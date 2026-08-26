import { beforeEach, describe, expect, it, vi } from 'vitest';

const generate = vi.fn();
const generateNext = vi.fn();

vi.mock('@/app/api/arena/companion-runtime', () => ({
  getCloudflareDrArenaCompanionService: () => ({ generate, generateNext }),
}));

import { appRouteHandler as arenaGenerate } from '@/app/api/arena/generate/handler';
import { appRouteHandler as battleStory } from '@/app/api/generate-battle-story/handler';
import { appRouteHandler as sessionNext } from '@/app/api/arena/session/generate-next/handler';

describe('Next Arena companion DR adapters', () => {
  beforeEach(() => {
    generate.mockReset().mockResolvedValue(new Response('generated'));
    generateNext.mockReset().mockResolvedValue(new Response('session'));
  });

  it('三条 adapter 只委托共享 DR service', async () => {
    await arenaGenerate(new Request('https://example.test/api/arena/generate', { method: 'POST' }) as any);
    await battleStory(new Request('https://example.test/api/generate-battle-story', { method: 'POST' }) as any);
    await sessionNext(new Request('https://example.test/api/arena/session/generate-next', { method: 'POST' }) as any);

    expect(generate).toHaveBeenNthCalledWith(1, expect.any(Request), 'arena/generate');
    expect(generate).toHaveBeenNthCalledWith(2, expect.any(Request), 'generate-battle-story');
    expect(generateNext).toHaveBeenCalledWith(expect.any(Request));
  });
});
