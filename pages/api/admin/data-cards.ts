// pages/api/admin/data-cards.ts

import { getAdminDataCards } from '@/lib/database/admin';
import { getDataCardById } from '@/lib/database/data-cards';
import type { NextRequest } from 'next/server';

export const runtime = 'experimental-edge';

export default async function handler(req: NextRequest) {
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), { status: 405 });
  }

  try {
    const { searchParams } = new URL(req.url);

    // 兼容旧版 character-management 页面根据 id 查询单个卡片的请求
    const id = searchParams.get('id');
    if (id) {
        // 调用通用的数据卡查询函数
        const card = await getDataCardById(id, false); // false 表示不限制为必须公开
        if (card) {
            return new Response(JSON.stringify(card), { status: 200 });
        } else {
            return new Response(JSON.stringify({ error: '角色卡未找到' }), { status: 404 });
        }
    }

    // 同时处理来自新旧两个版本前端的筛选参数。
    // 旧版页面发送 `status` ('public', 'private', 'banned')。
    // 新版页面发送 `isPublic` ('1', '0', '-1')。
    // 在这里，我们将旧版的 `status` 参数转换为新版 `isPublic` 参数可以理解的格式。
    let isPublicValue = searchParams.get('isPublic') as '0' | '1' | '-1' | undefined;
    const statusValue = searchParams.get('status');

    // 兼容旧版页面的 'status' 参数
    if (statusValue && statusValue !== 'all' && !isPublicValue) {
        if (statusValue === 'public') isPublicValue = '1';
        else if (statusValue === 'private') isPublicValue = '0';
        else if (statusValue === 'banned') isPublicValue = '-1';
    }

    // 从 URL 查询参数中解析所有可能的筛选条件
    const filters = {
      page: parseInt(searchParams.get('page') || '1', 10),
      limit: parseInt(searchParams.get('limit') || '20', 10),
      sortBy: searchParams.get('sortBy') || 'updated_at',
      sortOrder: (searchParams.get('sortOrder') as 'asc' | 'desc') || 'desc',
      reviewStatus: searchParams.get('reviewStatus') as 'pending' | 'approved' | 'rejected' | undefined,
      isPublic: isPublicValue, // <-- 使用处理后的 isPublicValue
      isRecommended: searchParams.get('isRecommended') as '0' | '1' | undefined,
      type: searchParams.get('type') as 'character' | 'scenario' | 'history' | undefined,
      search: searchParams.get('search') || undefined,
      includePendingUpdates: searchParams.get('includePendingUpdates') === '1',
    };
    
    // 清理掉值为 undefined 或空的筛选条件
    Object.keys(filters).forEach(key => {
        const filterKey = key as keyof typeof filters;
        if (filters[filterKey] === undefined || filters[filterKey] === '') {
            delete (filters as any)[filterKey];
        }
    });

    // 调用数据库函数获取数据
    const { cards, total } = await getAdminDataCards(filters);

    // 为了兼容旧版 character-management 页面的分页逻辑，返回 totalPages 和 currentPage
    const totalPages = Math.ceil(total / (filters.limit || 20));

    return new Response(JSON.stringify({ 
        success: true, 
        cards, 
        total, 
        currentPage: filters.page,
        totalPages: totalPages
    }), {
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
