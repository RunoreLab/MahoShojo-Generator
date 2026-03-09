import { and, eq, sql } from 'drizzle-orm';
import type { AppDrizzleDb } from '@/lib/db/drizzle';
import { dataCards } from '@/lib/db/schema';

export const getDataCardUpdatedAtById = async (db: AppDrizzleDb, dataCardId: string): Promise<string | null> => {
  const rows = await db
    .select({
      updatedAt: dataCards.updatedAt,
    })
    .from(dataCards)
    .where(eq(dataCards.id, dataCardId))
    .limit(1);

  const row = rows[0];
  return typeof row?.updatedAt === 'string' ? row.updatedAt : null;
};

export const updateDataCardContentByIdAndUser = async (
  db: AppDrizzleDb,
  dataCardId: string,
  userId: number,
  dataJsonString: string,
): Promise<void> => {
  await db
    .update(dataCards)
    .set({
      data: dataJsonString,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(and(eq(dataCards.id, dataCardId), eq(dataCards.userId, userId)));
};
