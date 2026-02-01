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

type QueryFromD1 = (sql: string, params?: unknown[]) => Promise<unknown>;

const QUEEN_CACHE_TTL_MS = 30_000;
const queenCache = new Map<ArenaQueue, { value: ArenaEntityRef | null; expiresAt: number }>();

const readRows = <T,>(result: unknown): T[] => {
  const rows = (result as any)?.result?.[0]?.results;
  return Array.isArray(rows) ? (rows as T[]) : [];
};

export async function queryArenaPublicQueenEntity(
  queryFromD1: QueryFromD1,
  queue: ArenaQueue,
): Promise<ArenaEntityRef | null> {
  const now = Date.now();
  const cached = queenCache.get(queue);
  if (cached && cached.expiresAt > now) return cached.value;

  const strictPublicSinceClause =
    queue === 'strict'
      ? `AND (
        dc.public_since IS NULL
        OR dc.public_since <= datetime('now', '-3 days')
        OR (
          dc.created_at IS NOT NULL
          AND dc.public_since IS NOT NULL
          AND ABS(strftime('%s', dc.public_since) - strftime('%s', dc.created_at)) <= 600
        )
      )`
      : '';

  const sql = `
    SELECT ar.entity_type AS entityType, ar.entity_id AS entityId
    FROM arena_ratings ar
    LEFT JOIN data_cards dc
      ON ar.entity_type = 'data_card' AND dc.id = ar.entity_id
    WHERE ar.queue = ?
      AND (
        ar.entity_type = 'preset'
        OR (
          dc.id IS NOT NULL
          AND dc.type = 'character'
          AND dc.is_public = 1
          AND dc.review_status = 'approved'
          AND dc.deleted_at IS NULL
          ${strictPublicSinceClause}
        )
      )
      AND ar.games >= ${ARENA_PLACEMENT_GAMES}
      AND ar.rating >= ${ARENA_SCEPTER_MIN_RATING}
    ORDER BY ar.rating DESC, ar.games DESC, ar.updated_at DESC, ar.entity_type ASC, ar.entity_id ASC
    LIMIT ${ARENA_QUEEN_MIN_SCEPTER_COUNT};
  `;

  const rows = readRows<{ entityType: unknown; entityId: unknown }>(await queryFromD1(sql, [queue]));
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
