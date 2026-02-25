import { countUserDecks, createDeck, deleteDeck, getUserDataCardCapacity, getUserDecks, updateDeck } from '@/lib/d1';
import { requireAuthUser } from '@/lib/auth/server';
import { config } from '@/lib/config';
import { quickCheck } from '@/lib/sensitive-word-filter';

export const runtime = 'edge';

export default async function handler(req: Request): Promise<Response> {
  const auth = await requireAuthUser(req);
  if ('response' in auth) return auth.response;

  const userId = auth.user.id;
  const isAdmin = auth.user.is_admin === 1;

  if (req.method === 'GET') {
    try {
      const [decks, capacity, deckCount] = await Promise.all([
        getUserDecks(userId),
        getUserDataCardCapacity(userId, config.DEFAULT_DATA_CARD_CAPACITY),
        countUserDecks(userId)
      ]);

      return new Response(JSON.stringify({ success: true, decks, capacity, deckCount }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      console.error('Get decks error:', error);
      return new Response(JSON.stringify({ error: '获取卡组失败' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  if (req.method === 'POST') {
    try {
      const { name, description, isPublic } = await req.json();
      const normalizedName = typeof name === 'string' ? name.trim() : '';
      const normalizedDescription = typeof description === 'string' ? description.trim() : '';

      if (!normalizedName) {
        return new Response(JSON.stringify({ error: '缺少卡组名称' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      const sensitiveWordResult = await quickCheck(`${normalizedName} ${normalizedDescription}`);
      if (sensitiveWordResult.hasSensitiveWords) {
        return new Response(JSON.stringify({ error: 'SENSITIVE_WORD_DETECTED', redirect: '/arrested' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      const [capacity, deckCount] = await Promise.all([
        getUserDataCardCapacity(userId, config.DEFAULT_DATA_CARD_CAPACITY),
        countUserDecks(userId)
      ]);

      if (deckCount >= capacity) {
        return new Response(JSON.stringify({ error: `卡组数量已达上限（${capacity}个），请删除部分卡组后再试` }), {
          status: 429,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      let normalizedPublic = typeof isPublic === 'number' ? isPublic : (isPublic ? 1 : 0);
      if (!isAdmin && normalizedPublic === -1) normalizedPublic = 0;

      const result = await createDeck(userId, normalizedName, normalizedDescription, normalizedPublic);
      if (!result.success) {
        return new Response(JSON.stringify({ error: result.error || '创建卡组失败' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      return new Response(JSON.stringify({ success: true, id: result.id }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      console.error('Create deck error:', error);
      return new Response(JSON.stringify({ error: '创建卡组失败' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  if (req.method === 'PUT') {
    try {
      const { id, name, description, isPublic } = await req.json();
      const deckId = typeof id === 'string' ? id.trim() : '';
      if (!deckId) {
        return new Response(JSON.stringify({ error: '缺少卡组ID' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      const payload: { name?: string; description?: string; isPublic?: number } = {};
      if (typeof name === 'string') payload.name = name.trim();
      if (typeof description === 'string') payload.description = description.trim();
      if (isPublic !== undefined) {
        let normalizedPublic = typeof isPublic === 'number' ? isPublic : (isPublic ? 1 : 0);
        if (!isAdmin && normalizedPublic === -1) normalizedPublic = 0;
        payload.isPublic = normalizedPublic;
      }

      const sensitiveWordResult = await quickCheck(`${payload.name || ''} ${payload.description || ''}`);
      if (sensitiveWordResult.hasSensitiveWords) {
        return new Response(JSON.stringify({ error: 'SENSITIVE_WORD_DETECTED', redirect: '/arrested' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      const result = await updateDeck(deckId, userId, payload);
      if (!result.success) {
        return new Response(JSON.stringify({ error: result.error || '更新卡组失败' }), {
          status: result.error?.includes('无权') ? 404 : 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      console.error('Update deck error:', error);
      return new Response(JSON.stringify({ error: '更新卡组失败' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  if (req.method === 'DELETE') {
    try {
      const url = new URL(req.url);
      const idFromQuery = url.searchParams.get('id');
      const body = await (async () => {
        try {
          return await req.json();
        } catch {
          return null;
        }
      })();

      const deckId = typeof idFromQuery === 'string' && idFromQuery.trim()
        ? idFromQuery.trim()
        : (typeof body?.id === 'string' ? body.id.trim() : '');

      if (!deckId) {
        return new Response(JSON.stringify({ error: '缺少卡组ID' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      const ok = await deleteDeck(deckId, userId);
      if (!ok) {
        return new Response(JSON.stringify({ error: '卡组不存在或无权访问' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      console.error('Delete deck error:', error);
      return new Response(JSON.stringify({ error: '删除卡组失败' }), {
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

