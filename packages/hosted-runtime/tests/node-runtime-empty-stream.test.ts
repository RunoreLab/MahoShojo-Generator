import {
  registerHostedRuntimeObserver,
  resetHostedRuntimeObserverForTests,
} from '../src/telemetry';

const mocks = vi.hoisted(() => ({
  streamText: vi.fn(),
}));

vi.mock('ai', () => ({
  generateObject: vi.fn(),
  generateText: vi.fn(),
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

const provider = {
  name: 'empty-stream-test',
  apiKey: 'test-key',
  baseUrl: 'https://example.invalid/v1',
  model: 'test-model',
  type: 'openai' as const,
  retryCount: 2,
  skipProbability: 0,
};

const fullStreamFrom = (parts: unknown[]): ReadableStream<unknown> => new ReadableStream({
  start(controller) {
    for (const part of parts) controller.enqueue(part);
    controller.close();
  },
});

describe('raw stream empty-output terminal', () => {
  beforeEach(() => {
    mocks.streamText.mockReset();
  });

  afterEach(() => {
    resetHostedRuntimeObserverForTests();
  });

  test.each([
    {
      name: '纯空白文本',
      parts: [{ type: 'text-delta', text: '   \n\t' }],
    },
    {
      name: '跨 chunk 的 {} 占位',
      parts: [{ type: 'text-delta', text: '{' }, { type: 'text-delta', text: '}' }],
    },
    {
      name: '只有 reasoning、没有正文',
      parts: [
        { type: 'reasoning-start' },
        { type: 'reasoning-delta', text: '内部推理' },
        { type: 'reasoning-end' },
      ],
    },
  ])('$name 在 Response 返回后 fail closed，且不盲目切换 provider', async ({ parts }) => {
    const terminals: unknown[] = [];
    const availability: unknown[] = [];
    registerHostedRuntimeObserver({
      beginAiUpstream: () => ({
        recordTtfb: () => undefined,
        finish: (value) => terminals.push(value),
      }),
      observeD1RoundTrip: () => undefined,
    });
    mocks.streamText.mockReturnValueOnce({
      fullStream: fullStreamFrom(parts),
      usage: Promise.resolve({}),
      finishReason: Promise.resolve('stop'),
    });
    const { createNodeRawStreamAiRuntime, LoadBalanceStrategy } = await import('../src/node-runtime');
    const runtime = createNodeRawStreamAiRuntime({
      providers: [provider, { ...provider, name: 'must-not-run' }],
      recordAiChannelOutcome: (input) => { availability.push(input); },
    });

    const result = await runtime.generateWithStreamAI(
      { prompt: 'empty stream' },
      {
        loadBalanceStrategy: LoadBalanceStrategy.SEQUENTIAL,
        channelContext: { providerId: 'system', modelId: 'test-model' },
      },
    );

    await expect(result.response.text()).rejects.toThrow('空对象/空内容');
    expect(mocks.streamText).toHaveBeenCalledTimes(1);
    expect(terminals).toEqual([expect.objectContaining({ outcome: 'error' })]);
    expect(availability).toEqual([{
      providerId: 'system',
      modelId: 'test-model',
      outcome: 'failure',
      errorClass: 'empty_output',
    }]);
  });
});
