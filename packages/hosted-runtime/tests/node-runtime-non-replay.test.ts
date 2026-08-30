import { z } from 'zod/v3';
import { readSafePublicAiError } from '@mahoshojo/hosted-api/regular-generation';

const mocks = vi.hoisted(() => ({
  configuredFetch: null as typeof fetch | null,
  createOpenAI: vi.fn((options: { fetch: typeof fetch }) => {
    mocks.configuredFetch = options.fetch;
    return { chat: () => ({}) };
  }),
  generateObject: vi.fn(),
  generateText: vi.fn(),
  streamText: vi.fn(),
}));

vi.mock('ai', () => ({
  generateObject: mocks.generateObject,
  generateText: mocks.generateText,
  streamText: mocks.streamText,
  NoObjectGeneratedError: {
    isInstance: (error: unknown) => (
      error instanceof Error && error.name === 'AI_NoObjectGeneratedError'
    ),
  },
}));
vi.mock('@ai-sdk/openai', () => ({ createOpenAI: mocks.createOpenAI }));
vi.mock('@ai-sdk/google', () => ({ createGoogleGenerativeAI: () => () => ({}) }));
vi.mock('@ai-sdk/deepseek', () => ({ createDeepSeek: () => () => ({}) }));

const provider = (name: string) => ({
  name,
  apiKey: 'provider-key-canary',
  baseUrl: 'https://provider-url-canary.invalid/v1',
  model: 'provider-model-canary',
  type: 'openai' as const,
  retryCount: 2,
  skipProbability: 0,
});

const generationConfig = {
  systemPrompt: 'system-body-canary',
  promptBuilder: () => 'prompt-body-canary',
  schema: z.object({ ok: z.boolean() }),
  taskName: 'non replay canary',
};

const dispatch = async (): Promise<void> => {
  if (!mocks.configuredFetch) throw new Error('provider fetch missing');
  await mocks.configuredFetch('https://provider-url-canary.invalid/v1/generate', {
    method: 'POST',
    headers: { 'x-api-key': 'provider-key-canary' },
    body: 'prompt-body-canary',
  });
};

describe('Node AI non-idempotent generation replay boundary', () => {
  beforeEach(() => {
    mocks.configuredFetch = null;
    mocks.createOpenAI.mockClear();
    mocks.generateObject.mockReset();
    mocks.generateText.mockReset();
    mocks.streamText.mockReset();
    mocks.generateText.mockRejectedValue(new Error('fallback-body-canary'));
  });

  it.each([
    {
      name: '5xx response',
      error: Object.assign(new Error('upstream-body-canary'), {
        name: 'AI_APICallError',
        statusCode: 503,
        responseBody: 'response-body-canary',
      }),
      fetch: vi.fn(async () => new Response('response-body-canary', { status: 503 })),
    },
    {
      name: 'response lost',
      error: new Error('response-lost-body-canary'),
      fetch: vi.fn(async () => {
        throw new Error('response-lost-body-canary');
      }),
    },
    {
      name: 'NoObject local parse failed',
      error: Object.assign(new Error('no-object-body-canary'), {
        name: 'AI_NoObjectGeneratedError',
        text: 'not-json-body-canary',
      }),
      fetch: vi.fn(async () => new Response('{}')),
    },
  ])('$name dispatch 后只允许一次 structured Provider 调用', async ({ error, fetch }) => {
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    mocks.generateObject.mockImplementation(async () => {
      await dispatch();
      throw error;
    });
    const { createNodeStructuredAiRuntime, LoadBalanceStrategy } = await import('../src/node-runtime');
    const runtime = createNodeStructuredAiRuntime({
      providers: [provider('first-provider-canary'), provider('second-provider-canary')],
      fetch: fetch as unknown as typeof globalThis.fetch,
      logger,
    });

    const caught = await runtime.generateWithAI(
      'input-body-canary',
      generationConfig,
      { loadBalanceStrategy: LoadBalanceStrategy.SEQUENTIAL },
    ).catch((failure: unknown) => failure as Error);

    expect(mocks.generateObject).toHaveBeenCalledTimes(1);
    expect(mocks.generateText).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
    if (!(caught instanceof Error)) throw new Error('expected structured generation failure');
    const serialized = JSON.stringify({
      caught: { name: caught.name, message: caught.message },
      logger: Object.values(logger).flatMap((spy) => spy.mock.calls),
    });
    expect(serialized).not.toMatch(
      /provider-key-canary|provider-url-canary|provider-model-canary|provider-canary|body-canary/u,
    );
  });

  it('stream dispatch 后的 5xx 只允许一次 Provider 调用', async () => {
    const fetch = vi.fn(async () => new Response('stream-response-body-canary', { status: 503 }));
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    mocks.streamText.mockImplementation(async () => {
      await dispatch();
      throw Object.assign(new Error('stream-upstream-body-canary'), {
        name: 'AI_APICallError',
        statusCode: 503,
      });
    });
    const { createNodeRawStreamAiRuntime, LoadBalanceStrategy } = await import('../src/node-runtime');
    const runtime = createNodeRawStreamAiRuntime({
      providers: [provider('first-provider-canary'), provider('second-provider-canary')],
      fetch: fetch as unknown as typeof globalThis.fetch,
      logger,
    });

    const caught = await runtime.generateWithStreamAI(
      { prompt: 'stream-prompt-body-canary' },
      { loadBalanceStrategy: LoadBalanceStrategy.SEQUENTIAL },
    ).catch((failure: unknown) => failure as Error);

    expect(mocks.streamText).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    if (!(caught instanceof Error)) throw new Error('expected stream generation failure');
    const serialized = JSON.stringify({
      caught: { name: caught.name, message: caught.message },
      logger: Object.values(logger).flatMap((spy) => spy.mock.calls),
    });
    expect(serialized).not.toMatch(
      /provider-key-canary|provider-url-canary|provider-model-canary|provider-canary|body-canary/u,
    );
  });

  it('structured dispatch 前错误也使用当前 Provider 与 prompt 上下文脱敏', async () => {
    mocks.createOpenAI.mockImplementation(() => {
      throw Object.assign(new Error(
        'provider-key-canary https://provider-url-canary.invalid/v1 system-body-canary prompt-body-canary',
      ), {
        name: 'AI_APICallError',
        statusCode: 503,
      });
    });
    const { createNodeStructuredAiRuntime, LoadBalanceStrategy } = await import('../src/node-runtime');
    const runtime = createNodeStructuredAiRuntime({
      providers: [{ ...provider('first-provider-canary'), retryCount: 1 }],
    });

    const caught = await runtime.generateWithAI(
      'input-body-canary',
      generationConfig,
      { loadBalanceStrategy: LoadBalanceStrategy.SEQUENTIAL },
    ).catch((failure: unknown) => failure as Error);
    const projection = readSafePublicAiError(caught);

    expect(projection).toEqual({
      code: 'AI_UPSTREAM_REQUEST_FAILED',
      message: '上游 AI 请求失败',
      upstreamStatus: 503,
    });
    expect(JSON.stringify(projection)).not.toMatch(
      /provider-key-canary|provider-url-canary|system-body-canary|prompt-body-canary/u,
    );
  });
});
