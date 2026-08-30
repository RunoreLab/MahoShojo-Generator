import { z } from 'zod/v3';

const mocks = vi.hoisted(() => ({
  generateObject: vi.fn(),
}));

vi.mock('ai', () => ({
  generateObject: mocks.generateObject,
  generateText: vi.fn(),
  streamText: vi.fn(),
  NoObjectGeneratedError: { isInstance: () => false },
}));
vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: () => ({ chat: () => ({}) }),
}));
vi.mock('@ai-sdk/google', () => ({
  createGoogleGenerativeAI: () => () => ({}),
}));
vi.mock('@ai-sdk/deepseek', () => ({
  createDeepSeek: () => () => ({}),
}));

const provider = {
  name: 'outcome-test',
  apiKey: 'test-key',
  baseUrl: 'https://example.invalid/v1',
  model: 'test-model',
  type: 'openai' as const,
  retryCount: 1,
  skipProbability: 0,
};

const generationConfig = {
  systemPrompt: 'system',
  promptBuilder: () => 'prompt',
  schema: z.object({ ok: z.boolean() }),
  taskName: 'outcome fail-soft',
};

describe('AI availability recorder fail-soft boundary', () => {
  beforeEach(() => {
    mocks.generateObject.mockReset();
    mocks.generateObject.mockResolvedValue({ object: { ok: true }, usage: {}, finishReason: 'stop' });
  });

  test('structured 成功不受同步 recorder throw 污染', async () => {
    const { createNodeStructuredAiRuntime } = await import('../src/node-runtime');
    const runtime = createNodeStructuredAiRuntime({
      providers: [provider],
      recordAiChannelOutcome: () => {
        throw new Error('recorder sync failure');
      },
    });

    await expect(runtime.generateWithAI(
      'input',
      generationConfig,
      { channelContext: { providerId: 'system', modelId: 'test-model' } },
    )).resolves.toEqual({ ok: true });
    expect(mocks.generateObject).toHaveBeenCalledTimes(1);
  });

  test('structured 成功会消费 recorder Promise rejection', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
      const { createNodeStructuredAiRuntime } = await import('../src/node-runtime');
      const runtime = createNodeStructuredAiRuntime({
        providers: [provider],
        recordAiChannelOutcome: () => Promise.reject(new Error('recorder async failure')),
      });

      await expect(runtime.generateWithAI(
        'input',
        generationConfig,
        { channelContext: { providerId: 'system', modelId: 'test-model' } },
      )).resolves.toEqual({ ok: true });
      await new Promise((resolve) => setImmediate(resolve));
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  test('stream attempt recorder 同时吞掉同步 throw 与异步 reject', async () => {
    const { createAttemptOutcomeRecorder } = await import('../src/node-runtime/attempt-outcome-recorder');
    const syncRecorder = createAttemptOutcomeRecorder(
      { providerId: 'system', modelId: 'sync' },
      () => { throw new Error('sync'); },
    );
    expect(() => syncRecorder.recordSuccess()).not.toThrow();

    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
      const asyncRecorder = createAttemptOutcomeRecorder(
        { providerId: 'system', modelId: 'async' },
        () => Promise.reject(new Error('async')),
      );
      asyncRecorder.recordSuccess();
      await new Promise((resolve) => setImmediate(resolve));
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });
});
