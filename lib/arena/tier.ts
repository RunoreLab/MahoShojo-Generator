export type ArenaQueue = 'strict' | 'free';
export type ArenaEntityType = 'data_card' | 'preset';

export type ArenaEntityRef = {
  entityType: ArenaEntityType;
  entityId: string;
};

export type ArenaBaseTier = '无牌' | '白牌' | '字牌' | '花牌' | '权杖';
export type ArenaTier = ArenaBaseTier | '女王';

export const ARENA_PLACEMENT_GAMES = 5;
export const ARENA_SCEPTER_MIN_RATING = 1500;
export const ARENA_QUEEN_MIN_SCEPTER_COUNT = 3;

export function computeArenaBaseTier(rating: number, games: number): ArenaBaseTier {
  if (games < ARENA_PLACEMENT_GAMES || rating < 800) return '无牌';
  if (rating < 1000) return '白牌';
  if (rating < 1200) return '字牌';
  if (rating < 1500) return '花牌';
  return '权杖';
}

export function applyQueenTier(baseTier: ArenaBaseTier, isQueen: boolean): ArenaTier {
  if (!isQueen) return baseTier;
  return baseTier === '权杖' ? '女王' : baseTier;
}

export function isArenaScepterTier(rating: number, games: number): boolean {
  return games >= ARENA_PLACEMENT_GAMES && rating >= ARENA_SCEPTER_MIN_RATING;
}

type ListPublicScepterEntities = (
  queue: ArenaQueue,
  options: { minGames: number; minRating: number; limit: number },
) => Promise<Array<ArenaEntityRef | { entityType: unknown; entityId: unknown }>>;

const QUEEN_CACHE_TTL_MS = 30_000;
const queenCache = new Map<ArenaQueue, { value: ArenaEntityRef | null; expiresAt: number }>();

export async function queryArenaPublicQueenEntity(
  listPublicScepterEntities: ListPublicScepterEntities,
  queue: ArenaQueue,
): Promise<ArenaEntityRef | null> {
  const now = Date.now();
  const cached = queenCache.get(queue);
  if (cached && cached.expiresAt > now) return cached.value;

  const rows = await listPublicScepterEntities(queue, {
    minGames: ARENA_PLACEMENT_GAMES,
    minRating: ARENA_SCEPTER_MIN_RATING,
    limit: ARENA_QUEEN_MIN_SCEPTER_COUNT,
  });
  if (rows.length < ARENA_QUEEN_MIN_SCEPTER_COUNT) {
    queenCache.set(queue, { value: null, expiresAt: now + QUEEN_CACHE_TTL_MS });
    return null;
  }

  const row = rows[0];
  if (!row) {
    queenCache.set(queue, { value: null, expiresAt: now + QUEEN_CACHE_TTL_MS });
    return null;
  }

  const entityType = row.entityType === 'data_card' || row.entityType === 'preset' ? row.entityType : null;
  const entityId = typeof row.entityId === 'string' ? row.entityId.trim() : '';
  if (!entityType || !entityId) {
    queenCache.set(queue, { value: null, expiresAt: now + QUEEN_CACHE_TTL_MS });
    return null;
  }

  const value: ArenaEntityRef = { entityType, entityId };
  queenCache.set(queue, { value, expiresAt: now + QUEEN_CACHE_TTL_MS });
  return value;
}
