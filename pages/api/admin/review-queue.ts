// pages/api/admin/review-queue.ts

import { getAdminReviewQueue } from '@/lib/database/admin';
import type { NextRequest } from 'next/server';

export const runtime = 'edge';

export default async function handler(req: NextRequest) {
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), { status: 405 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = parseInt(searchParams.get('limit') || '20', 10);
    const search = searchParams.get('search') || undefined;
    const type = (searchParams.get('type') as 'character' | 'scenario' | null) || undefined;
    const kind = (searchParams.get('kind') as 'new' | 'update' | null) || undefined;

    const { items, total } = await getAdminReviewQueue({
      page,
      limit,
      search,
      type,
      kind,
    });

    const totalPages = Math.ceil(total / limit);

    return new Response(JSON.stringify({ success: true, items, total, currentPage: page, totalPages }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Admin API - 获取待审核队列失败:', error);
    return new Response(JSON.stringify({ success: false, error: '获取待审核队列失败' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

