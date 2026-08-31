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

  test('raw stream 遇到 Hono 客户端断连时关闭响应而不向消费者传播进程级错误', async () => {
    let failUpstream!: (_error: Error) => void;
    const upstream = new ReadableStream<unknown>({
      start(controller) {
        controller.enqueue({ type: 'text-delta', text: 'partial output' });
        failUpstream = (error) => controller.error(error);
      },
    });
    mocks.streamText.mockReturnValueOnce({
      fullStream: upstream,
      usage: Promise.resolve({}),
      finishReason: Promise.resolve(null),
    });
    const { createNodeRawStreamAiRuntime } = await import('../src/node-runtime');
    const runtime = createNodeRawStreamAiRuntime({ providers: [provider('disconnect')] });

    const result = await runtime.generateWithStreamAI({ prompt: 'disconnect raw stream' });
    failUpstream(new Error('Client connection prematurely closed.'));

    await expect(result.response.text()).resolves.toBe('partial output');
    expect(mocks.streamText).toHaveBeenCalledTimes(1);
  });

  test('reasoning 回调失败时立即取消仍在输出的 raw Provider stream', async () => {
    let cancelledWith: unknown = null;
    const upstream = new ReadableStream<unknown>({
      start(controller) {
        controller.enqueue({ type: 'reasoning-delta', text: '超限推理' });
        controller.enqueue({ type: 'text-delta', text: '不应继续消费' });
      },
      cancel(reason) {
        cancelledWith = reason;
      },
    });
    mocks.streamText.mockReturnValueOnce({
      fullStream: upstream,
      usage: Promise.resolve({}),
      finishReason: Promise.resolve(null),
    });
    const { createNodeRawStreamAiRuntime } = await import('../src/node-runtime');
    const runtime = createNodeRawStreamAiRuntime({ providers: [provider('reasoning-budget')] });
    const callbackError = new Error('ARENA_OUTPUT_BUDGET_EXCEEDED');

    const result = await runtime.generateWithStreamAI(
      { prompt: 'reasoning callback failure' },
      {
        onReasoningEvent: async () => {
          throw callbackError;
        },
      },
    );

    await expect(Promise.race([
      result.response.text(),
      new Promise<string>((_, reject) => setTimeout(
        () => reject(new Error('reasoning callback was not propagated')),
        100,
      )),
    ])).rejects.toThrow('ARENA_OUTPUT_BUDGET_EXCEEDED');
    expect(cancelledWith).toBe(callbackError);
  });

  test('signal 已中止时，即使 SDK 抛普通 Error，structured attempt 仍以 aborted 结束', async () => {
    const terminals: unknown[] = [];
    registerHostedRuntimeObserver({
      beginAiUpstream: () => ({
        recordTtfb: () => undefined,
        finish: (value) => terminals.push(value),
      }),
      observeD1RoundTrip: () => undefined,
    });
    const controller = new AbortController();
    mocks.generateObject.mockImplementationOnce(() => {
      controller.abort('user');
      throw new Error('transport closed unexpectedly');
    });
    const { createNodeStructuredAiRuntime, LoadBalanceStrategy } = await import('../src/node-runtime');
    const runtime = createNodeStructuredAiRuntime({ providers: [provider('structured-abort')] });

    await expect(runtime.generateWithAI(
      'input',
      {
        systemPrompt: 'system',
        promptBuilder: () => 'prompt',
        schema: z.object({ ok: z.boolean() }),
        taskName: 'abort terminal',
      },
      {
        abortSignal: controller.signal,
        loadBalanceStrategy: LoadBalanceStrategy.SEQUENTIAL,
      },
    )).rejects.toThrow('transport closed');

    expect(mocks.generateObject).toHaveBeenCalledTimes(1);
    expect(mocks.generateText).not.toHaveBeenCalled();
    expect(terminals).toEqual([expect.objectContaining({ outcome: 'aborted' })]);
  });
});
