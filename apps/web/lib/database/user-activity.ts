/**
 * 用户最近活跃时间（后台统计用）。
 * - 目的：用较低 D1_ROWS_READ 成本统计近 24 小时/7 天活跃用户等指标。
 * - 口径：任意“可代表用户活跃”的操作完成后，调用 touchUserLastActivity 写入/更新。
 */

type UserActivityRepoBundle = {
  db: unknown;
  upsertUserLastActivity: (
    db: unknown,
    input: { userId: number; lastSeenAt: string; updatedAt: string },
  ) => Promise<void>;
  countUserLastActivitySince: (db: unknown, sinceIso: string) => Promise<number>;
};

const readUserActivityRepoBundle = async (): Promise<UserActivityRepoBundle | null> => {
  try {
    const [{ getDrizzleDbFromRuntime }, repo] = await Promise.all([
      import('@/lib/db/drizzle'),
      import('@/lib/db/repositories/user-activity'),
    ]);
    const db = getDrizzleDbFromRuntime();
    if (!db) return null;

    return {
      db,
      upsertUserLastActivity: repo.upsertUserLastActivity as UserActivityRepoBundle['upsertUserLastActivity'],
      countUserLastActivitySince: repo.countUserLastActivitySince as UserActivityRepoBundle['countUserLastActivitySince'],
    };
  } catch {
    return null;
  }
};

export async function touchUserLastActivity(userId: number, seenAtIso?: string): Promise<boolean> {
  const safeUserId = Number.isFinite(userId) ? Math.floor(userId) : 0;
  if (safeUserId <= 0) return false;

  const nowIso = new Date().toISOString();
  const safeSeenAtIso = (() => {
    if (typeof seenAtIso !== 'string' || !seenAtIso.trim()) return nowIso;
    const parsed = new Date(seenAtIso.trim());
    if (Number.isNaN(parsed.getTime())) return nowIso;
    return parsed.toISOString();
  })();

  try {
    const bundle = await readUserActivityRepoBundle();
    if (!bundle) return false;

    await bundle.upsertUserLastActivity(bundle.db, {
      userId: safeUserId,
      lastSeenAt: safeSeenAtIso,
      updatedAt: nowIso,
    });
    return true;
  } catch (error) {
    console.warn('[user_last_activity] 写入失败（可能尚未迁移建表）:', error);
    return false;
  }
}

export async function countActiveUsersSince(sinceIso: string): Promise<number> {
  const safeSinceIso = typeof sinceIso === 'string' ? sinceIso.trim() : '';
  if (!safeSinceIso) return 0;

  try {
    const bundle = await readUserActivityRepoBundle();
    if (!bundle) return 0;

    const total = await bundle.countUserLastActivitySince(bundle.db, safeSinceIso);
    return Number.isFinite(total) ? Math.max(0, Math.floor(total)) : 0;
  } catch (error) {
    console.warn('[user_last_activity] 统计失败（可能尚未迁移建表）:', error);
    return 0;
  }
}
