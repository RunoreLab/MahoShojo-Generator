import type { NextRequest } from 'next/server';

import { PRESET_LIST } from '@/lib/presets';
import { applyQueenTier, computeArenaBaseTier } from '@/lib/arena/tier';
import { withEdgeCache } from '@/lib/edge-cache';
import { getDrizzleDbFromRuntime } from '@/lib/db/drizzle';
import { searchArenaLeaderboardRows } from '@/lib/db/repositories/arena-read';
import { queryArenaPublicQueenEntityByQueue } from '@/lib/db/repositories/data-card-meta';

export const config = {
  runtime: 'edge',
};

type Queue = 'strict' | 'free';
type Sort = 'rating' | 'tech';
type SortOrder = 'asc' | 'desc';

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
};

const SEARCH_RATE_LIMIT = {
  capacity: 10,
  refillPerMs: 10 / 10_000,
};

const searchBuckets = new Map<string, { tokens: number; updatedAt: number }>();

const readClientIp = (req: Request): string | null => {
  const cf = req.headers.get('cf-connecting-ip');
  if (cf && cf.trim()) return cf.trim();
  const xff = req.headers.get('x-forwarded-for');
  if (xff && xff.trim()) return xff.split(',')[0]?.trim() ?? null;
  return null;
};

const consumeSearchToken = (key: string): { allowed: boolean; retryAfterSeconds: number } => {
  const now = Date.now();
  const current = searchBuckets.get(key) ?? { tokens: SEARCH_RATE_LIMIT.capacity, updatedAt: now };
  const elapsed = Math.max(0, now - current.updatedAt);
  const refilled = Math.min(SEARCH_RATE_LIMIT.capacity, current.tokens + elapsed * SEARCH_RATE_LIMIT.refillPerMs);
  if (refilled < 1) {
    const missing = 1 - refilled;
    const retryAfterSeconds = Math.max(1, Math.ceil(missing / (SEARCH_RATE_LIMIT.refillPerMs * 1000)));
    searchBuckets.set(key, { tokens: refilled, updatedAt: now });
    return { allowed: false, retryAfterSeconds };
  }

  const next = refilled - 1;
  searchBuckets.set(key, { tokens: next, updatedAt: now });
  return { allowed: true, retryAfterSeconds: 0 };
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

export default async function handler(req: NextRequest) {
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return withEdgeCache(req, { key: req.url, ttlSeconds: 10 }, async () => {
    try {
      const ip = readClientIp(req) ?? 'unknown';
      const rateKey = `arenaLeaderboardSearch:${ip}`;
      const rate = consumeSearchToken(rateKey);
      if (!rate.allowed) {
        return new Response(JSON.stringify({ success: false, error: '请求过于频繁，请稍后再试' }), {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store',
            'Retry-After': String(rate.retryAfterSeconds),
          },
        });
      }

      const db = getDrizzleDbFromRuntime();
      if (!db) {
        return new Response(JSON.stringify({ success: false, error: '数据库绑定不可用，请检查 Cloudflare D1 配置' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const url = new URL(req.url);
      const qRaw = url.searchParams.get('q');
      const q = typeof qRaw === 'string' ? qRaw.trim() : '';
      if (!q) {
        return new Response(JSON.stringify({ success: false, error: '缺少搜索关键词' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (q.length > 80) {
        return new Response(JSON.stringify({ success: false, error: '关键词过长' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const queue: Queue = url.searchParams.get('queue') === 'free' ? 'free' : 'strict';
      const sort: Sort = url.searchParams.get('sort') === 'tech' ? 'tech' : 'rating';
      const order: SortOrder = url.searchParams.get('order') === 'asc' ? 'asc' : 'desc';
      const limit = Math.max(1, Math.min(20, parseIntParam(url.searchParams.get('limit'), 10)));
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
      const qLower = q.toLowerCase();
      const matchedPresetIds = PRESET_LIST
        .filter((preset) => preset.name.toLowerCase().includes(qLower) || preset.filename.toLowerCase().includes(qLower))
        .map((preset) => preset.filename);

      const rows = await searchArenaLeaderboardRows(db, {
        queue,
        sort,
        order,
        limit,
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
        keyword: q,
        matchedPresetIds,
      });

      const queen = await queryArenaPublicQueenEntityByQueue(db, queue).catch((error) => {
        console.warn('读取女王段位失败（降级为无女王）:', error);
        return null;
      });

      const items: LeaderboardItem[] = rows.map((row) => {
        const rating = typeof row.rating === 'number' ? row.rating : 0;
        const games = typeof row.games === 'number' ? row.games : 0;
        const baseTier = computeArenaBaseTier(rating, games);
        const isQueen = queen?.entityType === row.entityType && queen?.entityId === row.entityId;
        const tier = applyQueenTier(baseTier, isQueen);

        const displayName = row.entityType === 'preset'
          ? (presetNameByFilename.get(row.entityId) ?? row.entityId)
          : (row.dataCardName ?? row.entityId);

        return {
          rank: 0,
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
        };
      });

      return new Response(JSON.stringify({ success: true, items }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=10',
        },
      });
    } catch (error) {
      console.error('搜索排行榜失败:', error);
      return new Response(JSON.stringify({ success: false, error: '无法搜索排行榜' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  });
}
