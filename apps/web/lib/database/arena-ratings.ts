import type { BattleReportGenerationCombatantRow } from './battle-report-generation-combatants';
import { ARENA_STRICT_POLICY, isSelfSelectedStrictPolicy } from '@mahoshojo/domain/arena-strict-setup';
import { PRESET_LIST } from '@/lib/presets';
import { isStrictRankedModelBlacklisted } from '@/lib/arena/ranked-model-policy';
import type { ArenaTier } from '@/lib/arena/tier';
import { getStrictRangeCheckResult } from '@/lib/arena/strict-range';
export {
  getStrictMaxAbsDiffForRatings, getStrictRangeCheckResult,
  STRICT_LOW_GAMES_THRESHOLD, STRICT_LOW_GAMES_MAX_ABS_DIFF,
  type StrictRangeCheckResult,
} from '@/lib/arena/strict-range';
import {
  buildArenaTerminalEffectIdempotencyKey, digestArenaRatingJson,
  isCurrentArenaPresetRatingBinding, parseArenaRatingEntityBinding,
} from '@mahoshojo/hosted-runtime/arena-generation';

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

import { INITIAL_RATING } from '@mahoshojo/hosted-runtime/admin/arena-policy';
export { INITIAL_RATING } from '@mahoshojo/hosted-runtime/admin/arena-policy';
export const STRICT_DEDUP_WINDOW_MS = 360 * 60 * 1000;
export const FREE_DEDUP_WINDOW_MS = 10 * 60 * 1000;
export const STRICT_DAILY_LIMIT = 20;
export const STRICT_SAME_PAIR_DAILY_LIMIT = 2;

export type StrictSeasonExtremaState = {
  seasonPeakRating: number;
  seasonPeakGames: number;
  seasonPeakAt: string;
  seasonLowRating: number;
  seasonLowGames: number;
  seasonLowAt: string;
};

export type StrictSeasonState = StrictSeasonExtremaState & {
  seasonPeakTier: ArenaTier;
};

export const buildInitialStrictSeasonState = (initialRating: number, nowIso: string): StrictSeasonState => ({
  seasonPeakRating: initialRating,
  seasonPeakGames: 0,
  seasonPeakAt: nowIso,
  seasonPeakTier: '无牌',
  seasonLowRating: initialRating,
  seasonLowGames: 0,
  seasonLowAt: nowIso,
});

type StrictSeasonExtremaSnapshot = {
  seasonPeakRating: number | null;
  seasonPeakGames: number | null;
  seasonPeakAt: string | null;
  seasonLowRating: number | null;
  seasonLowGames: number | null;
  seasonLowAt: string | null;
};

export const computeStrictSeasonExtremaAfterApplied = (input: {
  current: StrictSeasonExtremaSnapshot;
  afterRating: number;
  afterGames: number;
  appliedAtIso: string;
}): StrictSeasonExtremaState => {
  const { current, afterRating, afterGames, appliedAtIso } = input;

  const currentPeakRating =
    typeof current.seasonPeakRating === 'number' ? current.seasonPeakRating : null;
  const currentPeakGames = typeof current.seasonPeakGames === 'number' ? current.seasonPeakGames : null;
  const currentPeakAt = typeof current.seasonPeakAt === 'string' ? current.seasonPeakAt : null;
  const currentLowRating =
    typeof current.seasonLowRating === 'number' ? current.seasonLowRating : null;
  const currentLowGames = typeof current.seasonLowGames === 'number' ? current.seasonLowGames : null;
  const currentLowAt = typeof current.seasonLowAt === 'string' ? current.seasonLowAt : null;

  const shouldRefreshPeak =
    currentPeakRating == null ||
    currentPeakGames == null ||
    !currentPeakAt ||
    afterRating > currentPeakRating;
  const shouldRefreshLow =
    currentLowRating == null ||
    currentLowGames == null ||
    !currentLowAt ||
    afterRating < currentLowRating;

  const nextPeakRating = shouldRefreshPeak ? afterRating : currentPeakRating ?? afterRating;
  const nextPeakGames = shouldRefreshPeak ? afterGames : currentPeakGames ?? afterGames;
  const nextPeakAt = shouldRefreshPeak ? appliedAtIso : currentPeakAt ?? appliedAtIso;
  const nextLowRating = shouldRefreshLow ? afterRating : currentLowRating ?? afterRating;
  const nextLowGames = shouldRefreshLow ? afterGames : currentLowGames ?? afterGames;
  const nextLowAt = shouldRefreshLow ? appliedAtIso : currentLowAt ?? appliedAtIso;

  return {
    seasonPeakRating: nextPeakRating,
    seasonPeakGames: nextPeakGames,
    seasonPeakAt: nextPeakAt,
    seasonLowRating: nextLowRating,
    seasonLowGames: nextLowGames,
    seasonLowAt: nextLowAt,
  };
};

export type StrictDailyUsage = {
  sinceIso: string;
  used: number;
  limit: number;
  exceeded: boolean;
};

export type StrictPairUsage = {
  daySinceIso: string;
  windowSinceIso: string;
  usedToday: number;
  limit: number;
  exceeded: boolean;
  recentDeduped: boolean;
  recentAppliedAtIso: string | null;
  nextEligibleAtIso: string | null;
};

type ArenaRatingsRepoBundle = {
  db: unknown;
  resetStrictArenaRatingForDataCard: (
    db: unknown,
    dataCardId: string,
    initialRating: number,
    nowIso: string,
  ) => Promise<void>;
  removeStrictArenaRatingForDataCard: (db: unknown, dataCardId: string) => Promise<void>;
  countStrictAppliedEventsSince: (db: unknown, userId: number, sinceIso: string) => Promise<number>;
  getStrictUserPairAppliedStatsSince: (
    db: unknown,
    userId: number,
    pairKey: string,
    sinceIso: string,
    daySinceIso: string,
  ) => Promise<{ pairUsedToday: number; latestAppliedAt: string | null }>;
  getStrictQueueDataCardsByIds: (
    db: unknown,
    dataCardIds: string[],
  ) => Promise<Array<{
    id: string;
    type: string | null;
    isPublic: number | boolean | null;
    reviewStatus: string | null;
    deletedAt: string | null;
    data?: string | null;
    updatedAt?: string | null;
    userId?: number;
  }>>;
  getArenaEligibilitySnapshotByGenerationId: (db: unknown, generationId: string) => Promise<ArenaEligibilitySnapshot | null>;
  listGenerationCombatantsByGenerationId: (db: unknown, generationId: string) => Promise<BattleReportGenerationCombatantRow[]>;
  ensureArenaRatingsExist: (
    db: unknown,
    queue: ArenaQueue,
    entities: [ArenaEntity, ArenaEntity],
    initialRating: number,
    nowIso: string,
  ) => Promise<void>;
  getArenaRatingsByEntitiesForQueue: (
    db: unknown,
    queue: ArenaQueue,
    entities: [ArenaEntity, ArenaEntity],
  ) => Promise<Array<ArenaEntity & ArenaRatingSnapshot>>;
  hasRecentAppliedEventForPair: (
    db: unknown,
    queue: ArenaQueue,
    pairKey: string,
    options: { userId: number } | { ipAnonymized: string },
    sinceIso: string,
  ) => Promise<boolean>;
  insertArenaRatingEvent: (
    db: unknown,
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
      createdAtIso: string;
      detailsJson?: Record<string, unknown> | null;
    },
  ) => Promise<boolean>;
  getArenaRatingEventById: (db: unknown, eventId: string) => Promise<ArenaRatingEventRowForApply | null>;
  updateArenaRatingEventComputedFields: (
    db: unknown,
    eventId: string,
    computed: ArenaRatingEventComputedPayload,
  ) => Promise<boolean>;
  markArenaRatingEventApplied: (db: unknown, eventId: string, appliedAtIso: string) => Promise<void>;
  markArenaRatingEventStatus: (
    db: unknown,
    eventId: string,
    status: ArenaRatingEventStatus,
    options?: { skipReason?: string | null },
  ) => Promise<boolean | void>;
  applyArenaRatingsUpdateIfBothMatch: (
    db: unknown,
    queue: ArenaQueue,
    entities: [ArenaEntity, ArenaEntity],
    computed: ArenaRatingEventComputedPayload,
    appliedAtIso: string,
    identityGuards?: readonly ArenaRatingIdentityGuard[] | null,
    eventId?: string,
    requiredOwnedUserId?: number,
  ) => Promise<'applied' | 'already-applied' | 'conflict' | 'identity-conflict' | 'event-skipped'>;
};

let arenaRatingsRepoBundleForTests: ArenaRatingsRepoBundle | null = null;

export const setArenaRatingsRepoBundleForTests = (bundle: ArenaRatingsRepoBundle | null): void => {
  arenaRatingsRepoBundleForTests = bundle;
};

const readArenaRatingsRepoBundle = async (): Promise<ArenaRatingsRepoBundle | null> => {
  if (arenaRatingsRepoBundleForTests) return arenaRatingsRepoBundleForTests;

  try {
    const [{ getDrizzleDbFromRuntime }, repo] = await Promise.all([
      import('@/lib/db/drizzle'),
      import('@/lib/db/repositories/arena-ratings-write'),
    ]);
    const db = getDrizzleDbFromRuntime();
    if (!db) return null;

    return {
      db,
      resetStrictArenaRatingForDataCard: repo.resetStrictArenaRatingForDataCard as ArenaRatingsRepoBundle['resetStrictArenaRatingForDataCard'],
      removeStrictArenaRatingForDataCard: repo.removeStrictArenaRatingForDataCard as ArenaRatingsRepoBundle['removeStrictArenaRatingForDataCard'],
      countStrictAppliedEventsSince: repo.countStrictAppliedEventsSince as ArenaRatingsRepoBundle['countStrictAppliedEventsSince'],
      getStrictUserPairAppliedStatsSince: repo.getStrictUserPairAppliedStatsSince as ArenaRatingsRepoBundle['getStrictUserPairAppliedStatsSince'],
      getStrictQueueDataCardsByIds: repo.getStrictQueueDataCardsByIds as ArenaRatingsRepoBundle['getStrictQueueDataCardsByIds'],
      getArenaEligibilitySnapshotByGenerationId: repo.getArenaEligibilitySnapshotByGenerationId as ArenaRatingsRepoBundle['getArenaEligibilitySnapshotByGenerationId'],
      listGenerationCombatantsByGenerationId: repo.listGenerationCombatantsByGenerationId as ArenaRatingsRepoBundle['listGenerationCombatantsByGenerationId'],
      ensureArenaRatingsExist: repo.ensureArenaRatingsExist as ArenaRatingsRepoBundle['ensureArenaRatingsExist'],
      getArenaRatingsByEntitiesForQueue: repo.getArenaRatingsByEntitiesForQueue as ArenaRatingsRepoBundle['getArenaRatingsByEntitiesForQueue'],
      hasRecentAppliedEventForPair: repo.hasRecentAppliedEventForPair as ArenaRatingsRepoBundle['hasRecentAppliedEventForPair'],
      insertArenaRatingEvent: repo.insertArenaRatingEvent as ArenaRatingsRepoBundle['insertArenaRatingEvent'],
      getArenaRatingEventById: repo.getArenaRatingEventById as ArenaRatingsRepoBundle['getArenaRatingEventById'],
      updateArenaRatingEventComputedFields: repo.updateArenaRatingEventComputedFields as ArenaRatingsRepoBundle['updateArenaRatingEventComputedFields'],
      markArenaRatingEventApplied: repo.markArenaRatingEventApplied as ArenaRatingsRepoBundle['markArenaRatingEventApplied'],
      markArenaRatingEventStatus: repo.markArenaRatingEventStatus as ArenaRatingsRepoBundle['markArenaRatingEventStatus'],
      applyArenaRatingsUpdateIfBothMatch: repo.applyArenaRatingsUpdateIfBothMatch as ArenaRatingsRepoBundle['applyArenaRatingsUpdateIfBothMatch'],
    };
  } catch {
    return null;
  }
};

export async function resetStrictArenaRatingForDataCard(dataCardId: string): Promise<void> {
  const id = typeof dataCardId === 'string' ? dataCardId.trim() : '';
  if (!id) return;

  try {
    const bundle = await readArenaRatingsRepoBundle();
    if (!bundle) return;
    const nowIso = new Date().toISOString();
    await bundle.resetStrictArenaRatingForDataCard(bundle.db, id, INITIAL_RATING, nowIso);
  } catch (error) {
    console.warn('重置严格排位分失败（降级为忽略）:', { dataCardId, error });
  }
}

export async function removeStrictArenaRatingForDataCard(dataCardId: string): Promise<void> {
  const id = typeof dataCardId === 'string' ? dataCardId.trim() : '';
  if (!id) return;

  try {
    const bundle = await readArenaRatingsRepoBundle();
    if (!bundle) return;
    await bundle.removeStrictArenaRatingForDataCard(bundle.db, id);
  } catch (error) {
    console.warn('移除严格排位分失败（降级为忽略）:', { dataCardId, error });
  }
}

const startOfUtcDayIso = (): string => {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
  return start.toISOString();
};

const pickEarlierIso = (aIso: string, bIso: string): string => {
  const aMs = Date.parse(aIso);
  const bMs = Date.parse(bIso);
  if (Number.isFinite(aMs) && Number.isFinite(bMs)) return aMs <= bMs ? aIso : bIso;
  return aIso <= bIso ? aIso : bIso;
};

const buildNextEligibleAtIso = (recentAppliedAtIso: string | null, windowMs: number): string | null => {
  if (typeof recentAppliedAtIso !== 'string' || !recentAppliedAtIso.trim()) return null;
  const appliedAtMs = Date.parse(recentAppliedAtIso);
  if (!Number.isFinite(appliedAtMs)) return null;
  return new Date(appliedAtMs + windowMs).toISOString();
};

export const getStrictDailyUsage = async (userId: number): Promise<StrictDailyUsage | null> => {
  if (!Number.isFinite(userId) || userId <= 0) return null;
  try {
    const bundle = await readArenaRatingsRepoBundle();
    if (!bundle) return null;
    const sinceIso = startOfUtcDayIso();
    const used = await bundle.countStrictAppliedEventsSince(bundle.db, userId, sinceIso);
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

export const getStrictPairUsage = async (userId: number, pairKey: string): Promise<StrictPairUsage | null> => {
  const normalizedPairKey = typeof pairKey === 'string' ? pairKey.trim() : '';
  if (!Number.isFinite(userId) || userId <= 0 || !normalizedPairKey) return null;

  try {
    const bundle = await readArenaRatingsRepoBundle();
    if (!bundle) return null;

    const daySinceIso = startOfUtcDayIso();
    const windowSinceIso = new Date(Date.now() - STRICT_DEDUP_WINDOW_MS).toISOString();
    const sinceIso = pickEarlierIso(daySinceIso, windowSinceIso);
    const stats = await bundle.getStrictUserPairAppliedStatsSince(
      bundle.db,
      userId,
      normalizedPairKey,
      sinceIso,
      daySinceIso,
    );
    const recentAppliedAtIso = stats.latestAppliedAt;
    const recentDeduped = typeof recentAppliedAtIso === 'string' && recentAppliedAtIso >= windowSinceIso;

    return {
      daySinceIso,
      windowSinceIso,
      usedToday: stats.pairUsedToday,
      limit: STRICT_SAME_PAIR_DAILY_LIMIT,
      exceeded: stats.pairUsedToday >= STRICT_SAME_PAIR_DAILY_LIMIT,
      recentDeduped,
      recentAppliedAtIso,
      nextEligibleAtIso: recentDeduped ? buildNextEligibleAtIso(recentAppliedAtIso, STRICT_DEDUP_WINDOW_MS) : null,
    };
  } catch (error) {
    console.warn('读取 strict 对手组合计分使用情况失败（降级为不限制）:', { userId, pairKey: normalizedPairKey, error });
    return null;
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

const toNullableIntegerLike = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed)) return Math.trunc(parsed);
  }
  return null;
};

const toNullableTinyIntLike = (value: unknown): number | null => {
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return 1;
    if (normalized === 'false') return 0;
  }
  const numeric = toNullableIntegerLike(value);
  if (numeric == null) return null;
  return numeric === 0 ? 0 : 1;
};

const readFallbackTrimmedString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

export const parseGenerationCombatantsFallback = (
  generationId: string,
  extraJson: string | null,
): BattleReportGenerationCombatantRow[] => {
  if (typeof extraJson !== 'string' || !extraJson.trim()) return [];

  try {
    const parsed = JSON.parse(extraJson) as Record<string, unknown>;
    const rawList = Array.isArray(parsed?.combatantsFallback) ? parsed.combatantsFallback : [];
    if (rawList.length <= 0) return [];

    const fallbackRows = rawList
      .map((item, index) => {
        const raw = item && typeof item === 'object' && !Array.isArray(item) ? (item as Record<string, unknown>) : {};
        const sortIndex = toNullableIntegerLike(raw.sortIndex);
        const name = readFallbackTrimmedString(raw.name);
        const templateId =
          readFallbackTrimmedString(raw.templateId) ??
          readFallbackTrimmedString(raw.filename);

        const row: BattleReportGenerationCombatantRow = {
          generation_id: generationId,
          sort_index: sortIndex ?? index,
          name: name ?? templateId ?? `未知角色#${index + 1}`,
          type: readFallbackTrimmedString(raw.type),
          template_id: templateId,
          is_native: toNullableTinyIntLike(raw.isNative),
          is_preset: toNullableTinyIntLike(raw.isPreset),
          team_id: toNullableIntegerLike(raw.teamId),
          character_guidance: (() => {
            const guidance = readFallbackTrimmedString(raw.characterGuidance);
            return guidance ? guidance.slice(0, 100) : null;
          })(),
          data_card_id: readFallbackTrimmedString(raw.dataCardId),
          data_card_updated_at: readFallbackTrimmedString(raw.dataCardUpdatedAt),
          size_chars: null,
          size_bytes: null,
          created_at: new Date(0).toISOString(),
        };
        return row;
      })
      .sort((a, b) => a.sort_index - b.sort_index);

    return fallbackRows;
  } catch {
    return [];
  }
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

const readExtraJsonNonNegativeInt = (extraJson: string | null, key: string): number | null => {
  if (typeof extraJson !== 'string' || !extraJson.trim()) return null;
  try {
    const parsed = JSON.parse(extraJson) as Record<string, unknown>;
    const raw = parsed?.[key];
    const value = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
    if (!Number.isFinite(value)) return null;
    return Math.max(0, Math.floor(value));
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

const readExtraJsonStringArray = (extraJson: string | null, key: string): string[] | null => {
  if (typeof extraJson !== 'string' || !extraJson.trim()) return null;
  try {
    const parsed = JSON.parse(extraJson) as Record<string, unknown>;
    const raw = parsed?.[key];
    if (!Array.isArray(raw)) return null;
    const normalized = raw
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter((item) => Boolean(item));
    return normalized.slice(0, 20);
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
  if (!isSelfSelectedStrictPolicy(strictPolicy)) {
    // 严格排位（旧版）：必须由“排位匹配”签发票据并在生成时验证通过。
    // 缺失/无效都按“宁可漏算”处理为不具备资格（用于禁止 strict 自由挑对手）。
    if (readExtraJsonBoolean(snapshot.extraJson, 'rankedMatchOk') !== true) return false;
  }

  // 严格排位：禁止使用黑名单模型（生成逻辑不稳定，不适合作为排位依据）。
  if (isStrictRankedModelBlacklisted(readExtraJsonString(snapshot.extraJson, 'resolvedModelOverride'))) return false;

  // 严格排位：语言必须为简体中文（zh-CN）。
  if ((snapshot.language ?? '').trim() !== 'zh-CN') return false;

  const requiredStoryGuidance = readExtraJsonString(snapshot.extraJson, 'seasonStoryGuidance');
  if (requiredStoryGuidance) {
    const actual = typeof snapshot.userGuidancePreview === 'string' ? snapshot.userGuidancePreview.trim() : '';
    if (!actual) return false;
    if (actual !== requiredStoryGuidance) return false;
  } else {
    if (snapshot.hasUserGuidance !== 0) return false;
  }

  const requiredQuestionnaireLorePresetIds = readExtraJsonStringArray(snapshot.extraJson, 'seasonQuestionnaireLorePresetIds') ?? [];
  const actualQuestionnaireLoreIds = readExtraJsonStringArray(snapshot.extraJson, 'questionnaireLoreIds') ?? [];
  if (requiredQuestionnaireLorePresetIds.length > 0) {
    const requiredSet = new Set(requiredQuestionnaireLorePresetIds);
    const actualSet = new Set(actualQuestionnaireLoreIds);
    if (requiredSet.size !== actualSet.size) return false;
    for (const id of requiredSet) {
      if (!actualSet.has(id)) return false;
    }
  } else {
    // 严格排位：问卷/设定卡 Lore 需由赛季特殊规则显式许可。
    if (readExtraJsonBoolean(snapshot.extraJson, 'questionnaireLoreEnabled') === true) {
      if (readExtraJsonBoolean(snapshot.extraJson, 'seasonQuestionnaireLoreAllowed') !== true) return false;
    }
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
  if ((readExtraJsonNonNegativeInt(snapshot.extraJson, 'materialCount') ?? 0) > 0) return false;

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

type ArenaRatingIdentityGuard = {
  id: string;
  data: string;
  updatedAt: string;
  authorizedUserId: number | null;
};

const validateRatingEntityBinding = async (
  snapshot: ArenaEligibilitySnapshot,
  entities: [ArenaEntity, ArenaEntity],
  queue: ArenaQueue,
  repository: ArenaRatingsRepoBundle,
): Promise<{ ok: true; guards: ArenaRatingIdentityGuard[] } | { ok: false; skipReason: string }> => {
  let raw: unknown;
  try { raw = JSON.parse(snapshot.extraJson ?? '{}').ratingEntityBinding; } catch { raw = null; }
  const binding = parseArenaRatingEntityBinding(raw);
  if (!binding) return { ok: false, skipReason: 'entity-binding-missing' };
  if (binding.status !== 'bound') return { ok: false, skipReason: binding.reason };
  if (entities[0].entityType === entities[1].entityType && entities[0].entityId === entities[1].entityId) {
    return { ok: false, skipReason: 'entity-body-mismatch' };
  }
  if (binding.entities.some((bound, index) => bound.entityType !== entities[index].entityType
    || bound.entityId !== entities[index].entityId)) return { ok: false, skipReason: 'entity-body-mismatch' };
  const ids = binding.entities.filter((entity) => entity.entityType === 'data_card').map((entity) => entity.entityId);
  let rows: Awaited<ReturnType<ArenaRatingsRepoBundle['getStrictQueueDataCardsByIds']>>;
  try { rows = ids.length ? await repository.getStrictQueueDataCardsByIds(repository.db, ids) : []; }
  catch { return { ok: false, skipReason: 'entity-reference-unavailable' }; }
  const byId = new Map(rows.map((row) => [row.id, row]));
  const guards: ArenaRatingIdentityGuard[] = [];
  for (const entity of binding.entities) {
    if (entity.entityType === 'preset') {
      if (!isCurrentArenaPresetRatingBinding(entity)) return { ok: false, skipReason: 'entity-version-changed' };
      continue;
    }
    const row = byId.get(entity.entityId);
    if (!row || row.deletedAt || row.type !== 'character' || typeof row.data !== 'string'
      || typeof row.updatedAt !== 'string') return { ok: false, skipReason: 'entity-reference-unavailable' };
    const isPublic = (row.isPublic === 1 || row.isPublic === true) && row.reviewStatus === 'approved';
    if (queue === 'strict' && !isPublic) return { ok: false, skipReason: 'strict-not-public' };
    if (!isPublic && row.userId !== entity.authorizedUserId) {
      return { ok: false, skipReason: 'entity-reference-unavailable' };
    }
    let digest: string | null = null;
    try { digest = await digestArenaRatingJson(JSON.parse(row.data)); } catch { /* fail closed */ }
    if (row.updatedAt !== entity.updatedAt || digest !== entity.contentDigest) {
      return { ok: false, skipReason: 'entity-version-changed' };
    }
    guards.push({ id: entity.entityId, data: row.data, updatedAt: row.updatedAt, authorizedUserId: entity.authorizedUserId });
  }
  if (queue === 'strict' && readExtraJsonString(snapshot.extraJson, 'arenaStrictPolicy') === ARENA_STRICT_POLICY
    && !ids.some((id) => snapshot.userId != null && byId.get(id)?.userId === snapshot.userId)) {
    return { ok: false, skipReason: 'strict-no-owned-combatant' };
  }
  return { ok: true, guards };
};

export async function getArenaEligibilitySnapshotByGenerationId(
  generationId: string
): Promise<ArenaEligibilitySnapshot | null> {
  try {
    const bundle = await readArenaRatingsRepoBundle();
    if (!bundle) return null;
    return await bundle.getArenaEligibilitySnapshotByGenerationId(bundle.db, generationId);
  } catch (error) {
    console.error('读取 battle_report_generations 用于排位判定失败:', error);
    return null;
  }
}

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

interface ArenaRatingEventComputedPayload {
  aBefore: ArenaRatingSnapshot;
  bBefore: ArenaRatingSnapshot;
  aAfter: ArenaRatingSnapshot;
  bAfter: ArenaRatingSnapshot;
  deltaA: number;
  deltaB: number;
  detailsJson: Record<string, unknown>;
}

export async function settleArenaRatingsForGeneration(
  input: string | {
    generationId: string;
    idempotencyKey: string;
  },
): Promise<void> {
  const generationId = typeof input === 'string' ? input : input.generationId;
  const idempotencyKey = typeof input === 'string'
    ? buildArenaTerminalEffectIdempotencyKey(generationId, 'ratings')
    : input.idempotencyKey;
  if (idempotencyKey !== buildArenaTerminalEffectIdempotencyKey(generationId, 'ratings')) {
    throw new Error('ARENA_RATING_IDEMPOTENCY_KEY_INVALID');
  }
  try {
    const repository = await readArenaRatingsRepoBundle();
    if (!repository) throw new Error('ARENA_RATING_REPOSITORY_UNAVAILABLE');
    type RatingEventInsert = Omit<
      Parameters<ArenaRatingsRepoBundle['insertArenaRatingEvent']>[1],
      'createdAtIso'
    >;
    const insertEvent = (payload: RatingEventInsert) => (
      repository.insertArenaRatingEvent(repository.db, {
        ...payload,
        createdAtIso: new Date().toISOString(),
      })
    );
    const markEventStatus = async (
      eventId: string,
      status: ArenaRatingEventStatus,
      options?: { skipReason?: string | null },
    ): Promise<void> => {
      if (status === 'applied') {
        await repository.markArenaRatingEventApplied(repository.db, eventId, new Date().toISOString());
        return;
      }
      const changed = await repository.markArenaRatingEventStatus(repository.db, eventId, status, options);
      if (changed === false && status === 'skipped' && options?.skipReason?.startsWith('entity-')) {
        const latest = await repository.getArenaRatingEventById(repository.db, eventId);
        if (latest?.status === 'applied' || latest?.status === 'skipped') return;
        // A concurrent rating write may have reached after-state. Keep finalization
        // pending so the normal retry reconciles it; never claim a skipped success.
        throw new Error('ARENA_RATING_IDENTITY_SETTLEMENT_RETRY');
      }
    };
    const readCurrentRatings = async (
      queue: ArenaQueue,
      entities: [ArenaEntity, ArenaEntity],
    ): Promise<[ArenaRatingSnapshot, ArenaRatingSnapshot] | null> => {
      const rows = await repository.getArenaRatingsByEntitiesForQueue(
        repository.db,
        queue,
        entities,
      );
      const [a, b] = entities;
      const toSnapshot = (row: typeof rows[number] | undefined): ArenaRatingSnapshot => ({
        rating: typeof row?.rating === 'number' ? row.rating : INITIAL_RATING,
        games: typeof row?.games === 'number' ? row.games : 0,
        wins: typeof row?.wins === 'number' ? row.wins : 0,
        losses: typeof row?.losses === 'number' ? row.losses : 0,
        draws: typeof row?.draws === 'number' ? row.draws : 0,
      });
      const aRow = rows.find((row) => row.entityType === a.entityType && row.entityId === a.entityId);
      const bRow = rows.find((row) => row.entityType === b.entityType && row.entityId === b.entityId);
      return aRow && bRow ? [toSnapshot(aRow), toSnapshot(bRow)] : null;
    };
    const snapshot = await repository.getArenaEligibilitySnapshotByGenerationId(
      repository.db,
      generationId,
    );
    if (!snapshot) return;
    if (snapshot.status !== 'completed' && snapshot.status !== 'finalizing') return;
    if (snapshot.combatantCount !== 2) return;
    const eligibilitySnapshot = snapshot.status === 'finalizing'
      ? { ...snapshot, status: 'completed' as const }
      : snapshot;

    let combatants = await repository.listGenerationCombatantsByGenerationId(
      repository.db,
      generationId,
    );
    if (combatants.length !== 2) {
      const fallbackCombatants = parseGenerationCombatantsFallback(generationId, snapshot.extraJson);
      if (fallbackCombatants.length !== 2) return;
      combatants = fallbackCombatants;
    }

    const entities = combatants.map(parseCombatantEntity);
    if (!entities[0] || !entities[1]) return;
    const [aEntity, bEntity] = entities as [ArenaEntity, ArenaEntity];

    const pairKey = buildPairKey(aEntity, bEntity);
    const strictPolicy = readExtraJsonString(snapshot.extraJson, 'arenaStrictPolicy');
    const isNewStrictPolicy = isSelfSelectedStrictPolicy(strictPolicy);

    let strictEligible = isStrictEligible(eligibilitySnapshot, combatants);
    const freeEligible = isFreeEligible(eligibilitySnapshot);
    if (!strictEligible && !freeEligible) return;

    const winnerParse = parseWinnerSlot(snapshot.winner, [combatants[0].name, combatants[1].name]);
    if (!winnerParse.ok) {
      if (strictEligible) {
        await insertEvent({
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
        await insertEvent({
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
      const daySinceIso = startOfUtcDayIso();
      const windowSinceIso = new Date(Date.now() - STRICT_DEDUP_WINDOW_MS).toISOString();
      const sinceIso = pickEarlierIso(daySinceIso, windowSinceIso);
      const pairStats = await repository.getStrictUserPairAppliedStatsSince(
        repository.db,
        snapshot.userId,
        pairKey,
        sinceIso,
        daySinceIso,
      );
      const recentAppliedAtIso = pairStats.latestAppliedAt;
      const recentDeduped = typeof recentAppliedAtIso === 'string'
        && recentAppliedAtIso >= windowSinceIso;
      const pairUsage: StrictPairUsage = {
        daySinceIso,
        windowSinceIso,
        usedToday: pairStats.pairUsedToday,
        limit: STRICT_SAME_PAIR_DAILY_LIMIT,
        exceeded: pairStats.pairUsedToday >= STRICT_SAME_PAIR_DAILY_LIMIT,
        recentDeduped,
        recentAppliedAtIso,
        nextEligibleAtIso: recentDeduped
          ? buildNextEligibleAtIso(recentAppliedAtIso, STRICT_DEDUP_WINDOW_MS)
          : null,
      };
      if (pairUsage?.recentDeduped) {
        await insertEvent({
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
      } else if (pairUsage?.exceeded) {
        await insertEvent({
          id: buildArenaRatingEventId(generationId, 'strict'),
          generationId,
          queue: 'strict',
          status: 'skipped',
          skipReason: 'pair-daily-limit',
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
      const exceeded = await repository.countStrictAppliedEventsSince(
        repository.db,
        snapshot.userId,
        startOfUtcDayIso(),
      ) >= STRICT_DAILY_LIMIT;
      if (exceeded) {
        await insertEvent({
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
      const priorEvent = await repository.getArenaRatingEventById(repository.db, eventId);
      if (priorEvent?.status === 'applied' || priorEvent?.status === 'skipped') continue;
      if (priorEvent?.status === 'failed') throw new Error('ARENA_RATING_EVENT_FAILED');

      if (queue === 'free' && shouldApplyStrict) {
        // strict 命中时同时更新 free：为保持 strict ⊆ free，free 不再额外按 IP 去重。
        // 否则可能出现 strict 已结算、但 free 被风控跳过的情况。
      } else if (queue === 'free' && snapshot.ipAnonymized != null) {
        const deduped = await repository.hasRecentAppliedEventForPair(
          repository.db,
          queue,
          pairKey,
          { ipAnonymized: snapshot.ipAnonymized },
          new Date(Date.now() - FREE_DEDUP_WINDOW_MS).toISOString(),
        );
        if (deduped) {
          await insertEvent({
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

      const initialIdentity = await validateRatingEntityBinding(snapshot, [aEntity, bEntity], queue, repository);
      if (!initialIdentity.ok) {
        if (!priorEvent) {
          const insertedSkip = await insertEvent({ id: eventId, generationId, queue, status: 'skipped',
            skipReason: initialIdentity.skipReason, userId: snapshot.userId,
            ipAnonymized: snapshot.ipAnonymized, pairKey, a: aEntity, b: bEntity, winnerSlot });
          if (!insertedSkip) {
            const latest = await repository.getArenaRatingEventById(repository.db, eventId);
            if (latest?.status !== 'applied' && latest?.status !== 'skipped') {
              throw new Error('ARENA_RATING_IDENTITY_SETTLEMENT_RETRY');
            }
          }
          continue;
        }
        // Only an already-applied pending event may bypass the new binding rule.
        // Its computed snapshots below prove reconciliation, not fresh authority.
      }

      const inserted = await insertEvent({
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

      await repository.ensureArenaRatingsExist(
        repository.db,
        queue,
        [aEntity, bEntity],
        INITIAL_RATING,
        new Date().toISOString(),
      );
      const current = await readCurrentRatings(queue, [aEntity, bEntity]);
      if (!current) {
        await markEventStatus(eventId, 'failed', { skipReason: 'ratings-missing' });
        throw new Error('ARENA_RATING_STATE_MISSING');
      }
      const [aCurrent, bCurrent] = current;

      const existingEvent = !inserted
        ? await repository.getArenaRatingEventById(repository.db, eventId)
        : null;
      if (!inserted && !existingEvent) {
        throw new Error('ARENA_RATING_EVENT_RECONCILIATION_FAILED');
      }
      if (existingEvent?.status === 'failed') {
        throw new Error('ARENA_RATING_EVENT_FAILED');
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
      let shouldPersistComputedFields = true;
      let reconcileAlreadyApplied = false;

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

        reconcileAlreadyApplied = alreadyApplied;
        const matchesBefore =
          aCurrent.rating === existingEvent.a_before_rating &&
          aCurrent.games === existingEvent.a_before_games &&
          bCurrent.rating === existingEvent.b_before_rating &&
          bCurrent.games === existingEvent.b_before_games;
        if (!alreadyApplied && !matchesBefore) {
          await markEventStatus(eventId, 'failed', { skipReason: 'rating-conflict' });
          throw new Error('ARENA_RATING_SETTLEMENT_CONFLICT');
        }

        computed = {
          aBefore: {
            rating: existingEvent.a_before_rating,
            games: existingEvent.a_before_games,
            wins: aCurrent.wins,
            losses: aCurrent.losses,
            draws: aCurrent.draws,
          },
          bBefore: {
            rating: existingEvent.b_before_rating,
            games: existingEvent.b_before_games,
            wins: bCurrent.wins,
            losses: bCurrent.losses,
            draws: bCurrent.draws,
          },
          aAfter: {
            rating: existingEvent.a_after_rating,
            games: existingEvent.a_after_games,
            wins: alreadyApplied ? aCurrent.wins : aCurrent.wins + aWinInc,
            losses: alreadyApplied ? aCurrent.losses : aCurrent.losses + aLossInc,
            draws: alreadyApplied ? aCurrent.draws : aCurrent.draws + aDrawInc,
          },
          bAfter: {
            rating: existingEvent.b_after_rating,
            games: existingEvent.b_after_games,
            wins: alreadyApplied ? bCurrent.wins : bCurrent.wins + bWinInc,
            losses: alreadyApplied ? bCurrent.losses : bCurrent.losses + bLossInc,
            draws: alreadyApplied ? bCurrent.draws : bCurrent.draws + bDrawInc,
          },
          deltaA: existingEvent.a_delta,
          deltaB: existingEvent.b_delta,
          detailsJson: {
            version: 2,
            source: 'event-retry',
          },
        };
        shouldPersistComputedFields = false;
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

      // A pending event whose exact after-state is already present must finish
      // its existing reconciliation, even if its card has since changed. No new
      // rating delta is allowed without fresh validation and atomic source guards.
      const identity = reconcileAlreadyApplied ? null : initialIdentity;
      if (identity && !identity.ok) {
        await markEventStatus(eventId, 'skipped', { skipReason: identity.skipReason });
        continue;
      }

      if (!reconcileAlreadyApplied && queue === 'strict' && isNewStrictPolicy) {
        const involvesPreset = aEntity.entityType === 'preset' || bEntity.entityType === 'preset';
        if (!involvesPreset) {
          const rangeCheck = getStrictRangeCheckResult(
            { rating: aCurrent.rating, games: aCurrent.games },
            { rating: bCurrent.rating, games: bCurrent.games },
          );
          if (rangeCheck && rangeCheck.exceededBy > 0) {
            await markEventStatus(eventId, 'skipped', { skipReason: 'strict-out-of-range' });
            continue;
          }
        }
      }

      if (shouldPersistComputedFields) {
        const updated = await repository.updateArenaRatingEventComputedFields(
          repository.db,
          eventId,
          computed,
        );
        if (!updated) throw new Error('ARENA_RATING_EVENT_COMPUTED_FIELDS_CONFLICT');
      }

      const applied = await repository.applyArenaRatingsUpdateIfBothMatch(
        repository.db,
        queue,
        [aEntity, bEntity],
        computed,
        new Date().toISOString(),
        identity?.ok ? identity.guards : null,
        eventId,
        queue === 'strict' && strictPolicy === ARENA_STRICT_POLICY ? snapshot.userId ?? undefined : undefined,
      );
      if (applied === 'event-skipped') continue;
      if (applied === 'identity-conflict') {
        await markEventStatus(eventId, 'skipped', { skipReason: 'entity-version-changed' });
      } else if (applied === 'applied' || applied === 'already-applied') {
        await markEventStatus(eventId, 'applied');
      } else {
        await markEventStatus(eventId, 'failed', { skipReason: 'rating-conflict' });
        throw new Error('ARENA_RATING_SETTLEMENT_CONFLICT');
      }
    }
  } catch (error) {
    console.error('排位结算失败:', { generationId, error });
    throw error;
  }
}
