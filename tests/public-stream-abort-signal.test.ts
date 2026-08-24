import { beforeEach, describe, expect, vi, test } from 'vitest';

const mocks = vi.hoisted(() => ({
  capturedOptions: null as any,
  generateWithStreamAI: vi.fn(async (_config: unknown, options: unknown) => {
    mocks.capturedOptions = options;
    return {
      response: new Response('ok', {
        headers: {
          'content-type': 'text/plain; charset=utf-8',
          'x-upstream-stream': 'preserved',
        },
      }),
      usagePromise: Promise.resolve({}),
      telemetry: {},
    };
  }),
}));

vi.mock('@mahoshojo/hosted-runtime/node-runtime/public-rate-limit', () => ({
  OFFICIAL_KEY_QUESTIONNAIRE_CHARACTER_COOLDOWN_MS: 60_000,
  createPublicAiRateLimiter: vi.fn(() => ({
    acquirePublicAiRateLimit: vi.fn(async () => ({ allowed: true })),
  })),
  buildPublicAiRateLimitResponse: vi.fn(),
}));

vi.mock('@mahoshojo/hosted-runtime/node-runtime/content-safety', () => ({
  createContentSafetyService: vi.fn(() => ({
    enforceTextSafety: vi.fn(async () => null),
  })),
}));

vi.mock('@mahoshojo/hosted-runtime/node-runtime/data-ports', () => ({
  createNodeDataPorts: vi.fn(() => ({
    getDataCardById: vi.fn(async () => null),
    recordAiChannelOutcome: vi.fn(),
    recordUserActivityFromRequest: vi.fn(),
    touchUserLastActivity: vi.fn(),
  })),
}));

vi.mock('@mahoshojo/hosted-runtime/node-runtime/raw-stream-ai', () => ({
  createNodeRawStreamAiRuntime: vi.fn(() => ({
    generateWithStreamAI: mocks.generateWithStreamAI,
  })),
}));

describe('public stream abort signal', () => {
  beforeEach(() => {
    mocks.capturedOptions = null;
    vi.clearAllMocks();
  });

  test('generate-free-stream 将 Request.signal 传给上游流式生成层', async () => {
    const { default: handler } = await import('@/app/api/generate-free-stream/handler');
    const controller = new AbortController();
    const request = new Request('https://example.com/api/generate-free-stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        schema: 'general',
        prompt: '生成一个测试角色',
        attachments: [],
        language: 'zh-CN',
      }),
    });

    const response = await handler(request as any);

    expect(response.status).toBe(200);
    expect(response.headers.get('x-upstream-stream')).toBe('preserved');
    expect(await response.text()).toBe('ok');
    expect(mocks.capturedOptions?.abortSignal).toBeInstanceOf(AbortSignal);
    expect(mocks.capturedOptions?.abortSignal.aborted).toBe(false);
    controller.abort('test-abort');
    expect(mocks.capturedOptions?.abortSignal.aborted).toBe(true);
  });

  test('generate-scenario-stream 将 Request.signal 传给上游流式生成层', async () => {
    const { default: handler } = await import('@/app/api/generate-scenario-stream/handler');
    const controller = new AbortController();
    const request = new Request('https://example.com/api/generate-scenario-stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        answers: { 核心事件: '一次测试重逢' },
        language: 'zh-CN',
        fieldsToKeepEmpty: [],
      }),
    });

    const response = await handler(request as any);

    expect(response.status).toBe(200);
    expect(response.headers.get('x-upstream-stream')).toBe('preserved');
    expect(await response.text()).toBe('ok');
    expect(mocks.capturedOptions?.abortSignal).toBeInstanceOf(AbortSignal);
    expect(mocks.capturedOptions?.abortSignal.aborted).toBe(false);
    controller.abort('test-abort');
    expect(mocks.capturedOptions?.abortSignal.aborted).toBe(true);
  });

  test.each([
    {
      name: 'creator/generate-stream',
      load: () => import('@/app/api/creator/generate-stream/handler'),
      body: {
        template: 'general',
        freeformBrief: '生成一个测试角色',
        answers: [],
        questionnaires: [],
      },
    },
    {
      name: 'generate-canshou-stream',
      load: () => import('@/app/api/generate-canshou-stream/handler'),
      body: {
        answers: [{
          question: '核心概念？',
          answer: '测试残兽',
          questionId: 'q-1',
          questionnaireId: 'canshou-test',
        }],
        questionnaires: [{
          id: 'canshou-test',
          title: '测试残兽问卷',
          kind: 'canshou',
          questions: [{ id: 'q-1', question: '核心概念？' }],
        }],
      },
    },
  ])('$name 将 Request.signal 原样传给上游流式生成层', async ({ name, load, body }) => {
    const { default: handler } = await load();
    const controller = new AbortController();
    const request = new Request(`https://example.com/api/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify(body),
    });

    const response = await handler(request);

    expect(response.status).toBe(200);
    expect(response.headers.get('x-upstream-stream')).toBe('preserved');
    expect(await response.text()).toBe('ok');
    expect(mocks.capturedOptions?.abortSignal).toBe(request.signal);
    expect(mocks.capturedOptions?.abortSignal.aborted).toBe(false);
    controller.abort('test-abort');
    expect(mocks.capturedOptions?.abortSignal.aborted).toBe(true);
  });
});
