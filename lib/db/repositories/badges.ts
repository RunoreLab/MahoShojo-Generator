import { and, count, desc, eq, inArray, sql } from 'drizzle-orm';
import type { AppDrizzleDb } from '@/lib/db/drizzle';
import { badges, userBadges } from '@/lib/db/schema';

export type UserBadgeJoinedRow = {
  ub_id: number;
  user_id: number;
  badge_id: string;
  is_equipped: number;
  display_order: number;
  obtained_at: string | null;
  badge_name: string;
  badge_description: string | null;
  badge_icon: string;
  text_color: string;
  background_color: string;
  border_color: string | null;
  rarity: number;
  sort_order: number;
  is_active: number;
};

export type BadgeDefinitionRow = {
  id: string;
  name: string;
  description: string | null;
  icon: string;
  text_color: string;
  background_color: string;
  border_color: string | null;
  rarity: number;
  sort_order: number;
  is_active: number;
};

const toInt = (value: unknown, fallback = 0): number => {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
};

const toNullableString = (value: unknown): string | null => (typeof value === 'string' ? value : null);

const mapUserBadgeJoinedRow = (row: {
  ubId: number;
  userId: number;
  badgeId: string;
  isEquipped: boolean | null;
  displayOrder: number | null;
  obtainedAt: string | null;
  badgeName: string;
  badgeDescription: string | null;
  badgeIcon: string;
  textColor: string;
  backgroundColor: string;
  borderColor: string | null;
  rarity: number | null;
  sortOrder: number | null;
  isActive: boolean | null;
}): UserBadgeJoinedRow => ({
  ub_id: toInt(row.ubId, 0),
  user_id: toInt(row.userId, 0),
  badge_id: row.badgeId,
  is_equipped: row.isEquipped ? 1 : 0,
  display_order: toInt(row.displayOrder, 0),
  obtained_at: toNullableString(row.obtainedAt),
  badge_name: row.badgeName,
  badge_description: toNullableString(row.badgeDescription),
  badge_icon: row.badgeIcon,
  text_color: row.textColor,
  background_color: row.backgroundColor,
  border_color: toNullableString(row.borderColor),
  rarity: toInt(row.rarity, 0),
  sort_order: toInt(row.sortOrder, 0),
  is_active: row.isActive ? 1 : 0,
});

const mapBadgeDefinitionRow = (row: {
  id: string;
  name: string;
  description: string | null;
  icon: string;
  textColor: string;
  backgroundColor: string;
  borderColor: string | null;
  rarity: number | null;
  sortOrder: number | null;
  isActive: boolean | null;
}): BadgeDefinitionRow => ({
  id: row.id,
  name: row.name,
  description: toNullableString(row.description),
  icon: row.icon,
  text_color: row.textColor,
  background_color: row.backgroundColor,
  border_color: toNullableString(row.borderColor),
  rarity: toInt(row.rarity, 0),
  sort_order: toInt(row.sortOrder, 0),
  is_active: row.isActive ? 1 : 0,
});

export const listUserBadgesWithDefinitions = async (
  db: AppDrizzleDb,
  userId: number,
): Promise<UserBadgeJoinedRow[]> => {
  const rows = await db
    .select({
      ubId: userBadges.id,
      userId: userBadges.userId,
      badgeId: badges.id,
      isEquipped: userBadges.isEquipped,
      displayOrder: userBadges.displayOrder,
      obtainedAt: userBadges.obtainedAt,
      badgeName: badges.name,
      badgeDescription: badges.description,
      badgeIcon: badges.icon,
      textColor: badges.textColor,
      backgroundColor: badges.backgroundColor,
      borderColor: badges.borderColor,
      rarity: badges.rarity,
      sortOrder: badges.sortOrder,
      isActive: badges.isActive,
    })
    .from(userBadges)
    .innerJoin(badges, eq(userBadges.badgeId, badges.id))
    .where(and(eq(userBadges.userId, userId), eq(badges.isActive, true)))
    .orderBy(desc(userBadges.isEquipped), desc(badges.rarity), badges.sortOrder);

  return rows.map(mapUserBadgeJoinedRow);
};

export const listRecentUserBadgesExcludingEquipped = async (
  db: AppDrizzleDb,
  userId: number,
  limit: number,
): Promise<UserBadgeJoinedRow[]> => {
  const safeLimit = Math.max(1, Math.min(10, Math.floor(limit)));
  const rows = await db
    .select({
      ubId: userBadges.id,
      userId: userBadges.userId,
      badgeId: badges.id,
      isEquipped: userBadges.isEquipped,
      displayOrder: userBadges.displayOrder,
      obtainedAt: userBadges.obtainedAt,
      badgeName: badges.name,
      badgeDescription: badges.description,
      badgeIcon: badges.icon,
      textColor: badges.textColor,
      backgroundColor: badges.backgroundColor,
      borderColor: badges.borderColor,
      rarity: badges.rarity,
      sortOrder: badges.sortOrder,
      isActive: badges.isActive,
    })
    .from(userBadges)
    .innerJoin(badges, eq(userBadges.badgeId, badges.id))
    .where(and(eq(userBadges.userId, userId), eq(badges.isActive, true), eq(userBadges.isEquipped, false)))
    .orderBy(desc(userBadges.obtainedAt))
    .limit(safeLimit);

  return rows.map(mapUserBadgeJoinedRow);
};

export const clearEquippedUserBadges = async (
  db: AppDrizzleDb,
  userId: number,
): Promise<void> => {
  await db
    .update(userBadges)
    .set({
      isEquipped: false,
      displayOrder: 0,
    })
    .where(eq(userBadges.userId, userId));
};

export const setUserBadgeEquippedOrder = async (
  db: AppDrizzleDb,
  userId: number,
  badgeId: string,
  displayOrder: number,
): Promise<number> => {
  const updatedRows = await db
    .update(userBadges)
    .set({
      isEquipped: true,
      displayOrder: Math.max(0, Math.floor(displayOrder)),
    })
    .where(and(eq(userBadges.userId, userId), eq(userBadges.badgeId, badgeId)))
    .returning({
      id: userBadges.id,
    });

  return updatedRows.length;
};

export const insertUserBadgeIgnore = async (
  db: AppDrizzleDb,
  userId: number,
  badgeId: string,
): Promise<void> => {
  await db
    .insert(userBadges)
    .values({
      userId,
      badgeId,
      isEquipped: false,
      displayOrder: 0,
      obtainedAt: sql`CURRENT_TIMESTAMP`,
    })
    .onConflictDoNothing();
};

export const deleteUserBadge = async (
  db: AppDrizzleDb,
  userId: number,
  badgeId: string,
): Promise<number> => {
  const deletedRows = await db
    .delete(userBadges)
    .where(and(eq(userBadges.userId, userId), eq(userBadges.badgeId, badgeId)))
    .returning({
      id: userBadges.id,
    });

  return deletedRows.length;
};

export const countUserBadgesByBadgeId = async (
  db: AppDrizzleDb,
  userId: number,
  badgeId: string,
): Promise<number> => {
  const rows = await db
    .select({
      total: count(),
    })
    .from(userBadges)
    .where(and(eq(userBadges.userId, userId), eq(userBadges.badgeId, badgeId)));

  return Math.max(0, toInt(rows[0]?.total, 0));
};

export const listActiveBadgeDefinitions = async (
  db: AppDrizzleDb,
): Promise<BadgeDefinitionRow[]> => {
  const rows = await db
    .select({
      id: badges.id,
      name: badges.name,
      description: badges.description,
      icon: badges.icon,
      textColor: badges.textColor,
      backgroundColor: badges.backgroundColor,
      borderColor: badges.borderColor,
      rarity: badges.rarity,
      sortOrder: badges.sortOrder,
      isActive: badges.isActive,
    })
    .from(badges)
    .where(eq(badges.isActive, true))
    .orderBy(desc(badges.rarity), badges.sortOrder);

  return rows.map(mapBadgeDefinitionRow);
};

export const listExistingBadgeIds = async (
  db: AppDrizzleDb,
  badgeIds: string[],
): Promise<string[]> => {
  const safeBadgeIds = Array.from(
    new Set(badgeIds.map((id) => (typeof id === 'string' ? id.trim() : '')).filter(Boolean)),
  );
  if (safeBadgeIds.length === 0) return [];

  const rows = await db
    .select({
      id: badges.id,
    })
    .from(badges)
    .where(and(inArray(badges.id, safeBadgeIds), eq(badges.isActive, true)));

  return rows.map((row) => row.id);
};

export const listUserOwnedBadgeIds = async (
  db: AppDrizzleDb,
  userId: number,
  badgeIds: string[],
): Promise<string[]> => {
  const safeBadgeIds = Array.from(
    new Set(badgeIds.map((id) => (typeof id === 'string' ? id.trim() : '')).filter(Boolean)),
  );
  if (safeBadgeIds.length === 0) return [];

  const rows = await db
    .select({
      badgeId: userBadges.badgeId,
    })
    .from(userBadges)
    .where(and(eq(userBadges.userId, userId), inArray(userBadges.badgeId, safeBadgeIds)));

  return rows
    .map((row) => row.badgeId)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
};

export const runBadgeOpsTransaction = async (
  db: AppDrizzleDb,
  operation: (tx: AppDrizzleDb) => Promise<void>,
): Promise<void> => {
  await db.transaction(async (tx) => {
    await operation(tx as unknown as AppDrizzleDb);
  });
};

export const touchUserBadgeObtainedAtNow = async (
  db: AppDrizzleDb,
  userId: number,
  badgeId: string,
): Promise<void> => {
  await db
    .update(userBadges)
    .set({
      obtainedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(and(eq(userBadges.userId, userId), eq(userBadges.badgeId, badgeId)));
};
