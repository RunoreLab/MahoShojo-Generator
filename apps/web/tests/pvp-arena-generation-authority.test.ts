import { describe, expect, it, vi } from 'vitest';

const { sign } = vi.hoisted(() => ({
  sign: vi.fn(async () => 'trusted-guidance-signature'),
}));

vi.mock('@mahoshojo/hosted-runtime/arena-generation', async (importOriginal) => {
  const original = await importOriginal<typeof import('@mahoshojo/hosted-runtime/arena-generation')>();
  return {
    ...original,
    createArenaInternalGuidanceAuthority: () => ({ sign }),
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
    });
    const second = await createPvpArenaGenerationAuthority({
      roomId: 'room-1',
      matchId: 'match-1',
      roundId: 'round-1',
      attempt: 0,
      internalGuidance: '服务器裁判规则',
    });
    const retry = await createPvpArenaGenerationAuthority({
      roomId: 'room-1',
      matchId: 'match-1',
      roundId: 'round-1',
      attempt: 1,
      internalGuidance: '服务器裁判规则',
    });

    expect(first.generationRequestId).toBe(second.generationRequestId);
    expect(first.generationRequestId).toMatch(/^pvp_[a-f0-9]{64}$/u);
    expect(retry.generationRequestId).not.toBe(first.generationRequestId);
    expect(first.headers).toEqual({
      'x-mahoshojo-arena-internal-guidance-signature': 'trusted-guidance-signature',
    });
  });
});
