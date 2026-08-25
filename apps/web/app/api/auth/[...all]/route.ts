import { getBetterAuthBootstrapStatus } from '@/lib/auth/better-auth';
import { getBetterAuthRouteHandlers, hasBetterAuthDatabaseBinding } from '@/lib/auth/better-auth-app';

const json = (payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  });

const notReady = (): Response => {
  const status = getBetterAuthBootstrapStatus();

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
      error: 'Better Auth 路由初始化失败',
      code: 'BETTER_AUTH_INIT_FAILED',
    },
    500,
  );
};

const handle = async (req: Request): Promise<Response> => {
  const handlers = getBetterAuthRouteHandlers();
  if (!handlers) {
    return notReady();
  }

  if (!hasBetterAuthDatabaseBinding()) {
    return json(
      {
        error: 'Better Auth 运行所需的 D1 绑定不可用',
        code: 'BETTER_AUTH_DB_UNAVAILABLE',
      },
      503,
    );
  }

  const method = (req.method || '').toUpperCase() as keyof typeof handlers;
  const routeHandler = handlers[method];

  if (typeof routeHandler !== 'function') {
    return json({ error: 'Method not allowed' }, 405);
  }

  return routeHandler(req);
};

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const PUT = handle;
export const DELETE = handle;
