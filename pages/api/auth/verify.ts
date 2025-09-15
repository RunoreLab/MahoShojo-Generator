import { getUserByAuthKey } from '@/lib/d1';

export const runtime = 'edge';

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const authHeader = req.headers.get('authorization');
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: '未提供认证信息' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const authKey = authHeader.substring(7);

    // 根据认证密钥查找用户
    const user = await getUserByAuthKey(authKey);

    if (!user) {
      return new Response(JSON.stringify({ error: '认证失败' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        prefix: user.prefix
      }
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Verify error:', error);
    return new Response(JSON.stringify({ error: '验证失败，请稍后重试' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}