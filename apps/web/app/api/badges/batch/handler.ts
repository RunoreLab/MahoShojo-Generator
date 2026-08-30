import { getUserEquippedBadges } from '@/lib/database/badges';

/**
 * POST /api/badges/batch
 * 批量获取用户已佩戴的徽章（公开接口，仅返回 BadgeDefinition）
 */
async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    let payload: any = null;
    try {
      payload = await req.json();
    } catch {
      payload = null;
    }

    const rawIds: unknown[] = Array.isArray(payload?.userIds) ? payload.userIds : [];
    const userIds = [...new Set(rawIds.filter((id): id is number => typeof id === 'number' && id > 0))];

    if (userIds.length === 0) {
      return new Response(JSON.stringify({ success: true, items: {} }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (userIds.length > 50) {
      return new Response(JSON.stringify({ success: false, error: 'userIds 数量过多（最多 50）' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const results: Record<number, any[]> = {};
    await Promise.all(
      userIds.map(async (userId: number) => {
        try {
          const badges = await getUserEquippedBadges(userId);
          results[userId] = badges.map((ub) => ub.badge);
        } catch {
          results[userId] = [];
        }
      }),
    );

    return new Response(JSON.stringify({ success: true, items: results }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('批量获取用户徽章失败:', error);
    return new Response(JSON.stringify({ success: false, error: '服务器错误' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

export const appRouteHandler = handler;
export default appRouteHandler;
