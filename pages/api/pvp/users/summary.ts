import { getPvpUserSummariesByUserIds } from '@/lib/database/pvp';
import { json, readJson, requireAuthUser, withPvpErrorBoundary } from '@/lib/pvp/server';

export const runtime = 'edge';

type SummaryBody = { userIds?: unknown };

async function summaryHandler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, { status: 405 });

  const auth = await requireAuthUser(req);
  if ('response' in auth) return auth.response;

  const body = await readJson<SummaryBody>(req);
  if ('response' in body) return body.response;

  const rawUserIds = (body.data as SummaryBody).userIds;
  const userIds = Array.isArray(rawUserIds)
    ? rawUserIds
        .filter((n) => typeof n === 'number' && Number.isFinite(n))
        .map((n) => Math.floor(n))
        .filter((n) => n > 0)
    : [];

  if (userIds.length <= 0) return json({ success: true, users: [] });
  if (userIds.length > 20) return json({ error: '一次最多查询 20 个用户' }, { status: 400 });

  const rows = await getPvpUserSummariesByUserIds(userIds);
  const byUserId = new Map<number, any>();
  for (const r of rows) {
    const total = (r.wins ?? 0) + (r.losses ?? 0) + (r.draws ?? 0);
    const winRate = total > 0 ? Math.round(((r.wins ?? 0) / total) * 100) : 0;
    byUserId.set(r.user_id, {
      userId: r.user_id,
      completedMatches: r.completed_matches ?? 0,
      wins: r.wins ?? 0,
      losses: r.losses ?? 0,
      draws: r.draws ?? 0,
      abortedMatches: r.aborted_matches ?? 0,
      lastPlayedAt: r.last_played_at ?? null,
      winRate,
    });
  }

  return json({
    success: true,
    users: userIds.map((userId) => byUserId.get(userId) ?? ({
      userId,
      completedMatches: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      abortedMatches: 0,
      lastPlayedAt: null,
      winRate: 0,
    })),
  });
}

export default withPvpErrorBoundary(summaryHandler);

