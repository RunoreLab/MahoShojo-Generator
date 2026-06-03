import { withPagesApiResponse } from '@/lib/pages-api-adapter';
import { getUserBadges } from '@/lib/database/badges';
import { requireAuthUser } from '@/lib/auth/server';

/**
 * GET /api/badges/user
 * 获取当前用户的所有徽章
 */
async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const auth = await requireAuthUser(req);
    if ('response' in auth) return auth.response;

    // 获取用户徽章
    const badges = await getUserBadges(auth.user.id);

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

export default withPagesApiResponse(handler);
