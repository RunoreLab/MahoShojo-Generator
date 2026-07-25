// pages/api/admin/users/batch-update.ts

import { batchUpdateUsers } from '@/lib/database/admin';
import type { NextRequest } from 'next/server';

export const runtime = 'experimental-edge';

export default async function handler(req: NextRequest) {
  if (req.method !== 'PUT') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), { status: 405 });
  }

  try {
    const { userIds, action, value } = await req.json();

    if (!Array.isArray(userIds) || userIds.length === 0 || !action) {
      return new Response(JSON.stringify({ success: false, error: '缺少必要参数: userIds 和 action' }), { status: 400 });
    }

    const updates: { is_review_exempt?: 0 | 1; is_banned?: string | null } = {};

    switch (action) {
      case 'set_exempt':
        updates.is_review_exempt = 1;
        break;
      case 'remove_exempt':
        updates.is_review_exempt = 0;
        break;
      case 'ban':
        // 封禁理由可以是简单的 'true' 或具体原因
        updates.is_banned = typeof value === 'string' && value ? value : 'Banned by administrator';
        break;
      case 'unban':
        updates.is_banned = null; // 解封
        break;
      default:
        return new Response(JSON.stringify({ success: false, error: '无效的操作类型' }), { status: 400 });
    }
    
    const success = await batchUpdateUsers(userIds, updates);

    if (success) {
      return new Response(JSON.stringify({ success: true, message: `成功更新 ${userIds.length} 个用户` }), { status: 200 });
    } else {
      throw new Error('数据库批量更新用户操作失败');
    }
  } catch (error) {
    console.error('Admin API - 批量更新用户失败:', error);
    return new Response(JSON.stringify({ success: false, error: '批量更新用户操作失败' }), { status: 500 });
  }
}