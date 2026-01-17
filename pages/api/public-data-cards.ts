// pages/api/public-data-cards.ts

import { getPublicDataCards, getDataCardById } from '@/lib/d1';

export const runtime = 'edge';

const parseCommaList = (value: string | null): string[] => {
  if (!value) return [];
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
};

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
    const type = url.searchParams.get('type'); // 'character' | 'scenario' | 'history'
    const search = url.searchParams.get('search'); // 搜索关键词
    const sortBy = url.searchParams.get('sortBy') as 'likes' | 'usage' | 'favorites' | 'created_at' | null; // 排序方式
    const limit = parseInt(url.searchParams.get('limit') || '12');
    const offset = parseInt(url.searchParams.get('offset') || '0');
    const tagIds = parseCommaList(url.searchParams.get('tagIds'));
    const tagMatch = url.searchParams.get('tagMatch') === 'all' ? 'all' : 'any';

    // 【新增】解析高级筛选参数
    const author = url.searchParams.get('author');
    const minLikes = url.searchParams.get('minLikes');
    const maxLikes = url.searchParams.get('maxLikes');
    const minUsage = url.searchParams.get('minUsage');
    const maxUsage = url.searchParams.get('maxUsage');
    const minFavorites = url.searchParams.get('minFavorites');
    const maxFavorites = url.searchParams.get('maxFavorites');
    const recommendedOnly = url.searchParams.get('recommendedOnly') === '1';


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
        type as 'character' | 'scenario' | 'history' | undefined, 
        search || undefined, 
        sortBy || undefined,
        tagIds,
        tagMatch,
        author || undefined,
        minLikes ? parseInt(minLikes) : undefined,
        maxLikes ? parseInt(maxLikes) : undefined,
        minUsage ? parseInt(minUsage) : undefined,
        maxUsage ? parseInt(maxUsage) : undefined,
        minFavorites ? parseInt(minFavorites) : undefined,
        maxFavorites ? parseInt(maxFavorites) : undefined,
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
