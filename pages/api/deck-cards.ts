import { addCardsToDeck, getDeckById, getDeckCardsWithAccess, pruneDeckInaccessibleCards, removeCardsFromDeck } from '@/lib/d1';
import { getAuthUser, requireAuthUser } from '@/lib/auth/server';

export const runtime = 'edge';

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'GET') {
    try {
      const url = new URL(req.url);
      const deckId = url.searchParams.get('deckId')?.trim() || '';
      if (!deckId) {
        return new Response(JSON.stringify({ error: '缺少卡组ID' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      const viewer = (await getAuthUser(req))?.user ?? null;
      const deck = await getDeckById(deckId);
      if (!deck) {
        return new Response(JSON.stringify({ error: '卡组不存在' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      const isOwner = viewer && deck.user_id === viewer.id;
      const isPublic = deck.is_public === 1;
      const isBanned = deck.is_public === -1;
      if (!isOwner && !isPublic) {
        return new Response(JSON.stringify({ error: '卡组不存在或无权访问' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      if (!isOwner && isBanned) {
        return new Response(JSON.stringify({ error: '卡组不存在或无权访问' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      const cards = await getDeckCardsWithAccess(deckId, viewer?.id);
      return new Response(JSON.stringify({ success: true, deck, cards }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      console.error('Get deck cards error:', error);
      return new Response(JSON.stringify({ error: '获取卡组失败' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  const auth = await requireAuthUser(req);
  if ('response' in auth) return auth.response;
  const user = auth.user;

  if (req.method === 'POST') {
    try {
      const body = await req.json();
      const deckId = typeof body?.deckId === 'string' ? body.deckId.trim() : '';
      if (!deckId) {
        return new Response(JSON.stringify({ error: '缺少卡组ID' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      const deck = await getDeckById(deckId);
      if (!deck || deck.user_id !== user.id) {
        return new Response(JSON.stringify({ error: '卡组不存在或无权访问' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      const action = typeof body?.action === 'string' ? body.action : '';
      if (action === 'pruneInaccessible') {
        const result = await pruneDeckInaccessibleCards(deckId, user.id);
        if (!result.success) {
          return new Response(JSON.stringify({ error: result.error || '清理失败' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        return new Response(JSON.stringify({ success: true, removed: result.removed }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      const cardIds = Array.isArray(body?.cardIds) ? body.cardIds : [];
      const result = await addCardsToDeck(deckId, user.id, cardIds);
      if (!result.success) {
        return new Response(JSON.stringify({ error: result.error || '添加卡片失败' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      return new Response(JSON.stringify({ success: true, added: result.added, skipped: result.skipped }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      console.error('Add deck cards error:', error);
      return new Response(JSON.stringify({ error: '添加卡片失败' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  if (req.method === 'DELETE') {
    try {
      const body = await req.json();
      const deckId = typeof body?.deckId === 'string' ? body.deckId.trim() : '';
      const cardIds = Array.isArray(body?.cardIds) ? body.cardIds : [];
      if (!deckId) {
        return new Response(JSON.stringify({ error: '缺少卡组ID' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      const result = await removeCardsFromDeck(deckId, user.id, cardIds);
      if (!result.success) {
        return new Response(JSON.stringify({ error: result.error || '移除失败' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      return new Response(JSON.stringify({ success: true, removed: result.removed }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      console.error('Remove deck cards error:', error);
      return new Response(JSON.stringify({ error: '移除失败' }), {
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

