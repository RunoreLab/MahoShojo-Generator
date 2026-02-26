import { issueActivityToken } from '@/lib/auth/activity-token';
import { requireAuthUserForApp } from '@/lib/auth/server-app';

export const runtime = 'edge';

export async function POST(req: Request): Promise<Response> {
  try {
    const auth = await requireAuthUserForApp(req);
    if ('response' in auth) {
      return auth.response;
    }

    const user = auth.user;
    const activityToken = await issueActivityToken(user.id);

    return new Response(
      JSON.stringify({
        success: true,
        user: {
          id: user.id,
          username: user.username,
          prefix: user.prefix,
          is_banned: user.is_banned ?? null,
          is_admin: user.is_admin ?? 0,
          is_review_exempt: user.is_review_exempt ?? 0,
        },
        activityToken: activityToken ?? null,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  } catch (error) {
    console.error('Verify error:', error);
    return new Response(JSON.stringify({ error: '验证失败，请稍后重试' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
