import {
  getUserByAuthKey,
  addFavorite,
  removeFavorite,
  getUserFavorites,
  getUserFavoriteIds
} from '@/lib/d1';

export const runtime = 'edge';

interface AuthenticatedUser {
  id: number;
}

async function getUserFromAuth(req: Request): Promise<AuthenticatedUser | null> {
  const authHeader = req.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  const authKey = authHeader.substring(7);
  const user = await getUserByAuthKey(authKey);
  return user ?? null;
}

export default async function handler(req: Request): Promise<Response> {
  const user = await getUserFromAuth(req);
  if (!user) {
    return new Response(JSON.stringify({ success: false, error: '未授权' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    if (req.method === 'GET') {
      const url = new URL(req.url);
      const type = url.searchParams.get('type') as 'character' | 'scenario' | null;
      const idsOnly = url.searchParams.get('idsOnly') === '1';

      if (idsOnly) {
        const favorites = await getUserFavoriteIds(user.id, type ?? undefined);
        return new Response(JSON.stringify({ success: true, favorites }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      const favorites = await getUserFavorites(user.id, type ?? undefined);
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

      const result = await addFavorite(user.id, cardId);

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

      const result = await removeFavorite(user.id, cardId);

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
