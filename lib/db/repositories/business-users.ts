import { eq, sql } from 'drizzle-orm';
import type { AppDrizzleDb } from '@/lib/db/drizzle';
import { users } from '@/lib/db/schema';

export type BusinessUserRow = typeof users.$inferSelect;

export type CreateBusinessUserInput = {
  username: string;
  email: string;
  authKey: string;
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
