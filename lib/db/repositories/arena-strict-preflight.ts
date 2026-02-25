import { and, eq, gte, or } from 'drizzle-orm';
import type { AppDrizzleDb } from '@/lib/db/drizzle';
import { arenaRatingEvents, arenaRatings } from '@/lib/db/schema';

export type ArenaEntity = { entityType: 'data_card' | 'preset'; entityId: string };

export type ArenaRatingLiteRow = {
  entityType: 'data_card' | 'preset';
  entityId: string;
  rating: number;
  games: number;
};

export const getStrictArenaRatingsByEntities = async (
  db: AppDrizzleDb,
  a: ArenaEntity,
  b: ArenaEntity,
): Promise<ArenaRatingLiteRow[]> => {
  return db
    .select({
      entityType: arenaRatings.entityType,
      entityId: arenaRatings.entityId,
      rating: arenaRatings.rating,
      games: arenaRatings.games,
    })
    .from(arenaRatings)
    .where(
      and(
        eq(arenaRatings.queue, 'strict'),
        or(
          and(eq(arenaRatings.entityType, a.entityType), eq(arenaRatings.entityId, a.entityId)),
          and(eq(arenaRatings.entityType, b.entityType), eq(arenaRatings.entityId, b.entityId)),
        ),
      ),
    );
};

export const hasAppliedStrictEventForUserPairSince = async (
  db: AppDrizzleDb,
  userId: number,
  pairKey: string,
  sinceIso: string,
): Promise<boolean> => {
  const rows = await db
    .select({
      id: arenaRatingEvents.id,
    })
    .from(arenaRatingEvents)
    .where(
      and(
        eq(arenaRatingEvents.queue, 'strict'),
        eq(arenaRatingEvents.status, 'applied'),
        eq(arenaRatingEvents.userId, userId),
        eq(arenaRatingEvents.pairKey, pairKey),
        gte(arenaRatingEvents.createdAt, sinceIso),
      ),
    )
    .limit(1);

  return rows.length > 0;
};
