import type { NextRequest } from 'next/server';

import { queryFromD1 } from '@/lib/d1';
import { PRESET_LIST } from '@/lib/presets';
import { applyQueenTier, computeArenaBaseTier, queryArenaPublicQueenEntity } from '@/lib/arena/tier';
import { withEdgeCache } from '@/lib/edge-cache';

export const config = {
  runtime: 'edge',
};

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

const buildOrderBy = (sort: Sort, order: SortOrder) => {
  if (sort === 'tech') {
    if (order === 'asc') {
      return 'ORDER BY (dcm.tech_score IS NULL) ASC, dcm.tech_score ASC, ar.rating DESC, ar.games DESC, ar.updated_at DESC, ar.entity_type ASC, ar.entity_id ASC';
    }
    return 'ORDER BY (dcm.tech_score IS NULL) ASC, dcm.tech_score DESC, ar.rating DESC, ar.games DESC, ar.updated_at DESC, ar.entity_type ASC, ar.entity_id ASC';
  }

  if (order === 'asc') {
    return 'ORDER BY ar.rating ASC, ar.games DESC, ar.updated_at DESC, ar.entity_type ASC, ar.entity_id ASC';
  }
  return 'ORDER BY ar.rating DESC, ar.games DESC, ar.updated_at DESC, ar.entity_type ASC, ar.entity_id ASC';
};

export default async function handler(req: NextRequest) {
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return withEdgeCache(req, { key: req.url, ttlSeconds: 15 }, async () => {
    try {
      const url = new URL(req.url);
      const queue: Queue = url.searchParams.get('queue') === 'free' ? 'free' : 'strict';
      const strictPublicSinceClause = queue === 'strict'
        ? `AND (
        dc.public_since IS NULL
        OR dc.public_since <= datetime('now', '-3 days')
        OR (
          dc.created_at IS NOT NULL
          AND dc.public_since IS NOT NULL
          AND ABS(strftime('%s', dc.public_since) - strftime('%s', dc.created_at)) <= 600
        )
      )`
        : '';
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
      const includePresets = url.searchParams.get('includePresets') === '0' ? 0 : 1;
      const tagIds = parseCommaList(url.searchParams.get('tagIds'));
      const excludeTagIds = parseCommaList(url.searchParams.get('excludeTagIds'));
      const isNative = url.searchParams.get('isNative') ?? 'any';
      const minRating = parseOptionalIntParam(url.searchParams.get('minRating'));
      const maxRating = parseOptionalIntParam(url.searchParams.get('maxRating'));
      const minGames = parseOptionalIntParam(url.searchParams.get('minGames'));
      const maxGames = parseOptionalIntParam(url.searchParams.get('maxGames'));
      const minTechScore = parseOptionalIntParam(url.searchParams.get('minTechScore'));
      const maxTechScore = parseOptionalIntParam(url.searchParams.get('maxTechScore'));

      const presetNameByFilename = new Map(PRESET_LIST.map((preset) => [preset.filename, preset.name]));

      const whereParts: string[] = [];
      const params: unknown[] = [];

      whereParts.push('ar.queue = ?');
      params.push(queue);

      if (includePresets === 0) {
        whereParts.push("ar.entity_type = 'data_card'");
      }

      // 公共榜过滤：仅公开+已审核的角色卡；预设恒公开
      if (includePresets === 1) {
        whereParts.push(`(
        ar.entity_type = 'preset'
        OR (
          dc.id IS NOT NULL
          AND dc.type = 'character'
          AND dc.is_public = 1
          AND dc.review_status = 'approved'
          AND dc.deleted_at IS NULL
          ${strictPublicSinceClause}
        )
      )`);
      } else {
        whereParts.push(`(
        dc.id IS NOT NULL
        AND dc.type = 'character'
        AND dc.is_public = 1
        AND dc.review_status = 'approved'
        AND dc.deleted_at IS NULL
        ${strictPublicSinceClause}
      )`);
      }

      if (tagIds.length > 0) {
        const placeholders = tagIds.map(() => '?').join(', ');
        whereParts.push(`(
        ar.entity_type = 'preset'
        OR (
          ar.entity_type = 'data_card'
          AND EXISTS (
            SELECT 1 FROM data_card_tags dct2
            WHERE dct2.data_card_id = ar.entity_id
              AND dct2.tag_id IN (${placeholders})
          )
        )
      )`);
        params.push(...tagIds);
      }

      if (excludeTagIds.length > 0) {
        const placeholders = excludeTagIds.map(() => '?').join(', ');
        whereParts.push(`(
        ar.entity_type = 'preset'
        OR NOT EXISTS (
          SELECT 1 FROM data_card_tags dct3
          WHERE dct3.data_card_id = ar.entity_id
            AND dct3.tag_id IN (${placeholders})
        )
      )`);
        params.push(...excludeTagIds);
      }

      if (isNative === '1') {
        whereParts.push("ar.entity_type = 'data_card' AND dcm.is_native = 1");
      } else if (isNative === '0') {
        whereParts.push("ar.entity_type = 'data_card' AND dcm.is_native = 0");
      }

      if (minRating != null) {
        whereParts.push('ar.rating >= ?');
        params.push(minRating);
      }
      if (maxRating != null) {
        whereParts.push('ar.rating <= ?');
        params.push(maxRating);
      }
      if (minGames != null) {
        whereParts.push('ar.games >= ?');
        params.push(minGames);
      }
      if (maxGames != null) {
        whereParts.push('ar.games <= ?');
        params.push(maxGames);
      }

      if (minTechScore != null || maxTechScore != null) {
        whereParts.push("ar.entity_type = 'data_card' AND dcm.tech_score IS NOT NULL");
        if (minTechScore != null) {
          whereParts.push('dcm.tech_score >= ?');
          params.push(minTechScore);
        }
        if (maxTechScore != null) {
          whereParts.push('dcm.tech_score <= ?');
          params.push(maxTechScore);
        }
      }

      const orderBy = buildOrderBy(sort, order);

      const whereSql = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';

      const sql = `
      SELECT
        ar.entity_type as entityType,
        ar.entity_id as entityId,
        ar.rating as rating,
        ar.games as games,
        ar.wins as wins,
        ar.losses as losses,
        ar.draws as draws,
        dc.name as dataCardName,
        u.username as authorName,
        dcm.tech_score as techScore,
        dcm.tech_level as techLevel,
        dcm.is_native as isNative,
        CASE WHEN ar.entity_type = 'data_card' THEN (
          SELECT group_concat(DISTINCT dct.tag_id)
          FROM data_card_tags dct
          WHERE dct.data_card_id = ar.entity_id
        ) ELSE NULL END as tagIds
      FROM arena_ratings ar
      LEFT JOIN data_cards dc
        ON ar.entity_type = 'data_card' AND dc.id = ar.entity_id
      LEFT JOIN users u
        ON dc.user_id = u.id
      LEFT JOIN data_card_metrics dcm
        ON ar.entity_type = 'data_card' AND dcm.data_card_id = ar.entity_id
      ${whereSql}
      ${orderBy}
      LIMIT ? OFFSET ?;
    `;

      const result = (await queryFromD1(sql, [...params, effectiveLimit, offset])) as any;
      const rows = (result?.result?.[0]?.results ?? []) as Array<{
        entityType: 'data_card' | 'preset';
        entityId: string;
        rating: number;
        games: number;
        wins: number;
        losses: number;
        draws: number;
        dataCardName: string | null;
        authorName: string | null;
        techScore: number | null;
        techLevel: string | null;
        isNative: number | null;
        tagIds: string | null;
      }>;

      const queen = await (async () => {
        try {
          return await queryArenaPublicQueenEntity(queryFromD1, queue);
        } catch (error) {
          console.warn('读取女王段位失败（降级为无女王）:', error);
          return null;
        }
      })();

      const items: LeaderboardItem[] = rows.map((row, index) => {
        const rating = typeof row.rating === 'number' ? row.rating : 0;
        const games = typeof row.games === 'number' ? row.games : 0;
        const baseTier = computeArenaBaseTier(rating, games);
        const isQueen = queen?.entityType === row.entityType && queen?.entityId === row.entityId;
        const tier = applyQueenTier(baseTier, isQueen);

        const displayName = row.entityType === 'preset'
          ? (presetNameByFilename.get(row.entityId) ?? row.entityId)
          : (row.dataCardName ?? row.entityId);

        const tagIds = row.tagIds
          ? row.tagIds.split(',').map((id) => id.trim()).filter(Boolean)
          : [];

        return {
          rank: offset + index + 1,
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
          isNative: row.isNative === 1 ? true : row.isNative === 0 ? false : null,
          tagIds,
        };
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
