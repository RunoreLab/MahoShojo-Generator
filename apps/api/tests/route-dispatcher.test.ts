import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { NodeExecutionContextCoordinator } from '#/runtime/execution-context';
import { dispatchRoute } from '#/routes/dispatcher';
import type { RouteDefinition } from '#/routes/types';

describe('Hono route dispatcher', () => {
  it('传递动态参数并补充 waitUntil 上下文', async () => {
    let waitUntilAvailable = false;
    const definition: RouteDefinition = {
      id: 'items/[itemId]',
      pattern: '/api/items/:itemId',
      adapter: 'shared-service',
      load: async () => ({
        GET: async (request, context) => {
          const requestWithContext = request as Request & {
            context?: { waitUntil?: (promise: Promise<unknown>) => void };
          };
          waitUntilAvailable = typeof requestWithContext.context?.waitUntil === 'function';
          requestWithContext.context?.waitUntil?.(Promise.resolve());
          return Response.json({ params: await context.params });
        },
      }),
    };
    const app = new Hono();
    app.all(definition.pattern, (context) => dispatchRoute(context, definition));

    const response = await app.request('/api/items/card-1');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ params: { itemId: 'card-1' } });
    expect(waitUntilAvailable).toBe(true);
  });

  it('把响应返回后的 waitUntil 任务登记到进程级 coordinator', async () => {
    const coordinator = new NodeExecutionContextCoordinator();
    let completeBackgroundTask!: () => void;
    const backgroundTask = new Promise<void>((resolve) => {
      completeBackgroundTask = resolve;
    });
    const definition: RouteDefinition = {
      id: 'activity-write',
      pattern: '/api/activity-write',
      adapter: 'shared-service',
      load: async () => ({
        POST: async (request) => {
          const requestWithContext = request as Request & {
            context: { waitUntil: (promise: Promise<unknown>) => void };
          };
          requestWithContext.context.waitUntil(backgroundTask);
          return Response.json({ accepted: true });
        },
      }),
    };
    const app = new Hono();
    app.all(definition.pattern, (context) => dispatchRoute(context, definition, coordinator));

    const response = await app.request('/api/activity-write', { method: 'POST' });
    expect(await response.json()).toEqual({ accepted: true });
    expect(coordinator.pendingTaskCount).toBe(1);

    completeBackgroundTask();
    await expect(coordinator.drain({ timeoutMs: 1_000 })).resolves.toMatchObject({
      timedOut: false,
    });
  });

  it('未导出对应方法时返回 405', async () => {
    const definition: RouteDefinition = {
      id: 'read-only',
      pattern: '/api/read-only',
      adapter: 'shared-service',
      load: async () => ({ GET: async () => Response.json({ ok: true }) }),
    };
    const app = new Hono();
    app.all(definition.pattern, (context) => dispatchRoute(context, definition));

    const response = await app.request('/api/read-only', { method: 'POST' });
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET');
  });
});
