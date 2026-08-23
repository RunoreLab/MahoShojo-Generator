import type { Context } from 'hono';
import type {
  HttpMethod,
  NodeExecutionContext,
  RouteContext,
  RouteDefinition,
} from '@/server/routes/types';

const attachExecutionContext = (request: Request, routeId: string): Request => {
  const pendingTasks = new Set<Promise<unknown>>();
  const executionContext: NodeExecutionContext = {
    waitUntil(promise) {
      const tracked = Promise.resolve(promise);
      pendingTasks.add(tracked);
      void tracked
        .catch((error: unknown) => {
          console.error(`[hono][waitUntil][${routeId}] 后台任务失败`, error);
        })
        .finally(() => pendingTasks.delete(tracked));
    },
  };

  Object.defineProperty(request, 'context', {
    configurable: true,
    enumerable: false,
    value: executionContext,
  });
  return request;
};

const buildRouteContext = (context: Context): RouteContext => ({
  params: Promise.resolve(context.req.param()),
});

export const dispatchRoute = async (
  context: Context,
  definition: RouteDefinition,
): Promise<Response> => {
  const method = context.req.method.toUpperCase() as HttpMethod;
  const routeModule = await definition.load();
  const handler = routeModule[method];

  if (typeof handler !== 'function') {
    return context.json(
      {
        error: 'Method not allowed',
        code: 'METHOD_NOT_ALLOWED',
      },
      405,
      {
        Allow: Object.keys(routeModule).join(', '),
      },
    );
  }

  const request = attachExecutionContext(context.req.raw, definition.id);
  return handler(request, buildRouteContext(context));
};
