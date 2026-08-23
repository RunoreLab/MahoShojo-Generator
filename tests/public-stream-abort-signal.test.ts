import { beforeEach, describe, expect, vi, test } from 'vitest';

let capturedOptions: any = null;

vi.mock('@/lib/ai/public-rate-limit', () => ({
  acquirePublicAiRateLimit: async () => ({ allowed: true }),
  buildPublicAiRateLimitResponse: () => new Response(null, { status: 429 }),
  inferPublicAiProviderMode: () => 'system',
}));

vi.mock('@/lib/content-safety/server', () => ({
  enforceTextSafety: async () => null,
}));

vi.mock('@/lib/user-activity/record', () => ({
  recordUserActivityFromRequest: () => {},
}));

vi.mock('@/lib/stream/raw-ai', () => ({
  LoadBalanceStrategy: {
    CUSTOM: 'custom',
    SEQUENTIAL: 'sequential',
  },
  generateWithStreamAI: async (_config: unknown, options: unknown) => {
    capturedOptions = options;
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
  },
}));

describe('public stream abort signal', () => {
  beforeEach(() => {
    capturedOptions = null;
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
    expect(capturedOptions?.abortSignal).toBeInstanceOf(AbortSignal);
    expect(capturedOptions?.abortSignal.aborted).toBe(false);
    controller.abort('test-abort');
    expect(capturedOptions?.abortSignal.aborted).toBe(true);
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
    expect(capturedOptions?.abortSignal).toBeInstanceOf(AbortSignal);
    expect(capturedOptions?.abortSignal.aborted).toBe(false);
    controller.abort('test-abort');
    expect(capturedOptions?.abortSignal.aborted).toBe(true);
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
    expect(capturedOptions?.abortSignal).toBe(request.signal);
    expect(capturedOptions?.abortSignal.aborted).toBe(false);
    controller.abort('test-abort');
    expect(capturedOptions?.abortSignal.aborted).toBe(true);
  });
});
