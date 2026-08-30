import { describe, expect, it, vi } from 'vitest';

import {
  createArenaGenerationFinalizer,
  type ArenaGenerationFinalizationPorts,
} from '../src/arena-generation/finalization';

const input = {
  generationId: 'generation-1',
  generationRequestId: 'request-1',
  payloadHash: 'payload-hash-1',
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
    finalized: false,
  })),
  completeTerminal: vi.fn(async () => undefined),
  failTerminal: vi.fn(async () => undefined),
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
        return {
          kind: 'created' as const,
          resultRef: 'r2://battle/generation-1',
          finalized: false,
        };
      }),
      persistCombatants: vi.fn(async () => { order.push('combatants'); }),
      applyStoryImpacts: vi.fn(async () => { order.push('impacts'); }),
      settleRatings: vi.fn(async () => { order.push('ratings'); }),
      completeTerminal: vi.fn(async () => { order.push('complete'); }),
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

    expect(order).toEqual([
      'r2', 'claim', 'combatants', 'impacts', 'ratings', 'complete', 'ranking',
    ]);
    expect(ports.claimTerminal).toHaveBeenCalledWith(expect.objectContaining({
      generationId: 'generation-1',
      generationRequestId: 'request-1',
      status: 'completed',
      resultRef: 'r2://battle/generation-1',
    }));
    expect(ports.persistCombatants).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: 'arena-terminal:generation-1:combatants',
    }));
    expect(ports.applyStoryImpacts).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: 'arena-terminal:generation-1:story-impacts',
    }));
    expect(ports.settleRatings).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: 'arena-terminal:generation-1:ratings',
    }));
  });

  it('按输出契约为 R2 标注 Markdown 或 structured JSON', async () => {
    const markdownPorts = createPorts();
    await createArenaGenerationFinalizer(markdownPorts)(input);
    expect(markdownPorts.storeOutput).toHaveBeenCalledWith(expect.objectContaining({
      contentType: 'text/markdown; charset=utf-8',
    }));

    const structuredPorts = createPorts();
    await createArenaGenerationFinalizer(structuredPorts)({
      ...input,
      metadata: { ...input.metadata, outputContract: 'structured-report' },
      markdown: JSON.stringify({ headline: '结构化战报' }),
    });
    expect(structuredPorts.storeOutput).toHaveBeenCalledWith(expect.objectContaining({
      contentType: 'application/json; charset=utf-8',
    }));
  });

  it('重复 terminal claim 只读取已有结果，不重复业务副作用', async () => {
    const ports = createPorts({
      claimTerminal: vi.fn(async () => ({
        kind: 'existing' as const,
        resultRef: 'r2://battle/existing',
        finalized: true,
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
    const failedPorts = createPorts({
      storeOutput: vi.fn(async () => { throw new Error('r2-secret-canary'); }),
    });
    const failed = createArenaGenerationFinalizer(failedPorts, {
      observer: { observeArenaGeneration },
    });
    await expect(failed(input)).rejects.toThrow('r2-secret-canary');
    expect(observeArenaGeneration).toHaveBeenCalledWith(expect.objectContaining({
      event: 'storage',
      storage: 'r2',
      outcome: 'failure',
      generationId: 'generation-1',
    }));
    expect(JSON.stringify(observeArenaGeneration.mock.calls)).not.toContain('r2-secret-canary');
    expect(failedPorts.storeOutput).toHaveBeenCalledTimes(3);
    expect(failedPorts.claimTerminal).toHaveBeenCalledWith(expect.objectContaining({
      generationId: input.generationId,
      status: 'failed',
      errorCode: 'ARENA_R2_STORAGE_FAILED',
      resultRef: null,
      markdown: '',
    }));
    expect(JSON.stringify(vi.mocked(failedPorts.claimTerminal).mock.calls)).not.toContain(
      input.markdown,
    );
    expect(failedPorts.completeTerminal).toHaveBeenCalledOnce();
    expect(failedPorts.settleRatings).not.toHaveBeenCalled();
  });

  it('retries a transient post-claim failure through the idempotent D1 terminal claim', async () => {
    const applyStoryImpacts = vi.fn()
      .mockRejectedValueOnce(new Error('D1_TRANSIENT'))
      .mockResolvedValueOnce(undefined);
    const ports = createPorts({ applyStoryImpacts });
    const finalize = createArenaGenerationFinalizer(ports);

    await expect(finalize(input)).resolves.toEqual({
      resultRef: 'r2://battle/generation-1',
      ranking: { success: true },
    });
    expect(ports.claimTerminal).toHaveBeenCalledTimes(2);
    expect(applyStoryImpacts).toHaveBeenCalledTimes(2);
    expect(applyStoryImpacts.mock.calls[0]?.[0]).toMatchObject({
      idempotencyKey: 'arena-terminal:generation-1:story-impacts',
    });
    expect(applyStoryImpacts.mock.calls[1]?.[0]).toMatchObject({
      idempotencyKey: 'arena-terminal:generation-1:story-impacts',
    });
    expect(ports.completeTerminal).toHaveBeenCalledTimes(1);
  });

  it.each(['completed', 'failed', 'cancelled'] as const)(
    '%s terminal 在 post-claim finalization 重试耗尽后保留真实终态并保持 pending',
    async (status) => {
      const failure = new Error('D1_POST_CLAIM_UNAVAILABLE');
      const ports = createPorts({
        persistCombatants: vi.fn(async () => { throw failure; }),
      });
      const finalize = createArenaGenerationFinalizer(ports);

      await expect(finalize({
        ...input,
        status,
        errorCode: status === 'completed' ? null : `GENERATION_${status.toUpperCase()}`,
      })).rejects.toThrow('D1_POST_CLAIM_UNAVAILABLE');
      expect(ports.claimTerminal).toHaveBeenCalledTimes(3);
      expect(ports.failTerminal).not.toHaveBeenCalled();
      expect(ports.completeTerminal).not.toHaveBeenCalled();
    },
  );

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
