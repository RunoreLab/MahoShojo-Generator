import { and, count, desc, eq, gte, inArray, like, lte, sql, type SQL } from 'drizzle-orm';
import type { AppDrizzleDb } from '@/lib/db/drizzle';
import { redemptionCodes, userBadges } from '@/lib/db/schema';

export type RedemptionCodeRow = {
  code: string;
  slot_count: number;
  created_at: string | null;
};

export type AdminRedemptionCodeItem = {
  code: string;
  slotCount: number;
  estimatedValueCny: number;
  createdAt: string | null;
};

export type AdminRedemptionCodeStats = {
  unusedCodeTotal: number;
  unusedSlotTotal: number;
  unusedEstimatedValueCny: number;
  inferredRedeemedSlotTotal: number;
  inferredRedeemedEstimatedValueCny: number;
  inferredRedeemedUserTotal: number;
  inferredRedeemedAverageValueCny: number;
  reporterRewardSlotTotal: number;
  latestCreatedAt: string | null;
};

export type RedemptionCodePageInput = {
  page?: number;
  limit?: number;
  search?: string;
  minSlotCount?: number;
  maxSlotCount?: number;
};

export type RedemptionCodePageResult = {
  items: AdminRedemptionCodeItem[];
  total: number;
  page: number;
  limit: number;
};

const REPORTER_BADGE_SLOT_REWARDS: Record<string, number> = {
  excellent_reporter: 128,
  hot_reporter: 64,
  senior_reporter: 48,
  ace_reporter: 32,
  chief_reporter: 16,
};

const toInt = (value: unknown, fallback = 0): number => {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
};

const toNonNegativeInt = (value: unknown): number => Math.max(0, toInt(value, 0));

const normalizePage = (value: unknown): number => Math.max(1, toInt(value, 1));

const normalizeLimit = (value: unknown): number => Math.min(200, Math.max(1, toInt(value, 20)));

export const normalizeRedemptionCode = (code: string): string =>
  typeof code === 'string' ? code.trim().toUpperCase() : '';

const normalizeSlotBound = (value: unknown): number | null => {
  const parsed = toInt(value, Number.NaN);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, parsed);
};

const mapAdminItem = (row: { code: string; slotCount: unknown; createdAt: unknown }): AdminRedemptionCodeItem => {
  const slotCount = toNonNegativeInt(row.slotCount);
  return {
    code: row.code,
    slotCount,
    estimatedValueCny: estimateRedemptionCodeValueCny(slotCount),
    createdAt: typeof row.createdAt === 'string' ? row.createdAt : null,
  };
};

export const estimateRedemptionCodeValueCny = (slotCount: number): number => {
  const normalized = Math.max(0, Math.floor(Number.isFinite(slotCount) ? slotCount : 0));
  if (normalized >= 256) return 24;
  if (normalized >= 128) return 12;
  if (normalized >= 64) return 5;
  return 0;
};

export const consumeRedemptionCode = async (
  db: AppDrizzleDb,
  code: string,
): Promise<{ slot_count: number } | null> => {
  const normalizedCode = normalizeRedemptionCode(code);
  if (!normalizedCode) return null;

  const rows = await db
    .delete(redemptionCodes)
    .where(eq(redemptionCodes.code, normalizedCode))
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
        code: normalizeRedemptionCode(row.code),
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
    code: normalizeRedemptionCode(code),
    slotCount: Math.max(0, Math.floor(slotCount)),
    createdAt: sql`CURRENT_TIMESTAMP`,
  });
};

export const hasRedemptionCode = async (
  db: AppDrizzleDb,
  code: string,
): Promise<boolean> => {
  const normalizedCode = normalizeRedemptionCode(code);
  if (!normalizedCode) return false;

  const rows = await db
    .select({
      code: redemptionCodes.code,
    })
    .from(redemptionCodes)
    .where(eq(redemptionCodes.code, normalizedCode))
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

const buildPageWhereClause = (input: RedemptionCodePageInput): SQL | undefined => {
  const conditions: SQL[] = [];
  const search = typeof input.search === 'string' ? input.search.trim() : '';
  const minSlotCount = normalizeSlotBound(input.minSlotCount);
  const maxSlotCount = normalizeSlotBound(input.maxSlotCount);

  if (search) {
    conditions.push(like(redemptionCodes.code, `%${search}%`));
  }

  if (minSlotCount !== null && maxSlotCount !== null) {
    const low = Math.min(minSlotCount, maxSlotCount);
    const high = Math.max(minSlotCount, maxSlotCount);
    conditions.push(gte(redemptionCodes.slotCount, low), lte(redemptionCodes.slotCount, high));
  } else if (minSlotCount !== null) {
    conditions.push(gte(redemptionCodes.slotCount, minSlotCount));
  } else if (maxSlotCount !== null) {
    conditions.push(lte(redemptionCodes.slotCount, maxSlotCount));
  }

  return conditions.length > 0 ? and(...conditions) : undefined;
};

export const listRedemptionCodesPage = async (
  db: AppDrizzleDb,
  input: RedemptionCodePageInput = {},
): Promise<RedemptionCodePageResult> => {
  const page = normalizePage(input.page);
  const limit = normalizeLimit(input.limit);
  const whereClause = buildPageWhereClause(input);

  const [totalRow] = await db
    .select({ total: count() })
    .from(redemptionCodes)
    .where(whereClause);

  const rows = await db
    .select({
      code: redemptionCodes.code,
      slotCount: redemptionCodes.slotCount,
      createdAt: redemptionCodes.createdAt,
    })
    .from(redemptionCodes)
    .where(whereClause)
    .orderBy(desc(redemptionCodes.createdAt), desc(redemptionCodes.code))
    .limit(limit)
    .offset((page - 1) * limit);

  return {
    items: rows.map(mapAdminItem),
    total: toNonNegativeInt(totalRow?.total),
    page,
    limit,
  };
};

export const deleteRedemptionCodesBatch = async (
  db: AppDrizzleDb,
  codes: string[],
): Promise<number> => {
  const normalized = Array.from(
    new Set(
      codes
        .map((code) => normalizeRedemptionCode(code))
        .filter((code) => code.length > 0),
    ),
  );

  if (normalized.length === 0) return 0;

  const rows = await db
    .delete(redemptionCodes)
    .where(inArray(redemptionCodes.code, normalized))
    .returning({ code: redemptionCodes.code });

  return rows.length;
};

export const getAdminRedemptionCodeStats = async (
  db: AppDrizzleDb,
): Promise<AdminRedemptionCodeStats> => {
  const [unusedRow] = await db
    .select({
      unusedCodeTotal: count(),
      unusedSlotTotal: sql<number>`COALESCE(SUM(CASE WHEN ${redemptionCodes.slotCount} > 0 THEN ${redemptionCodes.slotCount} ELSE 0 END), 0)`,
      unusedEstimatedValueCny: sql<number>`COALESCE(SUM(CASE
        WHEN ${redemptionCodes.slotCount} >= 256 THEN 24
        WHEN ${redemptionCodes.slotCount} >= 128 THEN 12
        WHEN ${redemptionCodes.slotCount} >= 64 THEN 5
        ELSE 0
      END), 0)`,
      latestCreatedAt: sql<string | null>`MAX(${redemptionCodes.createdAt})`,
    })
    .from(redemptionCodes);

  const reporterBadgeIds = Object.keys(REPORTER_BADGE_SLOT_REWARDS);
  const [reporterRewardRow] = await db
    .select({
      total: sql<number>`COALESCE(SUM(CASE
        WHEN ${userBadges.badgeId} = 'excellent_reporter' THEN 128
        WHEN ${userBadges.badgeId} = 'hot_reporter' THEN 64
        WHEN ${userBadges.badgeId} = 'senior_reporter' THEN 48
        WHEN ${userBadges.badgeId} = 'ace_reporter' THEN 32
        WHEN ${userBadges.badgeId} = 'chief_reporter' THEN 16
        ELSE 0
      END), 0)`,
    })
    .from(userBadges)
    .where(inArray(userBadges.badgeId, reporterBadgeIds));

  const [inferredRedeemedRow] = await db
    .select({
      inferredRedeemedSlotTotal: sql<number>`COALESCE(SUM(redeemed_slots), 0)`,
      inferredRedeemedEstimatedValueCny: sql<number>`COALESCE(SUM(CASE
        WHEN redeemed_slots >= 256 THEN 24
        WHEN redeemed_slots >= 128 THEN 12
        WHEN redeemed_slots >= 64 THEN 5
        ELSE 0
      END), 0)`,
      inferredRedeemedUserTotal: sql<number>`COALESCE(SUM(CASE WHEN redeemed_slots > 0 THEN 1 ELSE 0 END), 0)`,
    })
    .from(sql`(
      SELECT
        CASE
          WHEN COALESCE(u.slot_count, 0) - COALESCE(rb.reporter_slots, 0) > 0
            THEN COALESCE(u.slot_count, 0) - COALESCE(rb.reporter_slots, 0)
          ELSE 0
        END AS redeemed_slots
      FROM users u
      LEFT JOIN (
        SELECT
          user_id,
          SUM(CASE
            WHEN badge_id = 'excellent_reporter' THEN 128
            WHEN badge_id = 'hot_reporter' THEN 64
            WHEN badge_id = 'senior_reporter' THEN 48
            WHEN badge_id = 'ace_reporter' THEN 32
            WHEN badge_id = 'chief_reporter' THEN 16
            ELSE 0
          END) AS reporter_slots
        FROM user_badges
        WHERE badge_id IN ('excellent_reporter', 'hot_reporter', 'senior_reporter', 'ace_reporter', 'chief_reporter')
        GROUP BY user_id
      ) rb ON rb.user_id = u.id
    ) inferred_redemption_slots`);

  const unusedCodeTotal = toNonNegativeInt(unusedRow?.unusedCodeTotal);
  const unusedSlotTotal = toNonNegativeInt(unusedRow?.unusedSlotTotal);
  const unusedEstimatedValueCny = toNonNegativeInt(unusedRow?.unusedEstimatedValueCny);
  const reporterRewardSlotTotal = toNonNegativeInt(reporterRewardRow?.total);
  const inferredRedeemedSlotTotal = toNonNegativeInt(inferredRedeemedRow?.inferredRedeemedSlotTotal);
  const inferredRedeemedEstimatedValueCny = toNonNegativeInt(inferredRedeemedRow?.inferredRedeemedEstimatedValueCny);
  const inferredRedeemedUserTotal = toNonNegativeInt(inferredRedeemedRow?.inferredRedeemedUserTotal);

  return {
    unusedCodeTotal,
    unusedSlotTotal,
    unusedEstimatedValueCny,
    inferredRedeemedSlotTotal,
    inferredRedeemedEstimatedValueCny,
    inferredRedeemedUserTotal,
    inferredRedeemedAverageValueCny:
      inferredRedeemedUserTotal > 0 ? inferredRedeemedEstimatedValueCny / inferredRedeemedUserTotal : 0,
    reporterRewardSlotTotal,
    latestCreatedAt: typeof unusedRow?.latestCreatedAt === 'string' ? unusedRow.latestCreatedAt : null,
  };
};
