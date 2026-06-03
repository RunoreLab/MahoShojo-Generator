import { withPagesApiResponse } from '@/lib/pages-api-adapter';
import { requireAuthUser } from '@/lib/auth/server';
import { config as appConfig } from '@/lib/config';
import { getDrizzleDbFromRuntime } from '@/lib/db/drizzle';
import { getBusinessUserSlotCountById } from '@/lib/db/repositories/business-users';
import { countUserUsedDataCardSlots } from '@/lib/db/repositories/data-cards-core';

async function handler(req: Request): Promise<Response> {
  // 只支持 GET 请求
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // 验证用户身份
  const auth = await requireAuthUser(req);
  if ('response' in auth) return auth.response;

  try {
    const db = getDrizzleDbFromRuntime();
    const [slotCount, usedSlots] = db
      ? await Promise.all([
          getBusinessUserSlotCountById(db, auth.user.id),
          countUserUsedDataCardSlots(db, auth.user.id),
        ])
      : [null, 0];

    const capacity = typeof slotCount === 'number' && slotCount > 0 ? slotCount : appConfig.DEFAULT_DATA_CARD_CAPACITY;
    
    return new Response(JSON.stringify({ 
      success: true, 
      capacity,
      usedSlots,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Get user capacity error:', error);
    return new Response(JSON.stringify({ error: '获取用户容量失败' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

export default withPagesApiResponse(handler);
