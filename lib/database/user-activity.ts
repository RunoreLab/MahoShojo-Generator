import { queryFromD1 } from './core';

/**
 * 用户最近活跃时间（后台统计用）。
 * - 目的：用较低 D1_ROWS_READ 成本统计近 24 小时/7 天活跃用户等指标。
 * - 口径：任意“可代表用户活跃”的操作完成后，调用 touchUserLastActivity 写入/更新。
 */

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

  const sql = `
    INSERT INTO user_last_activity (user_id, last_seen_at, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      last_seen_at = CASE
        WHEN excluded.last_seen_at > user_last_activity.last_seen_at THEN excluded.last_seen_at
        ELSE user_last_activity.last_seen_at
      END,
      updated_at = excluded.updated_at;
  `;

  try {
    const result = (await queryFromD1(sql, [safeUserId, safeSeenAtIso, nowIso])) as any;
    return Boolean(result?.success);
  } catch (error) {
    console.warn('[user_last_activity] 写入失败（可能尚未迁移建表）:', error);
    return false;
  }
}

export async function countActiveUsersSince(sinceIso: string): Promise<number> {
  const safeSinceIso = typeof sinceIso === 'string' ? sinceIso.trim() : '';
  if (!safeSinceIso) return 0;

  try {
    const result = (await queryFromD1(
      'SELECT COUNT(1) AS total FROM user_last_activity WHERE last_seen_at >= ?',
      [safeSinceIso]
    )) as any;
    const row = result?.result?.[0]?.results?.[0];
    const total = typeof row?.total === 'number' ? row.total : Number(row?.total);
    return Number.isFinite(total) ? Math.max(0, Math.floor(total)) : 0;
  } catch (error) {
    console.warn('[user_last_activity] 统计失败（可能尚未迁移建表）:', error);
    return 0;
  }
}
