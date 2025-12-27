import {
  getBattleReportGenerationsByUserIdLite,
  getPvpMatchesByUserId,
  getPvpUserSummariesByUserIds,
  getUserEquippedBadges,
  getUserProfileCardRowByUserId,
  getUserRecentBadgesExcludingEquipped,
  getUserTopDataCardsByEngagement,
  type UserTopDataCardRow,
} from '@/lib/d1';
import { json, requireAuthUser, withPvpErrorBoundary } from '@/lib/pvp/server';

export const runtime = 'edge';

type CardLite = {
  id: string;
  type: 'character' | 'scenario';
  name: string;
  description: string | null;
  isPublic: boolean;
  reviewStatus: string | null;
  likeCount: number;
  favoriteCount: number;
  usageCount: number;
  engagementScore: number;
};

type PvpMatchLite = {
  id: string;
  roomId: string | null;
  status: string;
  startedAt: string;
  endedAt: string | null;
  winnerUserId: number | null;
  players: Array<{ userId: number; seat: number; username: string | null; prefix: string | null }>;
};

type BattleReportLite = {
  id: string;
  startedAt: string;
  status: string;
  mode: string;
  headline: string | null;
  winner: string | null;
  pvpMatchId: string | null;
  contentBlocked: boolean;
};

export default withPvpErrorBoundary(async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return json({ error: 'Method not allowed' }, { status: 405 });

  const auth = await requireAuthUser(req);
  if ('response' in auth) return auth.response;

  const [userRow, equippedBadges, recentBadges, topCharacters, topScenarios, pvpSummaries, pvp, recentReports] =
    await Promise.all([
      getUserProfileCardRowByUserId(auth.user.id),
      getUserEquippedBadges(auth.user.id),
      getUserRecentBadgesExcludingEquipped(auth.user.id, 5),
      getUserTopDataCardsByEngagement(auth.user.id, 'character', 3),
      getUserTopDataCardsByEngagement(auth.user.id, 'scenario', 1),
      getPvpUserSummariesByUserIds([auth.user.id]),
      getPvpMatchesByUserId(auth.user.id, 3, 0),
      getBattleReportGenerationsByUserIdLite(auth.user.id, 3, 0),
    ]);

  if (!userRow) return json({ error: '用户不存在' }, { status: 404 });

  const summary = pvpSummaries.find((s) => s.user_id === auth.user.id) ?? {
    user_id: auth.user.id,
    completed_matches: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    aborted_matches: 0,
    last_played_at: null,
  };

  const playersByMatchId = new Map<string, typeof pvp.players>();
  for (const row of pvp.players) {
    const list = playersByMatchId.get(row.match_id) ?? [];
    list.push(row);
    playersByMatchId.set(row.match_id, list);
  }

  const mapCard = (row: UserTopDataCardRow): CardLite => {
    const usage = typeof row.usage_count === 'number' ? row.usage_count : Number(row.usage_count || 0);
    const likes = typeof row.like_count === 'number' ? row.like_count : Number(row.like_count || 0);
    const favorites = typeof row.favorite_count === 'number' ? row.favorite_count : Number(row.favorite_count || 0);
    const engagementScore = (Number.isFinite(usage) ? usage : 0) + (Number.isFinite(likes) ? likes : 0) + (Number.isFinite(favorites) ? favorites : 0);
    return {
      id: row.id,
      type: row.type === 'scenario' ? 'scenario' : 'character',
      name: row.name,
      description: row.description == null ? null : String(row.description),
      isPublic: Boolean(row.is_public),
      reviewStatus: row.review_status == null ? null : String(row.review_status),
      likeCount: Number.isFinite(likes) ? likes : 0,
      favoriteCount: Number.isFinite(favorites) ? favorites : 0,
      usageCount: Number.isFinite(usage) ? usage : 0,
      engagementScore,
    };
  };

  const avatarDataUrl = userRow.avatar_webp_base64 ? `data:image/webp;base64,${userRow.avatar_webp_base64}` : null;

  const reports: BattleReportLite[] = recentReports.map((r) => ({
    id: r.id,
    startedAt: r.started_at,
    status: r.status,
    mode: r.mode,
    headline: r.headline,
    winner: r.winner,
    pvpMatchId: r.pvp_match_id,
    contentBlocked: Boolean(r.output_has_sensitive_words),
  }));

  const recentMatches: PvpMatchLite[] = pvp.matches.map((m) => ({
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
  }));

  return json(
    {
      success: true,
      profile: {
        id: userRow.id,
        username: userRow.username,
        prefix: userRow.prefix ?? null,
        createdAt: userRow.created_at,
        signature: userRow.signature ?? '',
        avatarDataUrl,
      },
      badges: {
        equipped: equippedBadges,
        recent: recentBadges,
      },
      topCards: {
        characters: topCharacters.map(mapCard),
        scenario: topScenarios.length > 0 ? mapCard(topScenarios[0]) : null,
      },
      pvp: {
        summary: {
          completedMatches: summary.completed_matches ?? 0,
          wins: summary.wins ?? 0,
          losses: summary.losses ?? 0,
          draws: summary.draws ?? 0,
          abortedMatches: summary.aborted_matches ?? 0,
          lastPlayedAt: summary.last_played_at ?? null,
        },
        recentMatches,
      },
      recentBattleReports: reports,
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
});
