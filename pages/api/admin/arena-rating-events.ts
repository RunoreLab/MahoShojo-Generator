import type { NextRequest } from 'next/server';

import {
  getAdminArenaRatingEvents,
  type AdminArenaRatingEventsListFilters,
} from '@/lib/database/admin-arena-rating-events';

export const runtime = 'edge';

export default async function handler(req: NextRequest) {
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), { status: 405 });
  }

  try {
    const { searchParams } = new URL(req.url);

    const filters: AdminArenaRatingEventsListFilters = {
      page: parseInt(searchParams.get('page') || '1', 10),
      limit: parseInt(searchParams.get('limit') || '50', 10),
      sortBy: (searchParams.get('sortBy') as any) || 'created_at',
      sortOrder: (searchParams.get('sortOrder') as any) || 'desc',

      queue: (searchParams.get('queue') as any) || undefined,
      status: (searchParams.get('status') as any) || undefined,
      generationId: searchParams.get('generationId') || undefined,
      entityId: searchParams.get('entityId') || undefined,
      dateFrom: searchParams.get('dateFrom') || undefined,
      dateTo: searchParams.get('dateTo') || undefined,
      search: searchParams.get('search') || undefined,
    };

    const userIdRaw = searchParams.get('userId');
    if (userIdRaw) {
      const parsed = parseInt(userIdRaw, 10);
      if (!Number.isNaN(parsed)) filters.userId = parsed;
    }

    Object.keys(filters).forEach((key) => {
      const typed = key as keyof typeof filters;
      if (filters[typed] === undefined || filters[typed] === '' || filters[typed] === null) {
        delete (filters as any)[typed];
      }
    });

    const { records, total } = await getAdminArenaRatingEvents(filters);
    const totalPages = Math.ceil(total / (filters.limit || 50));

    return new Response(
      JSON.stringify({
        success: true,
        records,
        total,
        currentPage: filters.page || 1,
        totalPages,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  } catch (error) {
    console.error('Admin API - 获取 arena_rating_events 失败:', error);
    return new Response(JSON.stringify({ success: false, error: '获取事件列表失败' }), { status: 500 });
  }
}

