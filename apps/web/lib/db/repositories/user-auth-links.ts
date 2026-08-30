import { eq, sql } from 'drizzle-orm';
import type { AppDrizzleDb } from '@/lib/db/drizzle';
import { baAccounts, baUsers, baVerifications, userAuthLinks } from '@/lib/db/schema';

export type UserAuthLinkRow = typeof userAuthLinks.$inferSelect;

export type CreateUserAuthLinkInput = {
  authUserId: string;
  businessUserId: number;
};

export type AuthMigrationStatus = {
  hasAuthLink: boolean;
  authUserId: string | null;
  hasPassword: boolean;
  emailVerified: boolean;
};

export type AuthUserProfileLite = {
  id: string;
  email: string;
  emailVerified: boolean;
};

export type CreateAuthResetPasswordVerificationInput = {
  id: string;
  token: string;
  authUserId: string;
  expiresAt: number;
};

export const getUserAuthLinkByAuthUserId = async (
  db: AppDrizzleDb,
  authUserId: string,
): Promise<UserAuthLinkRow | null> => {
  const rows = await db
    .select()
    .from(userAuthLinks)
    .where(eq(userAuthLinks.authUserId, authUserId))
    .limit(1);

  return rows[0] ?? null;
};

export const getUserAuthLinkByBusinessUserId = async (
  db: AppDrizzleDb,
  businessUserId: number,
): Promise<UserAuthLinkRow | null> => {
  const rows = await db
    .select()
    .from(userAuthLinks)
    .where(eq(userAuthLinks.businessUserId, businessUserId))
    .limit(1);

  return rows[0] ?? null;
};

export const upsertUserAuthLink = async (
  db: AppDrizzleDb,
  input: CreateUserAuthLinkInput,
): Promise<UserAuthLinkRow | null> => {
  await db
    .insert(userAuthLinks)
    .values({
      authUserId: input.authUserId,
      businessUserId: input.businessUserId,
    })
    .onConflictDoUpdate({
      target: userAuthLinks.authUserId,
      set: {
        businessUserId: input.businessUserId,
      },
    });

  return getUserAuthLinkByAuthUserId(db, input.authUserId);
};

export const getAuthMigrationStatusByBusinessUserId = async (
  db: AppDrizzleDb,
  businessUserId: number,
): Promise<AuthMigrationStatus> => {
  const link = await getUserAuthLinkByBusinessUserId(db, businessUserId);
  if (!link) {
    return {
      hasAuthLink: false,
      authUserId: null,
      hasPassword: false,
      emailVerified: false,
    };
  }

  const authUserRows = await db
    .select({
      emailVerified: baUsers.emailVerified,
    })
    .from(baUsers)
    .where(eq(baUsers.id, link.authUserId))
    .limit(1);
  const emailVerified = Boolean(authUserRows[0]?.emailVerified);

  const credentialAccounts = await db
    .select({
      password: baAccounts.password,
    })
    .from(baAccounts)
    .where(eq(baAccounts.userId, link.authUserId));

  const hasPassword = credentialAccounts.some((row) => typeof row.password === 'string' && row.password.trim().length > 0);

  return {
    hasAuthLink: true,
    authUserId: link.authUserId,
    hasPassword,
    emailVerified,
  };
};

export const getAuthUserProfileByAuthUserId = async (
  db: AppDrizzleDb,
  authUserId: string,
): Promise<AuthUserProfileLite | null> => {
  const rows = await db
    .select({
      id: baUsers.id,
      email: baUsers.email,
      emailVerified: baUsers.emailVerified,
    })
    .from(baUsers)
    .where(eq(baUsers.id, authUserId))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  if (typeof row.email !== 'string' || !row.email.trim()) return null;

  return {
    id: row.id,
    email: row.email.trim().toLowerCase(),
    emailVerified: Boolean(row.emailVerified),
  };
};

export const getAuthUserProfileByEmail = async (
  db: AppDrizzleDb,
  email: string,
): Promise<AuthUserProfileLite | null> => {
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (!normalizedEmail) return null;

  const rows = await db
    .select({
      id: baUsers.id,
      email: baUsers.email,
      emailVerified: baUsers.emailVerified,
    })
    .from(baUsers)
    .where(sql`lower(${baUsers.email}) = lower(${normalizedEmail})`)
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  if (typeof row.email !== 'string' || !row.email.trim()) return null;

  return {
    id: row.id,
    email: row.email.trim().toLowerCase(),
    emailVerified: Boolean(row.emailVerified),
  };
};

export const markAuthUserEmailVerifiedById = async (
  db: AppDrizzleDb,
  authUserId: string,
): Promise<void> => {
  await db
    .update(baUsers)
    .set({
      emailVerified: true,
      updatedAt: sql`(unixepoch())`,
    })
    .where(eq(baUsers.id, authUserId));
};

export const createAuthResetPasswordVerification = async (
  db: AppDrizzleDb,
  input: CreateAuthResetPasswordVerificationInput,
): Promise<void> => {
  const identifier = `reset-password:${input.token}`;
  const expiresAt = new Date(Math.trunc(input.expiresAt) * 1000);

  await db.insert(baVerifications).values({
    id: input.id,
    identifier,
    value: input.authUserId,
    expiresAt,
  });
};
