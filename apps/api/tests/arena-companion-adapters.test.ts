import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  configureArenaCompanionRouteService,
} from '@mahoshojo/hosted-runtime/arena-companion';
import { POST as generate } from '../src/adapters/arena/generate';
import { POST as generateStory } from '../src/adapters/generate-battle-story';
import { POST as generateNext } from '../src/adapters/arena/session/generate-next';

afterEach(() => configureArenaCompanionRouteService(null));

describe('Hono Arena companion adapters', () => {
  it('三条路由委托给同一 shared service 并携带准确 operation', async () => {
    const service = {
      generate: vi.fn(async (_request: Request, operation?: string) => new Response(operation)),
      generateNext: vi.fn(async () => new Response('session')),
    };
    configureArenaCompanionRouteService(service as any);

    const responses = await Promise.all([
      generate(new Request('https://example.test/api/arena/generate', { method: 'POST' })),
      generateStory(new Request('https://example.test/api/generate-battle-story', { method: 'POST' })),
      generateNext(new Request('https://example.test/api/arena/session/generate-next', { method: 'POST' })),
    ]);

    expect(service.generate).toHaveBeenNthCalledWith(1, expect.any(Request), 'arena/generate');
    expect(service.generate).toHaveBeenNthCalledWith(2, expect.any(Request), 'generate-battle-story');
    expect(service.generateNext).toHaveBeenCalledTimes(1);
    expect(responses.map((response) => [
      response.headers.get('x-mahoshojo-arena-companion-operation'),
      response.headers.get('x-mahoshojo-arena-execution-placement'),
    ])).toEqual([
      ['arena/generate', 'hono-primary'],
      ['generate-battle-story', 'hono-primary'],
      ['arena/session/generate-next', 'hono-primary'],
    ]);
    expect(await Promise.all(responses.map((response) => response.text())))
      .toEqual(['arena/generate', 'generate-battle-story', 'session']);
  });
});
