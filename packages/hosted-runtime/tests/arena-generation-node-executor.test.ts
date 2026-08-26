import { describe, expect, it, vi } from 'vitest';

import { createArenaGenerationFinalizer } from '../src/arena-generation/finalization';
import { createNodeArenaGenerationExecutor } from '../src/arena-generation/node-executor';
import type { SignatureService } from '../src/signature';

const validPayload = {
  combatants: [
    { type: 'magical-girl', isNative: true, data: { name: 'A' } },
    { type: 'magical-girl', isNative: true, data: { name: 'B', signature: 'valid' } },
  ],
  mode: 'classic',
  internalGuidance: 'browser supplied authority',
};

const finalizer = createArenaGenerationFinalizer({
  storeOutput: vi.fn(async () => ({ resultRef: 'r2://test/output' })),
  claimTerminal: vi.fn(async () => ({
    kind: 'created' as const,
    resultRef: 'r2://test/output',
    finalized: false,
  })),
  completeTerminal: vi.fn(async () => undefined),
  failTerminal: vi.fn(async () => undefined),
  persistCombatants: vi.fn(async () => undefined),
  applyStoryImpacts: vi.fn(async () => undefined),
  settleRatings: vi.fn(async () => undefined),
  readRanking: vi.fn(async () => null),
});

const signatureService: SignatureService = {
  generateSignature: vi.fn(async () => 'generated'),
  verifySignature: vi.fn(async (value) => (
    Boolean(value)
    && typeof value === 'object'
    && ['valid', 'generated'].includes(String((value as { signature?: unknown }).signature ?? ''))
  )),
};

describe('Node Arena generation executor', () => {
  it('preserves the configured AI safety gate before reservation', async () => {
    const generateWithStreamAI = vi.fn();
    const generateWithStructuredAI = vi.fn(async () => ({
      isUnsafe: true,
      reason: 'test-policy',
    }));
    const executor = createNodeArenaGenerationExecutor({
      env: {
        NEXT_PUBLIC_ENABLE_SENSITIVE_WORD_FILTER: 'false',
        NEXT_PUBLIC_ENABLE_AI_SAFETY_CHECK: 'true',
      },
      finalizer,
      signatureService,
      generateWithStructuredAI,
      generateWithStreamAI,
    });

    const result = await executor.prepare!({
      request: new Request('https://example.test/api/arena/generate-stream'),
      actorKey: 'anonymous:test',
      payload: validPayload,
    });

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(400);
    expect(generateWithStructuredAI).toHaveBeenCalledTimes(1);
    expect(generateWithStreamAI).not.toHaveBeenCalled();
  });

  it('fail-closes invalid custom provider before reservation/provider dispatch', async () => {
    const generateWithStreamAI = vi.fn();
    const executor = createNodeArenaGenerationExecutor({
      env: {},
      finalizer,
      signatureService,
      enforceSafety: vi.fn(async () => null),
      generateWithStreamAI,
    });

    const result = await executor.prepare!({
      request: new Request('https://example.test/api/arena/generate-stream', {
        headers: { 'cf-connecting-ip': '192.0.2.44' },
      }),
      actorKey: 'anonymous:test',
      payload: {
        ...validPayload,
        customProvider: {
          providerId: 'unknown',
          modelId: 'model',
          apiKey: 'secret',
        },
      },
    });

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(400);
    expect(generateWithStreamAI).not.toHaveBeenCalled();
  });

  it('does not trust client native/internal fields and keeps BYOK only at provider boundary', async () => {
    const safetyPayloads: Array<Record<string, unknown>> = [];
    const generateWithStreamAI = vi.fn(async (_config, options) => {
      expect(options.providerOverride.apiKey).toBe('secret-value');
      expect(options.abortSignal).toBeInstanceOf(AbortSignal);
      return {
        response: new Response('body'),
        telemetry: options.telemetry,
        usagePromise: Promise.resolve({ totalTokens: 9 }),
        finishReasonPromise: Promise.resolve('stop'),
      };
    });
    const executor = createNodeArenaGenerationExecutor({
      env: {},
      finalizer,
      signatureService,
      enforceSafety: vi.fn(async ({ payload }) => {
        safetyPayloads.push(payload);
        return null;
      }),
      generateWithStreamAI,
    });
    const prepared = await executor.prepare!({
      request: new Request('https://example.test/api/arena/generate-stream', {
        headers: { 'cf-connecting-ip': '192.0.2.44' },
      }),
      actorKey: 'anonymous:test',
      payload: {
        ...validPayload,
        customProvider: {
          providerId: 'chatbox',
          modelId: 'gpt-5.4',
          apiKey: 'secret-value',
        },
      },
    });

    expect(prepared).not.toBeInstanceOf(Response);
    if (prepared instanceof Response) throw new Error('unexpected response');
    const combatants = safetyPayloads[0]?.combatants as Array<{ isNative: boolean }>;
    expect(combatants.map((item) => item.isNative)).toEqual([false, true]);
    expect(signatureService.generateSignature).not.toHaveBeenCalled();
    expect(safetyPayloads[0]?.internalGuidance).toBeUndefined();
    expect(JSON.stringify(prepared.semanticPayload)).not.toContain('secret-value');
    expect(JSON.stringify(prepared.semanticPayload)).not.toContain('__arenaServerContextV1');
    expect(prepared.executionPayload.__arenaServerContextV1).toEqual(expect.objectContaining({
      ipAnonymized: '192.0.2.0',
      endpoint: 'api/arena/generate-stream',
      deliveryMode: 'stream',
    }));

    const controller = new AbortController();
    const terminal = await executor.execute({
      generationId: 'generation-1',
      generationRequestId: 'request-1',
      actorKey: 'anonymous:test',
      producerToken: 'producer-token-1',
      payloadHash: 'payload-hash-1',
      payload: prepared.executionPayload,
      signal: controller.signal,
      emit: vi.fn(async () => undefined),
      claimFinalization: vi.fn(async () => ({ kind: 'claimed' as const })),
    });
    expect(terminal.status).toBe('completed');
    expect(generateWithStreamAI).toHaveBeenCalledTimes(1);
  });

  it('normalizes raw Arena materials before safety and prompt construction', async () => {
    const safetyPayloads: Array<Record<string, unknown>> = [];
    const executor = createNodeArenaGenerationExecutor({
      env: {},
      finalizer,
      signatureService,
      enforceSafety: vi.fn(async ({ payload }) => {
        safetyPayloads.push(payload);
        return null;
      }),
      generateWithStreamAI: vi.fn(),
    });

    const prepared = await executor.prepare!({
      request: new Request('https://example.test/api/arena/generate-stream'),
      actorKey: 'anonymous:test',
      payload: {
        ...validPayload,
        materials: [
          {
            templateId: '通用情景',
            title: '雨夜站台',
            content: '末班车停靠。',
            _cardId: 'card-1',
            _cardName: '雨夜站台卡',
            _updatedAt: '2026-08-25T04:00:00.000Z',
          },
          'primitive material',
          { cardKind: 'lore', name: 'Wantu lore', content: 'world setting' },
        ],
      },
    });

    expect(prepared).not.toBeInstanceOf(Response);
    const materials = safetyPayloads[0]?.materials as Array<Record<string, unknown>>;
    expect(materials).toEqual([
      expect.objectContaining({
        name: '雨夜站台卡',
        sourceKind: 'mahoshojo-data-card',
        sourceType: '通用情景',
        sourceDataCardId: 'card-1',
        sourceDataCardUpdatedAt: '2026-08-25T04:00:00.000Z',
        content: {
          templateId: '通用情景',
          title: '雨夜站台',
          content: '末班车停靠。',
        },
      }),
      expect.objectContaining({
        name: '未命名素材',
        sourceKind: 'raw-json',
        sourceType: 'raw-json',
        content: 'primitive material',
      }),
      expect.objectContaining({
        name: 'Wantu lore',
        sourceKind: 'wantu-card',
        sourceType: 'lore',
        content: expect.objectContaining({ content: 'world setting' }),
      }),
    ]);
  });

  it('在 reservation 前拒绝超过 companion 兼容上限的辅助情景与素材', async () => {
    const executor = createNodeArenaGenerationExecutor({
      env: {},
      finalizer,
      signatureService,
      enforceSafety: vi.fn(async () => null),
      generateWithStreamAI: vi.fn(),
    });
    const tooManyAux = await executor.prepare!({
      request: new Request('https://example.test/api/generate-battle-story'),
      actorKey: 'anonymous:test',
      payload: { ...validPayload, auxScenarios: Array.from({ length: 11 }, () => ({})) },
    });
    const tooManyMaterials = await executor.prepare!({
      request: new Request('https://example.test/api/arena/generate'),
      actorKey: 'anonymous:test',
      payload: { ...validPayload, materials: Array.from({ length: 11 }, () => ({})) },
    });

    expect(tooManyAux).toBeInstanceOf(Response);
    expect((tooManyAux as Response).status).toBe(400);
    expect(await (tooManyAux as Response).json()).toMatchObject({
      code: 'ARENA_AUX_SCENARIOS_LIMIT',
    });
    expect(tooManyMaterials).toBeInstanceOf(Response);
    expect((tooManyMaterials as Response).status).toBe(400);
    expect(await (tooManyMaterials as Response).json()).toMatchObject({
      code: 'ARENA_MATERIALS_LIMIT',
    });
  });

  it('uses the strict-ranked model fallback order until a provider attempt succeeds', async () => {
    const generateWithStreamAI = vi.fn()
      .mockRejectedValueOnce(new Error('first model unavailable'))
      .mockResolvedValueOnce({ response: new Response('body') });
    const executor = createNodeArenaGenerationExecutor({
      env: {},
      finalizer,
      signatureService,
      enforceSafety: vi.fn(async () => null),
      generateWithStreamAI,
    });
    const prepared = await executor.prepare!({
      request: new Request('https://example.test/api/arena/generate-stream'),
      actorKey: 'anonymous:test',
      payload: {
        ...validPayload,
        internalGuidance: undefined,
        readArenaHistory: false,
        readCurrentState: false,
        readNarrativeHistory: false,
        writeArenaHistory: false,
        writeCurrentState: false,
      },
    });
    if (prepared instanceof Response) throw new Error('unexpected response');

    const terminal = await executor.execute({
      generationId: 'generation-strict',
      generationRequestId: 'request-strict',
      actorKey: 'anonymous:test',
      producerToken: 'producer-token-strict',
      payloadHash: 'payload-hash-strict',
      payload: prepared.executionPayload,
      signal: new AbortController().signal,
      emit: vi.fn(async () => undefined),
      claimFinalization: vi.fn(async () => ({ kind: 'claimed' as const })),
    });

    expect(terminal.status).toBe('completed');
    expect(generateWithStreamAI).toHaveBeenCalledTimes(2);
    expect(generateWithStreamAI.mock.calls.map(([config]) => config.modelOverride)).toEqual([
      'gemma-4-31b-it',
      'gemma-3-27b-it',
    ]);
  });
});
