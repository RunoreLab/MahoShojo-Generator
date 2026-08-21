import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { dispatchLegacyRoute } from '@/server/legacy/dispatcher';
import type { LegacyRouteDefinition } from '@/server/legacy/types';

describe('Hono legacy route dispatcher', () => {
  it('传递动态参数并补充 waitUntil 上下文', async () => {
    let waitUntilAvailable = false;
    const definition: LegacyRouteDefinition = {
      id: 'items/[itemId]',
      pattern: '/api/items/:itemId',
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
    app.all(definition.pattern, (context) => dispatchLegacyRoute(context, definition));

    const response = await app.request('/api/items/card-1');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ params: { itemId: 'card-1' } });
    expect(waitUntilAvailable).toBe(true);
  });

  it('未导出对应方法时返回 405', async () => {
    const definition: LegacyRouteDefinition = {
      id: 'read-only',
      pattern: '/api/read-only',
      load: async () => ({ GET: async () => Response.json({ ok: true }) }),
    };
    const app = new Hono();
    app.all(definition.pattern, (context) => dispatchLegacyRoute(context, definition));

    const response = await app.request('/api/read-only', { method: 'POST' });
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET');
  });
});
