export type ArenaQueue = 'strict' | 'free';
export type ArenaEntityType = 'data_card' | 'preset';

export type ArenaEntityKey = `${ArenaEntityType}:${string}`;

type ArenaRankCacheSource = 'leaderboard' | 'ranked-match' | 'meta';

type ArenaRankCacheEntryV1 = {
  rank: number | null;
  rating: number | null;
  games: number | null;
  tier: string | null;
  updatedAtMs: number;
  source: ArenaRankCacheSource;
};

type ArenaRankCacheStateV1 = {
  version: 1;
  updatedAtMs: number;
  maxRankSeen: Record<ArenaQueue, number>;
  entries: Record<ArenaQueue, Record<string, ArenaRankCacheEntryV1>>;
};

const STORAGE_KEY = 'mahoshojo.arena.rank-cache.v1';
const MAX_ENTRIES_PER_QUEUE = 800;
const STALE_ROUNDING_AFTER_MS = 6 * 60 * 60 * 1000;

const emptyState = (): ArenaRankCacheStateV1 => ({
  version: 1,
  updatedAtMs: Date.now(),
  maxRankSeen: { strict: 0, free: 0 },
  entries: { strict: {}, free: {} },
});

const normalizeQueue = (value: unknown): ArenaQueue | null => {
  if (value === 'free') return 'free';
  if (value === 'strict') return 'strict';
  return null;
};

const normalizeEntityType = (value: unknown): ArenaEntityType | null => {
  if (value === 'preset') return 'preset';
  if (value === 'data_card') return 'data_card';
  return null;
};

const normalizeEntityId = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const buildEntityKey = (entityType: ArenaEntityType, entityId: string): ArenaEntityKey => `${entityType}:${entityId}`;

const readCache = (): ArenaRankCacheStateV1 => {
  if (typeof window === 'undefined') return emptyState();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw) as Partial<ArenaRankCacheStateV1> | null;
    if (!parsed || typeof parsed !== 'object') return emptyState();
    if (parsed.version !== 1) return emptyState();

    const maxRankSeenStrict = typeof parsed.maxRankSeen?.strict === 'number' && Number.isFinite(parsed.maxRankSeen.strict)
      ? Math.max(0, Math.floor(parsed.maxRankSeen.strict))
      : 0;
    const maxRankSeenFree = typeof parsed.maxRankSeen?.free === 'number' && Number.isFinite(parsed.maxRankSeen.free)
      ? Math.max(0, Math.floor(parsed.maxRankSeen.free))
      : 0;

    const entriesStrict = parsed.entries?.strict && typeof parsed.entries.strict === 'object' ? parsed.entries.strict : {};
    const entriesFree = parsed.entries?.free && typeof parsed.entries.free === 'object' ? parsed.entries.free : {};

    return {
      version: 1,
      updatedAtMs: typeof parsed.updatedAtMs === 'number' && Number.isFinite(parsed.updatedAtMs) ? parsed.updatedAtMs : Date.now(),
      maxRankSeen: { strict: maxRankSeenStrict, free: maxRankSeenFree },
      entries: {
        strict: (entriesStrict ?? {}) as Record<string, ArenaRankCacheEntryV1>,
        free: (entriesFree ?? {}) as Record<string, ArenaRankCacheEntryV1>,
      },
    };
  } catch {
    return emptyState();
  }
};

const pruneQueueEntries = (entries: Record<string, ArenaRankCacheEntryV1>): void => {
  const keys = Object.keys(entries);
  if (keys.length <= MAX_ENTRIES_PER_QUEUE) return;
  keys.sort((a, b) => (entries[a]?.updatedAtMs ?? 0) - (entries[b]?.updatedAtMs ?? 0));
  const toDrop = keys.length - MAX_ENTRIES_PER_QUEUE;
  for (let i = 0; i < toDrop; i += 1) {
    const key = keys[i];
    if (key) delete entries[key];
  }
};

const writeCache = (state: ArenaRankCacheStateV1): void => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.warn('写入本地排位缓存失败（已忽略）:', error);
  }
};

export const isCanonicalPublicLeaderboardQuery = (input: {
  sort?: string | null;
  order?: string | null;
  includePresets?: boolean | null;
  isNative?: string | null;
  includeTagIds?: string[] | null;
  excludeTagIds?: string[] | null;
  minRating?: string | null;
  maxRating?: string | null;
  minGames?: string | null;
  maxGames?: string | null;
  minTechScore?: string | null;
  maxTechScore?: string | null;
}): boolean => {
  const sort = input.sort ?? 'rating';
  const order = input.order ?? 'desc';
  if (sort !== 'rating') return false;
  if (order !== 'desc') return false;
  if (input.includePresets === false) return false;
  if ((input.isNative ?? 'any') !== 'any') return false;
  if ((input.includeTagIds ?? []).length > 0) return false;
  if ((input.excludeTagIds ?? []).length > 0) return false;
  if ((input.minRating ?? '').trim()) return false;
  if ((input.maxRating ?? '').trim()) return false;
  if ((input.minGames ?? '').trim()) return false;
  if ((input.maxGames ?? '').trim()) return false;
  if ((input.minTechScore ?? '').trim()) return false;
  if ((input.maxTechScore ?? '').trim()) return false;
  return true;
};

export const upsertArenaRankCacheFromLeaderboard = (input: {
  queue: ArenaQueue;
  items: Array<{
    rank: number;
    entityType: ArenaEntityType;
    entityId: string;
    rating?: number | null;
    games?: number | null;
    tier?: string | null;
  }>;
  maxRankSeen?: number;
  nowMs?: number;
}): void => {
  if (typeof window === 'undefined') return;
  const nowMs = typeof input.nowMs === 'number' && Number.isFinite(input.nowMs) ? input.nowMs : Date.now();
  const queue = normalizeQueue(input.queue);
  if (!queue) return;
  if (!Array.isArray(input.items) || input.items.length === 0) return;

  const state = readCache();
  const nextMaxRankSeen = (() => {
    if (typeof input.maxRankSeen === 'number' && Number.isFinite(input.maxRankSeen)) {
      return Math.max(0, Math.floor(input.maxRankSeen));
    }
    let maxRank = 0;
    for (const item of input.items) {
      const r = typeof item.rank === 'number' && Number.isFinite(item.rank) ? Math.floor(item.rank) : 0;
      if (r > maxRank) maxRank = r;
    }
    return maxRank;
  })();

  state.maxRankSeen[queue] = Math.max(state.maxRankSeen[queue] ?? 0, nextMaxRankSeen);

  const bucket = state.entries[queue] ?? {};
  for (const item of input.items) {
    const entityType = normalizeEntityType(item.entityType);
    const entityId = normalizeEntityId(item.entityId);
    if (!entityType || !entityId) continue;
    const rank = typeof item.rank === 'number' && Number.isFinite(item.rank) ? Math.max(1, Math.floor(item.rank)) : null;
    const rating = typeof item.rating === 'number' && Number.isFinite(item.rating) ? Math.floor(item.rating) : null;
    const games = typeof item.games === 'number' && Number.isFinite(item.games) ? Math.floor(item.games) : null;
    const tier = typeof item.tier === 'string' && item.tier.trim() ? item.tier.trim() : null;
    bucket[buildEntityKey(entityType, entityId)] = {
      rank,
      rating,
      games,
      tier,
      updatedAtMs: nowMs,
      source: 'leaderboard',
    };
  }

  pruneQueueEntries(bucket);
  state.entries[queue] = bucket;
  state.updatedAtMs = nowMs;
  writeCache(state);
};

export const upsertArenaRankCacheFromGenerationRanking = (input: {
  participants: Array<{
    entityType: ArenaEntityType | 'unknown';
    entityId: string | null;
    queues: Partial<
      Record<
        ArenaQueue,
        {
          rating: number | null;
          games: number | null;
          tier: string | null;
          rank?: number | null;
        }
      >
    >;
  }>;
  nowMs?: number;
}): void => {
  if (typeof window === 'undefined') return;
  if (!Array.isArray(input.participants) || input.participants.length === 0) return;
  const nowMs = typeof input.nowMs === 'number' && Number.isFinite(input.nowMs) ? input.nowMs : Date.now();

  const state = readCache();

  const upsert = (queue: ArenaQueue, entityKey: string, q: { rating: number | null; games: number | null; tier: string | null; rank?: number | null }) => {
    const rating = typeof q.rating === 'number' && Number.isFinite(q.rating) ? Math.floor(q.rating) : null;
    const games = typeof q.games === 'number' && Number.isFinite(q.games) ? Math.floor(q.games) : null;
    const tier = typeof q.tier === 'string' && q.tier.trim() ? q.tier.trim() : null;
    const rank = typeof q.rank === 'number' && Number.isFinite(q.rank) ? Math.max(1, Math.floor(q.rank)) : null;

    const prev = state.entries[queue]?.[entityKey];
    state.entries[queue] = state.entries[queue] ?? {};
    state.entries[queue]![entityKey] = {
      rank: rank ?? (prev?.rank ?? null),
      rating: rating ?? (prev?.rating ?? null),
      games: games ?? (prev?.games ?? null),
      tier: tier ?? (prev?.tier ?? null),
      updatedAtMs: nowMs,
      source: 'ranked-match',
    };
  };

  for (const participant of input.participants) {
    const entityType = normalizeEntityType(participant.entityType);
    const entityId = normalizeEntityId(participant.entityId);
    if (!entityType || !entityId) continue;
    const entityKey = buildEntityKey(entityType, entityId);

    for (const queue of ['strict', 'free'] as const) {
      const q = participant.queues?.[queue];
      if (!q) continue;
      upsert(queue, entityKey, q);
    }
  }

  pruneQueueEntries(state.entries.strict);
  pruneQueueEntries(state.entries.free);
  state.updatedAtMs = nowMs;
  writeCache(state);
};

export const upsertArenaRankCacheFromMeta = (input: {
  entityType: ArenaEntityType;
  entityId: string;
  queue: ArenaQueue;
  rating: number | null;
  games: number | null;
  tier: string | null;
  nowMs?: number;
}): void => {
  if (typeof window === 'undefined') return;
  const nowMs = typeof input.nowMs === 'number' && Number.isFinite(input.nowMs) ? input.nowMs : Date.now();
  const queue = normalizeQueue(input.queue);
  if (!queue) return;
  const entityType = normalizeEntityType(input.entityType);
  const entityId = normalizeEntityId(input.entityId);
  if (!entityType || !entityId) return;

  const state = readCache();
  const key = buildEntityKey(entityType, entityId);
  const prev = state.entries[queue]?.[key];

  const rating = typeof input.rating === 'number' && Number.isFinite(input.rating) ? Math.floor(input.rating) : null;
  const games = typeof input.games === 'number' && Number.isFinite(input.games) ? Math.floor(input.games) : null;
  const tier = typeof input.tier === 'string' && input.tier.trim() ? input.tier.trim() : null;

  state.entries[queue] = state.entries[queue] ?? {};
  state.entries[queue]![key] = {
    rank: prev?.rank ?? null,
    rating: rating ?? prev?.rating ?? null,
    games: games ?? prev?.games ?? null,
    tier: tier ?? prev?.tier ?? null,
    updatedAtMs: nowMs,
    source: 'meta',
  };

  pruneQueueEntries(state.entries[queue]!);
  state.updatedAtMs = nowMs;
  writeCache(state);
};

const formatRankInt = (value: number): string => {
  try {
    return value.toLocaleString('zh-CN');
  } catch {
    return String(value);
  }
};

const roundTo = (value: number, step: number): number => {
  if (step <= 1) return value;
  return Math.round(value / step) * step;
};

export const getArenaApproxRankLabel = (input: {
  queue: ArenaQueue;
  entityType: ArenaEntityType;
  entityId: string;
  nowMs?: number;
}): { label: string; title: string } | null => {
  if (typeof window === 'undefined') return null;
  const nowMs = typeof input.nowMs === 'number' && Number.isFinite(input.nowMs) ? input.nowMs : Date.now();
  const queue = normalizeQueue(input.queue);
  if (!queue) return null;
  const entityType = normalizeEntityType(input.entityType);
  const entityId = normalizeEntityId(input.entityId);
  if (!entityType || !entityId) return null;

  const state = readCache();
  const entry = state.entries[queue]?.[buildEntityKey(entityType, entityId)];
  const rank = typeof entry?.rank === 'number' && Number.isFinite(entry.rank) && entry.rank > 0 ? Math.floor(entry.rank) : null;
  if (!rank) return null;

  const ageMs = Math.max(0, nowMs - (entry?.updatedAtMs ?? nowMs));
  const step = ageMs > STALE_ROUNDING_AFTER_MS ? (rank >= 1000 ? 100 : 10) : 1;
  const rounded = roundTo(rank, step);

  const maxRankSeen = typeof state.maxRankSeen?.[queue] === 'number' && Number.isFinite(state.maxRankSeen[queue])
    ? Math.max(0, Math.floor(state.maxRankSeen[queue]))
    : 0;

  const percentBound = maxRankSeen > 0 ? Math.min(100, Math.max(0, Math.ceil((rounded / maxRankSeen) * 100))) : null;
  const percentText = percentBound != null ? `（至少前 ${percentBound}%）` : '';

  const ageText = (() => {
    if (ageMs < 60_000) return '刚刚';
    if (ageMs < 60 * 60_000) return `${Math.floor(ageMs / 60_000)} 分钟前`;
    if (ageMs < 24 * 60 * 60_000) return `${Math.floor(ageMs / (60 * 60_000))} 小时前`;
    return `${Math.floor(ageMs / (24 * 60 * 60_000))} 天前`;
  })();

  const sourceText = entry?.source === 'leaderboard'
    ? '排行榜'
    : entry?.source === 'ranked-match'
      ? '排位对战'
      : '本地记录';

  const cacheScopeText = maxRankSeen > 0 ? `（本设备已缓存至榜单 #${formatRankInt(maxRankSeen)}）` : '';
  const roundingText = step > 1 ? `（已按 ${step} 位取整）` : '';

  return {
    label: `约#${formatRankInt(rounded)}${percentText}`,
    title: `基于本地缓存估算：来源 ${sourceText}，更新于 ${ageText}${roundingText}。${cacheScopeText} 仅供参考，以排行榜/个人页为准。`,
  };
};

