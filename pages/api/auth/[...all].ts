import { getBetterAuthBootstrapStatus } from '@/lib/auth/better-auth';

export const runtime = 'edge';

const ALLOWED_METHODS = ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'] as const;

const json = (payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  });

const methodNotAllowed = (): Response =>
  new Response(JSON.stringify({ error: 'Method not allowed' }), {
    status: 405,
    headers: {
      'Content-Type': 'application/json',
      Allow: ALLOWED_METHODS.join(', '),
    },
  });

export default async function handler(req: Request): Promise<Response> {
  if (!ALLOWED_METHODS.includes((req.method || '').toUpperCase() as typeof ALLOWED_METHODS[number])) {
    return methodNotAllowed();
  }

  const status = getBetterAuthBootstrapStatus();
  if (status === 'disabled') {
    return json(
      {
        error: 'Better Auth 尚未启用',
        code: 'BETTER_AUTH_DISABLED',
      },
      503,
    );
  }

  if (status === 'misconfigured') {
    return json(
      {
        error: 'Better Auth 配置不完整',
        code: 'BETTER_AUTH_MISCONFIGURED',
      },
      503,
    );
  }

  return json(
    {
      error: 'Better Auth 入口骨架已就位，但 Edge Runtime 适配尚未接入',
      code: 'BETTER_AUTH_EDGE_NOT_READY',
    },
    501,
  );
}
