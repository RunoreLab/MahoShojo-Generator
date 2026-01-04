import type { NextRequest } from 'next/server';

import { getAdminArenaRatings, type AdminArenaRatingsListFilters } from '@/lib/database/admin-arena-ratings';

export const runtime = 'edge';

export default async function handler(req: NextRequest) {
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), { status: 405 });
  }

  try {
    const { searchParams } = new URL(req.url);

    const filters: AdminArenaRatingsListFilters = {
      page: parseInt(searchParams.get('page') || '1', 10),
      limit: parseInt(searchParams.get('limit') || '50', 10),
      sortBy: (searchParams.get('sortBy') as any) || 'rating',
      sortOrder: (searchParams.get('sortOrder') as any) || 'desc',
      queue: (searchParams.get('queue') as any) || undefined,
      entityType: (searchParams.get('entityType') as any) || undefined,
      search: searchParams.get('search') || undefined,
      reviewStatus: (searchParams.get('reviewStatus') as any) || undefined,
    };

    const ownerUserIdRaw = searchParams.get('ownerUserId');
    if (ownerUserIdRaw) {
      const parsed = parseInt(ownerUserIdRaw, 10);
      if (!Number.isNaN(parsed)) filters.ownerUserId = parsed;
    }

    const minRatingRaw = searchParams.get('minRating');
    if (minRatingRaw) {
      const parsed = parseInt(minRatingRaw, 10);
      if (!Number.isNaN(parsed)) filters.minRating = parsed;
    }
    const maxRatingRaw = searchParams.get('maxRating');
    if (maxRatingRaw) {
      const parsed = parseInt(maxRatingRaw, 10);
      if (!Number.isNaN(parsed)) filters.maxRating = parsed;
    }

    const minGamesRaw = searchParams.get('minGames');
    if (minGamesRaw) {
      const parsed = parseInt(minGamesRaw, 10);
      if (!Number.isNaN(parsed)) filters.minGames = parsed;
    }
    const maxGamesRaw = searchParams.get('maxGames');
    if (maxGamesRaw) {
      const parsed = parseInt(maxGamesRaw, 10);
      if (!Number.isNaN(parsed)) filters.maxGames = parsed;
    }

    const isPublicRaw = searchParams.get('isPublic');
    if (isPublicRaw) {
      const parsed = parseInt(isPublicRaw, 10);
      if (![1, 0, -1].includes(parsed)) {
        // ignore
      } else {
        filters.isPublic = parsed as any;
      }
    }

    Object.keys(filters).forEach((key) => {
      const typed = key as keyof typeof filters;
      if (filters[typed] === undefined || filters[typed] === '' || filters[typed] === null) {
        delete (filters as any)[typed];
      }
    });

    const { records, total } = await getAdminArenaRatings(filters);
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
    console.error('Admin API - 获取 arena_ratings 失败:', error);
    return new Response(JSON.stringify({ success: false, error: '获取排位数据失败' }), { status: 500 });
  }
}

