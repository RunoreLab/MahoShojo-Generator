// pages/api/admin/users.ts

import { getAdminUsers } from '@/lib/database/admin';
import type { NextRequest } from 'next/server';

export const runtime = 'edge';

export default async function handler(req: NextRequest) {
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), { status: 405 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const filters = {
      page: parseInt(searchParams.get('page') || '1', 10),
      limit: parseInt(searchParams.get('limit') || '20', 10),
      search: searchParams.get('search') || undefined,
      regDateStart: searchParams.get('regDateStart') || undefined,
      regDateEnd: searchParams.get('regDateEnd') || undefined,
      loginDateStart: searchParams.get('loginDateStart') || undefined,
      loginDateEnd: searchParams.get('loginDateEnd') || undefined,
      status: searchParams.get('status') as any || undefined,
    };
    
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