import type { NextRequest } from 'next/server';

import { getUserByAuthKey, queryFromD1 } from '@/lib/d1';
import { PRESET_LIST } from '@/lib/presets';
import { issueRankedMatchTicket, type RankedMatchEntity } from '@/lib/arena/ranked-match';
import { INITIAL_RATING, STRICT_DEDUP_WINDOW_MS, buildPairKey } from '@/lib/database/arena-ratings';
import { STRICT_MATCHMAKING_BANDS, pickStrictMatchmakingCandidate } from '@/lib/arena/ranked-matchmaking-logic';

export const config = {
  runtime: 'edge',
};

type DataCardOpponentCard = {
  id: string;
  name: string;
  description: string | null;
  data: string;
  is_public: number | boolean | null;
  updated_at: string | null;
  created_at: string | null;
  username: string | null;
  like_count: number | null;
  favorite_count: number | null;
  usage_count: number | null;
};

type DataCardOpponent = { entityType: 'data_card'; card: DataCardOpponentCard };
type PresetOpponent = { entityType: 'preset'; preset: { name: string; filename: string; type: 'magical-girl' | 'canshou' } };

type ApiSuccessResponse = {
  success: true;
  ticket: unknown;
  opponent: DataCardOpponent | PresetOpponent;
  note?: string;
};

type ApiErrorResponse = { success: false; error: string };

const readRows = <T,>(result: unknown): T[] => {
  const rows = (result as any)?.result?.[0]?.results;
  return Array.isArray(rows) ? (rows as T[]) : [];
};

const removePrivateKeys = (value: unknown): unknown => {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(removePrivateKeys);

  const obj = value as Record<string, unknown>;
  const cleaned: Record<string, unknown> = {};
  for (const key of Object.keys(obj)) {
    if (key.startsWith('_')) continue;
    cleaned[key] = removePrivateKeys(obj[key]);
  }
  return cleaned;
};

const stripPrivateKeysFromJsonString = (raw: string): string => {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (!trimmed) return raw;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    const cleaned = removePrivateKeys(parsed);
    return JSON.stringify(cleaned);
  } catch {
    return raw;
  }
};

const normalizeOptionalString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const normalizeString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const normalizeNonNegativeInt = (value: unknown): number => {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.floor(n));
};

const readPlayerEntity = (raw: unknown): RankedMatchEntity | null => {
  if (!raw || typeof raw !== 'object') return null;
  const anyRaw = raw as any;
  const entityType = anyRaw.entityType === 'preset' ? 'preset' : anyRaw.entityType === 'data_card' ? 'data_card' : null;
  const entityId = typeof anyRaw.entityId === 'string' ? anyRaw.entityId.trim() : '';
  if (!entityType || !entityId) return null;
  return { entityType, entityId };
};

const buildStrictPreflightErrors = (snapshot: {
  mode: string;
  language: string;
  selectedLevel: string;
  userGuidance: string;
  readArenaHistory: boolean;
  readCurrentState: boolean;
  readNarrativeHistory: boolean;
  adjudicationEventCount: number;
  characterGuidanceCount: number;
  scenarioEnabled: boolean;
  auxScenarioCount: number;
}): string[] => {
  const errors: string[] = [];
  if (snapshot.mode !== 'classic') errors.push('需为「经典模式」');
  if (snapshot.language !== 'zh-CN') errors.push('生成语言需为「简体中文」');
  if (snapshot.selectedLevel.trim()) errors.push('等级需为「默认」');
  if (snapshot.userGuidance.trim()) errors.push('需清空「故事引导」');
  if (snapshot.readArenaHistory) errors.push('需关闭「读取历战」');
  if (snapshot.readCurrentState) errors.push('需关闭「读取当前状态」');
  if (snapshot.readNarrativeHistory) errors.push('需关闭「读取叙事历史」');
  if (snapshot.adjudicationEventCount > 0) errors.push('需清空「随机判定器事件」');
  if (snapshot.characterGuidanceCount > 0) errors.push('需清空「角色行动引导」');
  if (snapshot.scenarioEnabled) errors.push('需关闭「情景模式」');
  if (snapshot.auxScenarioCount > 0) errors.push('需移除「辅助情景」');
  return errors;
};

type Candidate =
  | {
      kind: 'data_card';
      entity: { entityType: 'data_card'; entityId: string };
      rating: number;
      games: number;
    }
  | {
      kind: 'preset';
      entity: { entityType: 'preset'; entityId: string };
      rating: number;
      games: number;
      preset: { name: string; filename: string; type: 'magical-girl' | 'canshou' };
    };

type DataCardCandidate = Extract<Candidate, { kind: 'data_card' }>;
type PresetCandidate = Extract<Candidate, { kind: 'preset' }>;

const getEntityRating = async (entity: RankedMatchEntity): Promise<{ rating: number; games: number }> => {
  const result = (await queryFromD1(
    `SELECT rating, games
     FROM arena_ratings
     WHERE queue = 'strict'
       AND entity_type = ?
       AND entity_id = ?
     LIMIT 1`,
    [entity.entityType, entity.entityId]
  )) as any;
  const row = readRows<{ rating: number; games: number }>(result)[0];
  const rating = typeof row?.rating === 'number' ? row.rating : INITIAL_RATING;
  const games = typeof row?.games === 'number' ? row.games : 0;
  return { rating, games };
};

const readRecentPairKeys = async (userId: number, sinceIso: string): Promise<Set<string>> => {
  const result = (await queryFromD1(
    `SELECT pair_key
     FROM arena_rating_events
     WHERE queue = 'strict'
       AND status = 'applied'
       AND user_id = ?
       AND created_at >= ?
     ORDER BY created_at DESC
     LIMIT 200`,
    [userId, sinceIso]
  )) as any;
  const rows = readRows<{ pair_key: string }>(result);
  const set = new Set<string>();
  rows.forEach((row) => {
    const key = typeof row?.pair_key === 'string' ? row.pair_key.trim() : '';
    if (key) set.add(key);
  });
  return set;
};

const loadPresetCandidates = async (): Promise<Map<string, { rating: number; games: number }>> => {
  const ids = PRESET_LIST.map((p) => p.filename);
  if (ids.length === 0) return new Map();
  const placeholders = ids.map(() => '?').join(', ');
  const result = (await queryFromD1(
    `SELECT entity_id as entityId, rating, games
     FROM arena_ratings
     WHERE queue = 'strict'
       AND entity_type = 'preset'
       AND entity_id IN (${placeholders})`,
    ids
  )) as any;
  const rows = readRows<{ entityId: string; rating: number; games: number }>(result);
  const map = new Map<string, { rating: number; games: number }>();
  rows.forEach((row) => {
    const id = typeof row?.entityId === 'string' ? row.entityId.trim() : '';
    if (!id) return;
    map.set(id, {
      rating: typeof row.rating === 'number' ? row.rating : INITIAL_RATING,
      games: typeof row.games === 'number' ? row.games : 0,
    });
  });
  return map;
};

const fetchDataCardCandidatesByAbsDiff = async (input: {
  playerId: string;
  targetRating: number;
  minAbsDiffInclusive: number;
  maxAbsDiffInclusive: number;
  limit: number;
}): Promise<DataCardCandidate[]> => {
  const result = (await queryFromD1(
    `SELECT
      dc.id as id,
      ar.rating as rating,
      ar.games as games
     FROM data_cards dc
     INNER JOIN arena_ratings ar
       ON ar.queue = 'strict'
      AND ar.entity_type = 'data_card'
      AND ar.entity_id = dc.id
     WHERE dc.type = 'character'
       AND dc.deleted_at IS NULL
       AND dc.is_public = 1
       AND dc.review_status = 'approved'
       AND dc.id <> ?
       AND ar.games > 0
       AND ABS(ar.rating - ?) BETWEEN ? AND ?
     ORDER BY ABS(ar.rating - ?) ASC, ar.games ASC, dc.id ASC
     LIMIT ?`,
    [input.playerId, input.targetRating, input.minAbsDiffInclusive, input.maxAbsDiffInclusive, input.targetRating, input.limit]
  )) as any;

  const rows = readRows<{
    id: string;
    rating: number;
    games: number;
  }>(result);

  return rows
    .map((row) => {
      const id = typeof row.id === 'string' ? row.id.trim() : '';
      if (!id) return null;
      return {
        kind: 'data_card' as const,
        entity: { entityType: 'data_card' as const, entityId: id },
        rating: typeof row.rating === 'number' ? row.rating : INITIAL_RATING,
        games: typeof row.games === 'number' ? row.games : 0,
      };
    })
    .filter((item): item is DataCardCandidate => item !== null);
};

const fetchOpponentDataCardById = async (dataCardId: string): Promise<DataCardOpponentCard | null> => {
  const id = typeof dataCardId === 'string' ? dataCardId.trim() : '';
  if (!id) return null;

  const result = (await queryFromD1(
    `SELECT
      dc.id as id,
      dc.name as name,
      dc.description as description,
      dc.data as data,
      dc.is_public as is_public,
      dc.updated_at as updated_at,
      dc.created_at as created_at,
      dc.like_count as like_count,
      dc.favorite_count as favorite_count,
      dc.usage_count as usage_count,
      u.username as username
     FROM data_cards dc
     LEFT JOIN users u
       ON u.id = dc.user_id
     WHERE dc.id = ?
       AND dc.type = 'character'
       AND dc.deleted_at IS NULL
       AND dc.is_public = 1
       AND dc.review_status = 'approved'
     LIMIT 1`,
    [id]
  )) as any;

  const row = readRows<{
    id: string;
    name: string;
    description: string | null;
    data: string;
    is_public: number | boolean | null;
    updated_at: string | null;
    created_at: string | null;
    like_count?: number | null;
    favorite_count?: number | null;
    usage_count?: number | null;
    username: string | null;
  }>(result)[0];

  if (!row?.id) return null;

  const rawData = typeof row.data === 'string' ? row.data : '';
  const data = stripPrivateKeysFromJsonString(rawData);

  return {
    id,
    name: typeof row.name === 'string' ? row.name : '未命名',
    description: typeof row.description === 'string' ? row.description : null,
    data,
    is_public: row.is_public ?? null,
    updated_at: row.updated_at ?? null,
    created_at: row.created_at ?? null,
    username: row.username ?? null,
    like_count: typeof row.like_count === 'number' ? row.like_count : null,
    favorite_count: typeof row.favorite_count === 'number' ? row.favorite_count : null,
    usage_count: typeof row.usage_count === 'number' ? row.usage_count : null,
  };
};

const buildPresetCandidatesInBands = (input: {
  player: RankedMatchEntity;
  targetRating: number;
  presetRatings: Map<string, { rating: number; games: number }>;
}): PresetCandidate[] => {
  const maxAbsDiff = Math.max(...STRICT_MATCHMAKING_BANDS.map((b) => b.maxDiffInclusive));
  return PRESET_LIST
    .filter((preset) => preset.filename !== input.player.entityId)
    .map((preset) => {
      const stats = input.presetRatings.get(preset.filename) ?? { rating: INITIAL_RATING, games: 0 };
      const rating = stats.rating;
      const diff = Math.abs((Number.isFinite(rating) ? rating : INITIAL_RATING) - input.targetRating);
      if (diff > maxAbsDiff) return null;
      return {
        kind: 'preset' as const,
        entity: { entityType: 'preset' as const, entityId: preset.filename },
        rating,
        games: stats.games,
        preset: { name: preset.name, filename: preset.filename, type: preset.type },
      };
    })
    .filter((item): item is PresetCandidate => item !== null);
};

export default async function handler(req: NextRequest): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ success: false, error: 'Method not allowed' } satisfies ApiErrorResponse), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const authHeader = req.headers.get('authorization');
    const authKey = authHeader?.startsWith('Bearer ') ? authHeader.substring(7).trim() : null;
    const user = authKey ? await getUserByAuthKey(authKey) : null;
    if (!user?.id) {
      return new Response(JSON.stringify({ success: false, error: '需要先登录才能进行严格排位匹配' } satisfies ApiErrorResponse), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json();
    const player = readPlayerEntity(body?.player);
    if (!player) {
      return new Response(JSON.stringify({ success: false, error: '缺少有效的参战角色（player）' } satisfies ApiErrorResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 预检：必须先满足严格排位关键设置（否则签发票据也无意义）
    const snapshot = {
      mode: normalizeString(body?.mode),
      language: normalizeString(body?.language),
      selectedLevel: normalizeString(body?.selectedLevel),
      userGuidance: normalizeString(body?.settings?.userGuidance),
      readArenaHistory: Boolean(body?.settings?.readArenaHistory),
      readCurrentState: Boolean(body?.settings?.readCurrentState),
      readNarrativeHistory: Boolean(body?.settings?.readNarrativeHistory),
      adjudicationEventCount: normalizeNonNegativeInt(body?.adjudicationEventCount),
      characterGuidanceCount: normalizeNonNegativeInt(body?.characterGuidanceCount),
      scenarioEnabled: Boolean(body?.scenarioEnabled),
      auxScenarioCount: normalizeNonNegativeInt(body?.auxScenarioCount),
    };

    const preflightErrors = buildStrictPreflightErrors(snapshot);
    if (preflightErrors.length > 0) {
      return new Response(JSON.stringify({
        success: false,
        error: `当前设置不满足严格排位匹配前置条件：${preflightErrors.join('、')}`,
      } satisfies ApiErrorResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 校验 player 实体可用性
    if (player.entityType === 'preset') {
      const exists = PRESET_LIST.some((p) => p.filename === player.entityId);
      if (!exists) {
        return new Response(JSON.stringify({ success: false, error: '预设角色不存在，无法匹配' } satisfies ApiErrorResponse), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    } else {
      const result = (await queryFromD1(
        `SELECT id, type, user_id as userId, is_public as isPublic, review_status as reviewStatus, deleted_at as deletedAt
         FROM data_cards
         WHERE id = ?
         LIMIT 1`,
        [player.entityId]
      )) as any;
      const row = readRows<{
        id: string;
        type: string;
        userId: number;
        isPublic: number | boolean;
        reviewStatus: string | null;
        deletedAt: string | null;
      }>(result)[0];
      if (!row?.id || row.deletedAt) {
        return new Response(JSON.stringify({ success: false, error: '数据卡不存在或已被删除' } satisfies ApiErrorResponse), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (row.type !== 'character') {
        return new Response(JSON.stringify({ success: false, error: '仅支持“角色”类型的数据卡参与排位匹配' } satisfies ApiErrorResponse), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const isPublic = row.isPublic === 1 || row.isPublic === true;
      if (!isPublic) {
        return new Response(JSON.stringify({ success: false, error: '严格排位仅允许使用公开角色卡参与' } satisfies ApiErrorResponse), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (row.reviewStatus !== 'approved') {
        return new Response(JSON.stringify({ success: false, error: '严格排位仅允许使用已审核通过的公开角色卡' } satisfies ApiErrorResponse), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    const playerRating = await getEntityRating(player);
    const sinceIso = new Date(Date.now() - STRICT_DEDUP_WINDOW_MS).toISOString();
    const recentPairKeys = await readRecentPairKeys(user.id, sinceIso);
    const presetRatings = await loadPresetCandidates();

    const tryPick = async (allowRepeat: boolean): Promise<{ picked: Candidate | null; note?: string }> => {
      const playerId = player.entityType === 'data_card' ? player.entityId : '';

      const dataCardChunks = await Promise.all(
        STRICT_MATCHMAKING_BANDS.map((band) =>
          fetchDataCardCandidatesByAbsDiff({
            playerId,
            targetRating: playerRating.rating,
            minAbsDiffInclusive: band.minDiffInclusive,
            maxAbsDiffInclusive: band.maxDiffInclusive,
            limit: band.queryLimit,
          })
        )
      );
      const dataCardCandidates = dataCardChunks.flat();
      const presetCandidates = buildPresetCandidatesInBands({ player, targetRating: playerRating.rating, presetRatings });

      const byEntityKey = new Map<string, Candidate>();
      for (const candidate of [...dataCardCandidates, ...presetCandidates]) {
        if (candidate.entity.entityType === player.entityType && candidate.entity.entityId === player.entityId) continue;
        if (!allowRepeat) {
          const pairKey = buildPairKey(player, candidate.entity);
          if (recentPairKeys.has(pairKey)) continue;
        }
        byEntityKey.set(`${candidate.entity.entityType}:${candidate.entity.entityId}`, candidate);
      }

      const merged = Array.from(byEntityKey.values());
      if (merged.length === 0) return { picked: null };

      const picked = pickStrictMatchmakingCandidate(merged, playerRating.rating);
      return { picked };
    };

    const primary = await tryPick(false);
    const fallback = primary.picked ? null : await tryPick(true);
    const picked = primary.picked ?? fallback?.picked ?? null;
    const note =
      primary.picked
        ? undefined
        : (picked ? '候选对手较少，已允许在时间窗内重复匹配' : undefined);

    if (!picked) {
      return new Response(JSON.stringify({ success: false, error: '当前没有可匹配的对手（已参加严格排位的公开角色不足）' } satisfies ApiErrorResponse), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    let opponent: DataCardOpponent | PresetOpponent;
    if (picked.kind === 'data_card') {
      const card = await fetchOpponentDataCardById(picked.entity.entityId);
      if (!card) {
        return new Response(JSON.stringify({ success: false, error: '匹配到的对手数据卡不可用，请稍后重试' } satisfies ApiErrorResponse), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      opponent = { entityType: 'data_card', card };
    } else {
      opponent = { entityType: 'preset', preset: picked.preset };
    }

    const ticketResult = await issueRankedMatchTicket({
      userId: user.id,
      player,
      opponent: picked.entity,
      mode: 'classic',
      selectedLevel: normalizeOptionalString(body?.selectedLevel),
      language: normalizeOptionalString(body?.language),
      storyLength: normalizeOptionalString(body?.storyLength),
      expiresInMs: STRICT_DEDUP_WINDOW_MS,
    });
    if (!ticketResult.ok) {
      return new Response(JSON.stringify({ success: false, error: ticketResult.error } satisfies ApiErrorResponse), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const response: ApiSuccessResponse = { success: true, ticket: ticketResult.ticket, opponent, ...(note ? { note } : {}) };

    return new Response(JSON.stringify(response), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    console.error('严格排位匹配失败:', error);
    return new Response(JSON.stringify({ success: false, error: '匹配失败，服务器内部错误' } satisfies ApiErrorResponse), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
