import type { NextRequest } from 'next/server';

import { getAdminDataCleanupJobDetail } from '@/lib/database/admin-data-maintenance';

export const runtime = 'edge';

const getIdFromUrl = (url: string): string | null => {
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    const index = parts.findIndex((item) => item === 'jobs');
    if (index < 0) return null;
    return parts[index + 1] || null;
  } catch {
    return null;
  }
};

export default async function handler(req: NextRequest) {
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ success: false, error: 'Method Not Allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const id = getIdFromUrl(req.url);
  if (!id) {
    return new Response(JSON.stringify({ success: false, error: '缺少任务 ID' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const detail = await getAdminDataCleanupJobDetail(id);
    if (!detail) {
      return new Response(JSON.stringify({ success: false, error: '任务不存在' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ success: true, detail }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Admin data-maintenance job detail 失败:', error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : '读取任务详情失败' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }
}
