import {
  getBattleReportGenerationsByUserIdLite,
  countBattleReportGenerationsByUserId,
  countBattleReportGenerationsByUserIdSince,
} from '@/lib/database/battle-report-generations';
import {
  getPvpMatchRoundOutcomeSummariesByMatchIds,
  getPvpMatchesByUserId,
  getPvpUserSummariesByUserIds,
  type PvpMatchRoundOutcomeSummary,
} from '@/lib/database/pvp';
import {
  getUserBadges,
} from '@/lib/database/badges';
import {
  getUserProfileCardRowByUserId,
} from '@/lib/database/users';
import {
  getUserProfileCardDataStats,
  getUserTopDataCardsByEngagement,
  type UserTopDataCardRow,
} from '@/lib/database/data-cards';
import { applyQueenTier, computeArenaBaseTier } from '@/lib/arena/tier';
import { getDrizzleDbFromRuntime } from '@/lib/db/drizzle';
import {
  getDataCardMetricsByDataCardIds,
  getStrictArenaRatingsByDataCardIds,
  getStrictTopDataCardRankMap,
  getTopRatedCharacterCardByUserId,
  queryArenaPublicQueenEntityByQueue,
  type TopRatedCharacterCardRow,
} from '@/lib/db/repositories/data-card-meta';
import { json, requireAuthUser, withPvpErrorBoundary } from '@/lib/pvp/server';
import { buildDefaultPvpUserSummary, mapPvpMatchPlayerRow, mapPvpMatchRow, mapPvpUserSummaryRow } from '@/lib/pvp/read-mappers';
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

type CardMetricsLite = {
  techScore: number;
  techLevel: string;
} | null;

type CardRatingLite = {
  rating: number;
  games: number;
  tier: string;
  publicRank: number | null;
  publicTotal: number | null;
} | null;

type CardRatingsLite = {
  strict: CardRatingLite;
};

type CharacterHighlight = CardLite & {
  metrics: CardMetricsLite;
  ratings: CardRatingsLite;
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
  const db = getDrizzleDbFromRuntime();

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
      getUserTopDataCardsByEngagement(auth.user.id, 'character', 6),
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

  const summary = (() => {
    for (const row of pvpSummaries) {
      const mapped = mapPvpUserSummaryRow(row, auth.user.id);
      if (mapped.userId === auth.user.id) return mapped;
    }
    return buildDefaultPvpUserSummary(auth.user.id);
  })();

  const playersByMatchId = new Map<string, ReturnType<typeof mapPvpMatchPlayerRow>[]>();
  for (const row of pvp.players) {
    const mapped = mapPvpMatchPlayerRow(row);
    if (!mapped.matchId) continue;
    const list = playersByMatchId.get(mapped.matchId) ?? [];
    list.push(mapped);
    playersByMatchId.set(mapped.matchId, list);
  }

  const normalizeTopRatedRow = (row: TopRatedCharacterCardRow): UserTopDataCardRow => ({
    id: row.id,
    type: row.type,
    name: row.name,
    description: row.description,
    is_public: row.is_public ? 1 : 0,
    review_status: row.review_status,
    usage_count: typeof row.usage_count === 'number' ? row.usage_count : 0,
    like_count: typeof row.like_count === 'number' ? row.like_count : 0,
    favorite_count: typeof row.favorite_count === 'number' ? row.favorite_count : 0,
    created_at: row.created_at ?? '',
    updated_at: row.updated_at ?? '',
  });

  const getTopRatedCharacterRow = async (): Promise<UserTopDataCardRow | null> => {
    if (!db) return null;

    try {
      const strictRow = await getTopRatedCharacterCardByUserId(db, auth.user.id);
      if (!strictRow?.id || strictRow.type !== 'character') return null;
      return normalizeTopRatedRow(strictRow);
    } catch (error) {
      console.warn('读取最高排位角色卡失败（降级为 null）:', error);
      return null;
    }
  };

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

  const topRatedRow = await getTopRatedCharacterRow();
  const topRatedId = topRatedRow?.id ?? null;

  const topCharacterRows = topCharacters
    .filter((row) => row?.id && row.type === 'character')
    .filter((row) => (topRatedId ? row.id !== topRatedId : true))
    .slice(0, 2);

  const topRatedRowResolved = topRatedRow && topRatedRow.type === 'character' ? topRatedRow : null;

  const characterHighlightRows: UserTopDataCardRow[] = [
    ...topCharacterRows,
    ...(topRatedRowResolved ? [topRatedRowResolved] : []),
  ];

  const characterHighlightIds = Array.from(new Set(characterHighlightRows.map((r) => r.id).filter(Boolean)));

  const metricsById = new Map<string, CardMetricsLite>();
  if (characterHighlightIds.length > 0 && db) {
    try {
      const metricsMap = await getDataCardMetricsByDataCardIds(db, characterHighlightIds);
      metricsMap.forEach((row, id) => {
        if (typeof row.techScore !== 'number' || typeof row.techLevel !== 'string') return;
        metricsById.set(id, { techScore: row.techScore, techLevel: row.techLevel });
      });
    } catch (error) {
      console.warn('读取角色卡技术值失败（降级为 null）:', error);
    }
  }

  type RatingRow = {
    dataCardId: string;
    queue: 'strict';
    rating: number;
    games: number;
    updatedAt: string;
  };

  const ratingsById = new Map<string, { strict?: RatingRow }>();
  if (characterHighlightIds.length > 0 && db) {
    try {
      const rows = await getStrictArenaRatingsByDataCardIds(db, characterHighlightIds);
      rows.forEach((row) => {
        if (!row?.dataCardId) return;
        if (row.queue !== 'strict') return;
        const entry = ratingsById.get(row.dataCardId) ?? {};
        entry.strict = {
          dataCardId: row.dataCardId,
          queue: 'strict',
          rating: row.rating,
          games: row.games,
          updatedAt: row.updatedAt,
        };
        ratingsById.set(row.dataCardId, entry);
      });
    } catch (error) {
      console.warn('读取角色卡排位失败（降级为 null）:', error);
    }
  }

  const strictTop300RankByDataCardId = await (async () => {
    const map = new Map<string, number>();
    if (characterHighlightIds.length === 0 || !db) return map;

    try {
      return await getStrictTopDataCardRankMap(db, 300);
    } catch {
      return map;
    }
  })();
  const strictQueen = db
    ? await queryArenaPublicQueenEntityByQueue(db, 'strict').catch((error) => {
        console.warn('读取女王段位失败（降级为无女王）:', error);
        return null;
      })
    : null;

  const buildRating = (row: RatingRow | undefined): CardRatingLite => {
    if (!row) return null;
    if (typeof row.rating !== 'number' || typeof row.games !== 'number') return null;
    const baseTier = computeArenaBaseTier(row.rating, row.games);
    const isQueen = strictQueen?.entityType === 'data_card' && strictQueen?.entityId === row.dataCardId;
    const tier = applyQueenTier(baseTier, isQueen);
    const publicRank = strictTop300RankByDataCardId.get(row.dataCardId) ?? null;
    return { rating: row.rating, games: row.games, tier, publicRank, publicTotal: null };
  };

  const mapCharacterHighlight = async (row: UserTopDataCardRow): Promise<CharacterHighlight> => {
    const base = mapCard(row);
    const metrics = metricsById.get(row.id) ?? null;
    const ratingRows = ratingsById.get(row.id) ?? {};
    const strict = buildRating(ratingRows.strict);
    return {
      ...base,
      metrics,
      ratings: { strict },
    };
  };

  const topCharacterHighlights = await Promise.all(topCharacterRows.map(mapCharacterHighlight));
  const topRatedHighlight = topRatedRowResolved ? await mapCharacterHighlight(topRatedRowResolved) : null;

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

  const recentMatches: PvpMatchLite[] = pvp.matches.map((m) => {
    const mappedMatch = mapPvpMatchRow(m);
    return {
      ...mappedMatch,
      players: (playersByMatchId.get(mappedMatch.id) ?? []).map((p) => ({
        userId: p.userId,
        seat: p.seat,
        username: p.username,
        prefix: p.prefix,
      })),
      roundSummary: roundSummaryByMatchId.get(mappedMatch.id) ?? null,
    };
  });

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
        characters: topCharacterHighlights,
        topRatedCharacter: topRatedHighlight,
        scenario: topScenarios.length > 0 ? mapCard(topScenarios[0]) : null,
      },
      stats: {
        dataCards: dataCardStats,
        battleReports7d,
        battleReportsAll: { total: battleReportsAllTotal },
      },
      pvp: {
        summary,
        recentMatches,
      },
      recentBattleReports: reports,
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
});
