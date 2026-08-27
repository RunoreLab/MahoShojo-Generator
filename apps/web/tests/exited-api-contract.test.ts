import { describe, expect, it } from 'vitest';

import { appRouteHandler as tavernChoices } from '@/app/api/magic-tavern/generate-choices/handler';
import { appRouteHandler as tavernStream } from '@/app/api/magic-tavern/generate-stream/handler';
import { appRouteHandler as teaChoices } from '@/app/api/magic-tea-party/generate-choices/handler';
import { appRouteHandler as teaStream } from '@/app/api/magic-tea-party/generate-stream/handler';
import { appRouteHandler as teaUpdates } from '@/app/api/magic-tea-party/generate-updates/handler';
import { appRouteHandler as regenerate } from '@/app/api/me/battle-reports/[generationId]/regenerate/handler';

const exitedHandlers = [
  ['magic-tavern/generate-choices', tavernChoices],
  ['magic-tavern/generate-stream', tavernStream],
  ['magic-tea-party/generate-choices', teaChoices],
  ['magic-tea-party/generate-stream', teaStream],
  ['magic-tea-party/generate-updates', teaUpdates],
  ['me/battle-reports/generation-1/regenerate', regenerate],
] as const;

const generationHandlers = exitedHandlers.slice(0, 5);

describe('Phase 2.5 exited Next API contract', () => {
  it.each(exitedHandlers)('%s preserves the default method error wire', async (routeId, handler) => {
    const response = await handler(new Request(`https://example.test/api/${routeId}`, {
      method: 'GET',
    }) as never);

    expect(response.status).toBe(405);
    expect(await response.json()).toEqual({ error: 'Method not allowed' });
  });

  it.each(generationHandlers)('%s preserves the default malformed-request wire', async (
    routeId,
    handler,
  ) => {
    const response = await handler(new Request(`https://example.test/api/${routeId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'null',
    }) as never);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: '请求参数无效' });
  });

  it('me/battle-reports/[generationId]/regenerate preserves the default unauthenticated wire', async () => {
    const response = await regenerate(new Request(
      'https://example.test/api/me/battle-reports/generation-1/regenerate',
      { method: 'POST' },
    ) as never);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: '未授权' });
  });
});
