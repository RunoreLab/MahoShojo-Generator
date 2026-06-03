import { withPagesApiResponse } from '@/lib/pages-api-adapter';
import { getRequestUrl } from '@/lib/request-url';
import type { NextRequest } from 'next/server';

import { PRESET_LIST } from '@/lib/presets';
import { applyQueenTier, computeArenaBaseTier } from '@/lib/arena/tier';
import { withEdgeCache } from '@/lib/edge-cache';
import { getDrizzleDbFromRuntime } from '@/lib/db/drizzle';
import { type ArenaLeaderboardRow, listArenaLeaderboardRows } from '@/lib/db/repositories/arena-read';
import { queryArenaPublicQueenEntityByQueue } from '@/lib/db/repositories/data-card-meta';
import { buildStrictLeaderboardSeasonExtrema, type LeaderboardSeasonExtreme } from '@/lib/ranking/season-extrema';

type Queue = 'strict' | 'free';
type Sort = 'rating' | 'tech';
type SortOrder = 'asc' | 'desc';

const LEADERBOARD_TOP_RANK_LIMIT = 300;

type LeaderboardItem = {
  rank: number;
  entityType: 'data_card' | 'preset';
  entityId: string;
  displayName: string;
  authorName: string | null;
  rating: number;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  tier: string;
  techScore: number | null;
  techLevel: string | null;
  isNative: boolean | null;
  tagIds: string[];
  seasonPeak: LeaderboardSeasonExtreme | null;
  seasonPeakTier: string | null;
  seasonLow: LeaderboardSeasonExtreme | null;
};

type BuildLeaderboardItemFromRowOptions = {
  queue: Queue;
  rank: number;
  presetNameByFilename: Map<string, string>;
  isQueen: boolean;
};

const parseIntParam = (value: string | null, fallback: number) => {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.floor(parsed) : fallback;
};

const parseOptionalIntParam = (value: string | null): number | null => {
  if (value == null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? Math.floor(parsed) : null;
};

const parseCommaList = (value: string | null): string[] => {
  if (!value) return [];
  const parts = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return Array.from(new Set(parts));
};

export const buildLeaderboardItemFromRow = (
  row: ArenaLeaderboardRow,
  options: BuildLeaderboardItemFromRowOptions,
): LeaderboardItem => {
  const rating = typeof row.rating === 'number' ? row.rating : 0;
  const games = typeof row.games === 'number' ? row.games : 0;
  const baseTier = computeArenaBaseTier(rating, games);
  const tier = applyQueenTier(baseTier, options.isQueen);
  const seasonExtrema = buildStrictLeaderboardSeasonExtrema(options.queue, row);

  const displayName = row.entityType === 'preset'
    ? (options.presetNameByFilename.get(row.entityId) ?? row.entityId)
    : (row.dataCardName ?? row.entityId);

  return {
    rank: options.rank,
    entityType: row.entityType,
    entityId: row.entityId,
    displayName,
    authorName: typeof row.authorName === 'string' ? row.authorName : null,
    rating,
    games,
    wins: typeof row.wins === 'number' ? row.wins : 0,
    losses: typeof row.losses === 'number' ? row.losses : 0,
    draws: typeof row.draws === 'number' ? row.draws : 0,
    tier,
    techScore: typeof row.techScore === 'number' ? row.techScore : null,
    techLevel: typeof row.techLevel === 'string' ? row.techLevel : null,
    isNative: row.isNative === true ? true : row.isNative === false ? false : null,
    tagIds: Array.isArray(row.tagIds) ? row.tagIds : [],
    seasonPeak: seasonExtrema.seasonPeak,
    seasonPeakTier: seasonExtrema.seasonPeakTier,
    seasonLow: seasonExtrema.seasonLow,
  };
};

async function handler(req: NextRequest) {
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return withEdgeCache(req, { key: req.url, ttlSeconds: 15 }, async () => {
    try {
      const db = getDrizzleDbFromRuntime();
      if (!db) {
        return new Response(JSON.stringify({ success: false, error: '数据库绑定不可用，请检查 Cloudflare D1 配置' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const url = getRequestUrl(req);
      const queue: Queue = url.searchParams.get('queue') === 'free' ? 'free' : 'strict';
      const sort: Sort = url.searchParams.get('sort') === 'tech' ? 'tech' : 'rating';
      const order: SortOrder = url.searchParams.get('order') === 'asc' ? 'asc' : 'desc';
      const limit = Math.max(1, Math.min(100, parseIntParam(url.searchParams.get('limit'), 50)));
      const offset = Math.max(0, parseIntParam(url.searchParams.get('offset'), 0));
      if (offset >= LEADERBOARD_TOP_RANK_LIMIT) {
        return new Response(JSON.stringify({ success: true, items: [] }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'public, max-age=15',
          },
        });
      }

      const effectiveLimit = Math.max(1, Math.min(limit, LEADERBOARD_TOP_RANK_LIMIT - offset));
      const includePresets: 0 | 1 = url.searchParams.get('includePresets') === '0' ? 0 : 1;
      const tagIds = parseCommaList(url.searchParams.get('tagIds'));
      const excludeTagIds = parseCommaList(url.searchParams.get('excludeTagIds'));
      const isNativeRaw = url.searchParams.get('isNative') ?? 'any';
      const isNative: '0' | '1' | 'any' = isNativeRaw === '1' ? '1' : isNativeRaw === '0' ? '0' : 'any';
      const minRating = parseOptionalIntParam(url.searchParams.get('minRating'));
      const maxRating = parseOptionalIntParam(url.searchParams.get('maxRating'));
      const minGames = parseOptionalIntParam(url.searchParams.get('minGames'));
      const maxGames = parseOptionalIntParam(url.searchParams.get('maxGames'));
      const minTechScore = parseOptionalIntParam(url.searchParams.get('minTechScore'));
      const maxTechScore = parseOptionalIntParam(url.searchParams.get('maxTechScore'));

      const presetNameByFilename = new Map(PRESET_LIST.map((preset) => [preset.filename, preset.name]));

      const rows = await listArenaLeaderboardRows(db, {
        queue,
        sort,
        order,
        limit: effectiveLimit,
        offset,
        includePresets,
        tagIds,
        excludeTagIds,
        isNative,
        minRating,
        maxRating,
        minGames,
        maxGames,
        minTechScore,
        maxTechScore,
      });

      const queen = await queryArenaPublicQueenEntityByQueue(db, queue).catch((error) => {
        console.warn('读取女王段位失败（降级为无女王）:', error);
        return null;
      });

      const items: LeaderboardItem[] = rows.map((row, index) => {
        const isQueen = queen?.entityType === row.entityType && queen?.entityId === row.entityId;
        return buildLeaderboardItemFromRow(row, {
          queue,
          rank: offset + index + 1,
          presetNameByFilename,
          isQueen,
        });
      });

      return new Response(JSON.stringify({ success: true, items }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=15',
        },
      });
    } catch (error) {
      console.error('获取排行榜失败:', error);
      return new Response(JSON.stringify({ success: false, error: '无法加载排行榜' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  });
}

export default withPagesApiResponse(handler);
