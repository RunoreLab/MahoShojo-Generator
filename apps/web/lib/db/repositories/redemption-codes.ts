import { desc, eq, sql } from 'drizzle-orm';
import type { AppDrizzleDb } from '@/lib/db/drizzle';
import { redemptionCodes } from '@/lib/db/schema';

export type RedemptionCodeRow = {
  code: string;
  slot_count: number;
  created_at: string | null;
};

const toInt = (value: unknown, fallback = 0): number => {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
};

export const consumeRedemptionCode = async (
  db: AppDrizzleDb,
  code: string,
): Promise<{ slot_count: number } | null> => {
  const rows = await db
    .delete(redemptionCodes)
    .where(eq(redemptionCodes.code, code))
    .returning({
      slotCount: redemptionCodes.slotCount,
    });

  const row = rows[0];
  if (!row) return null;
  return {
    slot_count: toInt(row.slotCount, 0),
  };
};

export const insertRedemptionCodesBatch = async (
  db: AppDrizzleDb,
  rows: Array<{ code: string; slotCount: number }>,
): Promise<void> => {
  if (rows.length === 0) return;

  await db
    .insert(redemptionCodes)
    .values(
      rows.map((row) => ({
        code: row.code,
        slotCount: Math.max(0, Math.floor(row.slotCount)),
        createdAt: sql`CURRENT_TIMESTAMP`,
      })),
    );
};

export const insertRedemptionCode = async (
  db: AppDrizzleDb,
  code: string,
  slotCount: number,
): Promise<void> => {
  await db.insert(redemptionCodes).values({
    code,
    slotCount: Math.max(0, Math.floor(slotCount)),
    createdAt: sql`CURRENT_TIMESTAMP`,
  });
};

export const hasRedemptionCode = async (
  db: AppDrizzleDb,
  code: string,
): Promise<boolean> => {
  const rows = await db
    .select({
      code: redemptionCodes.code,
    })
    .from(redemptionCodes)
    .where(eq(redemptionCodes.code, code))
    .limit(1);

  return rows.length > 0;
};

export const listRedemptionCodes = async (
  db: AppDrizzleDb,
): Promise<RedemptionCodeRow[]> => {
  const rows = await db
    .select({
      code: redemptionCodes.code,
      slotCount: redemptionCodes.slotCount,
      createdAt: redemptionCodes.createdAt,
    })
    .from(redemptionCodes)
    .orderBy(desc(redemptionCodes.createdAt));

  return rows.map((row) => ({
    code: row.code,
    slot_count: toInt(row.slotCount, 0),
    created_at: typeof row.createdAt === 'string' ? row.createdAt : null,
  }));
};
