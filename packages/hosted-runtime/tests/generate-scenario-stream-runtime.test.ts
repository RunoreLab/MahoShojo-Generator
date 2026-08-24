import { describe, expect, it } from 'vitest';

import {
  createGenerateScenarioStreamRuntime,
  type GenerateScenarioStreamRuntimeDependencies,
} from '@mahoshojo/hosted-runtime/generate-scenario-stream-runtime';

const createRequest = (body: unknown, signal?: AbortSignal): Request => new Request(
  'https://example.test/api/generate-scenario-stream',
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

describe('generate scenario stream hosted runtime', () => {
  it('归一化 empty fields/titleHint，透传 signal/reasoning/usage 与上游 response', async () => {
    const events: string[] = [];
    const abortController = new AbortController();
    const upstream = new Response('scenario markdown', {
      status: 203,
      headers: { 'x-upstream': 'scenario' },
    });
    const dependencies: GenerateScenarioStreamRuntimeDependencies = {
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
            events.push(`bridge:${response.status}:${options.aiModel}`);
            return response;
          },
        };
      },
      generateWithStreamAI: async (config, options) => {
        events.push('generate');
        expect(config.prompt).toContain('【重要】输出要求');
        expect(config.prompt).toContain('- roles');
        expect(config.prompt).not.toContain('- 123');
        expect(config.prompt).toContain('【用户期望的情景标题（可参考）】');
        expect(config.prompt).toContain('这是一个非常非常非常非常非常非常非常非常非常非常非常非常非常长的标题提示'.slice(0, 60));
        expect(config.prompt).toContain('【地点】\n海边');
        expect(config.modelOverride).toBe('canonical-model');
        expect(options.abortSignal).toBe(request.signal);
        expect(options.loadBalanceStrategy).toBe('custom');
        expect(options.onReasoningEvent).toBeTypeOf('function');
        options.onReasoningEvent?.({ type: 'reasoning-start' });
        options.telemetry.model = 'observed-model';
        return { response: upstream, usagePromise: Promise.resolve({ outputTokens: 42 }) };
      },
      recordActivity: () => events.push('activity'),
      logWarn: () => events.push('warn'),
      logError: () => events.push('error'),
    };
    const runtime = createGenerateScenarioStreamRuntime(dependencies);

    const request = createRequest({
      answers: { 地点: ' 海边 ', 空白: '' },
      language: 'zh-CN',
      fieldsToKeepEmpty: ['roles', 123, '   '],
      titleHint: '这是一个非常非常非常非常非常非常非常非常非常非常非常非常非常长的标题提示',
      customProvider: {
        providerId: 'proxy',
        modelId: 'alias-model',
        apiKey: 'top-secret-key',
      },
    }, abortController.signal);
    const response = await runtime.service(request);

    expect(response).toBe(upstream);
    expect(response.headers.get('x-upstream')).toBe('scenario');
    expect(await response.text()).toBe('scenario markdown');
    expect(events).toEqual([
      'rate-limit',
      'safety',
      'reasoning:情景卡（流式）',
      'generate',
      'reasoning-event',
      'activity',
      'bridge:203:observed-model',
    ]);
    expect(JSON.stringify(events)).not.toContain('top-secret-key');
  });
});
