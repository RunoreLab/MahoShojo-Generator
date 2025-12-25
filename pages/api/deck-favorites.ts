import { addDeckFavorite, getUserByAuthKey, getUserDeckFavoriteIds, getUserDeckFavorites, removeDeckFavorite } from '@/lib/d1';

export const runtime = 'edge';

type AuthenticatedUser = { id: number; username: string };

async function getUserFromAuth(req: Request): Promise<AuthenticatedUser | null> {
  const authHeader = req.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;

  const authKey = authHeader.substring(7);
  const user = await getUserByAuthKey(authKey);
  return user;
}

export default async function handler(req: Request): Promise<Response> {
  const user = await getUserFromAuth(req);
  if (!user) {
    return new Response(JSON.stringify({ error: '未授权' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  if (req.method === 'GET') {
    try {
      const url = new URL(req.url);
      const idsOnly = url.searchParams.get('idsOnly') === '1';

      if (idsOnly) {
        const ids = await getUserDeckFavoriteIds(user.id);
        return new Response(JSON.stringify({ success: true, ids }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      const decks = await getUserDeckFavorites(user.id);
      return new Response(JSON.stringify({ success: true, decks }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      console.error('Get deck favorites error:', error);
      return new Response(JSON.stringify({ error: '获取收藏卡组失败' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  if (req.method === 'POST') {
    try {
      const { deckId } = await req.json();
      const id = typeof deckId === 'string' ? deckId.trim() : '';
      if (!id) {
        return new Response(JSON.stringify({ error: '缺少卡组ID' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      const result = await addDeckFavorite(user.id, id);
      if (!result.success) {
        return new Response(JSON.stringify({ error: result.notFound ? '卡组不存在或不可收藏' : (result.error || '收藏失败') }), {
          status: result.notFound ? 404 : 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      return new Response(JSON.stringify({ success: true, alreadyExists: result.alreadyExists }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      console.error('Add deck favorite error:', error);
      return new Response(JSON.stringify({ error: '收藏失败' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  if (req.method === 'DELETE') {
    try {
      const { deckId } = await req.json();
      const id = typeof deckId === 'string' ? deckId.trim() : '';
      if (!id) {
        return new Response(JSON.stringify({ error: '缺少卡组ID' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      const result = await removeDeckFavorite(user.id, id);
      if (!result.success) {
        return new Response(JSON.stringify({ error: result.notFound ? '未收藏该卡组' : (result.error || '取消收藏失败') }), {
          status: result.notFound ? 404 : 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      console.error('Remove deck favorite error:', error);
      return new Response(JSON.stringify({ error: '取消收藏失败' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  return new Response(JSON.stringify({ error: 'Method not allowed' }), {
    status: 405,
    headers: { 'Content-Type': 'application/json' }
  });
}

