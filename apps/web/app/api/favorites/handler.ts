import type { OnlineDataCardType } from '@mahoshojo/contracts/data-cards';
import { getRequestUrl } from '@/lib/request-url';
import {
  addFavorite,
  removeFavorite,
  getUserFavorites,
  getUserFavoriteIds
} from '@/lib/database/favorites';
import { requireAuthUser } from '@/lib/auth/server';

async function handler(req: Request): Promise<Response> {
  const auth = await requireAuthUser(req);
  if ('response' in auth) {
    const authPayload = await auth.response.clone().json().catch(() => null);
    const authError = typeof (authPayload as { error?: unknown } | null)?.error === 'string'
      ? ((authPayload as { error?: string }).error ?? '未授权')
      : '未授权';
    return new Response(JSON.stringify({ success: false, error: authError }), {
      status: auth.response.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    if (req.method === 'GET') {
      const url = getRequestUrl(req);
      const type = url.searchParams.get('type') as OnlineDataCardType | null;
      const idsOnly = url.searchParams.get('idsOnly') === '1';

      if (idsOnly) {
        const favorites = await getUserFavoriteIds(auth.user.id, type ?? undefined);
        return new Response(JSON.stringify({ success: true, favorites }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      const favorites = await getUserFavorites(auth.user.id, type ?? undefined);
      return new Response(JSON.stringify({ success: true, favorites }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (req.method === 'POST') {
      const { cardId } = await req.json();
      if (!cardId) {
        return new Response(JSON.stringify({ success: false, error: '缺少卡片ID' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      const result = await addFavorite(auth.user.id, cardId);

      if (result.notFound) {
        return new Response(JSON.stringify({ success: false, error: '卡片不存在或不可收藏' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      return new Response(JSON.stringify({
        success: true,
        alreadyExists: result.alreadyExists === true
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (req.method === 'DELETE') {
      const body = await req.json().catch(() => null);
      const cardId = body?.cardId;

      if (!cardId) {
        return new Response(JSON.stringify({ success: false, error: '缺少卡片ID' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      const result = await removeFavorite(auth.user.id, cardId);

      if (result.notFound) {
        return new Response(JSON.stringify({ success: false, error: '收藏不存在' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('收藏接口错误:', error);
    return new Response(JSON.stringify({ success: false, error: '服务器错误' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

export const appRouteHandler = handler;
export default appRouteHandler;
