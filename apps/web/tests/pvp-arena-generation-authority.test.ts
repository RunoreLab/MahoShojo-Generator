import { describe, expect, it, vi } from 'vitest';

const { sign, signPvp } = vi.hoisted(() => ({
  sign: vi.fn(async () => 'trusted-guidance-signature'),
  signPvp: vi.fn(async () => 'trusted-pvp-signature'),
}));

vi.mock('@mahoshojo/hosted-runtime/arena-generation', async (importOriginal) => {
  const original = await importOriginal<typeof import('@mahoshojo/hosted-runtime/arena-generation')>();
  return {
    ...original,
    createArenaInternalGuidanceAuthority: () => ({ sign }),
    createArenaPvpGenerationAuthority: () => ({ sign: signPvp }),
  };
});

import { createPvpArenaGenerationAuthority } from '@/lib/pvp/generation-authority';

describe('PVP Arena generation authority', () => {
  it('相同逻辑 attempt 产生稳定 identity 并签名服务器内部引导', async () => {
    const first = await createPvpArenaGenerationAuthority({
      roomId: 'room-1',
      matchId: 'match-1',
      roundId: 'round-1',
      attempt: 0,
      internalGuidance: '服务器裁判规则',
      payload: { combatants: ['A', 'B'], mode: 'classic' },
    });
    const second = await createPvpArenaGenerationAuthority({
      roomId: 'room-1',
      matchId: 'match-1',
      roundId: 'round-1',
      attempt: 0,
      internalGuidance: '服务器裁判规则',
      payload: { combatants: ['A', 'B'], mode: 'classic' },
    });
    const retry = await createPvpArenaGenerationAuthority({
      roomId: 'room-1',
      matchId: 'match-1',
      roundId: 'round-1',
      attempt: 1,
      internalGuidance: '服务器裁判规则',
      payload: { combatants: ['A', 'B'], mode: 'classic' },
    });

    expect(first.generationRequestId).toBe(second.generationRequestId);
    expect(first.generationRequestId).toMatch(/^pvp_[a-f0-9]{64}$/u);
    expect(retry.generationRequestId).not.toBe(first.generationRequestId);
    expect(first.headers).toEqual({
      'x-mahoshojo-arena-internal-guidance-signature': 'trusted-guidance-signature',
      'x-mahoshojo-arena-pvp-generation-signature': 'trusted-pvp-signature',
    });
    expect(signPvp).toHaveBeenCalledWith({
      generationRequestId: first.generationRequestId,
      payload: {
        combatants: ['A', 'B'],
        mode: 'classic',
        internalGuidance: '服务器裁判规则',
        pvpContext: { roomId: 'room-1', matchId: 'match-1', roundId: 'round-1' },
      },
    });
  });
});
