import type { NextRequest } from 'next/server';

import { queryFromD1 } from '@/lib/d1';

export const config = {
  runtime: 'edge',
};

type Queue = 'strict' | 'free';

type ApiRating = {
  queue: Queue;
  rating: number;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  tier: string;
};

const computeTier = (rating: number, games: number) => {
  const placementGames = 5;
  if (games < placementGames || rating < 900) return '无牌';
  if (rating < 1100) return '白牌';
  if (rating < 1300) return '字牌';
  if (rating < 1600) return '花牌';
  return '权杖';
};

export default async function handler(req: NextRequest) {
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const url = new URL(req.url);
  const entityId = (url.searchParams.get('entityId') ?? '').trim();
  if (!entityId) {
    return new Response(JSON.stringify({ error: '缺少 entityId' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const ratings: { strict: ApiRating | null; free: ApiRating | null } = { strict: null, free: null };
    const res = (await queryFromD1(
      `SELECT queue, rating, games, wins, losses, draws
       FROM arena_ratings
       WHERE entity_type = 'preset'
         AND entity_id = ?
         AND queue IN ('strict', 'free')`,
      [entityId],
    )) as any;

    const rows = (res?.result?.[0]?.results ?? []) as Array<{
      queue: Queue;
      rating: number;
      games: number;
      wins: number;
      losses: number;
      draws: number;
    }>;

    for (const row of rows) {
      const queue = row.queue === 'free' ? 'free' : 'strict';
      const rating = typeof row.rating === 'number' ? row.rating : 0;
      const games = typeof row.games === 'number' ? row.games : 0;
      const item: ApiRating = {
        queue,
        rating,
        games,
        wins: typeof row.wins === 'number' ? row.wins : 0,
        losses: typeof row.losses === 'number' ? row.losses : 0,
        draws: typeof row.draws === 'number' ? row.draws : 0,
        tier: computeTier(rating, games),
      };
      if (queue === 'strict') ratings.strict = item;
      else ratings.free = item;
    }

    return new Response(
      JSON.stringify({
        success: true,
        entityType: 'preset',
        entityId,
        ratings,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    console.error('读取 preset-meta 失败:', error);
    return new Response(JSON.stringify({ success: false, error: '无法加载预设排位信息' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

