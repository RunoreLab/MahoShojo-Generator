import { and, eq, sql } from 'drizzle-orm';
import { getDrizzleDbFromRuntime } from '@/lib/db/drizzle';
import { pvpMatchPlayers } from '@/lib/db/schema';

/** Read-only authorization for battle reports created before Card Duel retirement. */
export async function isUserInPvpMatch(matchId: string, userId: number): Promise<boolean> {
  try {
    const db = getDrizzleDbFromRuntime();
    if (!db) return false;
    const rows = await db.select({ ok: sql<number>`1` }).from(pvpMatchPlayers)
      .where(and(eq(pvpMatchPlayers.matchId, matchId), eq(pvpMatchPlayers.userId, userId))).limit(1);
    return rows.length > 0;
  } catch (error) {
    console.error('检查历史卡牌对决战报权限失败:', error);
    return false;
  }
}
