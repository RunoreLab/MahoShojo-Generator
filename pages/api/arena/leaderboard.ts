import type { NextRequest } from 'next/server';

import { queryFromD1 } from '@/lib/d1';
import { PRESET_LIST } from '@/lib/presets';

export const config = {
  runtime: 'edge',
};

type Queue = 'strict' | 'free';
type Sort = 'rating' | 'tech';

type LeaderboardItem = {
  rank: number;
  entityType: 'data_card' | 'preset';
  entityId: string;
  displayName: string;
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

const computeTier = (rating: number, games: number) => {
  const placementGames = 5;
  if (games < placementGames || rating < 900) return '无牌';
  if (rating < 1100) return '白牌';
  if (rating < 1300) return '字牌';
  if (rating < 1600) return '花牌';
  return '权杖';
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

  try {
    const url = new URL(req.url);
    const queue: Queue = url.searchParams.get('queue') === 'free' ? 'free' : 'strict';
    const sort: Sort = url.searchParams.get('sort') === 'tech' ? 'tech' : 'rating';
    const limit = Math.max(1, Math.min(100, parseIntParam(url.searchParams.get('limit'), 50)));
    const offset = Math.max(0, parseIntParam(url.searchParams.get('offset'), 0));
    const includePresets = url.searchParams.get('includePresets') === '0' ? 0 : 1;
    const tagIds = parseCommaList(url.searchParams.get('tagIds'));
    const excludeTagIds = parseCommaList(url.searchParams.get('excludeTagIds'));
    const isNative = url.searchParams.get('isNative') ?? 'any';

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
        )
      )`);
    } else {
      whereParts.push(`(
        dc.id IS NOT NULL
        AND dc.type = 'character'
        AND dc.is_public = 1
        AND dc.review_status = 'approved'
        AND dc.deleted_at IS NULL
      )`);
    }

    if (tagIds.length > 0) {
      const placeholders = tagIds.map(() => '?').join(', ');
      whereParts.push(`ar.entity_type = 'data_card' AND EXISTS (
        SELECT 1 FROM data_card_tags dct2
        WHERE dct2.data_card_id = ar.entity_id
          AND dct2.tag_id IN (${placeholders})
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

    const orderBy = sort === 'tech'
      ? 'ORDER BY (dcm.tech_score IS NULL) ASC, dcm.tech_score DESC, ar.rating DESC, ar.games DESC'
      : 'ORDER BY ar.rating DESC, ar.games DESC, ar.updated_at DESC';

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
        dcm.tech_score as techScore,
        dcm.tech_level as techLevel,
        dcm.is_native as isNative,
        group_concat(DISTINCT dct.tag_id) as tagIds
      FROM arena_ratings ar
      LEFT JOIN data_cards dc
        ON ar.entity_type = 'data_card' AND dc.id = ar.entity_id
      LEFT JOIN data_card_metrics dcm
        ON ar.entity_type = 'data_card' AND dcm.data_card_id = ar.entity_id
      LEFT JOIN data_card_tags dct
        ON ar.entity_type = 'data_card' AND dct.data_card_id = ar.entity_id
      ${whereSql}
      GROUP BY ar.entity_type, ar.entity_id, ar.queue
      ${orderBy}
      LIMIT ? OFFSET ?;
    `;

    const result = (await queryFromD1(sql, [...params, limit, offset])) as any;
    const rows = (result?.result?.[0]?.results ?? []) as Array<{
      entityType: 'data_card' | 'preset';
      entityId: string;
      rating: number;
      games: number;
      wins: number;
      losses: number;
      draws: number;
      dataCardName: string | null;
      techScore: number | null;
      techLevel: string | null;
      isNative: number | null;
      tagIds: string | null;
    }>;

    const items: LeaderboardItem[] = rows.map((row, index) => {
      const rating = typeof row.rating === 'number' ? row.rating : 0;
      const games = typeof row.games === 'number' ? row.games : 0;
      const tier = computeTier(rating, games);

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
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('获取排行榜失败:', error);
    return new Response(JSON.stringify({ success: false, error: '无法加载排行榜' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

