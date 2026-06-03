import { withPagesApiResponse } from '@/lib/pages-api-adapter';
import { getRequestUrl } from '@/lib/request-url';
import { getDeckCardsWithAccess } from '@/lib/database/deck-cards';
import { getDeckById, getPublicDecks } from '@/lib/database/decks';
import { getAuthUser } from '@/lib/auth/server';
import { getDeckStatus } from '@/lib/deck-status';
import { mapDeckReadRow, mapDeckReadRows } from '@/lib/deck-read-mappers';

const MAX_LIMIT = 100;
const MAX_SEARCH_LENGTH = 200;

const readIntParam = (value: string | null, fallback: number) => {
  if (value == null) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.floor(parsed) : fallback;
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const url = getRequestUrl(req);
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

    const normalizedSortBy = sortByRaw === 'createdAt' ? 'created_at' : sortByRaw;
    const sortBy =
      normalizedSortBy === 'likes' || normalizedSortBy === 'favorites' || normalizedSortBy === 'created_at'
        ? normalizedSortBy
        : undefined;

    if (id) {
      const deck = await getDeckById(id);
      if (!deck || getDeckStatus(deck).status !== 'public') {
        return new Response(JSON.stringify({ success: false, error: '卡组不存在' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      const cards = await getDeckCardsWithAccess(id, viewer?.id);
      const mappedDeck = mapDeckReadRow(deck);

      return new Response(JSON.stringify({ success: true, deck: mappedDeck, cards }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const decks = await getPublicDecks(limit, offset, search || undefined, sortBy);
    const mappedDecks = mapDeckReadRows(decks);
    return new Response(JSON.stringify({ success: true, decks: mappedDecks }), {
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

export default withPagesApiResponse(handler);
