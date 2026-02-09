import type { NextRequest } from 'next/server';

import { listAdminDataCleanupJobs } from '@/lib/database/admin-data-maintenance';

export const runtime = 'edge';

export default async function handler(req: NextRequest) {
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ success: false, error: 'Method Not Allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const url = new URL(req.url);
    const limitRaw = Number(url.searchParams.get('limit') ?? 20);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(100, Math.floor(limitRaw))) : 20;
    const statusRaw = String(url.searchParams.get('status') ?? '').trim();
    const status =
      statusRaw === 'running' || statusRaw === 'completed' || statusRaw === 'failed'
        ? statusRaw
        : undefined;
    const rows = await listAdminDataCleanupJobs(limit, status);
    return new Response(JSON.stringify({ success: true, rows }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Admin data-maintenance jobs list 失败:', error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : '读取任务列表失败' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }
}
