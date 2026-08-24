import { describe, expect, it } from 'vitest';

import {
  createGenerateFreeStreamRuntime,
  type GenerateFreeStreamRuntimeDependencies,
} from '@mahoshojo/hosted-runtime/generate-free-stream-runtime';

const createRequest = (body: unknown, signal?: AbortSignal): Request => new Request(
  'https://example.test/api/generate-free-stream?format=sse',
  {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify(body),
    signal,
  },
);

describe('generate free stream hosted runtime', () => {
  it('传递 request.signal，以 reasoning bridge 包装上游 response 并保持活动顺序', async () => {
    const events: string[] = [];
    const abortController = new AbortController();
    const upstream = new Response('markdown', {
      status: 202,
      headers: { 'x-upstream': 'free' },
    });
    const dependencies: GenerateFreeStreamRuntimeDependencies = {
      findProvider: () => ({
        id: 'proxy',
        name: 'Proxy',
        baseUrl: '',
        type: 'openai',
      }),
      resolveModel: () => ({ modelId: 'canonical-model' }),
      checkRateLimit: async () => {
        events.push('rate-limit');
        return null;
      },
      enforceSafety: async () => {
        events.push('safety');
        return null;
      },
      shouldUseReasoningSse: () => true,
      createReasoningSseBridge: (label) => {
        events.push(`reasoning:${label}`);
        return {
          onReasoningEvent: () => events.push('reasoning-event'),
          toResponse: (response, options) => {
            events.push(`bridge:${response.headers.get('x-upstream')}:${options.aiModel}`);
            return new Response('sse', {
              status: response.status,
              headers: { 'content-type': 'text/event-stream' },
            });
          },
        };
      },
      generateWithStreamAI: async (config, options) => {
        events.push('generate');
        expect(config.prompt).toContain('通用角色卡');
        expect(config.prompt).toContain('附件正文');
        expect(config.modelOverride).toBe('canonical-model');
        expect(config.generationSettingsContext).toEqual({
          providerId: 'proxy',
          userOverrides: { maxOutputTokens: 2048 },
        });
        expect(options.abortSignal).toBe(request.signal);
        expect(options.loadBalanceStrategy).toBe('custom');
        expect(options.channelContext).toEqual({
          providerId: 'proxy',
          modelId: 'canonical-model',
        });
        expect(options.onReasoningEvent).toBeTypeOf('function');
        options.onReasoningEvent?.({ type: 'reasoning-end' });
        options.telemetry.model = 'observed-model';
        return { response: upstream, usagePromise: Promise.resolve({ outputTokens: 12 }) };
      },
      recordActivity: () => events.push('activity'),
      logError: () => events.push('error'),
    };
    const runtime = createGenerateFreeStreamRuntime(dependencies);
    const request = createRequest({
      schema: 'general',
      prompt: '创建一名守夜人',
      attachments: [{ name: 'reference.txt', content: '附件正文' }],
      customProvider: {
        providerId: 'proxy',
        modelId: 'alias-model',
        apiKey: 'top-secret-key',
        generationOverrides: { maxOutputTokens: 2048 },
      },
    }, abortController.signal);

    const response = await runtime.service(request);

    expect(response.status).toBe(202);
    expect(response.headers.get('content-type')).toBe('text/event-stream');
    expect(await response.text()).toBe('sse');
    expect(events).toEqual([
      'rate-limit',
      'safety',
      'reasoning:自由生成（流式）',
      'generate',
      'reasoning-event',
      'activity',
      'bridge:free:observed-model',
    ]);
    expect(JSON.stringify(events)).not.toContain('top-secret-key');
  });

  it('非 SSE 请求原样返回上游 response', async () => {
    const upstream = new Response('plain', {
      status: 206,
      headers: { 'x-upstream': 'preserved' },
    });
    const dependencies: GenerateFreeStreamRuntimeDependencies = {
      findProvider: () => null,
      resolveModel: () => null,
      checkRateLimit: async () => null,
      enforceSafety: async () => null,
      shouldUseReasoningSse: () => false,
      createReasoningSseBridge: () => {
        throw new Error('unexpected bridge');
      },
      generateWithStreamAI: async () => ({ response: upstream }),
      recordActivity: () => undefined,
      logError: () => undefined,
    };
    const runtime = createGenerateFreeStreamRuntime(dependencies);

    const response = await runtime.service(createRequest({
      schema: 'general-scenario',
      prompt: '测试',
    }));

    expect(response).toBe(upstream);
    expect(response.headers.get('x-upstream')).toBe('preserved');
    expect(await response.text()).toBe('plain');
  });
});
