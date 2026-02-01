import type { NextRequest } from 'next/server';

import { queryFromD1 } from '@/lib/d1';

export const config = {
  runtime: 'edge',
};

type ApiSuccessResponse = {
  success: true;
  queue: 'strict' | 'free';
  entityType: 'data_card' | 'preset';
  entityId: string;
  found: boolean;
  rating: number;
  games: number;
};

type ApiErrorResponse = { success: false; error: string };

const INITIAL_RATING = 1000;

const readRows = <T,>(result: unknown): T[] => {
  const rows = (result as any)?.result?.[0]?.results;
  return Array.isArray(rows) ? (rows as T[]) : [];
};

const toNonNegativeInt = (value: unknown, fallback: number): number => {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.floor(n));
};

export default async function handler(req: NextRequest): Promise<Response> {
  if (req.method !== 'GET') {
    const body = { success: false, error: 'Method Not Allowed' } satisfies ApiErrorResponse;
    return new Response(JSON.stringify(body), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const url = new URL(req.url);
    const queue = url.searchParams.get('queue') === 'free' ? 'free' : 'strict';
    const entityType = url.searchParams.get('entityType') === 'preset' ? 'preset' : url.searchParams.get('entityType') === 'data_card' ? 'data_card' : null;
    const entityId = (url.searchParams.get('entityId') ?? '').trim();

    if (!entityType || !entityId) {
      const body = { success: false, error: '缺少参数：entityType/entityId' } satisfies ApiErrorResponse;
      return new Response(JSON.stringify(body), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const result = await queryFromD1(
      `SELECT rating, games
       FROM arena_ratings
       WHERE queue = ?
         AND entity_type = ?
         AND entity_id = ?
       LIMIT 1`,
      [queue, entityType, entityId],
    );
    const row = readRows<{ rating: unknown; games: unknown }>(result)[0] ?? null;
    const rating = toNonNegativeInt(row?.rating, INITIAL_RATING);
    const games = toNonNegativeInt(row?.games, 0);

    const body: ApiSuccessResponse = {
      success: true,
      queue,
      entityType,
      entityId,
      found: Boolean(row),
      rating,
      games,
    };

    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    console.error('entity-rating 失败:', error);
    const body = { success: false, error: '无法读取排位分' } satisfies ApiErrorResponse;
    return new Response(JSON.stringify(body), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
