import { getPvpUserSummariesByUserIds } from '@/lib/database/pvp';
import { buildDefaultPvpUserSummary, computePvpWinRate, mapPvpUserSummaryRow } from '@/lib/pvp/read-mappers';
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
    const mapped = mapPvpUserSummaryRow(r);
    byUserId.set(mapped.userId, {
      ...mapped,
      winRate: computePvpWinRate(mapped),
    });
  }

  return json({
    success: true,
    users: userIds.map((userId) => {
      const mapped = byUserId.get(userId);
      if (mapped) return mapped;
      const fallback = buildDefaultPvpUserSummary(userId);
      return { ...fallback, winRate: computePvpWinRate(fallback) };
    }),
  });
}

export default withPvpErrorBoundary(summaryHandler);
