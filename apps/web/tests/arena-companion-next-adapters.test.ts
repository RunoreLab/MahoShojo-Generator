import { beforeEach, describe, expect, it, vi } from 'vitest';

const generate = vi.fn();
const generateNext = vi.fn();
const repairCombatantMeta = vi.fn();

vi.mock('@/app/api/arena/companion-runtime', () => ({
  getCloudflareDrArenaCompanionService: () => ({
    generate,
    generateNext,
    repairCombatantMeta,
  }),
}));

import { appRouteHandler as arenaGenerate } from '@/app/api/arena/generate/handler';
import { appRouteHandler as battleStory } from '@/app/api/generate-battle-story/handler';
import { appRouteHandler as repairMeta } from '@/app/api/arena/repair-combatant-meta/handler';
import { appRouteHandler as sessionNext } from '@/app/api/arena/session/generate-next/handler';

describe('Next Arena companion DR adapters', () => {
  beforeEach(() => {
    generate.mockReset().mockResolvedValue(new Response('generated'));
    generateNext.mockReset().mockResolvedValue(new Response('session'));
    repairCombatantMeta.mockReset().mockResolvedValue(new Response('repair'));
  });

  it('四条 adapter 只委托共享 DR service', async () => {
    const responses = await Promise.all([
      arenaGenerate(new Request('https://example.test/api/arena/generate', { method: 'POST' }) as any),
      battleStory(new Request('https://example.test/api/generate-battle-story', { method: 'POST' }) as any),
      repairMeta(new Request('https://example.test/api/arena/repair-combatant-meta', { method: 'POST' }) as any),
      sessionNext(new Request('https://example.test/api/arena/session/generate-next', { method: 'POST' }) as any),
    ]);

    expect(generate).toHaveBeenNthCalledWith(1, expect.any(Request), 'arena/generate');
    expect(generate).toHaveBeenNthCalledWith(2, expect.any(Request), 'generate-battle-story');
    expect(repairCombatantMeta).toHaveBeenCalledWith(expect.any(Request));
    expect(generateNext).toHaveBeenCalledWith(expect.any(Request));
    expect(responses.map((response) => [
      response.headers.get('x-mahoshojo-arena-companion-operation'),
      response.headers.get('x-mahoshojo-arena-execution-placement'),
    ])).toEqual([
      ['arena/generate', 'next-dr'],
      ['generate-battle-story', 'next-dr'],
      ['arena/repair-combatant-meta', 'next-dr'],
      ['arena/session/generate-next', 'next-dr'],
    ]);
  });
});
