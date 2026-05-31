import { getPvpMatchById, getPvpMatchPlayersByMatchId, getPvpRoundsByMatch, isUserInPvpMatch } from '@/lib/database/pvp';
import { json, requireAuthUser } from '@/lib/pvp/server';

const getMatchIdFromUrl = (url: string): string | null => {
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    // /api/me/pvp/matches/:matchId
    const idx = parts.findIndex((p) => p === 'matches');
    if (idx === -1) return null;
    return parts[idx + 1] || null;
  } catch {
    return null;
  }
};

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return json({ error: 'Method not allowed' }, { status: 405 });

  const auth = await requireAuthUser(req);
  if ('response' in auth) return auth.response;

  const matchId = getMatchIdFromUrl(req.url);
  if (!matchId) return json({ error: '缺少 matchId' }, { status: 400 });

  const canRead = await isUserInPvpMatch(matchId, auth.user.id);
  if (!canRead) return json({ error: '记录不存在' }, { status: 404 });

  const match = await getPvpMatchById(matchId);
  if (!match) return json({ error: '记录不存在' }, { status: 404 });

  const [players, rounds] = await Promise.all([
    getPvpMatchPlayersByMatchId(matchId),
    getPvpRoundsByMatch(matchId),
  ]);

  return json({
    success: true,
    match: {
      id: match.id,
      roomId: match.room_id,
      status: match.status,
      participants: match.participants,
      startedAt: match.started_at,
      endedAt: match.ended_at,
      winnerUserId: match.winner_user_id,
    },
    players: players.map((p) => ({
      userId: p.user_id,
      seat: p.seat,
      username: p.username ?? null,
      prefix: p.user_prefix ?? null,
      joinedAt: p.joined_at,
    })),
    rounds: rounds.map((r) => ({
      id: r.id,
      roomId: r.room_id,
      roundIndex: r.round_index,
      status: r.status,
      winnerUserId: r.winner_user_id,
      winnerName: r.winner_name,
      battleGenerationId: r.battle_generation_id,
      createdAt: r.created_at,
    })),
  });
}

