import { describe, expect, it, vi } from 'vitest';

import {
  createArenaGenerationRuntime,
  type ArenaGenerationRuntimeDependencies,
} from '../src/arena-generation/runtime';

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
      payload: prepared.executionPayload,
      signal: controller.signal,
      emit,
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
      payload: prepared.executionPayload,
      signal: new AbortController().signal,
      emit: async () => undefined,
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
      payload: prepared.executionPayload,
      signal: new AbortController().signal,
      emit: async (event) => { emitted.push(event.type); },
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

  it('explicit generation abort reaches Provider/finalizer and maps to cancelled terminal', async () => {
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
      payload: prepared.executionPayload,
      signal: controller.signal,
      emit: async () => undefined,
    });

    controller.abort('user');

    await expect(execution).resolves.toMatchObject({ status: 'cancelled' });
    expect(finalize).toHaveBeenCalledTimes(1);
    expect(finalize).toHaveBeenCalledWith(expect.objectContaining({
      status: 'cancelled',
      signal: controller.signal,
    }));
  });
});
