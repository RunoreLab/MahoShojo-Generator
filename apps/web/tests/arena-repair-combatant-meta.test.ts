import { readFileSync } from 'node:fs';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const repairCombatantMeta = vi.fn();

vi.mock('@/app/api/arena/companion-runtime', () => ({
  getCloudflareDrArenaCompanionService: () => ({ repairCombatantMeta }),
}));

const { appRouteHandler } = await import(
  '@/app/api/arena/repair-combatant-meta/handler'
);

describe('Next Arena repair metadata adapter', () => {
  beforeEach(() => {
    repairCombatantMeta.mockReset().mockResolvedValue(new Response('repaired'));
  });

  it('只委托 shared DR service，并标记准确 operation 与 placement', async () => {
    const request = new Request(
      'https://example.test/api/arena/repair-combatant-meta',
      { method: 'POST' },
    );

    const response = await appRouteHandler(request as never);

    expect(repairCombatantMeta).toHaveBeenCalledOnce();
    expect(repairCombatantMeta).toHaveBeenCalledWith(request);
    expect(response.headers.get('x-mahoshojo-arena-companion-operation'))
      .toBe('arena/repair-combatant-meta');
    expect(response.headers.get('x-mahoshojo-arena-execution-placement'))
      .toBe('next-dr');
    await expect(response.text()).resolves.toBe('repaired');
  });

  it('adapter 不再 composition Web AI runtime 或独立安全策略', () => {
    const handlerSource = readFileSync(
      'app/api/arena/repair-combatant-meta/handler.ts',
      'utf8',
    );
    expect(handlerSource).not.toContain('@/lib/ai');
    expect(handlerSource).not.toContain('generateWithAI');
    expect(handlerSource).not.toContain('quickCheck');
    expect(handlerSource).not.toContain('verifySignature');
  });
});
