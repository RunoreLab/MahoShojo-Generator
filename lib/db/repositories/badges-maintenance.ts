import { and, asc, eq, inArray, isNotNull, ne, sql } from 'drizzle-orm';
import type { AppDrizzleDb } from '@/lib/db/drizzle';
import { badges, userBadges, users } from '@/lib/db/schema';

export type BadgeMaintenanceDefinitionInput = {
  id: string;
  name: string;
  description: string | null;
  icon: string;
  textColor: string;
  backgroundColor: string;
  borderColor: string | null;
  rarity: number;
  sortOrder: number;
  isActive: boolean;
};

export type BadgeMaintenanceUserWithPrefixRow = {
  id: number;
  username: string;
  prefix: string;
};

export type BadgeMaintenanceActiveBadgeRow = {
  id: string;
  name: string;
  description: string | null;
  icon: string;
  textColor: string;
  backgroundColor: string;
  borderColor: string | null;
  rarity: number;
  sortOrder: number;
  isActive: boolean;
};

const normalizeBadgeIds = (badgeIds: string[]): string[] =>
  Array.from(
    new Set(
      badgeIds
        .map((id) => (typeof id === 'string' ? id.trim() : ''))
        .filter(Boolean),
    ),
  );

export const listExistingBadgeIds = async (
  db: AppDrizzleDb,
  badgeIds: string[],
): Promise<string[]> => {
  const safeBadgeIds = normalizeBadgeIds(badgeIds);
  if (safeBadgeIds.length === 0) return [];

  const rows = await db
    .select({
      id: badges.id,
    })
    .from(badges)
    .where(inArray(badges.id, safeBadgeIds));

  return rows
    .map((row) => (typeof row.id === 'string' ? row.id.trim() : ''))
    .filter(Boolean);
};

export const upsertBadgeDefinition = async (
  db: AppDrizzleDb,
  input: BadgeMaintenanceDefinitionInput,
): Promise<void> => {
  await db
    .insert(badges)
    .values({
      id: input.id,
      name: input.name,
      description: input.description,
      icon: input.icon,
      textColor: input.textColor,
      backgroundColor: input.backgroundColor,
      borderColor: input.borderColor,
      rarity: input.rarity,
      sortOrder: input.sortOrder,
      isActive: input.isActive,
      createdAt: sql`CURRENT_TIMESTAMP`,
    })
    .onConflictDoUpdate({
      target: badges.id,
      set: {
        name: input.name,
        description: input.description,
        icon: input.icon,
        textColor: input.textColor,
        backgroundColor: input.backgroundColor,
        borderColor: input.borderColor,
        rarity: input.rarity,
        sortOrder: input.sortOrder,
        isActive: input.isActive,
      },
    });
};

export const listUsersWithPrefix = async (
  db: AppDrizzleDb,
): Promise<BadgeMaintenanceUserWithPrefixRow[]> => {
  const rows = await db
    .select({
      id: users.id,
      username: users.username,
      prefix: users.prefix,
    })
    .from(users)
    .where(and(isNotNull(users.prefix), ne(users.prefix, '')));

  return rows
    .map((row) => ({
      id: row.id,
      username: typeof row.username === 'string' ? row.username : '',
      prefix: typeof row.prefix === 'string' ? row.prefix : '',
    }))
    .filter((row) => row.username.length > 0 && row.prefix.length > 0);
};

export const listActiveBadges = async (
  db: AppDrizzleDb,
): Promise<BadgeMaintenanceActiveBadgeRow[]> => {
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
    .orderBy(asc(badges.sortOrder), asc(badges.id));

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: typeof row.description === 'string' ? row.description : null,
    icon: row.icon,
    textColor: row.textColor,
    backgroundColor: row.backgroundColor,
    borderColor: typeof row.borderColor === 'string' ? row.borderColor : null,
    rarity: typeof row.rarity === 'number' && Number.isFinite(row.rarity) ? Math.trunc(row.rarity) : 0,
    sortOrder: typeof row.sortOrder === 'number' && Number.isFinite(row.sortOrder) ? Math.trunc(row.sortOrder) : 0,
    isActive: Boolean(row.isActive),
  }));
};

export const hasUserBadge = async (
  db: AppDrizzleDb,
  input: { userId: number; badgeId: string },
): Promise<boolean> => {
  const rows = await db
    .select({
      userId: userBadges.userId,
    })
    .from(userBadges)
    .where(and(eq(userBadges.userId, input.userId), eq(userBadges.badgeId, input.badgeId)))
    .limit(1);

  return rows.length > 0;
};

export const grantUserBadge = async (
  db: AppDrizzleDb,
  input: { userId: number; badgeId: string; displayOrder: number; isEquipped: boolean },
): Promise<void> => {
  await db
    .insert(userBadges)
    .values({
      userId: input.userId,
      badgeId: input.badgeId,
      isEquipped: input.isEquipped,
      displayOrder: Math.max(0, Math.trunc(input.displayOrder)),
      obtainedAt: sql`CURRENT_TIMESTAMP`,
    })
    .onConflictDoNothing();
};
