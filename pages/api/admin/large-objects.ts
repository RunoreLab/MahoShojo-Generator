import type { NextRequest } from 'next/server';

import { listAdminLargeObjects } from '@/lib/database/admin-large-objects';
import type { LargeObjectAssetFamily } from '@/lib/admin/large-object-insights';

export const runtime = 'edge';

const parseIntParam = (value: string | null, fallback: number) => {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.floor(parsed) : fallback;
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
    const page = Math.max(1, parseIntParam(url.searchParams.get('page'), 1));
    const limit = Math.max(1, Math.min(200, parseIntParam(url.searchParams.get('limit'), 50)));
    const kind = (url.searchParams.get('kind') ?? '').trim() || undefined;
    const search = (url.searchParams.get('search') ?? '').trim() || undefined;
    const dateFrom = (url.searchParams.get('dateFrom') ?? '').trim() || undefined;
    const dateTo = (url.searchParams.get('dateTo') ?? '').trim() || undefined;
    const ownerUserId = url.searchParams.get('ownerUserId');
    const minBytes = url.searchParams.get('minBytes');
    const maxBytes = url.searchParams.get('maxBytes');
    const familyRaw = (url.searchParams.get('family') ?? '').trim();
    const family: LargeObjectAssetFamily | undefined =
      familyRaw === 'text' || familyRaw === 'image' || familyRaw === 'other' ? familyRaw : undefined;

    const filters = {
      page,
      limit,
      kind,
      search,
      dateFrom,
      dateTo,
      ...(ownerUserId ? { ownerUserId: parseIntParam(ownerUserId, NaN) } : {}),
      ...(minBytes ? { minBytes: parseIntParam(minBytes, NaN) } : {}),
      ...(maxBytes ? { maxBytes: parseIntParam(maxBytes, NaN) } : {}),
      ...(family ? { family } : {}),
    } as const;

    const { rows, total, kindSummaries, familySummaries } = await listAdminLargeObjects(filters);
    return new Response(JSON.stringify({ success: true, rows, total, page, limit, kindSummaries, familySummaries }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Admin large-objects list 失败:', error);
    return new Response(JSON.stringify({ success: false, error: '无法加载大对象列表' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

