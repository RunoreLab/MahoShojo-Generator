import { getPublicDataCards, getDataCardById } from '@/lib/d1';

export const runtime = 'edge';

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
    const type = url.searchParams.get('type'); // 'character' or 'scenario'
    const search = url.searchParams.get('search'); // 搜索关键词
    const sortBy = url.searchParams.get('sortBy') as 'likes' | 'usage' | 'created_at' | null; // 排序方式
    const limit = parseInt(url.searchParams.get('limit') || '12');
    const offset = parseInt(url.searchParams.get('offset') || '0');

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
    const cards = await getPublicDataCards(limit, offset, type as 'character' | 'scenario' | undefined, search || undefined, sortBy || undefined);

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