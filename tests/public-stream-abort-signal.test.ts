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
});
