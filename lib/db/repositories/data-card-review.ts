import { and, count, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { AppDrizzleDb } from '@/lib/db/drizzle';
import { dataCards, dataCardUpdates } from '@/lib/db/schema';

export type PendingDataCardReviewRow = {
  id: string;
  name: string;
  description: string | null;
  data: string;
};

export type PendingDataCardUpdateReviewRow = {
  updateId: string;
  dataCardId: string;
  name: string;
  description: string | null;
  data: string;
  type: 'character' | 'scenario' | 'history' | 'questionnaire' | null;
};

const toInt = (value: unknown, fallback = 0): number => {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
};

export const countPendingPublicCardsByUserId = async (
  db: AppDrizzleDb,
  userId: number,
): Promise<number> => {
  const rows = await db
    .select({
      count: count(),
    })
    .from(dataCards)
    .where(
      and(
        eq(dataCards.userId, userId),
        eq(dataCards.isPublic, true),
        eq(dataCards.reviewStatus, 'pending'),
        isNull(dataCards.deletedAt),
      ),
    );

  return Math.max(0, toInt(rows[0]?.count, 0));
};

export const listLatestPendingPublicCardsByUserId = async (
  db: AppDrizzleDb,
  userId: number,
  limit: number,
): Promise<PendingDataCardReviewRow[]> => {
  if (limit <= 0) return [];

  const rows = await db
    .select({
      id: dataCards.id,
      name: dataCards.name,
      description: dataCards.description,
      data: dataCards.data,
    })
    .from(dataCards)
    .where(
      and(
        eq(dataCards.userId, userId),
        eq(dataCards.isPublic, true),
        eq(dataCards.reviewStatus, 'pending'),
        isNull(dataCards.deletedAt),
      ),
    )
    .orderBy(desc(dataCards.updatedAt))
    .limit(Math.max(1, Math.min(200, Math.trunc(limit))));

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: typeof row.description === 'string' ? row.description : null,
    data: row.data,
  }));
};

export const approvePendingPublicCardsByIds = async (
  db: AppDrizzleDb,
  userId: number,
  cardIds: string[],
): Promise<number> => {
  const uniqueIds = Array.from(
    new Set(cardIds.map((id) => (typeof id === 'string' ? id.trim() : '')).filter(Boolean)),
  );
  if (uniqueIds.length === 0) return 0;

  const updatedRows = await db
    .update(dataCards)
    .set({
      reviewStatus: 'approved',
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(
      and(
        eq(dataCards.userId, userId),
        inArray(dataCards.id, uniqueIds),
        eq(dataCards.isPublic, true),
        eq(dataCards.reviewStatus, 'pending'),
        isNull(dataCards.deletedAt),
      ),
    )
    .returning({
      id: dataCards.id,
    });

  return updatedRows.length;
};

export const countPendingPublicCardUpdatesByUserId = async (
  db: AppDrizzleDb,
  userId: number,
): Promise<number> => {
  const rows = await db
    .select({
      count: count(),
    })
    .from(dataCardUpdates)
    .innerJoin(dataCards, eq(dataCards.id, dataCardUpdates.dataCardId))
    .where(
      and(
        eq(dataCardUpdates.userId, userId),
        eq(dataCards.isPublic, true),
        eq(dataCards.reviewStatus, 'approved'),
        isNull(dataCards.deletedAt),
      ),
    );

  return Math.max(0, toInt(rows[0]?.count, 0));
};

export const listLatestPendingPublicCardUpdatesByUserId = async (
  db: AppDrizzleDb,
  userId: number,
  limit: number,
): Promise<PendingDataCardUpdateReviewRow[]> => {
  if (limit <= 0) return [];

  const rows = await db
    .select({
      updateId: dataCardUpdates.id,
      dataCardId: dataCardUpdates.dataCardId,
      name: dataCardUpdates.name,
      description: dataCardUpdates.description,
      data: dataCardUpdates.data,
      type: dataCards.type,
    })
    .from(dataCardUpdates)
    .innerJoin(dataCards, eq(dataCards.id, dataCardUpdates.dataCardId))
    .where(
      and(
        eq(dataCardUpdates.userId, userId),
        eq(dataCards.isPublic, true),
        eq(dataCards.reviewStatus, 'approved'),
        isNull(dataCards.deletedAt),
      ),
    )
    .orderBy(desc(dataCardUpdates.updatedAt))
    .limit(Math.max(1, Math.min(200, Math.trunc(limit))));

  return rows.map((row) => ({
    updateId: row.updateId,
    dataCardId: row.dataCardId,
    name: typeof row.name === 'string' ? row.name : '',
    description: typeof row.description === 'string' ? row.description : null,
    data: typeof row.data === 'string' ? row.data : '',
    type: row.type === 'character' || row.type === 'scenario' || row.type === 'history' || row.type === 'questionnaire'
      ? row.type
      : null,
  }));
};

export const applyPendingPublicCardUpdateByUserId = async (
  db: AppDrizzleDb,
  userId: number,
  update: Pick<PendingDataCardUpdateReviewRow, 'dataCardId' | 'name' | 'description' | 'data'>,
): Promise<boolean> => {
  const updatedRows = await db
    .update(dataCards)
    .set({
      name: update.name,
      description: update.description ?? '',
      data: update.data,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(
      and(
        eq(dataCards.id, update.dataCardId),
        eq(dataCards.userId, userId),
        isNull(dataCards.deletedAt),
      ),
    )
    .returning({
      id: dataCards.id,
    });

  return updatedRows.length > 0;
};

export const deletePendingCardUpdateByDataCardId = async (
  db: AppDrizzleDb,
  dataCardId: string,
): Promise<void> => {
  await db
    .delete(dataCardUpdates)
    .where(eq(dataCardUpdates.dataCardId, dataCardId));
};
