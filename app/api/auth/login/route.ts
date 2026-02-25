import { issueActivityToken } from '@/lib/auth/activity-token';
import { verifyUserLogin } from '@/lib/d1';
import { verifyTurnstileToken } from '@/lib/turnstile';

export const runtime = 'edge';

export async function POST(req: Request): Promise<Response> {
  try {
    const { username, authKey, turnstileToken } = (await req.json()) as {
      username?: string;
      authKey?: string;
      turnstileToken?: string;
    };

    if (!username || !authKey || !turnstileToken) {
      return new Response(JSON.stringify({ error: '用户名、密钥和安全验证不能为空' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const isTurnstileValid = await verifyTurnstileToken(turnstileToken);
    if (!isTurnstileValid) {
      return new Response(JSON.stringify({ error: '安全验证失败，请重新验证' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const user = await verifyUserLogin(username, authKey);
    if (!user) {
      return new Response(JSON.stringify({ error: '用户名或密钥错误' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const activityToken = await issueActivityToken(user.id);

    return new Response(
      JSON.stringify({
        success: true,
        user: {
          id: user.id,
          username: user.username,
          prefix: user.prefix,
        },
        activityToken: activityToken ?? null,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  } catch (error) {
    console.error('Login error:', error);
    return new Response(JSON.stringify({ error: '登录失败，请稍后重试' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
