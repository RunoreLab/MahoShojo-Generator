import { eq } from 'drizzle-orm';
import type { AppDrizzleDb } from '@/lib/db/drizzle';
import { userAuthLinks } from '@/lib/db/schema';

export type UserAuthLinkRow = typeof userAuthLinks.$inferSelect;

export type CreateUserAuthLinkInput = {
  authUserId: string;
  businessUserId: number;
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
