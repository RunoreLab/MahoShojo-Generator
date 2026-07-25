import { getRequestUrl } from '@/lib/request-url';
import type { NextRequest } from 'next/server';

import { applyQueenTier, computeArenaBaseTier } from '@/lib/arena/tier';
import { getDrizzleDbFromRuntime } from '@/lib/db/drizzle';
import { getPresetArenaRatingsByEntityId } from '@/lib/db/repositories/arena-read';
import { queryArenaPublicQueenEntityByQueue } from '@/lib/db/repositories/data-card-meta';

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

async function handler(req: NextRequest) {
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const url = getRequestUrl(req);
  const entityId = (url.searchParams.get('entityId') ?? '').trim();
  if (!entityId) {
    return new Response(JSON.stringify({ error: '缺少 entityId' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const db = getDrizzleDbFromRuntime();
    if (!db) {
      return new Response(JSON.stringify({ error: '数据库绑定不可用，请检查 Cloudflare D1 配置' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const queenByQueue = await (async () => {
      try {
        const [strictQueen, freeQueen] = await Promise.all([
          queryArenaPublicQueenEntityByQueue(db, 'strict'),
          queryArenaPublicQueenEntityByQueue(db, 'free'),
        ]);
        return { strict: strictQueen, free: freeQueen };
      } catch (error) {
        console.warn('读取女王段位失败（降级为无女王）:', error);
        return { strict: null, free: null };
      }
    })();

    const ratings: { strict: ApiRating | null; free: ApiRating | null } = { strict: null, free: null };
    const rows = await getPresetArenaRatingsByEntityId(db, entityId);

    for (const row of rows) {
      const queue = row.queue === 'free' ? 'free' : 'strict';
      const rating = typeof row.rating === 'number' ? row.rating : 0;
      const games = typeof row.games === 'number' ? row.games : 0;
      const baseTier = computeArenaBaseTier(rating, games);
      const queen = queue === 'free' ? queenByQueue.free : queenByQueue.strict;
      const isQueen = queen?.entityType === 'preset' && queen?.entityId === entityId;
      const item: ApiRating = {
        queue,
        rating,
        games,
        wins: typeof row.wins === 'number' ? row.wins : 0,
        losses: typeof row.losses === 'number' ? row.losses : 0,
        draws: typeof row.draws === 'number' ? row.draws : 0,
        tier: applyQueenTier(baseTier, isQueen),
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

export const appRouteHandler = handler;
export default appRouteHandler;
