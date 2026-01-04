import type { NextRequest } from 'next/server';

import { resetArenaRating, type ArenaEntity, type ArenaQueue } from '@/lib/database/arena-ratings';

export const runtime = 'edge';

type PutBody = {
  entityType?: unknown;
  entityId?: unknown;
  queue?: unknown;
};

const normalizeQueue = (value: unknown): ArenaQueue | 'all' => {
  if (value === 'strict' || value === 'free') return value;
  return 'all';
};

const normalizeEntityType = (value: unknown): ArenaEntity['entityType'] | null => {
  if (value === 'data_card' || value === 'preset') return value;
  return null;
};

export default async function handler(req: NextRequest) {
  if (req.method !== 'PUT') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = (await req.json().catch(() => ({}))) as PutBody;
    const entityType = normalizeEntityType(body.entityType);
    const entityId = typeof body.entityId === 'string' ? body.entityId.trim() : '';
    const queue = normalizeQueue(body.queue);

    if (!entityType || !entityId) {
      return new Response(JSON.stringify({ success: false, error: '缺少 entityType 或 entityId' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const result = await resetArenaRating({ entityType, entityId }, queue);
    if (!result.ok) {
      return new Response(JSON.stringify({ success: false, error: result.error ?? '重置失败' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Admin API - reset arena_ratings 失败:', error);
    return new Response(JSON.stringify({ success: false, error: '重置失败' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

