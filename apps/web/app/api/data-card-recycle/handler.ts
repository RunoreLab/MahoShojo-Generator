import { getRequestUrl } from '@/lib/request-url';
import {
  getUserRecycleBinCards,
  getUserUsedSlots,
  getDataCardUpdate,
  restoreDataCard,
  permanentlyDeleteDataCards
} from '@/lib/database/data-cards';
import { getUserDataCardCapacity } from '@/lib/database/users';
import { requireAuthUser } from '@/lib/auth/server';
import { config as appConfig } from '@/lib/config';
import { getDataCardSlotUsage } from '@/lib/data-card-quota';

async function handler(req: Request): Promise<Response> {
  const auth = await requireAuthUser(req);
  if ('response' in auth) return auth.response;

  const userId = auth.user.id;

  try {
    switch (req.method) {
      case 'GET': {
        const cards = await getUserRecycleBinCards(userId);
        return new Response(JSON.stringify({ success: true, cards }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      case 'PATCH': {
        const { id } = await req.json();

        if (!id) {
          return new Response(JSON.stringify({ error: '缺少数据卡ID' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        const [recycleCards, usedSlots, capacity] = await Promise.all([
          getUserRecycleBinCards(userId),
          getUserUsedSlots(userId),
          getUserDataCardCapacity(userId, appConfig.DEFAULT_DATA_CARD_CAPACITY),
        ]);
        const recycleCard = recycleCards.find((card) => card.id === id);
        if (!recycleCard) {
          return new Response(JSON.stringify({ error: '数据卡不存在或无法恢复' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' }
          });
        }
        const pendingUpdate = await getDataCardUpdate(id);
        const requiredSlots = getDataCardSlotUsage({
          data: recycleCard.data,
          pendingData: pendingUpdate?.data ?? null,
          favoriteCount: recycleCard.favorite_count,
          usageCount: recycleCard.usage_count,
        });

        if (usedSlots + requiredSlots > capacity) {
          return new Response(JSON.stringify({
            error: `恢复该数据卡需要 ${requiredSlots} 个槽位，当前已用 ${usedSlots}/${capacity}，请释放足够槽位后再尝试恢复`
          }), {
            status: 409,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        const restored = await restoreDataCard(id, userId);

        if (!restored) {
          return new Response(JSON.stringify({ error: '数据卡不存在或无法恢复' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        return new Response(JSON.stringify({ success: true, message: '数据卡已恢复' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      case 'DELETE': {
        const url = getRequestUrl(req);
        const id = url.searchParams.get('id');

        if (!id) {
          return new Response(JSON.stringify({ error: '缺少数据卡ID' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        const deletedCount = await permanentlyDeleteDataCards([id], userId);

        if (deletedCount === 0) {
          return new Response(JSON.stringify({ error: '数据卡不存在或无权访问' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        return new Response(JSON.stringify({ success: true, message: '数据卡已彻底删除' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      default:
        return new Response(JSON.stringify({ error: 'Method not allowed' }), {
          status: 405,
          headers: { 'Content-Type': 'application/json' }
        });
    }
  } catch (error) {
    console.error('处理回收站请求失败:', error);
    return new Response(JSON.stringify({ error: '服务器内部错误' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

export const appRouteHandler = handler;
export default appRouteHandler;
