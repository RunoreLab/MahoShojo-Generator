import { getUserByAuthKey, getUserBadges } from '@/lib/d1';

export const runtime = 'edge';

/**
 * GET /api/badges/user
 * 获取当前用户的所有徽章
 */
export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') {
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

    // 获取用户徽章
    const badges = await getUserBadges(user.id);

    return new Response(JSON.stringify({
      success: true,
      badges
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('获取用户徽章失败:', error);
    return new Response(JSON.stringify({
      error: '服务器错误'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
