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

  it('已实际关闭 thinking 时，reasoning-only 返回稳定公共错误且不泄露 reasoning', async () => {
    const availability: unknown[] = [];
    const reasoningEvents: unknown[] = [];
    const telemetry: Record<string, unknown> = {};
    mocks.streamText.mockReturnValueOnce({
      fullStream: fullStreamFrom([
        { type: 'reasoning-start' },
        { type: 'reasoning-delta', text: '不应公开的内部推理' },
        { type: 'reasoning-end' },
      ]),
      usage: Promise.resolve({}),
      finishReason: Promise.resolve('stop'),
    });
    const { createNodeRawStreamAiRuntime, LoadBalanceStrategy } = await import('../src/node-runtime');
    const { readSafePublicAiError } = await import('@mahoshojo/hosted-api/regular-generation');
    const runtime = createNodeRawStreamAiRuntime({
      providers: [{
        ...provider,
        type: 'google',
        providerId: 'google-cloudflare',
        model: 'gemini-2.5-flash',
      }],
      recordAiChannelOutcome: (input) => { availability.push(input); },
    });

    const result = await runtime.generateWithStreamAI(
      {
        prompt: 'reasoning only',
        generationSettingsContext: {
          providerId: 'google-cloudflare',
          userOverrides: { thinking: { mode: 'disabled' } },
        },
      },
      {
        loadBalanceStrategy: LoadBalanceStrategy.SEQUENTIAL,
        channelContext: { providerId: 'google-cloudflare', modelId: 'gemini-2.5-flash' },
        telemetry,
        onReasoningEvent: (event) => { reasoningEvents.push(event); },
      },
    );

    let caught: unknown;
    try {
      await result.response.text();
    } catch (error) {
      caught = error;
    }

    expect(readSafePublicAiError(caught)).toEqual({
      code: 'THINKING_DISABLED_REASONING_ONLY',
      message: '模型在已关闭思考的情况下未返回可安全显示的正文，请重试或切换模型。',
    });
    expect(String(caught)).not.toContain('不应公开的内部推理');
    expect(reasoningEvents).toEqual([]);
    expect(telemetry).toMatchObject({
      reasoning: {
        status: 'error',
        anomalyFlags: ['thinking_disabled_reasoning_only'],
      },
    });
    expect(availability).toEqual([{
      providerId: 'google-cloudflare',
      modelId: 'gemini-2.5-flash',
      outcome: 'failure',
      errorClass: 'reasoning_only',
    }]);
  });

  it('已实际关闭 thinking 时仍正常返回 text-delta 正文', async () => {
    mocks.streamText.mockReturnValueOnce({
      fullStream: fullStreamFrom([{ type: 'text-delta', text: '正常正文' }]),
      usage: Promise.resolve({}),
      finishReason: Promise.resolve('stop'),
    });
    const { createNodeRawStreamAiRuntime } = await import('../src/node-runtime');
    const runtime = createNodeRawStreamAiRuntime({
      providers: [{
        ...provider,
        type: 'google',
        providerId: 'google-cloudflare',
        model: 'gemini-2.5-flash',
      }],
    });

    const result = await runtime.generateWithStreamAI({
      prompt: 'normal text',
      generationSettingsContext: {
        providerId: 'google-cloudflare',
        userOverrides: { thinking: { mode: 'disabled' } },
      },
    });

    await expect(result.response.text()).resolves.toBe('正常正文');
  });

  it('thinking 开启时继续分别回传 reasoning 与正文', async () => {
    const reasoningEvents: unknown[] = [];
    mocks.streamText.mockReturnValueOnce({
      fullStream: fullStreamFrom([
        { type: 'reasoning-start' },
        { type: 'reasoning-delta', text: '推理摘要' },
        { type: 'reasoning-end' },
        { type: 'text-delta', text: '最终正文' },
      ]),
      usage: Promise.resolve({}),
      finishReason: Promise.resolve('stop'),
    });
    const { createNodeRawStreamAiRuntime } = await import('../src/node-runtime');
    const runtime = createNodeRawStreamAiRuntime({
      providers: [{
        ...provider,
        type: 'google',
        providerId: 'google-cloudflare',
        model: 'gemini-2.5-flash',
      }],
    });

    const result = await runtime.generateWithStreamAI(
      {
        prompt: 'reasoning and text',
        generationSettingsContext: {
          providerId: 'google-cloudflare',
          userOverrides: { thinking: { mode: 'enabled', effort: 'low' } },
        },
      },
      { onReasoningEvent: (event) => { reasoningEvents.push(event); } },
    );

    await expect(result.response.text()).resolves.toBe('最终正文');
    expect(reasoningEvents).toEqual([
      { type: 'reasoning-start', id: undefined },
      { type: 'reasoning-delta', id: undefined, text: '推理摘要' },
      { type: 'reasoning-end', id: undefined },
    ]);
  });
});
