import { and, asc, eq, gt, isNull, sql } from 'drizzle-orm';
import type { AppDrizzleDb } from '@/lib/db/drizzle';
import { baUsers, userAuthLinks, users } from '@/lib/db/schema';

export type UnlinkedAuthUserRow = {
  id: string;
  email: string | null;
  name: string | null;
};

export type BackfillBusinessUserRow = {
  id: number;
  username: string;
  email: string;
};

const normalizeLimit = (limit: number, min = 1, max = 500): number => {
  if (!Number.isFinite(limit)) return min;
  return Math.max(min, Math.min(max, Math.floor(limit)));
};

export const listUnlinkedAuthUsers = async (
  db: AppDrizzleDb,
  input: { afterId: string; limit: number },
): Promise<UnlinkedAuthUserRow[]> => {
  const afterId = typeof input.afterId === 'string' ? input.afterId.trim() : '';
  const limit = normalizeLimit(input.limit, 1, 1000);

  const rows = await db
    .select({
      id: baUsers.id,
      email: baUsers.email,
      name: baUsers.name,
    })
    .from(baUsers)
    .leftJoin(userAuthLinks, eq(userAuthLinks.authUserId, baUsers.id))
    .where(and(gt(baUsers.id, afterId), isNull(userAuthLinks.id)))
    .orderBy(asc(baUsers.id))
    .limit(limit);

  return rows.map((row) => ({
    id: typeof row.id === 'string' ? row.id : '',
    email: typeof row.email === 'string' ? row.email : null,
    name: typeof row.name === 'string' ? row.name : null,
  }));
};

export const listBusinessUsersByEmailInsensitive = async (
  db: AppDrizzleDb,
  email: string,
  limit: number = 2,
): Promise<BackfillBusinessUserRow[]> => {
  const normalizedEmail = typeof email === 'string' ? email.trim() : '';
  if (!normalizedEmail) return [];

  const rows = await db
    .select({
      id: users.id,
      username: users.username,
      email: users.email,
    })
    .from(users)
    .where(sql`lower(${users.email}) = lower(${normalizedEmail})`)
    .orderBy(asc(users.id))
    .limit(normalizeLimit(limit, 1, 10));

  return rows.map((row) => ({
    id: row.id,
    username: row.username,
    email: row.email,
  }));
};

export const listBusinessUsersByUsernameInsensitive = async (
  db: AppDrizzleDb,
  username: string,
  limit: number = 2,
): Promise<BackfillBusinessUserRow[]> => {
  const normalizedUsername = typeof username === 'string' ? username.trim() : '';
  if (!normalizedUsername) return [];

  const rows = await db
    .select({
      id: users.id,
      username: users.username,
      email: users.email,
    })
    .from(users)
    .where(sql`lower(${users.username}) = lower(${normalizedUsername})`)
    .orderBy(asc(users.id))
    .limit(normalizeLimit(limit, 1, 10));

  return rows.map((row) => ({
    id: row.id,
    username: row.username,
    email: row.email,
  }));
};
