// pages/api/admin/users.ts

import { getAdminUsers } from '@/lib/database/admin';
import { getUserByUsername } from '@/lib/database/users';
import type { NextRequest } from 'next/server';

export const runtime = 'experimental-edge';

export default async function handler(req: NextRequest) {
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), { status: 405 });
  }

  try {
    const { searchParams } = new URL(req.url);

    // 兼容旧版 user-management 页面根据 username 查询单个用户的请求
    const username = searchParams.get('username');
    if (username) {
      const user = await getUserByUsername(username);
      if (user) {
        return new Response(JSON.stringify(user), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      } else {
        return new Response(JSON.stringify({ error: '用户未找到' }), { status: 404 });
      }
    }

    // 新版 user-dashboard 页面完整的筛选和统计功能
    const filters = {
      page: parseInt(searchParams.get('page') || '1', 10),
      limit: parseInt(searchParams.get('limit') || '20', 10),
      search: searchParams.get('search') || undefined,
      regDateStart: searchParams.get('regDateStart') || undefined,
      regDateEnd: searchParams.get('regDateEnd') || undefined,
      loginDateStart: searchParams.get('loginDateStart') || undefined,
      loginDateEnd: searchParams.get('loginDateEnd') || undefined,
      status: searchParams.get('status') as any || undefined,
      minPublicCards: searchParams.has('minPublicCards') ? parseInt(searchParams.get('minPublicCards')!, 10) : undefined,
      maxPublicCards: searchParams.has('maxPublicCards') ? parseInt(searchParams.get('maxPublicCards')!, 10) : undefined,
      minBannedCards: searchParams.has('minBannedCards') ? parseInt(searchParams.get('minBannedCards')!, 10) : undefined,
      maxBannedCards: searchParams.has('maxBannedCards') ? parseInt(searchParams.get('maxBannedCards')!, 10) : undefined,
    };
    
    const numericFilters: (keyof typeof filters)[] = ['minPublicCards', 'maxPublicCards', 'minBannedCards', 'maxBannedCards'];
    numericFilters.forEach(key => {
      if (filters[key] !== undefined && isNaN(filters[key]!)) {
        console.warn(`Invalid numeric value for filter ${key}:`, searchParams.get(key));
        delete filters[key];
      }
    });
    Object.keys(filters).forEach(key => (filters as any)[key] === undefined && delete (filters as any)[key]);

    const { users, total } = await getAdminUsers(filters);

    return new Response(JSON.stringify({ success: true, users, total, page: filters.page, limit: filters.limit }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Admin API - 获取用户列表失败:', error);
    return new Response(JSON.stringify({ success: false, error: '获取用户数据失败' }), { status: 500 });
  }
}