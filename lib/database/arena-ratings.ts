import { queryFromD1 } from './core';
import { getBattleReportGenerationCombatantsByGenerationId, type BattleReportGenerationCombatantRow } from './battle-report-generation-combatants';
import { PRESET_LIST } from '@/lib/presets';
import { isStrictRankedModelBlacklisted } from '@/lib/arena/ranked-model-policy';
import { computeArenaBaseTier, type ArenaBaseTier } from '@/lib/arena/tier';

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
  hasScenario: number | boolean | null;
  hasUserGuidance: number | null;
  userGuidancePreview: string | null;
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

const STRICT_MAX_ABS_DIFF_BY_TIER: Record<ArenaBaseTier, number> = {
  '无牌': 2000,
  '白牌': 1000,
  '字牌': 900,
  '花牌': 800,
  '权杖': 1000,
};

const getStrictMaxAbsDiffForRatings = (a: ArenaRatingSnapshot, b: ArenaRatingSnapshot): number => {
  const aTier = computeArenaBaseTier(a.rating, a.games);
  const bTier = computeArenaBaseTier(b.rating, b.games);
  const pick = a.rating > b.rating ? aTier : b.rating > a.rating ? bTier : (a.games >= b.games ? aTier : bTier);
  return STRICT_MAX_ABS_DIFF_BY_TIER[pick] ?? 1000;
};

export type StrictDailyUsage = {
  sinceIso: string;
  used: number;
  limit: number;
  exceeded: boolean;
};

export async function resetStrictArenaRatingForDataCard(dataCardId: string): Promise<void> {
  const id = typeof dataCardId === 'string' ? dataCardId.trim() : '';
  if (!id) return;

  try {
    const nowIso = new Date().toISOString();
    await (async () => {
      try {
        await queryFromD1(
          `UPDATE arena_ratings
           SET rating = ?, games = 0, wins = 0, losses = 0, draws = 0, last_delta = NULL, last_applied_at = NULL, updated_at = ?
           WHERE entity_type = 'data_card'
             AND entity_id = ?
             AND queue = 'strict'`,
          [INITIAL_RATING, nowIso, id]
        );
      } catch {
        await queryFromD1(
          `UPDATE arena_ratings
           SET rating = ?, games = 0, wins = 0, losses = 0, draws = 0, updated_at = ?
           WHERE entity_type = 'data_card'
             AND entity_id = ?
             AND queue = 'strict'`,
          [INITIAL_RATING, nowIso, id]
        );
      }
    })();
  } catch (error) {
    console.warn('重置严格排位分失败（降级为忽略）:', { dataCardId, error });
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

export const getStrictDailyUsage = async (userId: number): Promise<StrictDailyUsage | null> => {
  if (!Number.isFinite(userId) || userId <= 0) return null;
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
    const used = Math.max(0, Math.floor(count));
    return {
      sinceIso,
      used,
      limit: STRICT_DAILY_LIMIT,
      exceeded: used >= STRICT_DAILY_LIMIT,
    };
  } catch (error) {
    console.warn('读取 strict 每日计分次数失败（降级为不限制）:', error);
    return null;
  }
};

const hasExceededStrictDailyLimit = async (userId: number): Promise<boolean> => {
  const usage = await getStrictDailyUsage(userId);
  return usage?.exceeded ?? false;
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

  // 统一 Unicode 形态，尽量降低全角/兼容字符差异对匹配的影响
  try {
    normalized = normalized.normalize('NFKC');
  } catch {
    // 极少数运行环境可能不支持 normalize；忽略即可
  }

  // 去掉常见 Markdown/列表前缀（避免误伤正文，仅作用于“winner 一行/短 token”）
  normalized = normalized.replace(/^[>\-\*\+\s]+/g, '').trim();

  // 去掉行内 code 标记
  normalized = normalized.replace(/`/g, '').trim();

  // 仅剥离“成对包裹”的 Markdown 修饰，避免把角色代号中的 "_" 误删（如 I_moly）。
  for (let i = 0; i < 3; i += 1) {
    const prev = normalized;
    normalized = normalized
      .replace(/^\*\*(.+)\*\*$/u, '$1')
      .replace(/^__(.+)__$/u, '$1')
      .replace(/^\*(.+)\*$/u, '$1')
      .replace(/^_(.+)_$/u, '$1')
      .replace(/^~~(.+)~~$/u, '$1')
      .trim();
    if (normalized === prev) break;
  }

  normalized = normalized.replace(/[*~]/g, '').trim();

  // 去掉“胜利者/胜者/赢家/winner:” 等标签前缀
  normalized = normalized.replace(/^(?:胜利者|胜者|赢家|winner)\s*[:：]\s*/i, '').trim();

  // 去掉常见引号/括号包裹
  normalized = normalized
    .replace(/^[\s"'“”‘’【】\[\]<>《》]+/g, '')
    .replace(/[\s"'“”‘’【】\[\]<>《》]+$/g, '')
    .trim();

  normalized = normalized.replace(/\s+/g, ' ').trim();

  // 去掉结尾括号尾注（如：雪绒（P1） / 看守（魔女残骸））
  normalized = normalized.replace(/[（(][^）)]*[）)]\s*$/u, '').trim();

  // 去掉尾部标点/空白
  normalized = normalized.replace(/[。！!？?；;：:、，,.\s]+$/u, '').trim();

  return normalized;
};

const normalizeForSimilarity = (value: string): string => {
  let normalized = value.trim();
  try {
    normalized = normalized.normalize('NFKC');
  } catch {
    // ignore
  }
  normalized = normalized.toLowerCase();
  // 尽量消除“符号噪声”，避免相似度被标点/空白稀释
  normalized = normalized.replace(/[\s"'“”‘’【】\[\]<>《》()（）`~]/gu, '');
  normalized = normalized.replace(/[。！!？?；;：:、，,./\\/&＋+｜|]/gu, '');
  return normalized;
};

const levenshteinDistance = (a: string, b: string): number => {
  if (a === b) return 0;
  const aLen = a.length;
  const bLen = b.length;
  if (aLen === 0) return bLen;
  if (bLen === 0) return aLen;

  // 经典 DP：仅保留一行，降低内存占用
  const prev: number[] = Array.from({ length: bLen + 1 }, (_, i) => i);
  const curr: number[] = new Array(bLen + 1);

  for (let i = 1; i <= aLen; i += 1) {
    curr[0] = i;
    const aChar = a.charCodeAt(i - 1);
    for (let j = 1; j <= bLen; j += 1) {
      const cost = aChar === b.charCodeAt(j - 1) ? 0 : 1;
      const del = prev[j]! + 1;
      const ins = curr[j - 1]! + 1;
      const sub = prev[j - 1]! + cost;
      curr[j] = Math.min(del, ins, sub);
    }
    for (let j = 0; j <= bLen; j += 1) prev[j] = curr[j]!;
  }

  return prev[bLen]!;
};

const normalizedSimilarity = (a: string, b: string): number => {
  const aNorm = normalizeForSimilarity(a);
  const bNorm = normalizeForSimilarity(b);
  const maxLen = Math.max(aNorm.length, bNorm.length);
  if (maxLen === 0) return 0;
  if (aNorm.length < 3 || bNorm.length < 3) return 0;
  const dist = levenshteinDistance(aNorm, bNorm);
  return 1 - dist / maxLen;
};

const pickUniqueSimilarityIndex = (
  target: string,
  candidates: string[],
  options?: { threshold?: number; gap?: number }
): number | null => {
  const threshold = options?.threshold ?? 0.67;
  const gap = options?.gap ?? 0.05;

  const scores = candidates.map((c) => normalizedSimilarity(target, c));
  let bestIndex = -1;
  let bestScore = -Infinity;
  let secondScore = -Infinity;

  for (let i = 0; i < scores.length; i += 1) {
    const score = scores[i]!;
    if (score > bestScore) {
      secondScore = bestScore;
      bestScore = score;
      bestIndex = i;
    } else if (score > secondScore) {
      secondScore = score;
    }
  }

  if (bestIndex < 0) return null;
  if (bestScore < threshold) return null;
  if (bestScore - secondScore < gap) return null;
  if (secondScore >= threshold) return null;
  return bestIndex;
};

const MULTI_SEPARATOR_RE = /[,，、/&+|\/／＆＋｜]/u;
const MULTI_SPLIT_RE = /\s*(?:,|，|、|\/|／|&|＆|\+|＋|\||｜)\s*/u;

const isMultiWinner = (winner: string): boolean => MULTI_SEPARATOR_RE.test(winner);

const hasExplicitMultiWinnerKeyword = (winner: string): boolean => {
  const text = winner.trim();
  if (!text) return false;
  return /共同(?:胜利|获胜|赢)|双赢|都(?:获胜|胜利)/u.test(text);
};

const splitWinnerParts = (winner: string): string[] => {
  return winner
    .split(MULTI_SPLIT_RE)
    .map((t) => t.trim())
    .filter(Boolean);
};

const detectCandidateMention = (winnerText: string, candidate: string, threshold = 0.67): boolean => {
  const text = normalizeForSimilarity(winnerText);
  const needle = normalizeForSimilarity(candidate);
  if (!needle) return false;
  if (needle.length < 3) return text.includes(needle);
  if (text.includes(needle)) return true;

  // 在长文本中，按候选名长度做滑窗，避免整段相似度被稀释
  const baseLen = needle.length;
  const minLen = Math.max(3, baseLen - 1);
  const maxLen = baseLen + 1;
  let best = 0;

  for (let len = minLen; len <= maxLen; len += 1) {
    for (let i = 0; i + len <= text.length; i += 1) {
      const sub = text.slice(i, i + len);
      const score = 1 - levenshteinDistance(sub, needle) / Math.max(sub.length, needle.length);
      if (score > best) best = score;
      if (best >= threshold) return true;
    }
  }
  return best >= threshold;
};

const PRESET_FILENAME_SET = new Set(PRESET_LIST.map((preset) => preset.filename));
const PRESET_FILENAME_BY_NAME = new Map(PRESET_LIST.map((preset) => [preset.name.trim(), preset.filename]));

const resolvePresetEntityId = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (PRESET_FILENAME_SET.has(trimmed)) return trimmed;
  return PRESET_FILENAME_BY_NAME.get(trimmed) ?? null;
};

export type WinnerParseResult =
  | { ok: true; winnerSlot: WinnerSlot }
  | { ok: false; skipReason: 'winner-empty' | 'multi-winner' | 'winner-ambiguous' };

export const parseWinnerSlot = (winnerRaw: string | null, combatantNames: [string, string]): WinnerParseResult => {
  const winner = typeof winnerRaw === 'string' ? winnerRaw.trim() : '';
  if (!winner) return { ok: false, skipReason: 'winner-empty' };
  const maybeMultiWinner = isMultiWinner(winner) || hasExplicitMultiWinnerKeyword(winner);

  const normalizedWinner = normalizeWinnerToken(winner);
  if (!normalizedWinner) return { ok: false, skipReason: 'winner-empty' };

  const loweredWinner = normalizedWinner.toLowerCase();
  if (
    normalizedWinner === '平局' ||
    normalizedWinner === '平手' ||
    normalizedWinner === '打平' ||
    loweredWinner === 'draw' ||
    loweredWinner === 'tie' ||
    loweredWinner === 'tied'
  ) {
    return { ok: true, winnerSlot: 0 };
  }

  const normalizedNames = combatantNames.map((name) => normalizeWinnerToken(name));

  const matchSingleWinnerToIndex = (winnerToken: string): number | null => {
    const token = normalizeWinnerToken(winnerToken);
    if (!token) return null;

    const exact = normalizedNames
      .map((candidate, index) => (candidate && candidate === token ? index : -1))
      .filter((index) => index !== -1);
    if (exact.length === 1) return exact[0]!;

    // 容错：winner 可能包含额外描述（如“看守（魔女残骸） (P2)”）
    const include = normalizedNames
      .map((candidate, index) => {
        if (!candidate) return -1;
        if (candidate === token) return index;
        if (token.includes(candidate) || candidate.includes(token)) return index;
        return -1;
      })
      .filter((index) => index !== -1);
    if (include.length === 1) return include[0]!;

    // 容错：参战者名称可能被“称号/前后缀”显著拉长，导致整体相似度被稀释；
    // 改为在候选名内部做“滑窗相似度/提及”检测，以覆盖异体字 + 称号场景。
    const mention = normalizedNames
      .map((candidate, index) => {
        if (!candidate) return -1;
        return detectCandidateMention(candidate, token) ? index : -1;
      })
      .filter((index) => index !== -1);
    if (mention.length === 1) return mention[0]!;
    if (mention.length > 1) return null;

    const similarityIndex = pickUniqueSimilarityIndex(token, normalizedNames);
    return similarityIndex;
  };

  // 处理“多胜者/共同胜利”类输出：
  // - 若能在阈值内唯一匹配到 1 名参战者，则计分
  // - 若命中 2 名参战者（哪怕其中一名仅能通过相似度命中），则视为多胜者，跳过计分
  if (maybeMultiWinner) {
    const parts = splitWinnerParts(winner);
    const matched = new Set<number>();
    for (const part of parts) {
      const index = matchSingleWinnerToIndex(part);
      if (index != null) matched.add(index);
    }

    const mentionA = detectCandidateMention(winner, combatantNames[0]);
    const mentionB = detectCandidateMention(winner, combatantNames[1]);
    if (mentionA && mentionB) {
      return { ok: false, skipReason: 'multi-winner' };
    }

    if (matched.size === 1) {
      const only = [...matched][0]!;
      return { ok: true, winnerSlot: (only === 0 ? 1 : 2) as WinnerSlot };
    }
    if (matched.size > 1) {
      return { ok: false, skipReason: 'multi-winner' };
    }

    // 多胜者文本但无法命中任何参战者：按 multi-winner 跳过，避免误判
    return { ok: false, skipReason: 'multi-winner' };
  }

  const singleIndex = matchSingleWinnerToIndex(normalizedWinner);
  if (singleIndex != null) {
    return { ok: true, winnerSlot: (singleIndex === 0 ? 1 : 2) as WinnerSlot };
  }

  return { ok: false, skipReason: maybeMultiWinner ? 'multi-winner' : 'winner-ambiguous' };
};

export const parseCombatantEntity = (combatant: BattleReportGenerationCombatantRow): ArenaEntity | null => {
  if (combatant.is_preset) {
    const resolved = resolvePresetEntityId(combatant.template_id) ?? resolvePresetEntityId(combatant.name);
    if (!resolved) return null;
    return { entityType: 'preset', entityId: resolved };
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

const readExtraJsonString = (extraJson: string | null, key: string): string | null => {
  if (typeof extraJson !== 'string' || !extraJson.trim()) return null;
  try {
    const parsed = JSON.parse(extraJson) as Record<string, unknown>;
    const raw = parsed?.[key];
    if (typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    return trimmed ? trimmed : null;
  } catch {
    return null;
  }
};

export const isStrictEligible = (snapshot: ArenaEligibilitySnapshot, combatants: BattleReportGenerationCombatantRow[]): boolean => {
  if (snapshot.status !== 'completed') return false;
  if (snapshot.combatantCount !== 2) return false;
  if (snapshot.ipAnonymized == null) return false;
  if (snapshot.userId == null) return false;

  const seasonMode = readExtraJsonString(snapshot.extraJson, 'seasonMode');
  const requiredMode = seasonMode === 'classic' || seasonMode === 'kizuna' || seasonMode === 'daily' || seasonMode === 'scenario'
    ? seasonMode
    : 'classic';
  if ((snapshot.mode ?? '').trim() !== requiredMode) return false;

  // 兼容旧版 strict（排位匹配票据）与新版 strict（1+3 手选对手）：
  // - 旧版：必须存在 rankedMatchOk=true
  // - 新版：通过 arenaStrictPolicy 标记启用（避免历史战报被“回溯计分”）
  const strictPolicy = readExtraJsonString(snapshot.extraJson, 'arenaStrictPolicy');
  if (strictPolicy !== '1+3:v1') {
    // 严格排位（旧版）：必须由“排位匹配”签发票据并在生成时验证通过。
    // 缺失/无效都按“宁可漏算”处理为不具备资格（用于禁止 strict 自由挑对手）。
    if (readExtraJsonBoolean(snapshot.extraJson, 'rankedMatchOk') !== true) return false;
  }

  // 严格排位：禁止使用黑名单模型（生成逻辑不稳定，不适合作为排位依据）。
  if (isStrictRankedModelBlacklisted(readExtraJsonString(snapshot.extraJson, 'resolvedModelOverride'))) return false;

  // 严格排位：语言必须为简体中文（zh-CN）。
  if ((snapshot.language ?? '').trim() !== 'zh-CN') return false;

  // 严格排位：等级必须为默认/未指定（selected_level 为空或 NULL）。
  if (typeof snapshot.selectedLevel === 'string' && snapshot.selectedLevel.trim()) return false;

  const requiredStoryGuidance = readExtraJsonString(snapshot.extraJson, 'seasonStoryGuidance');
  if (requiredStoryGuidance) {
    const actual = typeof snapshot.userGuidancePreview === 'string' ? snapshot.userGuidancePreview.trim() : '';
    if (!actual) return false;
    if (actual !== requiredStoryGuidance) return false;
  } else {
    if (snapshot.hasUserGuidance !== 0) return false;
  }

  if (requiredMode === 'scenario') {
    const hasScenario = snapshot.hasScenario === 1 || snapshot.hasScenario === true;
    if (!hasScenario) return false;

    const requiredPreset = readExtraJsonString(snapshot.extraJson, 'seasonScenarioPreset');
    if (requiredPreset) {
      const actualFileName = readExtraJsonString(snapshot.extraJson, 'scenarioFileName');
      if (!actualFileName || actualFileName !== requiredPreset) return false;
    }

    // 严格排位：情景模式下也禁止辅助情景（缺失则视为无辅助情景）。
    if (readExtraJsonBoolean(snapshot.extraJson, 'auxScenarioCount') === true) return false;
  }

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
  // 自由排位默认关闭：只有显式开启时才允许结算（缺失则视为旧记录，按开启处理）。
  if (readExtraJsonBoolean(snapshot.extraJson, 'arenaFreeRankingEnabled') === false) return false;
  return true;
};

const validateStrictPublicDataCardEntities = async (
  entities: [ArenaEntity, ArenaEntity]
): Promise<{ ok: true } | { ok: false; skipReason: 'strict-not-public' | 'strict-not-approved' | 'strict-not-character' | 'strict-card-missing' }> => {
  const dataCardIds = entities
    .filter((e) => e.entityType === 'data_card')
    .map((e) => e.entityId)
    .filter(Boolean);

  if (dataCardIds.length === 0) return { ok: true };

  try {
    const result = (await queryFromD1(
      `SELECT id, type, is_public as isPublic, review_status as reviewStatus, deleted_at as deletedAt
       FROM data_cards
       WHERE id IN (${dataCardIds.map(() => '?').join(', ')})`,
      dataCardIds
    )) as any;

    const rows = readD1Rows<{
      id: string;
      type: string;
      isPublic: number | boolean | null;
      reviewStatus: string | null;
      deletedAt: string | null;
    }>(result);

    const byId = new Map<string, (typeof rows)[number]>();
    rows.forEach((row) => {
      const id = typeof row?.id === 'string' ? row.id.trim() : '';
      if (!id) return;
      byId.set(id, row);
    });

    for (const id of dataCardIds) {
      const row = byId.get(id);
      if (!row || row.deletedAt) return { ok: false, skipReason: 'strict-card-missing' };
      if (row.type !== 'character') return { ok: false, skipReason: 'strict-not-character' };
      const isPublic = row.isPublic === 1 || row.isPublic === true;
      if (!isPublic) return { ok: false, skipReason: 'strict-not-public' };
      if (row.reviewStatus !== 'approved') return { ok: false, skipReason: 'strict-not-approved' };
    }

    return { ok: true };
  } catch (error) {
    console.warn('校验严格排位数据卡可用性失败（降级为不计 strict）:', error);
    return { ok: false, skipReason: 'strict-card-missing' };
  }
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
        has_scenario as hasScenario,
        has_user_guidance as hasUserGuidance,
        user_guidance_preview as userGuidancePreview,
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
  details_json: string | null;
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
        details_json,
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

  const matchGuardParams = [
    queue,
    aEntity.entityType, aEntity.entityId, computed.aBefore.rating, computed.aBefore.games,
    bEntity.entityType, bEntity.entityId, computed.bBefore.rating, computed.bBefore.games,
  ];

  const ratingParams = [
    aEntity.entityType, aEntity.entityId, computed.aAfter.rating,
    bEntity.entityType, bEntity.entityId, computed.bAfter.rating,
  ];
  const gamesParams = [
    aEntity.entityType, aEntity.entityId, computed.aAfter.games,
    bEntity.entityType, bEntity.entityId, computed.bAfter.games,
  ];
  const winsParams = [
    aEntity.entityType, aEntity.entityId, computed.aAfter.wins,
    bEntity.entityType, bEntity.entityId, computed.bAfter.wins,
  ];
  const lossesParams = [
    aEntity.entityType, aEntity.entityId, computed.aAfter.losses,
    bEntity.entityType, bEntity.entityId, computed.bAfter.losses,
  ];
  const drawsParams = [
    aEntity.entityType, aEntity.entityId, computed.aAfter.draws,
    bEntity.entityType, bEntity.entityId, computed.bAfter.draws,
  ];

  const whereParams = [queue, aEntity.entityType, aEntity.entityId, bEntity.entityType, bEntity.entityId];

  const paramsOld = [
    ...matchGuardParams,
    ...ratingParams,
    ...gamesParams,
    ...winsParams,
    ...lossesParams,
    ...drawsParams,
    nowIso,
    ...whereParams,
  ];

  const sqlOld = `WITH matched AS (
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
      AND (SELECT COUNT(*) FROM matched) = 2`;

  const lastDeltaParams = [
    aEntity.entityType, aEntity.entityId, computed.deltaA,
    bEntity.entityType, bEntity.entityId, computed.deltaB,
  ];
  const lastAppliedAtParams = [
    aEntity.entityType, aEntity.entityId, nowIso,
    bEntity.entityType, bEntity.entityId, nowIso,
  ];

  const paramsNew = [
    ...matchGuardParams,
    ...ratingParams,
    ...gamesParams,
    ...winsParams,
    ...lossesParams,
    ...drawsParams,
    ...lastDeltaParams,
    ...lastAppliedAtParams,
    nowIso,
    ...whereParams,
  ];

  const sqlNew = `WITH matched AS (
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
      last_delta = CASE
        WHEN entity_type = ? AND entity_id = ? THEN ?
        WHEN entity_type = ? AND entity_id = ? THEN ?
        ELSE last_delta
      END,
      last_applied_at = CASE
        WHEN entity_type = ? AND entity_id = ? THEN ?
        WHEN entity_type = ? AND entity_id = ? THEN ?
        ELSE last_applied_at
      END,
      updated_at = ?
    WHERE queue = ?
      AND (
        (entity_type = ? AND entity_id = ?)
        OR
        (entity_type = ? AND entity_id = ?)
      )
      AND (SELECT COUNT(*) FROM matched) = 2`;

  const runUpdate = async (sql: string, params: unknown[]): Promise<number> => {
    const result = (await queryFromD1(sql, params)) as any;
    return readD1Changes(result);
  };

  const changes = await (async () => {
    try {
      return await runUpdate(sqlNew, paramsNew);
    } catch (error) {
      console.warn('更新 arena_ratings.last_delta 失败（将回退到旧结构）:', error);
      return await runUpdate(sqlOld, paramsOld);
    }
  })();
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
    const isNewStrictPolicy = readExtraJsonString(snapshot.extraJson, 'arenaStrictPolicy') === '1+3:v1';

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

    if (shouldApplyStrict && isNewStrictPolicy && snapshot.userId != null) {
      const deduped = await hasRecentAppliedEventForPair(
        'strict',
        pairKey,
        { userId: snapshot.userId },
        STRICT_DEDUP_WINDOW_MS
      );
      if (deduped) {
        await insertArenaRatingEvent({
          id: buildArenaRatingEventId(generationId, 'strict'),
          generationId,
          queue: 'strict',
          status: 'skipped',
          skipReason: 'dedup-user-pair',
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

    const queuesToApply: ArenaQueue[] = [];
    if (shouldApplyStrict) queuesToApply.push('strict');
    if (shouldApplyFree) queuesToApply.push('free');
    for (const queue of queuesToApply) {
      const eventId = buildArenaRatingEventId(generationId, queue);

      if (queue === 'free' && shouldApplyStrict) {
        // strict 命中时同时更新 free：为保持 strict ⊆ free，free 不再额外按 IP 去重。
        // 否则可能出现 strict 已结算、但 free 被风控跳过的情况。
      } else if (queue === 'free' && snapshot.ipAnonymized != null) {
        const deduped = await hasRecentAppliedEventForPair(
          queue,
          pairKey,
          { ipAnonymized: snapshot.ipAnonymized },
          FREE_DEDUP_WINDOW_MS
        );
        if (deduped) {
          await insertArenaRatingEvent({
            id: eventId,
            generationId,
            queue,
            status: 'skipped',
            skipReason: 'dedup-ip-pair',
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
          version: 2,
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

      if (queue === 'strict' && isNewStrictPolicy) {
        const strictEntities = await validateStrictPublicDataCardEntities([aEntity, bEntity]);
        if (!strictEntities.ok) {
          await markArenaRatingEventStatus(eventId, 'skipped', { skipReason: strictEntities.skipReason });
          continue;
        }

        const involvesPreset = aEntity.entityType === 'preset' || bEntity.entityType === 'preset';
        if (!involvesPreset) {
          const absDiff = Math.abs(aCurrent.rating - bCurrent.rating);
          const maxAbsDiff = getStrictMaxAbsDiffForRatings(aCurrent, bCurrent);
          if (absDiff > maxAbsDiff) {
            await markArenaRatingEventStatus(eventId, 'skipped', { skipReason: 'strict-out-of-range' });
            continue;
          }
        }
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
            version: 2,
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
            version: 2,
            kA: elo.kA,
            kB: elo.kB,
            expectedA: elo.expectedA,
            expectedB: elo.expectedB,
            scoreA: elo.scoreA,
            scoreB: elo.scoreB,
          },
        };
      }

      await updateArenaRatingEventComputedFields(eventId, computed);

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
