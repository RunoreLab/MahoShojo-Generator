import { getDrizzleDbFromRuntime } from '@/lib/db/drizzle';
import {
  incrementPublicApprovedDataCardLikeCount,
  incrementPublicApprovedDataCardUsageCount,
} from '@/lib/db/repositories/data-cards-core';

export const runtime = 'edge';

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const db = getDrizzleDbFromRuntime();
    if (!db) {
      return new Response(JSON.stringify({
        success: false,
        error: '数据库不可用，请稍后重试'
      }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const { cardId, type } = await req.json();
    
    if (!cardId || !type || !['like', 'usage'].includes(type)) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: '无效的参数' 
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const changed =
      type === 'like'
        ? await incrementPublicApprovedDataCardLikeCount(db, cardId)
        : await incrementPublicApprovedDataCardUsageCount(db, cardId);

    if (changed <= 0) {
      return new Response(JSON.stringify({
        success: false,
        error: '卡片不存在或不可操作'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({
      success: true
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Increment data card stats error:', error);
    return new Response(JSON.stringify({ 
      success: false,
      error: '操作失败' 
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
