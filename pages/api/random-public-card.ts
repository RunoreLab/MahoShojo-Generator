import { withPagesApiResponse } from '@/lib/pages-api-adapter';
import { getRequestUrl } from '@/lib/request-url';
// pages/api/random-public-card.ts

import { getRandomPublicCard } from '@/lib/database/data-cards';

/**
 * @api {get} /api/random-public-card
 * @description 从数据库中随机获取一张公开的数据卡（角色或情景）。
 * @param {string} type - 'character' 或 'scenario'，指定要获取的卡片类型。
 * @returns {Response} 返回包含随机卡片数据的 JSON 响应。
 */
async function handler(req: Request): Promise<Response> {
  // 仅允许 GET 请求
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    // 从请求 URL 中解析查询参数
    const url = getRequestUrl(req);
    const type = url.searchParams.get('type') as 'character' | 'scenario' | null;
    const readNonNegativeInt = (key: string): number | null => {
      const raw = url.searchParams.get(key);
      if (raw === null) return null;
      const n = Number(raw);
      if (!Number.isFinite(n)) return null;
      return Math.max(0, Math.floor(n));
    };

    // 验证 type 参数是否有效
    if (!type || !['character', 'scenario'].includes(type)) {
      return new Response(JSON.stringify({
        success: false,
        error: '必须提供有效的 "type" 参数 ("character" 或 "scenario")',
      }), {
        status: 400, // Bad Request
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 调用我们刚刚在 data-cards.ts 中创建的函数
    const card = await getRandomPublicCard(type, {
      minLikeCount: readNonNegativeInt('minLikes'),
      maxLikeCount: readNonNegativeInt('maxLikes'),
      minUsageCount: readNonNegativeInt('minUsage'),
      maxUsageCount: readNonNegativeInt('maxUsage'),
      minFavoriteCount: readNonNegativeInt('minFavorites'),
      maxFavoriteCount: readNonNegativeInt('maxFavorites'),
    });

    // 如果没有找到任何符合条件的卡片
    if (!card) {
      return new Response(JSON.stringify({
        success: false,
        error: `数据库中没有找到类型为 "${type}" 的公开数据卡`,
      }), {
        status: 404, // Not Found
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 成功找到，返回卡片数据
    return new Response(JSON.stringify({
      success: true,
      card,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error(`获取随机公开数据卡 API 错误 (类型: ${getRequestUrl(req).searchParams.get('type')}):`, error);
    return new Response(JSON.stringify({
      success: false,
      error: '获取随机数据失败，服务器内部错误',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

export default withPagesApiResponse(handler);
