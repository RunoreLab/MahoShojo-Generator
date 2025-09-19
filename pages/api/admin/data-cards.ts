// pages/api/admin/data-cards.ts

import { getAdminDataCards } from '@/lib/database/admin';
import type { NextRequest } from 'next/server';

export const runtime = 'experimental-edge';

export default async function handler(req: NextRequest) {
  // 根据您的要求，此阶段暂不进行管理员身份验证

  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), { status: 405 });
  }

  try {
    const { searchParams } = new URL(req.url);

    // 从 URL 查询参数中解析所有可能的筛选条件
    const filters = {
      page: parseInt(searchParams.get('page') || '1', 10),
      limit: parseInt(searchParams.get('limit') || '20', 10),
      sortBy: searchParams.get('sortBy') || 'updated_at',
      sortOrder: (searchParams.get('sortOrder') as 'asc' | 'desc') || 'desc',
      reviewStatus: searchParams.get('reviewStatus') as 'pending' | 'approved' | 'rejected' | undefined,
      isPublic: searchParams.get('isPublic') as '0' | '1' | '-1' | undefined,
      type: searchParams.get('type') as 'character' | 'scenario' | undefined,
      search: searchParams.get('search') || undefined,
    };
    
    // 清理掉值为 undefined 的筛选条件
    Object.keys(filters).forEach(key => (filters as any)[key] === undefined && delete (filters as any)[key]);

    const { cards, total } = await getAdminDataCards(filters);

    return new Response(JSON.stringify({ success: true, cards, total, page: filters.page, limit: filters.limit }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Admin API - 获取数据卡列表失败:', error);
    return new Response(JSON.stringify({ success: false, error: '获取数据失败' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}