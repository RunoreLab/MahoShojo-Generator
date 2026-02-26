import { and, eq, sql } from 'drizzle-orm';
import type { AppDrizzleDb } from '@/lib/db/drizzle';
import { users } from '@/lib/db/schema';

export type BusinessUserRow = typeof users.$inferSelect;

export type CreateBusinessUserInput = {
  username: string;
  email: string;
  authKey: string;
};

export type BusinessUserLoginRow = {
  id: number;
  username: string;
  prefix: string | null;
};

export const getBusinessUserById = async (db: AppDrizzleDb, userId: number): Promise<BusinessUserRow | null> => {
  const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  return rows[0] ?? null;
};

export const getBusinessUserByEmail = async (db: AppDrizzleDb, email: string): Promise<BusinessUserRow | null> => {
  const rows = await db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = lower(${email})`)
    .limit(1);
  return rows[0] ?? null;
};

export const getBusinessUserByUsername = async (db: AppDrizzleDb, username: string): Promise<BusinessUserRow | null> => {
  const rows = await db.select().from(users).where(eq(users.username, username)).limit(1);
  return rows[0] ?? null;
};

export const getBusinessUserByAuthKey = async (db: AppDrizzleDb, authKey: string): Promise<BusinessUserRow | null> => {
  const rows = await db.select().from(users).where(eq(users.authKey, authKey)).limit(1);
  return rows[0] ?? null;
};

export const createBusinessUser = async (
  db: AppDrizzleDb,
  input: CreateBusinessUserInput,
): Promise<BusinessUserRow | null> => {
  try {
    await db.insert(users).values({
      username: input.username,
      email: input.email,
      authKey: input.authKey,
    });
  } catch {
    return null;
  }

  return getBusinessUserByEmail(db, input.email);
};

export const updateBusinessUserAuthKey = async (
  db: AppDrizzleDb,
  userId: number,
  authKey: string,
): Promise<BusinessUserRow | null> => {
  await db
    .update(users)
    .set({
      authKey,
    })
    .where(eq(users.id, userId));

  return getBusinessUserById(db, userId);
};

export const verifyBusinessUserLoginByUsernameAndAuthKey = async (
  db: AppDrizzleDb,
  username: string,
  authKey: string,
): Promise<BusinessUserLoginRow | null> => {
  const rows = await db
    .select({
      id: users.id,
      username: users.username,
      prefix: users.prefix,
    })
    .from(users)
    .where(and(eq(users.username, username), eq(users.authKey, authKey)))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    prefix: typeof row.prefix === 'string' ? row.prefix : null,
  };
};

export const touchBusinessUserLastLoginAt = async (db: AppDrizzleDb, userId: number): Promise<void> => {
  await db
    .update(users)
    .set({
      lastLoginAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(users.id, userId));
};

export const getBusinessUserProfileCardById = async (
  db: AppDrizzleDb,
  userId: number,
): Promise<{
  id: number;
  username: string;
  prefix: string | null;
  createdAt: string | null;
  signature: string | null;
  avatarWebpBase64: string | null;
} | null> => {
  const rows = await db
    .select({
      id: users.id,
      username: users.username,
      prefix: users.prefix,
      createdAt: users.createdAt,
      signature: users.signature,
      avatarWebpBase64: users.avatarWebpBase64,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    prefix: typeof row.prefix === 'string' ? row.prefix : null,
    createdAt: typeof row.createdAt === 'string' ? row.createdAt : null,
    signature: typeof row.signature === 'string' ? row.signature : null,
    avatarWebpBase64: typeof row.avatarWebpBase64 === 'string' ? row.avatarWebpBase64 : null,
  };
};

export const getBusinessUserProfileById = async (
  db: AppDrizzleDb,
  userId: number,
): Promise<{ signature: string | null; avatarWebpBase64: string | null } | null> => {
  const rows = await db
    .select({
      signature: users.signature,
      avatarWebpBase64: users.avatarWebpBase64,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  return {
    signature: typeof row.signature === 'string' ? row.signature : null,
    avatarWebpBase64: typeof row.avatarWebpBase64 === 'string' ? row.avatarWebpBase64 : null,
  };
};

export const updateBusinessUserSignatureById = async (
  db: AppDrizzleDb,
  userId: number,
  signature: string | null,
): Promise<number> => {
  const rows = await db
    .update(users)
    .set({
      signature,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(users.id, userId))
    .returning({
      id: users.id,
    });

  return rows.length;
};

export const updateBusinessUserAvatarWebpBase64ById = async (
  db: AppDrizzleDb,
  userId: number,
  avatarWebpBase64: string | null,
): Promise<number> => {
  const rows = await db
    .update(users)
    .set({
      avatarWebpBase64,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(users.id, userId))
    .returning({
      id: users.id,
    });

  return rows.length;
};

export const getBusinessUserSlotCountById = async (
  db: AppDrizzleDb,
  userId: number,
): Promise<number | null> => {
  const rows = await db
    .select({
      slotCount: users.slotCount,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!rows[0]) return null;
  const value = rows[0].slotCount;
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.trunc(parsed);
  }
  return null;
};

export const updateBusinessUserSlotCountById = async (
  db: AppDrizzleDb,
  userId: number,
  slotCount: number,
): Promise<number> => {
  const rows = await db
    .update(users)
    .set({
      slotCount: Math.trunc(slotCount),
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(users.id, userId))
    .returning({
      id: users.id,
    });

  return rows.length;
};

export const increaseBusinessUserSlotCountById = async (
  db: AppDrizzleDb,
  userId: number,
  increaseBy: number,
): Promise<number> => {
  const delta = Math.max(0, Math.trunc(increaseBy));
  const rows = await db
    .update(users)
    .set({
      slotCount: sql`COALESCE(${users.slotCount}, 0) + ${delta}`,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(users.id, userId))
    .returning({
      id: users.id,
    });

  return rows.length;
};
