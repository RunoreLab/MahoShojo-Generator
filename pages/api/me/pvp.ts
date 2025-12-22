import { getPvpMatchesByUserId, getPvpUserSummariesByUserIds } from '@/lib/d1';
import { json, requireAuthUser } from '@/lib/pvp/server';

export const runtime = 'edge';

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return json({ error: 'Method not allowed' }, { status: 405 });

  const auth = await requireAuthUser(req);
  if ('response' in auth) return auth.response;

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

  const { matches, players } = await getPvpMatchesByUserId(auth.user.id, 20);
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
    recentMatches: matches.map((m) => ({
      id: m.id,
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

