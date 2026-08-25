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
  storeOutput: vi.fn(async () => ({ resultRef: null })),
  claimTerminal: vi.fn(async () => ({ kind: 'created' as const, resultRef: null })),
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
    && (value as { signature?: unknown }).signature === 'valid'
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
    expect(safetyPayloads[0]?.internalGuidance).toBeUndefined();
    expect(JSON.stringify(prepared.semanticPayload)).not.toContain('secret-value');
    expect(JSON.stringify(prepared.semanticPayload)).not.toContain('__arenaServerContextV1');
    expect(prepared.executionPayload.__arenaServerContextV1).toEqual(expect.objectContaining({
      ipAnonymized: '192.0.2.0',
    }));

    const controller = new AbortController();
    const terminal = await executor.execute({
      generationId: 'generation-1',
      generationRequestId: 'request-1',
      actorKey: 'anonymous:test',
      payload: prepared.executionPayload,
      signal: controller.signal,
      emit: vi.fn(async () => undefined),
    });
    expect(terminal.status).toBe('completed');
    expect(generateWithStreamAI).toHaveBeenCalledTimes(1);
  });
});
