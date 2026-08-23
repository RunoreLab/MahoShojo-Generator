import type { Context } from 'hono';
import {
  NodeExecutionContextCoordinator,
  nodeExecutionContextCoordinator,
} from '@/server/runtime/execution-context';
import type {
  HttpMethod,
  RouteContext,
  RouteDefinition,
} from '@/server/routes/types';

const attachExecutionContext = (
  request: Request,
  routeId: string,
  coordinator: NodeExecutionContextCoordinator,
): Request => {
  Object.defineProperty(request, 'context', {
    configurable: true,
    enumerable: false,
    value: coordinator.createExecutionContext(routeId),
  });
  return request;
};

const buildRouteContext = (context: Context): RouteContext => ({
  params: Promise.resolve(context.req.param()),
});

export const dispatchRoute = async (
  context: Context,
  definition: RouteDefinition,
  coordinator: NodeExecutionContextCoordinator = nodeExecutionContextCoordinator,
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

  const request = attachExecutionContext(context.req.raw, definition.id, coordinator);
  return handler(request, buildRouteContext(context));
};
