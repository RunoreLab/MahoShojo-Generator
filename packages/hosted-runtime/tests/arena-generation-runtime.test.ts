import { describe, expect, it, vi } from 'vitest';
import { createMemoryGenerationReplayStore } from '@mahoshojo/hosted-api/arena-generation/memory-replay-store';
import {
  ArenaGenerationFinalizationPendingError,
  createArenaGenerationService,
} from '@mahoshojo/hosted-api/arena-generation/service';

import {
  createArenaGenerationRuntime,
  MAX_ARENA_COMBATANTS,
  type ArenaGenerationRuntimeDependencies,
} from '../src/arena-generation/runtime';
import { buildArenaGenerationPrompt } from '../src/arena-generation/prompt';

const payload = {
  combatants: [
    { type: 'magical-girl', data: { name: 'A' }, isNative: true },
    { type: 'magical-girl', data: { name: 'B' }, isNative: true },
  ],
  mode: 'classic',
  customProvider: {
    providerId: 'openai',
    modelId: 'model-1',
    apiKey: 'byok-secret',
  },
};

const stream = (...chunks: string[]): ReadableStream<Uint8Array> => {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const chunk of chunks) {
        await Promise.resolve();
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
};

const createDependencies = (
  overrides: Partial<ArenaGenerationRuntimeDependencies> = {},
): ArenaGenerationRuntimeDependencies => ({
  checkSafety: vi.fn(async () => null),
  buildPrompt: vi.fn(async () => ({
    prompt: 'system\n\nuser',
    metadata: { mode: 'classic' },
  })),
  generate: vi.fn(async () => ({
    body: stream('first', ' second'),
    telemetry: { model: 'model-1' },
  })),
  finalize: vi.fn(async () => ({
    resultRef: 'r2://battle/generation-1',
    ranking: { success: true },
  })),
  ...overrides,
});

describe('Arena generation runtime', () => {
  it('materializes adjudication and prompt deterministically from the reserved seed', async () => {
    const buildPrompt = vi.fn(async ({ payload: input, random }) => ({
      prompt: `prompt:${JSON.stringify(input.adjudicationResults)}:${random()}`,
      metadata: {
        adjudicationResults: input.adjudicationResults,
        reporterInfo: { name: `reporter-${random()}`, publication: 'test' },
      },
    }));
    const dependencies = createDependencies({ buildPrompt });
    const runtime = createArenaGenerationRuntime(dependencies);
    const request = new Request('https://example.test/api/arena/generate-stream');
    const preflight = await runtime.preflight!({
      request,
      actorKey: 'user:42',
      payload: {
        ...payload,
        adjudicationEvents: [{
          type: 'binary',
          description: 'seeded event',
          probability: 50,
        }],
      },
    });
    if (preflight instanceof Response) throw new Error('unexpected response');
    expect(buildPrompt).not.toHaveBeenCalled();

    const materialize = (preparationSeed: string) => runtime.materialize!({
      request,
      actorKey: 'user:42',
      payload: preflight.materializationPayload,
      preparationSeed,
      preparationVersion: runtime.materializationVersion!,
    });
    const first = await materialize('11'.repeat(32));
    const second = await materialize('11'.repeat(32));
    const different = await materialize('22'.repeat(32));
    if (first instanceof Response || second instanceof Response || different instanceof Response) {
      throw new Error('unexpected response');
    }

    expect(first).toEqual(second);
    expect(first).not.toEqual(different);
    expect(first.responseHeaders?.['X-Mahoshojo-Stream-Meta']).toBe(
      second.responseHeaders?.['X-Mahoshojo-Stream-Meta'],
    );
    expect(JSON.stringify(preflight.semanticPayload)).not.toContain('byok-secret');
    expect(JSON.stringify(first.executionPayload)).toContain('byok-secret');
  });

  it('keeps reused response metadata aligned with the one real Provider prompt', async () => {
    const prompts: string[] = [];
    const runtime = createArenaGenerationRuntime(createDependencies({
      buildPrompt: buildArenaGenerationPrompt,
      generate: vi.fn(async ({ prompt }) => {
        prompts.push(prompt);
        return { body: stream('battle body'), telemetry: {} };
      }),
    }));
    const store = createMemoryGenerationReplayStore();
    const service = createArenaGenerationService({
      store,
      executor: runtime,
      resolveActor: async () => ({ actorKey: 'user:42' }),
      deriveGenerationId: async () => 'generation-seeded-integration',
      hashPayload: async (input) => `hash:${JSON.stringify(input)}`,
      now: () => new Date('2026-08-25T04:00:00.000Z'),
      heartbeatIntervalMs: 60_000,
      leaseDurationMs: 120_000,
      replayPollMs: 1,
    });
    const createRequest = () => new Request(
      'https://example.test/api/arena/generate-stream?format=sse',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          generationRequestId: 'request-seeded-integration',
          ...payload,
          adjudicationEvents: [{
            type: 'binary',
            description: 'integration roll',
            probability: 50,
          }],
        }),
      },
    );

    const first = await service.create(createRequest());
    const firstHeader = first.headers.get('x-mahoshojo-stream-meta');
    await first.body?.cancel('simulate lost initial response');
    const reused = await service.create(createRequest());
    const reusedHeader = reused.headers.get('x-mahoshojo-stream-meta');
    await reused.text();

    expect(firstHeader).not.toBeNull();
    expect(reusedHeader).toBe(firstHeader);
    expect(prompts).toHaveLength(1);
    const metadata = JSON.parse(decodeURIComponent(reusedHeader!)) as {
      adjudicationResults: Array<{
        description: string;
        outcome: string;
        details: string;
      }>;
      reporterInfo: { name: string; publication: string };
    };
    expect(metadata.reporterInfo.name).toBeTruthy();
    expect(metadata.reporterInfo.publication).toBeTruthy();
    expect(metadata.adjudicationResults).toHaveLength(1);
    expect(prompts[0]).toContain(metadata.adjudicationResults[0]!.description);
    expect(prompts[0]).toContain(metadata.adjudicationResults[0]!.outcome);
    expect(prompts[0]).toContain(metadata.adjudicationResults[0]!.details);
    expect(JSON.stringify(await store.readState({
      generationId: 'generation-seeded-integration',
      actorKey: 'user:42',
    }))).not.toMatch(/byok-secret|以下是登场角色/u);
  });

  it('在 hash 与执行前只接受 server-authorized internal guidance', async () => {
    const preparedPayloads: Array<Record<string, unknown>> = [];
    const dependencies = createDependencies({
      preparePayload: vi.fn(async ({ payload: input }) => ({
        ...input,
        internalGuidance: 'server-authorized rule',
      })),
      buildPrompt: vi.fn(async ({ payload: input }) => {
        preparedPayloads.push(input);
        return { prompt: 'prompt', metadata: {} };
      }),
    });
    const runtime = createArenaGenerationRuntime(dependencies);
    const prepared = await runtime.prepare!({
      request: new Request('https://example.test/api/arena/generate-stream'),
      actorKey: 'user:42',
      payload: {
        ...payload,
        combatants: [
          { type: 'magical-girl', data: { name: 'A', signature: 'generated' } },
          { type: 'magical-girl', data: { name: 'B' } },
        ],
        internalGuidance: 'untrusted rule',
      },
    });

    expect(prepared).not.toBeInstanceOf(Response);
    if (prepared instanceof Response) throw new Error('unexpected response');
    expect(prepared.semanticPayload).toMatchObject({
      internalGuidance: 'server-authorized rule',
      combatants: [
        { data: { name: 'A' } },
        { data: { name: 'B' } },
      ],
    });
    expect(JSON.stringify(prepared.semanticPayload)).not.toContain('generated');
    expect(JSON.stringify(prepared.semanticPayload)).not.toContain('byok-secret');
    expect(JSON.stringify(prepared.executionPayload)).toContain('byok-secret');
    expect(preparedPayloads[0]?.internalGuidance).toBe('server-authorized rule');
  });

  it('在 reservation 前完成 schema/safety，并从 semantic hash payload 排除 BYOK secret', async () => {
    const dependencies = createDependencies();
    const runtime = createArenaGenerationRuntime(dependencies);
    const prepared = await runtime.prepare!({
      request: new Request('https://example.test/api/arena/generate-stream'),
      actorKey: 'user:42',
      payload,
    });

    expect(prepared).not.toBeInstanceOf(Response);
    if (prepared instanceof Response) throw new Error('unexpected response');
    expect(dependencies.checkSafety).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(prepared.semanticPayload)).not.toContain('byok-secret');
    expect(JSON.stringify(prepared.executionPayload)).toContain('byok-secret');
  });

  it('invalid Arena payload 在 safety/provider 之前返回兼容 400', async () => {
    const dependencies = createDependencies();
    const runtime = createArenaGenerationRuntime(dependencies);

    const prepared = await runtime.prepare!({
      request: new Request('https://example.test/api/arena/generate-stream'),
      actorKey: 'user:42',
      payload: { combatants: [] },
    });

    expect(prepared).toBeInstanceOf(Response);
    expect((prepared as Response).status).toBe(400);
    expect(await (prepared as Response).json()).toMatchObject({
      code: 'ARENA_PARTICIPANTS_INVALID',
    });
    expect(dependencies.checkSafety).not.toHaveBeenCalled();
    expect(dependencies.generate).not.toHaveBeenCalled();
  });

  it('rejects an unbounded combatant roster before safety, reservation, or Provider', async () => {
    const dependencies = createDependencies();
    const runtime = createArenaGenerationRuntime(dependencies);

    const prepared = await runtime.prepare!({
      request: new Request('https://example.test/api/arena/generate-stream'),
      actorKey: 'user:42',
      payload: {
        ...payload,
        combatants: Array.from({ length: MAX_ARENA_COMBATANTS + 1 }, (_, index) => ({
          type: 'magical-girl',
          data: { name: `combatant-${index}` },
        })),
      },
    });

    expect(prepared).toBeInstanceOf(Response);
    expect((prepared as Response).status).toBe(413);
    expect(await (prepared as Response).json()).toMatchObject({
      code: 'ARENA_PARTICIPANTS_LIMIT',
    });
    expect(dependencies.checkSafety).not.toHaveBeenCalled();
    expect(dependencies.generate).not.toHaveBeenCalled();
  });

  it('slow Provider stream emits compatible deltas and finalizes exactly once', async () => {
    const dependencies = createDependencies();
    const runtime = createArenaGenerationRuntime(dependencies);
    const prepared = await runtime.prepare!({
      request: new Request('https://example.test/api/arena/generate-stream'),
      actorKey: 'user:42',
      payload,
    });
    if (prepared instanceof Response) throw new Error('unexpected response');
    const emit = vi.fn(async () => undefined);
    const controller = new AbortController();

    const terminal = await runtime.execute({
      generationId: 'generation-1',
      generationRequestId: 'request-1',
      actorKey: 'user:42',
      producerToken: 'producer-token-1',
      payloadHash: 'payload-hash-1',
      payload: prepared.executionPayload,
      signal: controller.signal,
      emit,
      claimFinalization: vi.fn(async () => ({ kind: 'claimed' as const })),
    });

    expect(terminal).toEqual({
      status: 'completed',
      resultRef: 'r2://battle/generation-1',
    });
    expect(emit).toHaveBeenNthCalledWith(1, {
      type: 'markdown',
      data: { chunk: 'first' },
    });
    expect(emit).toHaveBeenNthCalledWith(2, {
      type: 'markdown',
      data: { chunk: ' second' },
    });
    expect(emit).toHaveBeenCalledWith({
      type: 'telemetry',
      data: { model: 'model-1' },
    });
    expect(emit).toHaveBeenCalledWith({
      type: 'ranking',
      data: { success: true },
    });
    expect(dependencies.finalize).toHaveBeenCalledTimes(1);
    expect(dependencies.finalize).toHaveBeenCalledWith(expect.objectContaining({
      generationId: 'generation-1',
      markdown: 'first second',
      status: 'completed',
    }));
  });

  it('observes safety, prompt, Provider and finalization phases with bounded fields', async () => {
    const observeArenaGeneration = vi.fn();
    const dependencies = {
      ...createDependencies(),
      observer: { observeArenaGeneration },
    } as ArenaGenerationRuntimeDependencies;
    const runtime = createArenaGenerationRuntime(dependencies);
    const prepared = await runtime.prepare!({
      request: new Request('https://example.test/api/arena/generate-stream'),
      actorKey: 'user:42',
      payload,
    });
    if (prepared instanceof Response) throw new Error('unexpected response');

    await runtime.execute({
      generationId: 'generation-1',
      generationRequestId: 'request-1',
      actorKey: 'user:42',
      producerToken: 'producer-token-1',
      payloadHash: 'payload-hash-1',
      payload: prepared.executionPayload,
      signal: new AbortController().signal,
      emit: async () => undefined,
      claimFinalization: vi.fn(async () => ({ kind: 'claimed' as const })),
    });

    expect(observeArenaGeneration).toHaveBeenCalledWith(expect.objectContaining({
      event: 'phase', phase: 'safety', outcome: 'success', durationMs: expect.any(Number),
    }));
    expect(observeArenaGeneration).toHaveBeenCalledWith(expect.objectContaining({
      event: 'phase', phase: 'prompt', outcome: 'success', durationMs: expect.any(Number),
    }));
    expect(observeArenaGeneration).toHaveBeenCalledWith(expect.objectContaining({
      event: 'provider', outcome: 'started', generationId: 'generation-1',
    }));
    expect(observeArenaGeneration).toHaveBeenCalledWith(expect.objectContaining({
      event: 'provider', outcome: 'success', durationMs: expect.any(Number),
    }));
    expect(observeArenaGeneration).toHaveBeenCalledWith(expect.objectContaining({
      event: 'phase', phase: 'finalization', outcome: 'success', durationMs: expect.any(Number),
    }));
    expect(JSON.stringify(observeArenaGeneration.mock.calls)).not.toContain('byok-secret');
  });

  it('reasoning callbacks remain ordered before finalization', async () => {
    const dependencies = createDependencies({
      generate: vi.fn(async (input) => {
        await input.onReasoning({ type: 'reasoning-start' });
        await input.onReasoning({ type: 'reasoning-delta', text: '思考' });
        await input.onReasoning({ type: 'reasoning-end' });
        return { body: stream('正文'), telemetry: {} };
      }),
    });
    const runtime = createArenaGenerationRuntime(dependencies);
    const prepared = await runtime.prepare!({
      request: new Request('https://example.test/api/arena/generate-stream'),
      actorKey: 'user:42',
      payload,
    });
    if (prepared instanceof Response) throw new Error('unexpected response');
    const emitted: string[] = [];

    await runtime.execute({
      generationId: 'generation-1',
      generationRequestId: 'request-1',
      actorKey: 'user:42',
      producerToken: 'producer-token-1',
      payloadHash: 'payload-hash-1',
      payload: prepared.executionPayload,
      signal: new AbortController().signal,
      emit: async (event) => { emitted.push(event.type); },
      claimFinalization: vi.fn(async () => ({ kind: 'claimed' as const })),
    });

    expect(emitted).toEqual([
      'reasoning',
      'reasoning',
      'reasoning_done',
      'markdown',
      'telemetry',
      'ranking',
    ]);
  });

  it('does not manufacture a failed terminal when durable finalization remains incomplete', async () => {
    const dependencies = createDependencies({
      finalize: vi.fn(async () => { throw new Error('D1 and R2 unavailable'); }),
    });
    const runtime = createArenaGenerationRuntime(dependencies);
    const prepared = await runtime.prepare!({
      request: new Request('https://example.test/api/arena/generate-stream'),
      actorKey: 'user:42',
      payload,
    });
    if (prepared instanceof Response) throw new Error('unexpected response');

    await expect(runtime.execute({
      generationId: 'generation-1',
      generationRequestId: 'request-1',
      actorKey: 'user:42',
      producerToken: 'producer-token-1',
      payloadHash: 'payload-hash-1',
      payload: prepared.executionPayload,
      signal: new AbortController().signal,
      emit: async () => undefined,
      claimFinalization: vi.fn(async () => ({ kind: 'claimed' as const })),
    })).rejects.toBeInstanceOf(ArenaGenerationFinalizationPendingError);
  });

  it('keeps a Provider failure pending when its durable failed-terminal write is incomplete', async () => {
    const dependencies = createDependencies({
      generate: vi.fn(async () => { throw new Error('Provider process failed'); }),
      finalize: vi.fn(async () => { throw new Error('D1 failed-terminal write unavailable'); }),
    });
    const runtime = createArenaGenerationRuntime(dependencies);
    const prepared = await runtime.prepare!({
      request: new Request('https://example.test/api/arena/generate-stream'),
      actorKey: 'user:42',
      payload,
    });
    if (prepared instanceof Response) throw new Error('unexpected response');

    await expect(runtime.execute({
      generationId: 'generation-1',
      generationRequestId: 'request-1',
      actorKey: 'user:42',
      producerToken: 'producer-token-1',
      payloadHash: 'payload-hash-1',
      payload: prepared.executionPayload,
      signal: new AbortController().signal,
      emit: async () => undefined,
      claimFinalization: vi.fn(async () => ({ kind: 'claimed' as const })),
    })).rejects.toBeInstanceOf(ArenaGenerationFinalizationPendingError);
  });

  it('treats an indeterminate Redis finalization claim as pending instead of failed', async () => {
    const dependencies = createDependencies();
    const runtime = createArenaGenerationRuntime(dependencies);
    const prepared = await runtime.prepare!({
      request: new Request('https://example.test/api/arena/generate-stream'),
      actorKey: 'user:42',
      payload,
    });
    if (prepared instanceof Response) throw new Error('unexpected response');

    await expect(runtime.execute({
      generationId: 'generation-1',
      generationRequestId: 'request-1',
      actorKey: 'user:42',
      producerToken: 'producer-token-1',
      payloadHash: 'payload-hash-1',
      payload: prepared.executionPayload,
      signal: new AbortController().signal,
      emit: async () => undefined,
      claimFinalization: vi.fn(async () => { throw new Error('Redis timeout'); }),
    })).rejects.toBeInstanceOf(ArenaGenerationFinalizationPendingError);
    expect(dependencies.finalize).not.toHaveBeenCalled();
  });

  it.each([
    ['user', 'USER_CANCELLED'],
    ['content_policy', 'CONTENT_POLICY_CANCELLED'],
  ] as const)('explicit %s abort reaches Provider/finalizer as %s', async (reason, code) => {
    const finalize = vi.fn(async () => ({ resultRef: null, ranking: null }));
    const dependencies = createDependencies({
      generate: vi.fn(async ({ signal }) => {
        await new Promise<void>((resolve) => {
          if (signal.aborted) resolve();
          else signal.addEventListener('abort', () => resolve(), { once: true });
        });
        throw new DOMException('aborted', 'AbortError');
      }),
      finalize,
    });
    const runtime = createArenaGenerationRuntime(dependencies);
    const prepared = await runtime.prepare!({
      request: new Request('https://example.test/api/arena/generate-stream'),
      actorKey: 'user:42',
      payload,
    });
    if (prepared instanceof Response) throw new Error('unexpected response');
    const controller = new AbortController();
    const execution = runtime.execute({
      generationId: 'generation-1',
      generationRequestId: 'request-1',
      actorKey: 'user:42',
      producerToken: 'producer-token-1',
      payloadHash: 'payload-hash-1',
      payload: prepared.executionPayload,
      signal: controller.signal,
      emit: async () => undefined,
      claimFinalization: vi.fn(async () => ({ kind: 'claimed' as const })),
    });

    controller.abort(reason);

    await expect(execution).resolves.toMatchObject({ status: 'cancelled', code });
    expect(finalize).toHaveBeenCalledTimes(1);
    expect(finalize).toHaveBeenCalledWith(expect.objectContaining({
      status: 'cancelled',
      errorCode: code,
      signal: controller.signal,
    }));
  });

  it('maps a cancel-first durable claim race to cancelled instead of producer_lost', async () => {
    const finalize = vi.fn(async () => ({ resultRef: null, ranking: null }));
    const dependencies = createDependencies({ finalize });
    const runtime = createArenaGenerationRuntime(dependencies);
    const prepared = await runtime.prepare!({
      request: new Request('https://example.test/api/arena/generate-stream'),
      actorKey: 'user:42',
      payload,
    });
    if (prepared instanceof Response) throw new Error('unexpected response');

    const terminal = await runtime.execute({
      generationId: 'generation-cancel-race',
      generationRequestId: 'request-cancel-race',
      actorKey: 'user:42',
      producerToken: 'producer-token-cancel-race',
      payloadHash: 'payload-hash-cancel-race',
      payload: prepared.executionPayload,
      signal: new AbortController().signal,
      emit: async () => undefined,
      claimFinalization: vi.fn(async () => ({
        kind: 'cancelled' as const,
        cancelReason: 'content_policy' as const,
      })),
    });

    expect(terminal).toMatchObject({ status: 'cancelled', code: 'CONTENT_POLICY_CANCELLED' });
    expect(finalize).toHaveBeenCalledWith(expect.objectContaining({
      status: 'cancelled',
      errorCode: 'CONTENT_POLICY_CANCELLED',
    }));
  });
});
