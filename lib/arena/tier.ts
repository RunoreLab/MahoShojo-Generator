export type ArenaQueue = 'strict' | 'free';
export type ArenaEntityType = 'data_card' | 'preset';

export type ArenaEntityRef = {
  entityType: ArenaEntityType;
  entityId: string;
};

export type ArenaBaseTier = '无牌' | '白牌' | '字牌' | '花牌' | '权杖';
export type ArenaTier = ArenaBaseTier | '女王';

export const ARENA_PLACEMENT_GAMES = 5;
export const ARENA_SCEPTER_MIN_RATING = 1600;
export const ARENA_QUEEN_MIN_SCEPTER_COUNT = 3;

export function computeArenaBaseTier(rating: number, games: number): ArenaBaseTier {
  if (games < ARENA_PLACEMENT_GAMES || rating < 900) return '无牌';
  if (rating < 1100) return '白牌';
  if (rating < 1300) return '字牌';
  if (rating < 1600) return '花牌';
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

type QueenRow = {
  scepterCount: unknown;
  entityType: unknown;
  entityId: unknown;
};

const readSingleRow = <T,>(result: unknown): T | null => {
  const row = (result as any)?.result?.[0]?.results?.[0];
  return row ? (row as T) : null;
};

function clampInt(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.floor(n));
}

export async function queryArenaPublicQueenEntity(
  queryFromD1: QueryFromD1,
  queue: ArenaQueue,
): Promise<ArenaEntityRef | null> {
  const strictPublicSinceClause =
    queue === 'strict' ? "AND (dc.public_since IS NULL OR dc.public_since <= datetime('now', '-3 days'))" : '';

  const sql = `
    WITH eligible AS (
      SELECT ar.entity_type AS entityType, ar.entity_id AS entityId, ar.rating AS rating, ar.games AS games, ar.updated_at AS updatedAt
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
    ),
    scepter AS (
      SELECT * FROM eligible
      WHERE games >= ${ARENA_PLACEMENT_GAMES} AND rating >= ${ARENA_SCEPTER_MIN_RATING}
    ),
    stats AS (
      SELECT COUNT(*) AS scepterCount FROM scepter
    ),
    queen AS (
      SELECT entityType, entityId
      FROM scepter
      ORDER BY rating DESC, games DESC, updatedAt DESC, entityType ASC, entityId ASC
      LIMIT 1
    )
    SELECT stats.scepterCount AS scepterCount, queen.entityType AS entityType, queen.entityId AS entityId
    FROM stats
    LEFT JOIN queen ON 1=1;
  `;

  const row = readSingleRow<QueenRow>(await queryFromD1(sql, [queue]));
  if (!row) return null;

  const scepterCount = clampInt(row.scepterCount) ?? 0;
  if (scepterCount < ARENA_QUEEN_MIN_SCEPTER_COUNT) return null;

  const entityType = row.entityType === 'data_card' || row.entityType === 'preset' ? row.entityType : null;
  const entityId = typeof row.entityId === 'string' ? row.entityId.trim() : '';
  if (!entityType || !entityId) return null;

  return { entityType, entityId };
}

