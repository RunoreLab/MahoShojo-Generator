// pages/api/public-data-cards.ts

import { getPublicDataCards, getDataCardById } from '@/lib/d1';

export const runtime = 'edge';

const MAX_LIMIT = 100;
const MAX_TAGS = 20;
const MAX_SEARCH_LENGTH = 200;

const parseCommaList = (value: string | null): string[] => {
  if (!value) return [];
  const list = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return list.slice(0, MAX_TAGS);
};

const readIntParam = (value: string | null, fallback: number) => {
  if (value == null) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.floor(parsed) : fallback;
};

const readNonNegativeInt = (value: string | null): number | undefined => {
  if (value == null) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.max(0, Math.floor(parsed));
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
    const id = url.searchParams.get('id'); // 单个数据卡ID
    const typeRaw = url.searchParams.get('type'); // 'character' | 'scenario' | 'history' | 'questionnaire'
    const searchRaw = url.searchParams.get('search'); // 搜索关键词
    const sortByRaw = url.searchParams.get('sortBy'); // 排序方式
    const limit = clamp(readIntParam(url.searchParams.get('limit'), 12), 1, MAX_LIMIT);
    const offset = Math.max(0, readIntParam(url.searchParams.get('offset'), 0));
    const tagIds = parseCommaList(url.searchParams.get('tagIds'));
    const tagMatch = url.searchParams.get('tagMatch') === 'all' ? 'all' : 'any';

    // 【新增】解析高级筛选参数
    const authorRaw = url.searchParams.get('author');
    const minLikes = readNonNegativeInt(url.searchParams.get('minLikes'));
    const maxLikes = readNonNegativeInt(url.searchParams.get('maxLikes'));
    const minUsage = readNonNegativeInt(url.searchParams.get('minUsage'));
    const maxUsage = readNonNegativeInt(url.searchParams.get('maxUsage'));
    const minFavorites = readNonNegativeInt(url.searchParams.get('minFavorites'));
    const maxFavorites = readNonNegativeInt(url.searchParams.get('maxFavorites'));
    const recommendedOnly = url.searchParams.get('recommendedOnly') === '1';

    const search = typeof searchRaw === 'string' ? searchRaw.trim() : '';
    if (search.length > MAX_SEARCH_LENGTH) {
      return new Response(JSON.stringify({
        success: false,
        error: `搜索关键词过长（最多 ${MAX_SEARCH_LENGTH} 字符）`
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const author = typeof authorRaw === 'string' ? authorRaw.trim() : '';
    if (author.length > MAX_SEARCH_LENGTH) {
      return new Response(JSON.stringify({
        success: false,
        error: `作者名过长（最多 ${MAX_SEARCH_LENGTH} 字符）`
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const type =
      typeRaw === 'character' || typeRaw === 'scenario' || typeRaw === 'history' || typeRaw === 'questionnaire'
        ? typeRaw
        : undefined;

    const sortBy =
      sortByRaw === 'likes' || sortByRaw === 'usage' || sortByRaw === 'favorites' || sortByRaw === 'created_at'
        ? sortByRaw
        : undefined;


    // 如果提供了ID，则获取单个数据卡
    if (id) {
      const card = await getDataCardById(id, true);
      if (!card) {
        return new Response(JSON.stringify({
          success: false,
          error: '数据卡不存在'
        }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      return new Response(JSON.stringify({
        success: true,
        card
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 获取公开数据卡列表，支持搜索和类型过滤
    // 【修改】将新增的筛选参数传递给数据库函数
    const cards = await getPublicDataCards(
        limit, 
        offset, 
        type, 
        search || undefined, 
        sortBy,
        tagIds,
        tagMatch,
        author || undefined,
        minLikes,
        maxLikes,
        minUsage,
        maxUsage,
        minFavorites,
        maxFavorites,
        recommendedOnly
    );

    return new Response(JSON.stringify({
      success: true,
      cards
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Get public data cards error:', error);
    return new Response(JSON.stringify({ 
      success: false,
      error: '获取公开数据卡失败' 
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
