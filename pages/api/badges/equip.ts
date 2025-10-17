import { getUserByAuthKey, updateEquippedBadges } from '@/lib/d1';

export const runtime = 'edge';

/**
 * POST /api/badges/equip
 * 更新用户佩戴的徽章
 */
export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    // 从请求头获取认证信息
    const authHeader = req.headers.get('authorization');

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: '未登录' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const authKey = authHeader.substring(7);

    // 验证用户
    const user = await getUserByAuthKey(authKey);
    if (!user) {
      return new Response(JSON.stringify({ error: '认证失败' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 解析请求体
    const body = await req.json();
    const { badgeIds } = body;

    // 验证参数
    if (!Array.isArray(badgeIds)) {
      return new Response(JSON.stringify({ error: '参数错误：badgeIds 必须是数组' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (badgeIds.length > 5) {
      return new Response(JSON.stringify({ error: '最多只能佩戴 5 个徽章' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 更新佩戴徽章
    const success = await updateEquippedBadges(user.id, badgeIds);

    if (!success) {
      return new Response(JSON.stringify({ error: '更新失败' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({
      success: true,
      message: '徽章设置已更新'
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('更新佩戴徽章失败:', error);
    return new Response(JSON.stringify({
      error: '服务器错误'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
