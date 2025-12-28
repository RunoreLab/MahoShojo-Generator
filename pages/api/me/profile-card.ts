import {
  getBattleReportGenerationsByUserIdLite,
  countBattleReportGenerationsByUserId,
  countBattleReportGenerationsByUserIdSince,
  getPvpMatchRoundOutcomeSummariesByMatchIds,
  getPvpMatchesByUserId,
  getPvpUserSummariesByUserIds,
  getUserBadges,
  getUserProfileCardRowByUserId,
  getUserProfileCardDataStats,
  getUserTopDataCardsByEngagement,
  type PvpMatchRoundOutcomeSummary,
  type UserTopDataCardRow,
} from '@/lib/d1';
import { json, requireAuthUser, withPvpErrorBoundary } from '@/lib/pvp/server';
import type { UserBadge } from '@/types/badge';

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
  roundSummary: { total: number; wins: number; losses: number; draws: number } | null;
};

type BattleReportLite = {
  id: string;
  startedAt: string;
  status: string;
  mode: string;
  headline: string | null;
  winner: string | null;
  promptTokens: number | null;
  reasoningTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  cachedTokens: number | null;
  pvpMatchId: string | null;
  contentBlocked: boolean;
};

function clampInt(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.floor(n));
}

function buildBadgeLists(allBadges: UserBadge[]) {
  const equipped = allBadges
    .filter((b) => Boolean(b?.isEquipped))
    .sort((a, b) => (a?.displayOrder ?? 0) - (b?.displayOrder ?? 0))
    .slice(0, 5);

  const recent = allBadges
    .filter((b) => !Boolean(b?.isEquipped))
    .sort((a, b) => {
      const ams = Date.parse(String(a?.obtainedAt ?? ''));
      const bms = Date.parse(String(b?.obtainedAt ?? ''));
      if (!Number.isFinite(ams) && !Number.isFinite(bms)) return 0;
      if (!Number.isFinite(ams)) return 1;
      if (!Number.isFinite(bms)) return -1;
      return bms - ams;
    })
    .slice(0, 5);

  return { equipped, recent };
}

function normalizeRoundSummary(row: PvpMatchRoundOutcomeSummary): { total: number; wins: number; losses: number; draws: number } {
  const record = row as unknown as Record<string, unknown>;
  const total = clampInt(record.total_rounds) ?? 0;
  const wins = clampInt(record.wins) ?? 0;
  const losses = clampInt(record.losses) ?? 0;
  const draws = clampInt(record.draws) ?? 0;
  return { total, wins, losses, draws };
}

export default withPvpErrorBoundary(async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return json({ error: 'Method not allowed' }, { status: 405 });

  const auth = await requireAuthUser(req);
  if ('response' in auth) return auth.response;

  const sinceIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [
    userRow,
    allBadges,
    topCharacters,
    topScenarios,
    pvpSummaries,
    pvp,
    recentReports,
    dataCardStats,
    battleReports7d,
    battleReportsAllTotal,
  ] =
    await Promise.all([
      getUserProfileCardRowByUserId(auth.user.id),
      getUserBadges(auth.user.id),
      getUserTopDataCardsByEngagement(auth.user.id, 'character', 3),
      getUserTopDataCardsByEngagement(auth.user.id, 'scenario', 1),
      getPvpUserSummariesByUserIds([auth.user.id]),
      getPvpMatchesByUserId(auth.user.id, 3, 0),
      getBattleReportGenerationsByUserIdLite(auth.user.id, 3, 0),
      getUserProfileCardDataStats(auth.user.id),
      countBattleReportGenerationsByUserIdSince(auth.user.id, sinceIso),
      countBattleReportGenerationsByUserId(auth.user.id),
    ]);

  if (!userRow) return json({ error: '用户不存在' }, { status: 404 });

  const badgeLists = buildBadgeLists(allBadges);

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
    promptTokens: r.prompt_tokens ?? null,
    reasoningTokens: r.reasoning_tokens ?? null,
    completionTokens: r.completion_tokens ?? null,
    totalTokens: r.total_tokens ?? null,
    cachedTokens: r.cached_tokens ?? null,
    pvpMatchId: r.pvp_match_id,
    contentBlocked: Boolean(r.output_has_sensitive_words),
  }));

  const matchIds = pvp.matches.map((m) => m.id);
  const roundRows = await getPvpMatchRoundOutcomeSummariesByMatchIds(matchIds, auth.user.id);
  const roundSummaryByMatchId = new Map<string, { total: number; wins: number; losses: number; draws: number }>();
  for (const row of roundRows) {
    if (!row?.match_id) continue;
    roundSummaryByMatchId.set(row.match_id, normalizeRoundSummary(row));
  }

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
    roundSummary: roundSummaryByMatchId.get(m.id) ?? null,
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
        equipped: badgeLists.equipped,
        recent: badgeLists.recent,
        all: allBadges,
      },
      topCards: {
        characters: topCharacters.map(mapCard),
        scenario: topScenarios.length > 0 ? mapCard(topScenarios[0]) : null,
      },
      stats: {
        dataCards: dataCardStats,
        battleReports7d,
        battleReportsAll: { total: battleReportsAllTotal },
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
