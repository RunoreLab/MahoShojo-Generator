import { z } from 'zod/v3';

import {
  registerHostedRuntimeObserver,
  resetHostedRuntimeObserverForTests,
} from '../src/telemetry';

const mocks = vi.hoisted(() => ({
  generateObject: vi.fn(),
  generateText: vi.fn(),
  streamText: vi.fn(),
}));

vi.mock('ai', () => ({
  generateObject: mocks.generateObject,
  generateText: mocks.generateText,
  streamText: mocks.streamText,
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

const provider = (name: string) => ({
  name,
  apiKey: 'test-key',
  baseUrl: 'https://example.invalid/v1',
  model: 'test-model',
  type: 'openai' as const,
  retryCount: 2,
  skipProbability: 0,
});

describe('Node AI runtime abort contract', () => {
  beforeEach(() => {
    mocks.generateObject.mockReset();
    mocks.generateText.mockReset();
    mocks.streamText.mockReset();
  });

  afterEach(() => {
    resetHostedRuntimeObserverForTests();
  });

  test('structured generateObject 与 generateText fallback 都透传同一 abortSignal', async () => {
    mocks.generateObject.mockRejectedValueOnce(new Error('json mode is not enabled'));
    mocks.generateText.mockResolvedValueOnce({
      text: '{"ok":true}',
      usage: {},
      finishReason: 'stop',
    });
    const { createNodeStructuredAiRuntime, LoadBalanceStrategy } = await import('../src/node-runtime');
    const controller = new AbortController();
    const runtime = createNodeStructuredAiRuntime({ providers: [provider('structured')] });

    await expect(runtime.generateWithAI(
      'input',
      {
        systemPrompt: 'system',
        promptBuilder: () => 'prompt',
        schema: z.object({ ok: z.boolean() }),
        taskName: 'abort signal',
      },
      {
        abortSignal: controller.signal,
        loadBalanceStrategy: LoadBalanceStrategy.SEQUENTIAL,
      },
    )).resolves.toEqual({ ok: true });

    expect(mocks.generateObject).toHaveBeenCalledWith(expect.objectContaining({
      abortSignal: controller.signal,
    }));
    expect(mocks.generateText).toHaveBeenCalledWith(expect.objectContaining({
      abortSignal: controller.signal,
    }));
  });

  test('raw stream 遇到 AbortError 后不重试或切换 provider，并以 aborted 结束唯一 attempt', async () => {
    const terminals: unknown[] = [];
    registerHostedRuntimeObserver({
      beginAiUpstream: () => ({
        recordTtfb: () => undefined,
        finish: (value) => terminals.push(value),
      }),
      observeD1RoundTrip: () => undefined,
    });
    const abortError = Object.assign(new Error('request aborted'), { name: 'AbortError' });
    mocks.streamText.mockImplementationOnce(({ abortSignal }) => {
      expect(abortSignal).toBeInstanceOf(AbortSignal);
      throw abortError;
    });
    const { createNodeRawStreamAiRuntime, LoadBalanceStrategy } = await import('../src/node-runtime');
    const runtime = createNodeRawStreamAiRuntime({
      providers: [provider('first'), provider('second')],
    });

    await expect(runtime.generateWithStreamAI(
      { prompt: 'abort raw stream' },
      {
        abortSignal: new AbortController().signal,
        loadBalanceStrategy: LoadBalanceStrategy.SEQUENTIAL,
      },
    )).rejects.toMatchObject({ name: 'AbortError' });

    expect(mocks.streamText).toHaveBeenCalledTimes(1);
    expect(terminals).toEqual([expect.objectContaining({ outcome: 'aborted' })]);
  });
});
