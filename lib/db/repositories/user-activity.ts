import { count, gte, sql } from 'drizzle-orm';
import type { AppDrizzleDb } from '@/lib/db/drizzle';
import { userLastActivity } from '@/lib/db/schema';

const toInt = (value: unknown, fallback = 0): number => {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
};

export const upsertUserLastActivity = async (
  db: AppDrizzleDb,
  input: { userId: number; lastSeenAt: string; updatedAt: string },
): Promise<void> => {
  await db
    .insert(userLastActivity)
    .values({
      userId: input.userId,
      lastSeenAt: input.lastSeenAt,
      updatedAt: input.updatedAt,
    })
    .onConflictDoUpdate({
      target: userLastActivity.userId,
      set: {
        lastSeenAt: sql`CASE
          WHEN excluded.last_seen_at > ${userLastActivity.lastSeenAt} THEN excluded.last_seen_at
          ELSE ${userLastActivity.lastSeenAt}
        END`,
        updatedAt: input.updatedAt,
      },
    });
};

export const countUserLastActivitySince = async (
  db: AppDrizzleDb,
  sinceIso: string,
): Promise<number> => {
  const rows = await db
    .select({
      total: count(),
    })
    .from(userLastActivity)
    .where(gte(userLastActivity.lastSeenAt, sinceIso));

  return Math.max(0, toInt(rows[0]?.total, 0));
};
