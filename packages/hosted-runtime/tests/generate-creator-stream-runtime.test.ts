import { describe, expect, it } from 'vitest';

import {
  createGenerateCreatorStreamRuntime,
  type GenerateCreatorStreamRuntimeDependencies,
} from '@mahoshojo/hosted-runtime/generate-creator-stream-runtime';

const createRequest = (body: unknown, signal?: AbortSignal): Request => new Request(
  'https://example.test/api/creator/generate-stream',
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

describe('generate creator stream hosted runtime', () => {
  it('持有 general-scenario validation/prompt，并透传 signal/reasoning/usage 与上游 response', async () => {
    const events: string[] = [];
    const abortController = new AbortController();
    const upstream = new Response('# 雾港', {
      status: 203,
      headers: { 'x-upstream': 'creator-stream' },
    });
    const dependencies: GenerateCreatorStreamRuntimeDependencies = {
      findProvider: () => ({
        id: 'proxy',
        name: 'Proxy',
        baseUrl: '',
        type: 'openai',
      }),
      resolveModel: () => ({ modelId: 'canonical-model' }),
      resolveBuildRules: () => [],
      validateCreatorRequest: (input) => {
        events.push(`validate:${input.template}`);
      },
      buildCreatorPromptInput: (input) => ({
        template: input.template,
        userIntent: input.freeformBrief ?? '',
        questionnaireSummary: '',
        buildRuleProjection: { primary: null, references: [] },
      }),
      checkRateLimit: async ({ actionType, providerMode }) => {
        events.push(`rate-limit:${actionType}:${providerMode}`);
        return null;
      },
      enforceSafety: async ({ text }) => {
        events.push(`safety:${text}`);
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
        expect(config.prompt).toContain('生成一份【情景卡】');
        expect(config.prompt).toContain('自由补充的港口调查');
        expect(config.prompt).toContain('【设定来源：上传问卷】\n潮汐会记录秘密');
        expect(config.prompt).toContain('Q: 调查目标？\nA: 失踪船只');
        expect(config.modelOverride).toBe('canonical-model');
        expect(options.abortSignal).toBe(request.signal);
        expect(options.loadBalanceStrategy).toBe('custom');
        expect(options.onReasoningEvent).toBeTypeOf('function');
        options.onReasoningEvent?.({ type: 'reasoning-start' });
        options.telemetry.model = 'observed-model';
        return {
          response: upstream,
          usagePromise: Promise.resolve({ outputTokens: 42 }),
        };
      },
      recordActivity: () => events.push('activity'),
      logWarn: () => events.push('warn'),
      logError: () => events.push('error'),
    };
    const runtime = createGenerateCreatorStreamRuntime(dependencies);

    const request = createRequest({
      template: 'general-scenario',
      language: 'zh-CN',
      freeformBrief: '自由补充的港口调查',
      questionnaires: [{
        id: 'upload-1',
        title: '上传问卷',
        kind: 'magical-girl',
        loreMarkdown: '潮汐会记录秘密',
        questions: [{ id: 'q-1', question: '调查目标？' }],
      }],
      answers: [{
        questionnaireId: 'upload-1',
        questionId: 'q-1',
        answer: '失踪船只',
      }],
      customProvider: {
        providerId: 'proxy',
        modelId: 'alias-model',
        apiKey: 'top-secret-key',
      },
    }, abortController.signal);
    const response = await runtime.service(request);

    expect(response).toBe(upstream);
    expect(response.headers.get('x-upstream')).toBe('creator-stream');
    expect(await response.text()).toBe('# 雾港');
    expect(events).toEqual([
      'validate:general-scenario',
      'rate-limit:magical_girl_details_generate:custom',
      'safety:失踪船只',
      'safety:自由补充的港口调查',
      'reasoning:魔法少女档案（流式）',
      'generate',
      'reasoning-event',
      'activity',
      'bridge:203:observed-model',
    ]);
    expect(JSON.stringify(events)).not.toContain('top-secret-key');
  });
});
