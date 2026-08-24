import { z } from 'zod/v3';

const mocks = vi.hoisted(() => ({
  createDeepSeek: vi.fn((_options?: Record<string, unknown>) => () => ({})),
  createGoogleGenerativeAI: vi.fn((_options?: Record<string, unknown>) => () => ({})),
  createOpenAI: vi.fn((_options?: Record<string, unknown>) => ({ chat: () => ({}) })),
  generateObject: vi.fn(),
}));

vi.mock('ai', () => ({
  generateObject: mocks.generateObject,
  generateText: vi.fn(),
  streamText: vi.fn(),
  NoObjectGeneratedError: { isInstance: () => false },
}));
vi.mock('@ai-sdk/openai', () => ({ createOpenAI: mocks.createOpenAI }));
vi.mock('@ai-sdk/google', () => ({ createGoogleGenerativeAI: mocks.createGoogleGenerativeAI }));
vi.mock('@ai-sdk/deepseek', () => ({ createDeepSeek: mocks.createDeepSeek }));

describe('Node AI provider fetch injection', () => {
  beforeEach(() => {
    mocks.createDeepSeek.mockClear();
    mocks.createGoogleGenerativeAI.mockClear();
    mocks.createOpenAI.mockClear();
    mocks.generateObject.mockReset();
    mocks.generateObject.mockResolvedValue({ object: { ok: true }, usage: {}, finishReason: 'stop' });
  });

  test.each([
    { type: 'google' as const, factory: mocks.createGoogleGenerativeAI },
    { type: 'deepseek' as const, factory: mocks.createDeepSeek },
  ])('$type provider factory 使用显式注入 fetch', async ({ type, factory }) => {
    const injectedFetch = vi.fn(async () => new Response('{}')) as unknown as typeof fetch;
    const { createNodeStructuredAiRuntime } = await import('../src/node-runtime');
    const runtime = createNodeStructuredAiRuntime({
      providers: [{
        name: `${type}-test`,
        apiKey: 'test-key',
        baseUrl: 'https://example.invalid/v1',
        model: 'test-model',
        type,
        retryCount: 1,
      }],
      fetch: injectedFetch,
    });

    await runtime.generateWithAI('input', {
      systemPrompt: 'system',
      promptBuilder: () => 'prompt',
      schema: z.object({ ok: z.boolean() }),
      taskName: 'provider fetch',
    });

    expect(factory).toHaveBeenCalledWith(expect.objectContaining({
      apiKey: 'test-key',
      baseURL: 'https://example.invalid/v1',
      fetch: expect.any(Function),
    }));
    const configuredFetch = (factory.mock.calls[0]?.[0] as { fetch: typeof fetch }).fetch;
    await configuredFetch('https://upstream.invalid/test');
    expect(injectedFetch).toHaveBeenCalledTimes(1);
  });
});
