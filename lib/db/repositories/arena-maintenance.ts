import { and, asc, desc, eq, sql, type SQL } from 'drizzle-orm';
import type { AppDrizzleDb } from '@/lib/db/drizzle';
import { arenaRatings } from '@/lib/db/schema';

export type ArenaQueue = 'strict' | 'free';

export type InvalidPresetArenaRatingRow = {
  entityId: string;
  queue: ArenaQueue;
  rating: number;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  updatedAt: string;
};

const toInt = (value: unknown, fallback = 0): number => {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
};

const normalizePresetIds = (presetIds: string[]): string[] => {
  return Array.from(
    new Set(
      presetIds
        .map((id) => (typeof id === 'string' ? id.trim() : ''))
        .filter(Boolean),
    ),
  );
};

const buildInvalidPresetIdCondition = (presetIds: string[]): SQL | undefined => {
  const safePresetIds = normalizePresetIds(presetIds);
  if (safePresetIds.length === 0) return undefined;
  return sql`${arenaRatings.entityId} NOT IN (${sql.join(safePresetIds.map((id) => sql`${id}`), sql`, `)})`;
};

export const listInvalidPresetArenaRatings = async (
  db: AppDrizzleDb,
  presetIds: string[],
): Promise<InvalidPresetArenaRatingRow[]> => {
  const invalidPresetIdCondition = buildInvalidPresetIdCondition(presetIds);

  const rows = await db
    .select({
      entityId: arenaRatings.entityId,
      queue: arenaRatings.queue,
      rating: arenaRatings.rating,
      games: arenaRatings.games,
      wins: arenaRatings.wins,
      losses: arenaRatings.losses,
      draws: arenaRatings.draws,
      updatedAt: arenaRatings.updatedAt,
    })
    .from(arenaRatings)
    .where(
      invalidPresetIdCondition
        ? and(eq(arenaRatings.entityType, 'preset'), invalidPresetIdCondition)
        : eq(arenaRatings.entityType, 'preset'),
    )
    .orderBy(asc(arenaRatings.queue), desc(arenaRatings.games), desc(arenaRatings.updatedAt));

  return rows.map((row) => ({
    entityId: typeof row.entityId === 'string' ? row.entityId : '',
    queue: row.queue === 'free' ? 'free' : 'strict',
    rating: toInt(row.rating, 0),
    games: Math.max(0, toInt(row.games, 0)),
    wins: Math.max(0, toInt(row.wins, 0)),
    losses: Math.max(0, toInt(row.losses, 0)),
    draws: Math.max(0, toInt(row.draws, 0)),
    updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : '',
  }));
};

export const hasPresetArenaRatingByQueue = async (
  db: AppDrizzleDb,
  input: { entityId: string; queue: ArenaQueue },
): Promise<boolean> => {
  const rows = await db
    .select({
      one: sql<number>`1`,
    })
    .from(arenaRatings)
    .where(
      and(
        eq(arenaRatings.entityType, 'preset'),
        eq(arenaRatings.entityId, input.entityId),
        eq(arenaRatings.queue, input.queue),
      ),
    )
    .limit(1);

  return rows.length > 0;
};

export const deletePresetArenaRatingByQueue = async (
  db: AppDrizzleDb,
  input: { entityId: string; queue: ArenaQueue },
): Promise<number> => {
  const rows = await db
    .delete(arenaRatings)
    .where(
      and(
        eq(arenaRatings.entityType, 'preset'),
        eq(arenaRatings.entityId, input.entityId),
        eq(arenaRatings.queue, input.queue),
      ),
    )
    .returning({
      queue: arenaRatings.queue,
    });

  return rows.length;
};

export const renamePresetArenaRatingByQueue = async (
  db: AppDrizzleDb,
  input: { fromEntityId: string; toEntityId: string; queue: ArenaQueue; updatedAt: string },
): Promise<number> => {
  const rows = await db
    .update(arenaRatings)
    .set({
      entityId: input.toEntityId,
      updatedAt: input.updatedAt,
    })
    .where(
      and(
        eq(arenaRatings.entityType, 'preset'),
        eq(arenaRatings.entityId, input.fromEntityId),
        eq(arenaRatings.queue, input.queue),
      ),
    )
    .returning({
      queue: arenaRatings.queue,
    });

  return rows.length;
};

