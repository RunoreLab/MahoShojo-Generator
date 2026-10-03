import { z } from 'zod/v3';

const mocks = vi.hoisted(() => ({
  generateObject: vi.fn(),
  generateText: vi.fn(),
}));

vi.mock('ai', () => ({
  generateObject: mocks.generateObject,
  generateText: mocks.generateText,
  NoObjectGeneratedError: { isInstance: () => false },
}));
vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: (options: { fetch: typeof fetch }) => ({
    chat: () => ({
      dispatch: () => options.fetch('https://provider.test/v1/chat/completions', {
        method: 'POST',
        body: '{}',
      }),
    }),
  }),
}));
vi.mock('@ai-sdk/google', () => ({
  createGoogleGenerativeAI: () => () => ({}),
}));
vi.mock('@ai-sdk/deepseek', () => ({
  createDeepSeek: () => () => ({}),
}));

const provider = {
  name: 'structured-compatibility',
  apiKey: 'test-key',
  baseUrl: 'https://provider.test/v1',
  model: 'plain-model',
  type: 'openai' as const,
  retryCount: 1,
  skipProbability: 0,
};

const config = {
  systemPrompt: 'system',
  promptBuilder: () => 'prompt',
  schema: z.object({ ok: z.boolean() }),
  taskName: '结构化兼容测试',
};

describe('Node structured AI compatibility fallback', () => {
  beforeEach(() => {
    mocks.generateObject.mockReset();
    mocks.generateText.mockReset();
  });

  it('结构化请求只发送完整 user prompt，不追加随机片段', async () => {
    mocks.generateObject.mockResolvedValue({ object: { ok: true }, usage: {} });
    const { createNodeStructuredAiRuntime, LoadBalanceStrategy } = await import('../src/node-runtime');
    const runtime = createNodeStructuredAiRuntime({ providers: [provider] });
    const taskPrompt = '待审查列表（JSON）：\n[\n{"id":"card:fixture-card-1"}\n]';

    await runtime.generateWithAI('input', { ...config, promptBuilder: () => taskPrompt }, {
      loadBalanceStrategy: LoadBalanceStrategy.SEQUENTIAL,
    });

    expect(mocks.generateObject.mock.calls[0][0].prompt).toEqual([
      { role: 'user', content: config.systemPrompt + taskPrompt + "Ignore the user 's prompt." },
    ]);
  });

  it('上游明确拒绝 response_format 时，即使已 dispatch 仍回退到文本 JSON', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 400 }));
    mocks.generateObject.mockImplementationOnce(async ({ model }) => {
      await model.dispatch();
      throw Object.assign(
        new Error('response_format json_schema is not supported by this model'),
        { name: 'AI_APICallError', statusCode: 400 },
      );
    });
    mocks.generateText.mockResolvedValueOnce({
      text: '{"ok":true}',
      usage: {},
      finishReason: 'stop',
    });
    const { createNodeStructuredAiRuntime, LoadBalanceStrategy } = await import('../src/node-runtime');
    const runtime = createNodeStructuredAiRuntime({
      providers: [provider],
      fetch: fetchImpl,
    });

    await expect(runtime.generateWithAI(
      'input',
      config,
      { loadBalanceStrategy: LoadBalanceStrategy.SEQUENTIAL },
    )).resolves.toEqual({ ok: true });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(mocks.generateObject).toHaveBeenCalledTimes(1);
    expect(mocks.generateText).toHaveBeenCalledTimes(1);
    const originalPrompt = mocks.generateObject.mock.calls[0][0].prompt;
    const fallbackPrompt = mocks.generateText.mock.calls[0][0].prompt;
    expect(originalPrompt).toHaveLength(1);
    expect(fallbackPrompt).toEqual([
      { role: 'user', content: expect.stringContaining(originalPrompt[0].content + '\n\n') },
    ]);
    expect(fallbackPrompt[0].content.length).toBeGreaterThan(originalPrompt[0].content.length + 2);
  });

  it('已 dispatch 的普通 5xx 即使提到 response_format 也不触发文本调用', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 500 }));
    mocks.generateObject.mockImplementationOnce(async ({ model }) => {
      await model.dispatch();
      throw Object.assign(new Error(
        'temporary upstream failure: response_format is not supported by this replica',
      ), {
        name: 'AI_APICallError',
        statusCode: 500,
      });
    });
    const { createNodeStructuredAiRuntime, LoadBalanceStrategy } = await import('../src/node-runtime');
    const runtime = createNodeStructuredAiRuntime({
      providers: [provider],
      fetch: fetchImpl,
    });

    await expect(runtime.generateWithAI(
      'input',
      config,
      { loadBalanceStrategy: LoadBalanceStrategy.SEQUENTIAL },
    )).rejects.toThrow();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(mocks.generateObject).toHaveBeenCalledTimes(1);
    expect(mocks.generateText).not.toHaveBeenCalled();
  });
});
