import { getDeckById, getDeckCardsWithAccess, getPublicDecks } from '@/lib/d1';
import { getAuthUser } from '@/lib/auth/server';

export const runtime = 'edge';

const MAX_LIMIT = 100;
const MAX_SEARCH_LENGTH = 200;

const readIntParam = (value: string | null, fallback: number) => {
  if (value == null) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.floor(parsed) : fallback;
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

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
    const searchRaw = url.searchParams.get('search');
    const sortByRaw = url.searchParams.get('sortBy');
    const limit = clamp(readIntParam(url.searchParams.get('limit'), 12), 1, MAX_LIMIT);
    const offset = Math.max(0, readIntParam(url.searchParams.get('offset'), 0));

    const viewer = (await getAuthUser(req))?.user ?? null;
    const search = typeof searchRaw === 'string' ? searchRaw.trim() : '';

    if (search.length > MAX_SEARCH_LENGTH) {
      return new Response(JSON.stringify({ success: false, error: `搜索关键词过长（最多 ${MAX_SEARCH_LENGTH} 字符）` }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const sortBy =
      sortByRaw === 'likes' || sortByRaw === 'favorites' || sortByRaw === 'created_at'
        ? sortByRaw
        : undefined;

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

    const decks = await getPublicDecks(limit, offset, search || undefined, sortBy);
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
