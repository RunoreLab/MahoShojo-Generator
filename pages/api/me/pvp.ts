import { countPvpMatchesByUserId, getPvpMatchesByUserId, getPvpUserSummariesByUserIds } from '@/lib/d1';
import { json, requireAuthUser } from '@/lib/pvp/server';

export const runtime = 'edge';

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
  const summary = summaries.find((s) => s.user_id === auth.user.id) ?? {
    user_id: auth.user.id,
    completed_matches: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    aborted_matches: 0,
    last_played_at: null,
  };

  const [totalMatches, matchResult] = await Promise.all([
    countPvpMatchesByUserId(auth.user.id),
    getPvpMatchesByUserId(auth.user.id, pageSize, offset),
  ]);
  const { matches, players } = matchResult;
  const playersByMatchId = new Map<string, typeof players>();
  for (const row of players) {
    const list = playersByMatchId.get(row.match_id) ?? [];
    list.push(row);
    playersByMatchId.set(row.match_id, list);
  }

  return json({
    success: true,
    summary: {
      completedMatches: summary.completed_matches ?? 0,
      wins: summary.wins ?? 0,
      losses: summary.losses ?? 0,
      draws: summary.draws ?? 0,
      abortedMatches: summary.aborted_matches ?? 0,
      lastPlayedAt: summary.last_played_at ?? null,
    },
    page,
    pageSize,
    totalMatches,
    recentMatches: matches.map((m) => ({
      id: m.id,
      roomId: m.room_id ?? null,
      status: m.status,
      startedAt: m.started_at,
      endedAt: m.ended_at,
      winnerUserId: m.winner_user_id,
      players: (playersByMatchId.get(m.id) ?? []).map((p) => ({
        userId: p.user_id,
        seat: p.seat,
        username: p.username ?? null,
        prefix: p.user_prefix ?? null,
      })),
    })),
  });
}

