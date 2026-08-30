import { z } from 'zod/v3';

const mocks = vi.hoisted(() => ({
  createDeepSeek: vi.fn((_options?: Record<string, unknown>) => () => ({})),
  createGoogleGenerativeAI: vi.fn((_options?: Record<string, unknown>) => () => ({})),
  createOpenAI: vi.fn((_options?: Record<string, unknown>) => ({ chat: () => ({}) })),
  generateObject: vi.fn(),
  streamText: vi.fn(),
}));

vi.mock('ai', () => ({
  generateObject: mocks.generateObject,
  generateText: vi.fn(),
  streamText: mocks.streamText,
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
    mocks.streamText.mockReset();
    mocks.streamText.mockReturnValue({
      fullStream: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: 'text-delta', text: 'valid output' });
          controller.close();
        },
      }),
    });
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

  test.each([
    { type: 'google' as const, factory: mocks.createGoogleGenerativeAI },
    { type: 'deepseek' as const, factory: mocks.createDeepSeek },
  ])('raw stream 的 $type provider factory 也使用显式注入 fetch', async ({ type, factory }) => {
    const injectedFetch = vi.fn(async () => new Response('{}')) as unknown as typeof fetch;
    const { createNodeRawStreamAiRuntime } = await import('../src/node-runtime');
    const runtime = createNodeRawStreamAiRuntime({
      providers: [{
        name: `${type}-stream-test`,
        apiKey: 'test-key',
        baseUrl: 'https://example.invalid/v1',
        model: 'test-model',
        type,
        retryCount: 1,
      }],
      fetch: injectedFetch,
    });

    const result = await runtime.generateWithStreamAI({ prompt: 'provider fetch' });
    await expect(result.response.text()).resolves.toBe('valid output');

    const configuredFetch = (factory.mock.calls[0]?.[0] as { fetch: typeof fetch }).fetch;
    await configuredFetch('https://upstream.invalid/test');
    expect(injectedFetch).toHaveBeenCalledTimes(1);
  });

  test.each([301, 302, 303, 307, 308])(
    'Provider POST 遇到 %s redirect 时 fail closed，且不向新 Origin 重放 secret/body',
    async (status) => {
      const injectedFetch = vi.fn(async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        expect(init?.redirect).toBe('manual');
        return new Response(null, {
          status,
          headers: { location: 'https://redirect-canary.invalid/steal' },
        });
      }) as unknown as typeof fetch;
      const { getProviderFetch } = await import('../src/node-runtime/provider-fetch');
      const guardedFetch = getProviderFetch({
        name: 'google-test',
        apiKey: 'provider-secret-canary',
        baseUrl: 'https://origin.invalid/v1',
        model: 'test-model',
        type: 'google',
      }, injectedFetch);

      const error = await guardedFetch('https://origin.invalid/v1/generate', {
        method: 'POST',
        headers: {
          'x-goog-api-key': 'provider-secret-canary',
          'content-type': 'application/json',
        },
        body: 'prompt-body-canary',
      }).catch((caught: unknown) => caught as Error);

      expect(injectedFetch).toHaveBeenCalledTimes(1);
      if (!(error instanceof Error)) throw new Error('expected redirect failure');
      expect(error).toMatchObject({ message: 'AI_PROVIDER_REDIRECT_BLOCKED' });
      expect(`${error.name}:${error.message}`).not.toMatch(
        /provider-secret-canary|prompt-body-canary|redirect-canary/u,
      );
    },
  );
});
