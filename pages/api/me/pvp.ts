import { countPvpMatchesByUserId, getPvpMatchesByUserId, getPvpUserSummariesByUserIds } from '@/lib/database/pvp';
import { buildDefaultPvpUserSummary, mapPvpMatchPlayerRow, mapPvpMatchRow, mapPvpUserSummaryRow } from '@/lib/pvp/read-mappers';
import { json, requireAuthUser } from '@/lib/pvp/server';

const clampInt = (value: unknown, fallback: number, min: number, max: number): number => {
  const n = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
};

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return json({ error: 'Method not allowed' }, { status: 405 });

  const auth = await requireAuthUser(req);
  if ('response' in auth) return auth.response;

  const url = new URL(req.url);
  const page = clampInt(url.searchParams.get('page'), 1, 1, 10_000);
  const pageSize = clampInt(url.searchParams.get('pageSize'), 10, 1, 30);
  const offset = (page - 1) * pageSize;

  const summaries = await getPvpUserSummariesByUserIds([auth.user.id]);
  const summary = (() => {
    for (const row of summaries) {
      const mapped = mapPvpUserSummaryRow(row, auth.user.id);
      if (mapped.userId === auth.user.id) return mapped;
    }
    return buildDefaultPvpUserSummary(auth.user.id);
  })();

  const [totalMatches, matchResult] = await Promise.all([
    countPvpMatchesByUserId(auth.user.id),
    getPvpMatchesByUserId(auth.user.id, pageSize, offset),
  ]);
  const { matches, players } = matchResult;
  const playersByMatchId = new Map<string, ReturnType<typeof mapPvpMatchPlayerRow>[]>();
  for (const row of players) {
    const mapped = mapPvpMatchPlayerRow(row);
    if (!mapped.matchId) continue;
    const list = playersByMatchId.get(mapped.matchId) ?? [];
    list.push(mapped);
    playersByMatchId.set(mapped.matchId, list);
  }

  return json({
    success: true,
    summary,
    page,
    pageSize,
    totalMatches,
    recentMatches: matches.map((m) => {
      const mappedMatch = mapPvpMatchRow(m);
      return {
        ...mappedMatch,
        players: (playersByMatchId.get(mappedMatch.id) ?? []).map((p) => ({
          userId: p.userId,
          seat: p.seat,
          username: p.username,
          prefix: p.prefix,
        })),
      };
    }),
  });
}
