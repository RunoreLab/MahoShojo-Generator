import { describe, expect, it, vi } from 'vitest';

import {
  createArenaGenerationFinalizer,
  type ArenaGenerationFinalizationPorts,
} from '../src/arena-generation/finalization';

const input = {
  generationId: 'generation-1',
  generationRequestId: 'request-1',
  actorKey: 'user:42',
  payload: {
    combatants: [{ data: { name: 'A' } }, { data: { name: 'B' } }],
  },
  metadata: {
    mode: 'classic',
    streamMeta: { report: { winner: 'A' } },
  },
  markdown: '完整正文',
  telemetry: { model: 'model-1' },
  status: 'completed' as const,
  errorCode: null,
  signal: new AbortController().signal,
};

const createPorts = (
  overrides: Partial<ArenaGenerationFinalizationPorts> = {},
): ArenaGenerationFinalizationPorts => ({
  storeOutput: vi.fn(async () => ({ resultRef: 'r2://battle/generation-1' })),
  claimTerminal: vi.fn(async (claim) => ({
    kind: 'created' as const,
    resultRef: claim.resultRef,
  })),
  persistCombatants: vi.fn(async () => undefined),
  applyStoryImpacts: vi.fn(async () => undefined),
  settleRatings: vi.fn(async () => undefined),
  readRanking: vi.fn(async () => ({ success: true })),
  ...overrides,
});

describe('Arena generation finalization', () => {
  it('D1 terminal claim 是 rating/history 等权威副作用的唯一门禁', async () => {
    const order: string[] = [];
    const ports = createPorts({
      storeOutput: vi.fn(async () => {
        order.push('r2');
        return { resultRef: 'r2://battle/generation-1' };
      }),
      claimTerminal: vi.fn(async () => {
        order.push('claim');
        return { kind: 'created' as const, resultRef: 'r2://battle/generation-1' };
      }),
      persistCombatants: vi.fn(async () => { order.push('combatants'); }),
      applyStoryImpacts: vi.fn(async () => { order.push('impacts'); }),
      settleRatings: vi.fn(async () => { order.push('ratings'); }),
      readRanking: vi.fn(async () => {
        order.push('ranking');
        return { success: true };
      }),
    });
    const finalize = createArenaGenerationFinalizer(ports);

    await expect(finalize(input)).resolves.toEqual({
      resultRef: 'r2://battle/generation-1',
      ranking: { success: true },
    });

    expect(order).toEqual(['r2', 'claim', 'combatants', 'impacts', 'ratings', 'ranking']);
    expect(ports.claimTerminal).toHaveBeenCalledWith(expect.objectContaining({
      generationId: 'generation-1',
      generationRequestId: 'request-1',
      status: 'completed',
      resultRef: 'r2://battle/generation-1',
    }));
  });

  it('重复 terminal claim 只读取已有结果，不重复业务副作用', async () => {
    const ports = createPorts({
      claimTerminal: vi.fn(async () => ({
        kind: 'existing' as const,
        resultRef: 'r2://battle/existing',
      })),
      readRanking: vi.fn(async () => ({ success: true, cached: true })),
    });
    const finalize = createArenaGenerationFinalizer(ports);

    await expect(finalize(input)).resolves.toEqual({
      resultRef: 'r2://battle/existing',
      ranking: { success: true, cached: true },
    });

    expect(ports.persistCombatants).not.toHaveBeenCalled();
    expect(ports.applyStoryImpacts).not.toHaveBeenCalled();
    expect(ports.settleRatings).not.toHaveBeenCalled();
    expect(ports.readRanking).toHaveBeenCalledTimes(1);
  });

  it('R2 output success/failure 只报告低基数结果与字节数', async () => {
    const observeArenaGeneration = vi.fn();
    const successful = createArenaGenerationFinalizer(createPorts(), {
      observer: { observeArenaGeneration },
    });
    await successful(input);
    expect(observeArenaGeneration).toHaveBeenCalledWith(expect.objectContaining({
      event: 'storage',
      storage: 'r2',
      outcome: 'success',
      generationId: 'generation-1',
      bytes: new TextEncoder().encode(input.markdown).byteLength,
      durationMs: expect.any(Number),
    }));

    observeArenaGeneration.mockClear();
    const failed = createArenaGenerationFinalizer(createPorts({
      storeOutput: vi.fn(async () => { throw new Error('r2-secret-canary'); }),
    }), { observer: { observeArenaGeneration } });
    await failed(input);
    expect(observeArenaGeneration).toHaveBeenCalledWith(expect.objectContaining({
      event: 'storage',
      storage: 'r2',
      outcome: 'failure',
      generationId: 'generation-1',
    }));
    expect(JSON.stringify(observeArenaGeneration.mock.calls)).not.toContain('r2-secret-canary');
  });

  it.each(['failed', 'cancelled'] as const)(
    '%s 终态不写 completed R2、rating 或 story impacts',
    async (status) => {
      const ports = createPorts();
      const finalize = createArenaGenerationFinalizer(ports);

      await finalize({
        ...input,
        status,
        errorCode: status === 'cancelled' ? 'USER_CANCELLED' : 'GENERATION_FAILED',
      });

      expect(ports.storeOutput).not.toHaveBeenCalled();
      expect(ports.applyStoryImpacts).not.toHaveBeenCalled();
      expect(ports.settleRatings).not.toHaveBeenCalled();
      expect(ports.readRanking).not.toHaveBeenCalled();
      expect(ports.claimTerminal).toHaveBeenCalledTimes(1);
    },
  );
});
