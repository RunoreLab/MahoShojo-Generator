import { getDeckById, getDeckCardsWithAccess, getPublicDecks, getUserByAuthKey } from '@/lib/d1';

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
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const url = new URL(req.url);
    const id = url.searchParams.get('id');
    const search = url.searchParams.get('search');
    const sortBy = url.searchParams.get('sortBy') as 'likes' | 'favorites' | 'created_at' | null;
    const limit = parseInt(url.searchParams.get('limit') || '12');
    const offset = parseInt(url.searchParams.get('offset') || '0');

    const viewer = await getUserFromAuth(req);

    if (id) {
      const deck = await getDeckById(id);
      if (!deck || deck.is_public !== 1) {
        return new Response(JSON.stringify({ success: false, error: '卡组不存在' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      const cards = await getDeckCardsWithAccess(id, viewer?.id);

      return new Response(JSON.stringify({ success: true, deck, cards }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const decks = await getPublicDecks(limit, offset, search || undefined, sortBy || undefined);
    return new Response(JSON.stringify({ success: true, decks }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Get public decks error:', error);
    return new Response(JSON.stringify({ success: false, error: '获取公开卡组失败' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

