import type { NextRequest } from 'next/server';

import {
  exportAdminBattleReportGenerations,
  type AdminBattleReportGenerationListFilters,
} from '@/lib/database/admin-battle-report-generations';

export const runtime = 'edge';

export default async function handler(req: NextRequest) {
  // 此阶段暂不进行严格的管理员身份验证

  try {
    if (req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      const generationIds = Array.isArray(body.generationIds) ? body.generationIds.filter(Boolean) : [];
      const includeCombatants = body.includeCombatants !== false;
      const maxRows = typeof body.maxRows === 'number' ? body.maxRows : undefined;

      if (generationIds.length === 0) {
        return new Response(JSON.stringify({ success: false, error: '缺少必要参数: generationIds' }), { status: 400 });
      }

      const { rows, total, truncated } = await exportAdminBattleReportGenerations({
        ids: generationIds,
        includeCombatants,
        maxRows,
      });

      return new Response(JSON.stringify({ success: true, data: rows, meta: { total, truncated } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (req.method === 'GET') {
      const { searchParams } = new URL(req.url);

      const filters: AdminBattleReportGenerationListFilters = {
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

      const includeCombatants = searchParams.get('includeCombatants') !== '0';
      const maxRowsRaw = searchParams.get('maxRows');
      const maxRows = maxRowsRaw ? parseInt(maxRowsRaw, 10) : undefined;

      Object.keys(filters).forEach(key => {
        const filterKey = key as keyof typeof filters;
        if (filters[filterKey] === undefined || filters[filterKey] === '' || filters[filterKey] === null) {
          delete (filters as any)[filterKey];
        }
      });

      const { rows, total, truncated } = await exportAdminBattleReportGenerations({
        filters,
        includeCombatants,
        maxRows,
      });

      return new Response(JSON.stringify({ success: true, data: rows, meta: { total, truncated } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), { status: 405 });
  } catch (error) {
    console.error('Admin API - 导出战报生成记录失败:', error);
    return new Response(JSON.stringify({ success: false, error: '导出战报生成记录失败' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

