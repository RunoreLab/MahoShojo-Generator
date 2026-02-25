import { issueActivityToken } from '@/lib/auth/activity-token';
import { requireAuthUser } from '@/lib/auth/server';

export const runtime = 'edge';

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const auth = await requireAuthUser(req);
    if ('response' in auth) {
      return auth.response;
    }

    const user = auth.user;

    const activityToken = await issueActivityToken(user.id);

    return new Response(JSON.stringify({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        prefix: user.prefix
      },
      activityToken: activityToken ?? null
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
