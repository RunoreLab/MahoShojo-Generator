import { describe, expect, it } from 'vitest';

import {
  createGenerateCanshouStreamRuntime,
  type GenerateCanshouStreamRuntimeDependencies,
} from '@mahoshojo/hosted-runtime/generate-canshou-stream-runtime';

const createRequest = (body: unknown, signal?: AbortSignal): Request => new Request(
  'https://example.test/api/generate-canshou-stream',
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

describe('generate canshou stream hosted runtime', () => {
  it('保留 legacy answer canonicalization 与残兽 prompt，并透传 signal/reasoning/usage/response', async () => {
    const events: string[] = [];
    const abortController = new AbortController();
    const upstream = new Response('# 潮痕兽', {
      status: 206,
      headers: { 'x-upstream': 'canshou-stream' },
    });
    const dependencies: GenerateCanshouStreamRuntimeDependencies = {
      canshouLore: '残兽不可被视为普通动物',
      findProvider: () => ({
        id: 'proxy',
        name: 'Proxy',
        baseUrl: '',
        type: 'openai',
      }),
      resolveModel: () => ({ modelId: 'canonical-model' }),
      checkRateLimit: async ({ actionType, providerMode }) => {
        events.push(`rate-limit:${actionType}:${providerMode}`);
        return null;
      },
      enforceSafety: async ({ text, sensitiveWordReason }) => {
        events.push(`safety:${text}:${sensitiveWordReason}`);
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
        expect(config.prompt).toContain('【残兽设定（必须遵守）】\n残兽不可被视为普通动物');
        expect(config.prompt).toContain('【参考设定】\n【设定来源：第一份】\n港口世界观');
        expect(config.prompt).toContain('Q: 目击了什么？\nA: 盐雾里的影子');
        expect(config.modelOverride).toBe('canonical-model');
        expect(options.abortSignal).toBe(request.signal);
        expect(options.loadBalanceStrategy).toBe('custom');
        options.onReasoningEvent?.({ type: 'reasoning-start' });
        options.telemetry.model = 'observed-model';
        return {
          response: upstream,
          usagePromise: Promise.resolve({ outputTokens: 55 }),
        };
      },
      recordActivity: () => events.push('activity'),
      logWarn: () => events.push('warn'),
      logError: () => events.push('error'),
    };
    const runtime = createGenerateCanshouStreamRuntime(dependencies);

    const request = createRequest({
      language: 'zh-CN',
      questionnaires: [{
        id: 'first',
        title: '第一份',
        kind: 'canshou',
        loreMarkdown: '港口世界观',
        questions: [{ id: 'q-1', question: '目击了什么？' }],
      }, {
        id: 'second',
        title: '第二份',
        kind: 'canshou',
        questions: [{ id: 'q-1', question: '另一问题？' }],
      }],
      answers: [{ questionId: 'q-1', answer: '盐雾里的影子' }],
      customProvider: {
        providerId: 'proxy',
        modelId: 'alias-model',
        apiKey: 'top-secret-key',
      },
    }, abortController.signal);
    const response = await runtime.service(request);

    expect(response).toBe(upstream);
    expect(response.headers.get('x-upstream')).toBe('canshou-stream');
    expect(await response.text()).toBe('# 潮痕兽');
    expect(events).toEqual([
      'rate-limit:canshou_generate:custom',
      'safety:盐雾里的影子:在残兽问卷中使用了危险符文',
      'reasoning:残兽档案（流式）',
      'generate',
      'reasoning-event',
      'activity',
      'bridge:206:observed-model',
    ]);
    expect(JSON.stringify(events)).not.toContain('top-secret-key');
  });
});
