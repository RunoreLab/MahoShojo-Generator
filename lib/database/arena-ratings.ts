import { queryFromD1 } from './core';
import { getBattleReportGenerationCombatantsByGenerationId, type BattleReportGenerationCombatantRow } from './battle-report-generation-combatants';

export type ArenaQueue = 'strict' | 'free';
export type ArenaEntityType = 'data_card' | 'preset';
export type ArenaRatingEventStatus = 'pending' | 'applied' | 'skipped' | 'failed';
export type WinnerSlot = 0 | 1 | 2;

export interface ArenaEntity {
  entityType: ArenaEntityType;
  entityId: string;
}

export interface ArenaRatingSnapshot {
  rating: number;
  games: number;
  wins: number;
  losses: number;
  draws: number;
}

export interface ArenaEligibilitySnapshot {
  status: string | null;
  mode: string | null;
  userId: number | null;
  ipAnonymized: string | null;
  language: string | null;
  selectedLevel: string | null;
  hasUserGuidance: number | null;
  hasAdjudicationEvents: number | null;
  readArenaHistory: number | null;
  readCurrentState: number | null;
  combatantCount: number | null;
  winner: string | null;
  extraJson: string | null;
}

export const INITIAL_RATING = 1000;
export const STRICT_DEDUP_WINDOW_MS = 10 * 60 * 1000;
export const FREE_DEDUP_WINDOW_MS = 10 * 60 * 1000;
export const STRICT_DAILY_LIMIT = 80;

export async function resetStrictArenaRatingForDataCard(dataCardId: string): Promise<void> {
  const id = typeof dataCardId === 'string' ? dataCardId.trim() : '';
  if (!id) return;

  try {
    const nowIso = new Date().toISOString();
    await queryFromD1(
      `UPDATE arena_ratings
       SET rating = ?, games = 0, wins = 0, losses = 0, draws = 0, updated_at = ?
       WHERE entity_type = 'data_card'
         AND entity_id = ?
         AND queue = 'strict'`,
      [INITIAL_RATING, nowIso, id]
    );
  } catch (error) {
    console.warn('重置严格排位分失败（降级为忽略）:', { dataCardId, error });
  }
}

export async function resetArenaRating(entity: ArenaEntity, queue: ArenaQueue | 'all' = 'all'): Promise<{ ok: boolean; error?: string }> {
  const entityType = entity?.entityType;
  const entityId = typeof entity?.entityId === 'string' ? entity.entityId.trim() : '';
  if ((entityType !== 'data_card' && entityType !== 'preset') || !entityId) {
    return { ok: false, error: '参数无效' };
  }

  const targetQueues: ArenaQueue[] = queue === 'all' ? ['strict', 'free'] : [queue];
  try {
    const nowIso = new Date().toISOString();
    for (const q of targetQueues) {
      await queryFromD1(
        `INSERT INTO arena_ratings (
           entity_type, entity_id, queue,
           rating, games, wins, losses, draws,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, 0, 0, 0, 0, ?, ?)
         ON CONFLICT(entity_type, entity_id, queue) DO UPDATE SET
           rating = excluded.rating,
           games = excluded.games,
           wins = excluded.wins,
           losses = excluded.losses,
           draws = excluded.draws,
           updated_at = excluded.updated_at`,
        [entityType, entityId, q, INITIAL_RATING, nowIso, nowIso]
      );
    }
    return { ok: true };
  } catch (error) {
    console.warn('重置 arena_ratings 失败（降级为忽略）:', { entity, queue, error });
    return { ok: false, error: error instanceof Error ? error.message : '未知错误' };
  }
}

const isFiniteInteger = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value);

const readD1Changes = (result: unknown): number => {
  const changes = (result as any)?.result?.[0]?.meta?.changes;
  return isFiniteInteger(changes) ? changes : 0;
};

const readD1Rows = <T>(result: unknown): T[] => {
  const rows = (result as any)?.result?.[0]?.results;
  return Array.isArray(rows) ? (rows as T[]) : [];
};

const startOfUtcDayIso = (): string => {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
  return start.toISOString();
};

const hasExceededStrictDailyLimit = async (userId: number): Promise<boolean> => {
  if (!Number.isFinite(userId) || userId <= 0) return false;
  try {
    const sinceIso = startOfUtcDayIso();
    const result = (await queryFromD1(
      `SELECT COUNT(*) as count
       FROM arena_rating_events
       WHERE queue = 'strict'
         AND status = 'applied'
         AND user_id = ?
         AND created_at >= ?`,
      [userId, sinceIso]
    )) as any;
    const row = readD1Rows<{ count: number }>(result)[0];
    const count = typeof row?.count === 'number' ? row.count : 0;
    return count >= STRICT_DAILY_LIMIT;
  } catch (error) {
    console.warn('读取 strict 每日计分次数失败（降级为不限制）:', error);
    return false;
  }
};

export const buildEntityKey = (entity: ArenaEntity): string => `${entity.entityType}:${entity.entityId}`;

export const buildPairKey = (a: ArenaEntity, b: ArenaEntity): string => {
  const parts = [buildEntityKey(a), buildEntityKey(b)].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
  return `${parts[0]}|${parts[1]}`;
};

export const buildArenaRatingEventId = (generationId: string, queue: ArenaQueue): string => `${generationId}:${queue}`;

export const computeKFactor = (games: number): number => {
  if (!Number.isFinite(games) || games < 0) return 16;
  if (games < 10) return 40;
  if (games < 30) return 24;
  return 16;
};

export interface EloUpdateResult {
  kA: number;
  kB: number;
  expectedA: number;
  expectedB: number;
  scoreA: number;
  scoreB: number;
  deltaA: number;
  deltaB: number;
}

export const computeEloUpdate = (
  a: ArenaRatingSnapshot,
  b: ArenaRatingSnapshot,
  winnerSlot: WinnerSlot
): EloUpdateResult => {
  const ratingA = Number.isFinite(a.rating) ? a.rating : INITIAL_RATING;
  const ratingB = Number.isFinite(b.rating) ? b.rating : INITIAL_RATING;

  const kA = computeKFactor(a.games);
  const kB = computeKFactor(b.games);

  const expectedA = 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
  const expectedB = 1 / (1 + Math.pow(10, (ratingA - ratingB) / 400));

  const scoreA = winnerSlot === 1 ? 1 : winnerSlot === 2 ? 0 : 0.5;
  const scoreB = winnerSlot === 2 ? 1 : winnerSlot === 1 ? 0 : 0.5;

  const deltaA = Math.round(kA * (scoreA - expectedA));
  const deltaB = Math.round(kB * (scoreB - expectedB));

  return { kA, kB, expectedA, expectedB, scoreA, scoreB, deltaA, deltaB };
};

const normalizeWinnerToken = (value: string): string => {
  let normalized = value.trim();
  normalized = normalized.replace(/\s+/g, ' ').trim();
  normalized = normalized.replace(/[（(][^）)]*[）)]\s*$/u, '').trim();
  normalized = normalized.replace(/[。！!？?；;：:、，,.\s]+$/u, '').trim();
  return normalized;
};

const isMultiWinner = (winner: string): boolean => /[,，、/&]/u.test(winner);

export type WinnerParseResult =
  | { ok: true; winnerSlot: WinnerSlot }
  | { ok: false; skipReason: 'winner-empty' | 'multi-winner' | 'winner-ambiguous' };

export const parseWinnerSlot = (winnerRaw: string | null, combatantNames: [string, string]): WinnerParseResult => {
  const winner = typeof winnerRaw === 'string' ? winnerRaw.trim() : '';
  if (!winner) return { ok: false, skipReason: 'winner-empty' };
  if (winner === '平局') return { ok: true, winnerSlot: 0 };
  if (isMultiWinner(winner)) return { ok: false, skipReason: 'multi-winner' };

  const normalizedWinner = normalizeWinnerToken(winner);
  const normalizedNames = combatantNames.map((name) => normalizeWinnerToken(name));

  const matches = normalizedNames
    .map((candidate, index) => (candidate && candidate === normalizedWinner ? index : -1))
    .filter((index) => index !== -1);

  if (matches.length === 1) {
    return { ok: true, winnerSlot: (matches[0] === 0 ? 1 : 2) as WinnerSlot };
  }

  // 容错：PVP 胜者行可能包含更长的描述（如“看守（魔女残骸） (P2)”）而参战者名仅保存 codename。
  // 允许做一次“包含式匹配”，但必须只命中唯一候选，避免误判。
  const includeMatches = normalizedNames
    .map((candidate, index) => {
      if (!candidate) return -1;
      if (candidate === normalizedWinner) return index;
      if (normalizedWinner.includes(candidate) || candidate.includes(normalizedWinner)) return index;
      return -1;
    })
    .filter((index) => index !== -1);
  if (includeMatches.length === 1) {
    return { ok: true, winnerSlot: (includeMatches[0] === 0 ? 1 : 2) as WinnerSlot };
  }

  return { ok: false, skipReason: 'winner-ambiguous' };
};

export const parseCombatantEntity = (combatant: BattleReportGenerationCombatantRow): ArenaEntity | null => {
  if (combatant.is_preset) {
    const entityId =
      (typeof combatant.template_id === 'string' && combatant.template_id.trim())
        ? combatant.template_id.trim()
        : combatant.name;
    return { entityType: 'preset', entityId };
  }

  if (typeof combatant.data_card_id === 'string' && combatant.data_card_id.trim()) {
    return { entityType: 'data_card', entityId: combatant.data_card_id.trim() };
  }

  return null;
};

const readExtraJsonBoolean = (extraJson: string | null, key: string): boolean | null => {
  if (typeof extraJson !== 'string' || !extraJson.trim()) return null;
  try {
    const parsed = JSON.parse(extraJson) as Record<string, unknown>;
    const value = parsed?.[key];
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return value !== 0;
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (normalized === 'true') return true;
      if (normalized === 'false') return false;
      if (normalized === '1') return true;
      if (normalized === '0') return false;
    }
    return null;
  } catch {
    return null;
  }
};

export const isStrictEligible = (snapshot: ArenaEligibilitySnapshot, combatants: BattleReportGenerationCombatantRow[]): boolean => {
  if (snapshot.status !== 'completed') return false;
  if (snapshot.combatantCount !== 2) return false;
  if (snapshot.ipAnonymized == null) return false;
  if (snapshot.mode !== 'classic') return false;
  if (snapshot.userId == null) return false;

  // 严格排位：语言必须为简体中文（zh-CN）。
  if ((snapshot.language ?? '').trim() !== 'zh-CN') return false;

  // 严格排位：等级必须为默认/未指定（selected_level 为空或 NULL）。
  if (typeof snapshot.selectedLevel === 'string' && snapshot.selectedLevel.trim()) return false;

  if (snapshot.hasUserGuidance !== 0) return false;
  if (snapshot.hasAdjudicationEvents !== 0) return false;
  if (snapshot.readArenaHistory !== 0) return false;
  if (snapshot.readCurrentState !== 0) return false;

  // 严格排位：禁止读取叙事历史。该字段目前落在 extra_json 中；缺失则按“宁可漏算”处理为不具备资格。
  if (readExtraJsonBoolean(snapshot.extraJson, 'readNarrativeHistory') !== false) return false;

  for (const combatant of combatants) {
    if (combatant.character_guidance && combatant.character_guidance.trim()) return false;
  }

  return true;
};

export const isFreeEligible = (snapshot: ArenaEligibilitySnapshot): boolean => {
  if (snapshot.status !== 'completed') return false;
  if (snapshot.combatantCount !== 2) return false;
  if (snapshot.ipAnonymized == null) return false;
  return true;
};

export async function getArenaEligibilitySnapshotByGenerationId(
  generationId: string
): Promise<ArenaEligibilitySnapshot | null> {
  try {
    const result = (await queryFromD1(
      `SELECT
        status,
        mode,
        user_id as userId,
        ip_anonymized as ipAnonymized,
        language,
        selected_level as selectedLevel,
        has_user_guidance as hasUserGuidance,
        has_adjudication_events as hasAdjudicationEvents,
        read_arena_history as readArenaHistory,
        read_current_state as readCurrentState,
        combatant_count as combatantCount,
        winner,
        extra_json as extraJson
      FROM battle_report_generations
      WHERE id = ?`,
      [generationId]
    )) as any;

    const rows = readD1Rows<ArenaEligibilitySnapshot>(result);
    return rows[0] ?? null;
  } catch (error) {
    console.error('读取 battle_report_generations 用于排位判定失败:', error);
    return null;
  }
}

const ensureArenaRatingsExist = async (queue: ArenaQueue, entities: [ArenaEntity, ArenaEntity]): Promise<void> => {
  const nowIso = new Date().toISOString();
  const [a, b] = entities;
  await queryFromD1(
    `INSERT OR IGNORE INTO arena_ratings (
      entity_type, entity_id, queue,
      rating, games, wins, losses, draws,
      created_at, updated_at
    ) VALUES
      (?, ?, ?, ?, 0, 0, 0, 0, ?, ?),
      (?, ?, ?, ?, 0, 0, 0, 0, ?, ?)`,
    [
      a.entityType, a.entityId, queue, INITIAL_RATING, nowIso, nowIso,
      b.entityType, b.entityId, queue, INITIAL_RATING, nowIso, nowIso,
    ]
  );
};

const getArenaRatings = async (queue: ArenaQueue, entities: [ArenaEntity, ArenaEntity]): Promise<[ArenaRatingSnapshot, ArenaRatingSnapshot] | null> => {
  const [a, b] = entities;
  const result = (await queryFromD1(
    `SELECT
      entity_type as entityType,
      entity_id as entityId,
      rating,
      games,
      wins,
      losses,
      draws
    FROM arena_ratings
    WHERE queue = ?
      AND ((entity_type = ? AND entity_id = ?) OR (entity_type = ? AND entity_id = ?))`,
    [queue, a.entityType, a.entityId, b.entityType, b.entityId]
  )) as any;

  const rows = readD1Rows<{
    entityType: ArenaEntityType;
    entityId: string;
    rating: number;
    games: number;
    wins: number;
    losses: number;
    draws: number;
  }>(result);

  const toSnapshot = (row: typeof rows[number] | undefined): ArenaRatingSnapshot => ({
    rating: typeof row?.rating === 'number' ? row.rating : INITIAL_RATING,
    games: typeof row?.games === 'number' ? row.games : 0,
    wins: typeof row?.wins === 'number' ? row.wins : 0,
    losses: typeof row?.losses === 'number' ? row.losses : 0,
    draws: typeof row?.draws === 'number' ? row.draws : 0,
  });

  const aRow = rows.find((row) => row.entityType === a.entityType && row.entityId === a.entityId);
  const bRow = rows.find((row) => row.entityType === b.entityType && row.entityId === b.entityId);
  if (!aRow || !bRow) return null;

  return [toSnapshot(aRow), toSnapshot(bRow)];
};

const hasRecentAppliedEventForPair = async (
  queue: ArenaQueue,
  pairKey: string,
  options: { userId: number } | { ipAnonymized: string },
  windowMs: number
): Promise<boolean> => {
  const sinceIso = new Date(Date.now() - windowMs).toISOString();
  const baseSql =
    `SELECT 1
     FROM arena_rating_events
     WHERE queue = ?
       AND status = 'applied'
       AND pair_key = ?
       AND created_at >= ?
       AND `;
  const { sql, params } = 'userId' in options
    ? { sql: `${baseSql} user_id = ? LIMIT 1`, params: [queue, pairKey, sinceIso, options.userId] }
    : { sql: `${baseSql} ip_anonymized = ? LIMIT 1`, params: [queue, pairKey, sinceIso, options.ipAnonymized] };

  try {
    const result = (await queryFromD1(sql, params)) as any;
    const rows = readD1Rows<unknown>(result);
    return rows.length > 0;
  } catch (error) {
    console.error('查询排位风控去重失败:', error);
    return false;
  }
};

const insertArenaRatingEvent = async (
  payload: {
    id: string;
    generationId: string;
    queue: ArenaQueue;
    status: ArenaRatingEventStatus;
    skipReason: string | null;
    userId: number | null;
    ipAnonymized: string | null;
    pairKey: string;
    a: ArenaEntity;
    b: ArenaEntity;
    winnerSlot: WinnerSlot;
    detailsJson?: Record<string, unknown> | null;
  }
): Promise<boolean> => {
  const nowIso = new Date().toISOString();
  const detailsJson = payload.detailsJson ? JSON.stringify(payload.detailsJson) : null;

  const result = (await queryFromD1(
    `INSERT OR IGNORE INTO arena_rating_events (
      id,
      generation_id,
      queue,
      status,
      skip_reason,
      user_id,
      ip_anonymized,
      pair_key,
      a_entity_type,
      a_entity_id,
      b_entity_type,
      b_entity_id,
      winner_slot,
      details_json,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      payload.id,
      payload.generationId,
      payload.queue,
      payload.status,
      payload.skipReason,
      payload.userId,
      payload.ipAnonymized,
      payload.pairKey,
      payload.a.entityType,
      payload.a.entityId,
      payload.b.entityType,
      payload.b.entityId,
      payload.winnerSlot,
      detailsJson,
      nowIso,
    ]
  )) as any;

  return readD1Changes(result) > 0;
};

interface ArenaRatingEventRowForApply {
  id: string;
  status: ArenaRatingEventStatus;
  skip_reason: string | null;
  a_before_rating: number | null;
  a_after_rating: number | null;
  a_delta: number | null;
  a_before_games: number | null;
  a_after_games: number | null;
  b_before_rating: number | null;
  b_after_rating: number | null;
  b_delta: number | null;
  b_before_games: number | null;
  b_after_games: number | null;
}

const getArenaRatingEventById = async (eventId: string): Promise<ArenaRatingEventRowForApply | null> => {
  try {
    const result = (await queryFromD1(
      `SELECT
        id,
        status,
        skip_reason,
        a_before_rating,
        a_after_rating,
        a_delta,
        a_before_games,
        a_after_games,
        b_before_rating,
        b_after_rating,
        b_delta,
        b_before_games,
        b_after_games
      FROM arena_rating_events
      WHERE id = ?
      LIMIT 1`,
      [eventId]
    )) as any;
    const rows = readD1Rows<ArenaRatingEventRowForApply>(result);
    return rows[0] ?? null;
  } catch (error) {
    console.error('读取 arena_rating_events 失败:', { eventId, error });
    return null;
  }
};

interface ArenaRatingEventComputedPayload {
  aBefore: ArenaRatingSnapshot;
  bBefore: ArenaRatingSnapshot;
  aAfter: ArenaRatingSnapshot;
  bAfter: ArenaRatingSnapshot;
  deltaA: number;
  deltaB: number;
  detailsJson: Record<string, unknown>;
}

const updateArenaRatingEventComputedFields = async (
  eventId: string,
  computed: ArenaRatingEventComputedPayload
): Promise<void> => {
  const result = (await queryFromD1(
    `UPDATE arena_rating_events
     SET
       a_before_rating = ?,
       a_after_rating = ?,
       a_delta = ?,
       a_before_games = ?,
       a_after_games = ?,
       b_before_rating = ?,
       b_after_rating = ?,
       b_delta = ?,
       b_before_games = ?,
       b_after_games = ?,
       details_json = ?
     WHERE id = ?
       AND status = 'pending'`,
    [
      computed.aBefore.rating,
      computed.aAfter.rating,
      computed.deltaA,
      computed.aBefore.games,
      computed.aAfter.games,
      computed.bBefore.rating,
      computed.bAfter.rating,
      computed.deltaB,
      computed.bBefore.games,
      computed.bAfter.games,
      JSON.stringify(computed.detailsJson),
      eventId,
    ]
  )) as any;

  const changes = readD1Changes(result);
  if (changes <= 0) {
    return;
  }
};

const markArenaRatingEventStatus = async (
  eventId: string,
  status: ArenaRatingEventStatus,
  options?: { skipReason?: string | null }
): Promise<void> => {
  const nowIso = new Date().toISOString();
  if (status === 'applied') {
    await queryFromD1(
      `UPDATE arena_rating_events
       SET status = 'applied', applied_at = ?
       WHERE id = ?`,
      [nowIso, eventId]
    );
    return;
  }

  await queryFromD1(
    `UPDATE arena_rating_events
     SET status = ?, skip_reason = COALESCE(?, skip_reason)
     WHERE id = ?`,
    [status, options?.skipReason ?? null, eventId]
  );
};

const applyArenaRatingsUpdateIfBothMatch = async (
  queue: ArenaQueue,
  entities: [ArenaEntity, ArenaEntity],
  computed: ArenaRatingEventComputedPayload
): Promise<'applied' | 'already-applied' | 'conflict'> => {
  const nowIso = new Date().toISOString();
  const [aEntity, bEntity] = entities;

  const result = (await queryFromD1(
    `WITH matched AS (
      SELECT entity_type, entity_id
      FROM arena_ratings
      WHERE queue = ?
        AND (
          (entity_type = ? AND entity_id = ? AND rating = ? AND games = ?)
          OR
          (entity_type = ? AND entity_id = ? AND rating = ? AND games = ?)
        )
    )
    UPDATE arena_ratings
    SET
      rating = CASE
        WHEN entity_type = ? AND entity_id = ? THEN ?
        WHEN entity_type = ? AND entity_id = ? THEN ?
        ELSE rating
      END,
      games = CASE
        WHEN entity_type = ? AND entity_id = ? THEN ?
        WHEN entity_type = ? AND entity_id = ? THEN ?
        ELSE games
      END,
      wins = CASE
        WHEN entity_type = ? AND entity_id = ? THEN ?
        WHEN entity_type = ? AND entity_id = ? THEN ?
        ELSE wins
      END,
      losses = CASE
        WHEN entity_type = ? AND entity_id = ? THEN ?
        WHEN entity_type = ? AND entity_id = ? THEN ?
        ELSE losses
      END,
      draws = CASE
        WHEN entity_type = ? AND entity_id = ? THEN ?
        WHEN entity_type = ? AND entity_id = ? THEN ?
        ELSE draws
      END,
      updated_at = ?
    WHERE queue = ?
      AND (
        (entity_type = ? AND entity_id = ?)
        OR
        (entity_type = ? AND entity_id = ?)
      )
      AND (SELECT COUNT(*) FROM matched) = 2`,
    [
      queue,
      aEntity.entityType, aEntity.entityId, computed.aBefore.rating, computed.aBefore.games,
      bEntity.entityType, bEntity.entityId, computed.bBefore.rating, computed.bBefore.games,

      aEntity.entityType, aEntity.entityId, computed.aAfter.rating,
      bEntity.entityType, bEntity.entityId, computed.bAfter.rating,

      aEntity.entityType, aEntity.entityId, computed.aAfter.games,
      bEntity.entityType, bEntity.entityId, computed.bAfter.games,

      aEntity.entityType, aEntity.entityId, computed.aAfter.wins,
      bEntity.entityType, bEntity.entityId, computed.bAfter.wins,

      aEntity.entityType, aEntity.entityId, computed.aAfter.losses,
      bEntity.entityType, bEntity.entityId, computed.bAfter.losses,

      aEntity.entityType, aEntity.entityId, computed.aAfter.draws,
      bEntity.entityType, bEntity.entityId, computed.bAfter.draws,

      nowIso,
      queue,
      aEntity.entityType, aEntity.entityId,
      bEntity.entityType, bEntity.entityId,
    ]
  )) as any;

  const changes = readD1Changes(result);
  if (changes === 2) return 'applied';

  const latest = await getArenaRatings(queue, entities);
  if (!latest) return 'conflict';
  const [aLatest, bLatest] = latest;
  if (
    aLatest.rating === computed.aAfter.rating &&
    aLatest.games === computed.aAfter.games &&
    bLatest.rating === computed.bAfter.rating &&
    bLatest.games === computed.bAfter.games
  ) {
    return 'already-applied';
  }
  return 'conflict';
};

export async function settleArenaRatingsForGeneration(
  generationId: string
): Promise<void> {
  try {
    const snapshot = await getArenaEligibilitySnapshotByGenerationId(generationId);
    if (!snapshot) return;
    if (snapshot.status !== 'completed') return;
    if (snapshot.combatantCount !== 2) return;

    const combatants = await getBattleReportGenerationCombatantsByGenerationId(generationId);
    if (combatants.length !== 2) return;

    const entities = combatants.map(parseCombatantEntity);
    if (!entities[0] || !entities[1]) return;
    const [aEntity, bEntity] = entities as [ArenaEntity, ArenaEntity];

    const pairKey = buildPairKey(aEntity, bEntity);

    let strictEligible = isStrictEligible(snapshot, combatants);
    const freeEligible = isFreeEligible(snapshot);
    if (!strictEligible && !freeEligible) return;

    const winnerParse = parseWinnerSlot(snapshot.winner, [combatants[0].name, combatants[1].name]);
    if (!winnerParse.ok) {
      if (strictEligible) {
        await insertArenaRatingEvent({
          id: buildArenaRatingEventId(generationId, 'strict'),
          generationId,
          queue: 'strict',
          status: 'skipped',
          skipReason: winnerParse.skipReason,
          userId: snapshot.userId,
          ipAnonymized: snapshot.ipAnonymized,
          pairKey,
          a: aEntity,
          b: bEntity,
          winnerSlot: 0,
        });
      }
      if (freeEligible) {
        await insertArenaRatingEvent({
          id: buildArenaRatingEventId(generationId, 'free'),
          generationId,
          queue: 'free',
          status: 'skipped',
          skipReason: winnerParse.skipReason,
          userId: snapshot.userId,
          ipAnonymized: snapshot.ipAnonymized,
          pairKey,
          a: aEntity,
          b: bEntity,
          winnerSlot: 0,
        });
      }
      return;
    }

    const winnerSlot = winnerParse.winnerSlot;

    const shouldApplyFree = freeEligible;
    let shouldApplyStrict = strictEligible;

    if (shouldApplyStrict && snapshot.userId != null) {
      const exceeded = await hasExceededStrictDailyLimit(snapshot.userId);
      if (exceeded) {
        await insertArenaRatingEvent({
          id: buildArenaRatingEventId(generationId, 'strict'),
          generationId,
          queue: 'strict',
          status: 'skipped',
          skipReason: 'daily-limit',
          userId: snapshot.userId,
          ipAnonymized: snapshot.ipAnonymized,
          pairKey,
          a: aEntity,
          b: bEntity,
          winnerSlot,
        });
        shouldApplyStrict = false;
        strictEligible = false;
      }
    }

    const queuesToApply: ArenaQueue[] = shouldApplyStrict ? ['strict', 'free'] : (shouldApplyFree ? ['free'] : []);
    for (const queue of queuesToApply) {
      const eventId = buildArenaRatingEventId(generationId, queue);

      const dedupKey =
        queue === 'strict'
          ? (snapshot.userId != null ? { userId: snapshot.userId } : null)
          : (snapshot.ipAnonymized != null ? { ipAnonymized: snapshot.ipAnonymized } : null);
      if (queue === 'free' && shouldApplyStrict) {
        // strict 命中时同时更新 free：为保持 strict ⊆ free，free 不再额外按 IP 去重。
        // （strict 已经要求登录，并会单独走 userId + pairKey 去重）
      } else if (dedupKey) {
        const deduped = await hasRecentAppliedEventForPair(
          queue,
          pairKey,
          dedupKey,
          queue === 'strict' ? STRICT_DEDUP_WINDOW_MS : FREE_DEDUP_WINDOW_MS
        );
        if (deduped) {
          await insertArenaRatingEvent({
            id: eventId,
            generationId,
            queue,
            status: 'skipped',
            skipReason: queue === 'strict' ? 'dedup-user-pair' : 'dedup-ip-pair',
            userId: snapshot.userId,
            ipAnonymized: snapshot.ipAnonymized,
            pairKey,
            a: aEntity,
            b: bEntity,
            winnerSlot,
          });
          continue;
        }
      }

      const inserted = await insertArenaRatingEvent({
        id: eventId,
        generationId,
        queue,
        status: 'pending',
        skipReason: null,
        userId: snapshot.userId,
        ipAnonymized: snapshot.ipAnonymized,
        pairKey,
        a: aEntity,
        b: bEntity,
        winnerSlot,
        detailsJson: {
          version: 1,
        },
      });

      await ensureArenaRatingsExist(queue, [aEntity, bEntity]);
      const current = await getArenaRatings(queue, [aEntity, bEntity]);
      if (!current) {
        await markArenaRatingEventStatus(eventId, 'failed', { skipReason: 'ratings-missing' });
        continue;
      }
      const [aCurrent, bCurrent] = current;

      const existingEvent = !inserted ? await getArenaRatingEventById(eventId) : null;
      if (!inserted && !existingEvent) {
        continue;
      }
      if (existingEvent && existingEvent.status !== 'pending') {
        continue;
      }

      const aWinInc = winnerSlot === 1 ? 1 : 0;
      const aLossInc = winnerSlot === 2 ? 1 : 0;
      const aDrawInc = winnerSlot === 0 ? 1 : 0;
      const bWinInc = winnerSlot === 2 ? 1 : 0;
      const bLossInc = winnerSlot === 1 ? 1 : 0;
      const bDrawInc = winnerSlot === 0 ? 1 : 0;

      let computed: ArenaRatingEventComputedPayload | null = null;

      if (
        existingEvent &&
        typeof existingEvent.a_before_rating === 'number' &&
        typeof existingEvent.a_after_rating === 'number' &&
        typeof existingEvent.a_before_games === 'number' &&
        typeof existingEvent.a_after_games === 'number' &&
        typeof existingEvent.a_delta === 'number' &&
        typeof existingEvent.b_before_rating === 'number' &&
        typeof existingEvent.b_after_rating === 'number' &&
        typeof existingEvent.b_before_games === 'number' &&
        typeof existingEvent.b_after_games === 'number' &&
        typeof existingEvent.b_delta === 'number'
      ) {
        const alreadyApplied =
          aCurrent.rating === existingEvent.a_after_rating &&
          aCurrent.games === existingEvent.a_after_games &&
          bCurrent.rating === existingEvent.b_after_rating &&
          bCurrent.games === existingEvent.b_after_games;
        if (alreadyApplied) {
          await markArenaRatingEventStatus(eventId, 'applied');
          continue;
        }

        const matchesBefore =
          aCurrent.rating === existingEvent.a_before_rating &&
          aCurrent.games === existingEvent.a_before_games &&
          bCurrent.rating === existingEvent.b_before_rating &&
          bCurrent.games === existingEvent.b_before_games;
        if (!matchesBefore) {
          await markArenaRatingEventStatus(eventId, 'failed', { skipReason: 'rating-conflict' });
          continue;
        }

        computed = {
          aBefore: aCurrent,
          bBefore: bCurrent,
          aAfter: {
            rating: existingEvent.a_after_rating,
            games: existingEvent.a_after_games,
            wins: aCurrent.wins + aWinInc,
            losses: aCurrent.losses + aLossInc,
            draws: aCurrent.draws + aDrawInc,
          },
          bAfter: {
            rating: existingEvent.b_after_rating,
            games: existingEvent.b_after_games,
            wins: bCurrent.wins + bWinInc,
            losses: bCurrent.losses + bLossInc,
            draws: bCurrent.draws + bDrawInc,
          },
          deltaA: existingEvent.a_delta,
          deltaB: existingEvent.b_delta,
          detailsJson: {
            version: 1,
            source: 'event-retry',
          },
        };
      } else {
        const elo = computeEloUpdate(aCurrent, bCurrent, winnerSlot);
        const aAfter: ArenaRatingSnapshot = {
          rating: aCurrent.rating + elo.deltaA,
          games: aCurrent.games + 1,
          wins: aCurrent.wins + aWinInc,
          losses: aCurrent.losses + aLossInc,
          draws: aCurrent.draws + aDrawInc,
        };
        const bAfter: ArenaRatingSnapshot = {
          rating: bCurrent.rating + elo.deltaB,
          games: bCurrent.games + 1,
          wins: bCurrent.wins + bWinInc,
          losses: bCurrent.losses + bLossInc,
          draws: bCurrent.draws + bDrawInc,
        };

        computed = {
          aBefore: aCurrent,
          bBefore: bCurrent,
          aAfter,
          bAfter,
          deltaA: elo.deltaA,
          deltaB: elo.deltaB,
          detailsJson: {
            version: 1,
            kA: elo.kA,
            kB: elo.kB,
            expectedA: elo.expectedA,
            expectedB: elo.expectedB,
            scoreA: elo.scoreA,
            scoreB: elo.scoreB,
          },
        };
        await updateArenaRatingEventComputedFields(eventId, computed);
      }

      const applied = await applyArenaRatingsUpdateIfBothMatch(queue, [aEntity, bEntity], computed);
      if (applied === 'applied' || applied === 'already-applied') {
        await markArenaRatingEventStatus(eventId, 'applied');
      } else {
        await markArenaRatingEventStatus(eventId, 'failed', { skipReason: 'rating-conflict' });
      }
    }
  } catch (error) {
    console.error('排位结算失败:', { generationId, error });
  }
}
