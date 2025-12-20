import type { NextRequest } from 'next/server';

import {
  getAdminBattleReportGenerationDetail,
  getAdminBattleReportGenerations,
  type AdminBattleReportGenerationListFilters,
} from '@/lib/database/admin-battle-report-generations';

export const runtime = 'edge';

export default async function handler(req: NextRequest) {
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), { status: 405 });
  }

  try {
    const { searchParams } = new URL(req.url);

    const id = searchParams.get('id');
    if (id) {
      const detail = await getAdminBattleReportGenerationDetail(id);
      if (!detail) {
        return new Response(JSON.stringify({ success: false, error: '战报生成记录未找到' }), { status: 404 });
      }
      return new Response(JSON.stringify({ success: true, ...detail }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const filters: AdminBattleReportGenerationListFilters = {
      page: parseInt(searchParams.get('page') || '1', 10),
      limit: parseInt(searchParams.get('limit') || '20', 10),
      sortBy: (searchParams.get('sortBy') as any) || 'started_at',
      sortOrder: (searchParams.get('sortOrder') as any) || 'desc',

      status: (searchParams.get('status') as any) || undefined,
      mode: searchParams.get('mode') || undefined,
      generationMode: (searchParams.get('generationMode') as any) || undefined,
      endpoint: searchParams.get('endpoint') || undefined,

      dateFrom: searchParams.get('dateFrom') || undefined,
      dateTo: searchParams.get('dateTo') || undefined,

      username: searchParams.get('username') || undefined,
      scenarioDataCardId: searchParams.get('scenarioDataCardId') || undefined,

      hasSensitiveWords: searchParams.get('hasSensitiveWords') === '1' ? true : undefined,
      hasShieldWords: searchParams.get('hasShieldWords') === '1' ? true : undefined,

      search: searchParams.get('search') || undefined,
    };

    const userIdRaw = searchParams.get('userId');
    if (userIdRaw) {
      const parsed = parseInt(userIdRaw, 10);
      if (!Number.isNaN(parsed)) filters.userId = parsed;
    }

    Object.keys(filters).forEach(key => {
      const filterKey = key as keyof typeof filters;
      if (filters[filterKey] === undefined || filters[filterKey] === '' || filters[filterKey] === null) {
        delete (filters as any)[filterKey];
      }
    });

    const { records, total } = await getAdminBattleReportGenerations(filters);
    const totalPages = Math.ceil(total / (filters.limit || 20));

    return new Response(JSON.stringify({
      success: true,
      records,
      total,
      currentPage: filters.page || 1,
      totalPages,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Admin API - 获取战报生成记录失败:', error);
    return new Response(JSON.stringify({ success: false, error: '获取战报生成记录失败' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

