// pages/api/admin/data-cards/batch-update.ts

import { batchUpdateDataCards } from '@/lib/database/admin';
import type { NextRequest } from 'next/server';

export const runtime = 'experimental-edge';

export default async function handler(req: NextRequest) {
  // 根据您的要求，此阶段暂不进行管理员身份验证

  if (req.method !== 'PUT') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), { status: 405 });
  }

  try {
    const { cardIds, action, value } = await req.json();

    if (!Array.isArray(cardIds) || cardIds.length === 0 || !action) {
      return new Response(JSON.stringify({ success: false, error: '缺少必要参数: cardIds 和 action' }), { status: 400 });
    }

    const updates: { review_status?: 'approved' | 'rejected'; is_public?: 0 | 1 | -1; is_recommended?: 0 | 1 } = {};

    // 根据 action 构建 updates 对象
    switch (action) {
      case 'approve':
        updates.review_status = 'approved';
        break;
      case 'reject':
        updates.review_status = 'rejected';
        break;
      case 'set_public_status':
        if ([-1, 0, 1].includes(value)) {
          updates.is_public = value;
        } else {
          return new Response(JSON.stringify({ success: false, error: '无效的公开状态值' }), { status: 400 });
        }
        break;
      case 'set_recommended':
        if ([0, 1].includes(value)) {
          updates.is_recommended = value;
        } else {
          return new Response(JSON.stringify({ success: false, error: '无效的推荐状态值' }), { status: 400 });
        }
        break;
      default:
        return new Response(JSON.stringify({ success: false, error: '无效的操作类型' }), { status: 400 });
    }
    
    const success = await batchUpdateDataCards(cardIds, updates);

    if (success) {
      return new Response(JSON.stringify({ success: true, message: `成功更新 ${cardIds.length} 个项目` }), { status: 200 });
    } else {
      throw new Error('数据库批量更新操作失败');
    }
  } catch (error) {
    console.error('Admin API - 批量更新失败:', error);
    return new Response(JSON.stringify({ success: false, error: '批量更新操作失败' }), { status: 500 });
  }
}
