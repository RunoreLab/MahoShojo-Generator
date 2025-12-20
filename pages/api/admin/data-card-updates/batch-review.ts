// pages/api/admin/data-card-updates/batch-review.ts

import { reviewDataCardUpdate } from '@/lib/database/admin';
import type { NextRequest } from 'next/server';

export const runtime = 'edge';

export default async function handler(req: NextRequest) {
  if (req.method !== 'PUT') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), { status: 405 });
  }

  try {
    const { updateIds, action } = await req.json();

    if (!Array.isArray(updateIds) || updateIds.length === 0) {
      return new Response(JSON.stringify({ success: false, error: '缺少必要参数: updateIds' }), { status: 400 });
    }

    if (action !== 'approve' && action !== 'reject') {
      return new Response(JSON.stringify({ success: false, error: '无效的操作类型' }), { status: 400 });
    }

    const failedIds: string[] = [];
    for (const updateId of updateIds as string[]) {
      const ok = await reviewDataCardUpdate(updateId, action);
      if (!ok) failedIds.push(updateId);
    }

    const success = failedIds.length === 0;
    return new Response(JSON.stringify({
      success,
      processed: updateIds.length,
      failedIds,
    }), {
      status: success ? 200 : 207,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Admin API - 批量审核更新失败:', error);
    return new Response(JSON.stringify({ success: false, error: '批量审核更新失败' }), { status: 500 });
  }
}

