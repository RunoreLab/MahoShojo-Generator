import { describe, expect, it } from 'vitest';

import {
  SCENARIO_GENERATION_ACTION_TYPE,
  createGenerateScenarioRuntime,
  type GenerateScenarioRuntimeDependencies,
} from '@mahoshojo/hosted-runtime/generate-scenario-runtime';

const createRequest = (body: unknown): Request => new Request(
  'https://example.test/api/generate-scenario',
  {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Mahoshojo-AI-Meta': 'true',
    },
    body: JSON.stringify(body),
  },
);

describe('generate scenario hosted runtime', () => {
  it('持有 fieldsToKeepEmpty prompt/schema，并按 activity→created_at/signature→AI meta response 完成', async () => {
    const events: string[] = [];
    const dependencies: GenerateScenarioRuntimeDependencies = {
      findProvider: () => ({
        id: 'deepseek',
        name: 'DeepSeek',
        baseUrl: 'https://api.deepseek.com',
        type: 'deepseek',
      }),
      resolveModel: () => ({ modelId: 'canonical-model' }),
      checkRateLimit: async ({ actionType, providerMode }) => {
        events.push(`rate-limit:${actionType}:${providerMode}`);
        return null;
      },
      enforceSafety: async ({ text, aiPromptTemplate, logMeta }) => {
        events.push(`safety:${text}:${aiPromptTemplate}:${logMeta.answersCount}`);
        return null;
      },
      generateWithAI: async (input, config, options) => {
        events.push(`generate:${String(input)}`);
        const prompt = config.promptBuilder(input);
        expect(prompt).toContain('## 核心创作原则');
        expect(prompt).toContain('- elements.roles');
        expect(prompt).toContain('【地点】\n旧图书馆');
        expect(config.schema.safeParse({
          title: '馆藏低语',
          scenario_type: '调查',
          description: '测试',
          elements: {
            scene: {},
            events: '寻找书页',
            atmosphere: '诡谲',
            development: [],
          },
        }).success).toBe(true);
        expect(options.loadBalanceStrategy).toBe('custom');
        expect(options.providerOverride?.model).toBe('canonical-model');
        options.telemetry.model = 'canonical-model';
        return {
          title: '馆藏低语',
          scenario_type: '调查',
          description: '测试',
          elements: {
            scene: {},
            events: '寻找书页',
            atmosphere: '诡谲',
            development: [],
          },
        };
      },
      now: () => new Date('2026-08-24T02:03:04.000Z'),
      sign: async (payload) => {
        events.push(`sign:${payload.metadata.created_at}`);
        return 'native-signature';
      },
      recordActivity: () => events.push('activity'),
      buildResponse: ({ data, telemetry }) => {
        events.push(`response:${String(telemetry.model)}`);
        return new Response(JSON.stringify({ data, aiMeta: { aiModel: telemetry.model } }));
      },
      logWarn: () => events.push('warn'),
      logError: () => events.push('error'),
    };
    const runtime = createGenerateScenarioRuntime(dependencies);

    const response = await runtime.service(createRequest({
      answers: { 地点: '旧图书馆', 忽略: '' },
      language: 'zh-CN',
      fieldsToKeepEmpty: ['elements.roles'],
      customProvider: {
        providerId: 'deepseek',
        modelId: 'alias-model',
        apiKey: 'top-secret-key',
      },
    }));

    expect(SCENARIO_GENERATION_ACTION_TYPE).toBe('scenario_generate');
    expect(Object.isFrozen(runtime)).toBe(true);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: {
        title: '馆藏低语',
        scenario_type: '调查',
        description: '测试',
        elements: {
          scene: {},
          events: '寻找书页',
          atmosphere: '诡谲',
          development: [],
        },
        metadata: {
          created_at: '2026-08-24T02:03:04.000Z',
          signature: 'native-signature',
        },
      },
      aiMeta: { aiModel: 'canonical-model' },
    });
    expect(events).toEqual([
      'rate-limit:scenario_generate:custom',
      'safety:旧图书馆 :scenario:2',
      'generate:null',
      'activity',
      'sign:2026-08-24T02:03:04.000Z',
      'response:canonical-model',
    ]);
    expect(JSON.stringify(events)).not.toContain('top-secret-key');
  });

  it('无效 custom provider 只记录 providerId/issues，不泄漏 API key 或触发 AI/activity', async () => {
    const events: string[] = [];
    const dependencies: GenerateScenarioRuntimeDependencies = {
      findProvider: () => null,
      resolveModel: () => null,
      checkRateLimit: async () => null,
      enforceSafety: async () => null,
      generateWithAI: async () => {
        events.push('generate');
        return {} as never;
      },
      now: () => new Date(0),
      sign: async () => null,
      recordActivity: () => events.push('activity'),
      buildResponse: () => new Response(null),
      logWarn: (message, meta) => events.push(`${message}:${JSON.stringify(meta)}`),
      logError: () => events.push('error'),
    };
    const runtime = createGenerateScenarioRuntime(dependencies);

    const response = await runtime.service(createRequest({
      answers: { key: 'value' },
      customProvider: {
        providerId: '',
        modelId: 'model',
        apiKey: 'top-secret-key',
      },
    }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: '自定义 AI 供应商配置无效' });
    expect(events).toHaveLength(1);
    expect(events[0]).toContain('自定义 AI 供应商配置校验失败');
    expect(events[0]).not.toContain('top-secret-key');
  });
});
