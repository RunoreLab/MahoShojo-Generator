import { describe, expect, it, vi } from 'vitest';

import type { CustomProviderRuntimeDependencies } from '../src/custom-provider-runtime';

import {
  createGenerateMagicalGirlDetailsRuntime,
  type GenerateMagicalGirlDetailsRuntimeDependencies,
} from '@mahoshojo/hosted-runtime/generate-magical-girl-details-runtime';
import {
  createGenerateMagicalGirlDetailsStreamRuntime,
  type GenerateMagicalGirlDetailsStreamRuntimeDependencies,
} from '@mahoshojo/hosted-runtime/generate-magical-girl-details-stream-runtime';
import {
  createGenerateSublimationRuntime,
  type GenerateSublimationRuntimeDependencies,
} from '@mahoshojo/hosted-runtime/generate-sublimation-runtime';
import {
  createGenerateSublimationStreamRuntime,
  type GenerateSublimationStreamRuntimeDependencies,
} from '@mahoshojo/hosted-runtime/generate-sublimation-stream-runtime';

const questionnaire = {
  id: 'q-card',
  title: '测试问卷',
  kind: 'magical-girl' as const,
  questions: [{ id: 'q-1', question: '为何而战？', required: false, maxLength: null }],
};

const request = (body: Record<string, unknown>) => new Request(
  'https://example.test/api/generate',
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  },
);

const providerPorts = (logs: unknown[], findProvider: ReturnType<typeof createFindProvider>) => ({
  findProvider,
  resolveModel: (_provider: unknown, modelId: string) => modelId === 'unknown-model'
    ? null
    : { modelId: `canonical:${modelId}` },
  logInfo: (message: string, meta: Record<string, unknown>) => logs.push({ message, meta }),
  logWarn: (message: string, meta: Record<string, unknown>) => logs.push({ message, meta }),
});

function createFindProvider() {
  return vi.fn<CustomProviderRuntimeDependencies['findProvider']>(
    (providerId: string) => providerId === 'deepseek'
    ? {
      id: 'deepseek',
      name: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com',
      type: 'deepseek' as const,
    }
    : null,
  );
}

type RouteHarness = {
  service(_request: Request): Promise<Response>;
  generate: ReturnType<typeof vi.fn>;
  activity: ReturnType<typeof vi.fn>;
  sign: ReturnType<typeof vi.fn>;
  findProvider: ReturnType<typeof createFindProvider>;
  logs: unknown[];
  body: Record<string, unknown>;
};

const createRouteHarness = (
  route: 'details' | 'details-stream' | 'sublimation' | 'sublimation-stream',
  policies: { rateLimit?: Response; safety?: Response } = {},
): RouteHarness => {
  const logs: unknown[] = [];
  const generate = vi.fn();
  const activity = vi.fn();
  const sign = vi.fn(async () => 'signature');
  const findProvider = createFindProvider();
  const common = {
    ...providerPorts(logs, findProvider),
    checkRateLimit: async () => policies.rateLimit ?? null,
    enforceSafety: async () => policies.safety ?? null,
    recordActivity: activity,
    logError: vi.fn(),
  };

  if (route === 'details') {
    generate.mockImplementation(async (_input, _config, options) => {
      expect(options).toMatchObject({
        channelContext: { providerId: 'deepseek', modelId: 'model-alias' },
        loadBalanceStrategy: 'custom',
        providerOverride: {
          apiKey: 'secret-provider-key',
          model: 'canonical:model-alias',
          generationOverrides: { temperature: 0.4 },
        },
        generationSettingsContext: {
          providerId: 'deepseek',
          userOverrides: { temperature: 0.4 },
        },
      });
      return { codename: '测试花名' };
    });
    const dependencies = {
      ...common,
      presetIndex: { presets: [] },
      loadPreset: async () => null,
      loadDataCard: async () => null,
      getRandomFlowers: () => '测试花：守护',
      generateWithAI: generate,
      sign,
      findProvider,
      buildResponse: ({ data }: { data: Record<string, unknown> }) => (
        new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } })
      ),
    } satisfies GenerateMagicalGirlDetailsRuntimeDependencies;
    return {
      service: createGenerateMagicalGirlDetailsRuntime(dependencies).service,
      generate,
      activity,
      sign,
      findProvider,
      logs,
      body: { answers: ['守护同伴'], questionnaires: [questionnaire] },
    };
  }

  if (route === 'details-stream') {
    generate.mockImplementation(async (_config, options) => {
      expect(options).toMatchObject({
        channelContext: { providerId: 'deepseek', modelId: 'model-alias' },
        loadBalanceStrategy: 'custom',
        providerOverride: {
          apiKey: 'secret-provider-key',
          model: 'canonical:model-alias',
        },
      });
      return { response: new Response('details-stream') };
    });
    const dependencies = {
      ...common,
      getRandomFlowers: () => '测试花：守护',
      shouldUseReasoningSse: () => false,
      createReasoningSseBridge: vi.fn(),
      generateWithStreamAI: generate,
    } satisfies GenerateMagicalGirlDetailsStreamRuntimeDependencies;
    return {
      service: createGenerateMagicalGirlDetailsStreamRuntime(dependencies).service,
      generate,
      activity,
      sign,
      findProvider,
      logs,
      body: { answers: ['守护同伴'], questionnaires: [questionnaire] },
    };
  }

  if (route === 'sublimation') {
    generate.mockImplementation(async (_input, _config, options) => {
      expect(options).toMatchObject({
        channelContext: { providerId: 'deepseek', modelId: 'model-alias' },
        loadBalanceStrategy: 'custom',
        providerOverride: {
          apiKey: 'secret-provider-key',
          model: 'canonical:model-alias',
        },
      });
      return {
        updatedCharacterData: { name: '测试角色「新生」', content: '完成成长' },
        sublimationEvent: { title: '新生', impact: '完成成长' },
      };
    });
    const dependencies = {
      ...common,
      presetIndex: { presets: [] },
      defaultQuestions: { magicalGirl: [], canshou: [] },
      allowGuidedNativeSigning: false,
      loadPreset: async () => null,
      loadDataCard: async () => null,
      generateWithAI: generate,
      verify: async () => false,
      sign,
      buildResponse: ({ data }: { data: Record<string, unknown> }) => (
        new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } })
      ),
      now: () => new Date('2026-08-26T00:00:00.000Z'),
    } satisfies GenerateSublimationRuntimeDependencies;
    return {
      service: createGenerateSublimationRuntime(dependencies).service,
      generate,
      activity,
      sign,
      findProvider,
      logs,
      body: {
        templateId: '通用角色',
        name: '测试角色',
        content: '原始设定',
        targetTemplate: 'general',
        writeArenaHistory: false,
        writeCurrentState: false,
      },
    };
  }

  generate.mockImplementation(async (_config, options) => {
    expect(options).toMatchObject({
      channelContext: { providerId: 'deepseek', modelId: 'model-alias' },
      loadBalanceStrategy: 'custom',
      providerOverride: {
        apiKey: 'secret-provider-key',
        model: 'canonical:model-alias',
      },
    });
    return { response: new Response('sublimation-stream') };
  });
  const dependencies = {
    ...common,
    shouldUseReasoningSse: () => false,
    createReasoningSseBridge: vi.fn(),
    generateWithStreamAI: generate,
  } satisfies GenerateSublimationStreamRuntimeDependencies;
  return {
    service: createGenerateSublimationStreamRuntime(dependencies).service,
    generate,
    activity,
    sign,
    findProvider,
    logs,
    body: {
      templateId: '通用角色',
      name: '测试角色',
      content: '原始设定',
      targetTemplate: 'general',
    },
  };
};

const validCustomProvider = {
  providerId: 'deepseek',
  modelId: 'model-alias',
  apiKey: 'secret-provider-key',
  generationOverrides: { temperature: 0.4 },
};

describe('Details / Sublimation custom Provider wiring', () => {
  it.each([
    'details',
    'details-stream',
    'sublimation',
    'sublimation-stream',
  ] as const)('%s 透传 canonical Provider options 且不把 API key 写入 wire/log', async (route) => {
    const harness = createRouteHarness(route);

    const response = await harness.service(request({
      ...harness.body,
      customProvider: validCustomProvider,
    }));
    const responseBody = await response.text();

    expect(response.status).toBe(200);
    expect(harness.generate).toHaveBeenCalledOnce();
    expect(harness.activity).toHaveBeenCalledOnce();
    expect(`${responseBody}${JSON.stringify(harness.logs)}`).not.toContain('secret-provider-key');
  });

  it.each([
    {
      name: 'unknown provider',
      payload: { ...validCustomProvider, providerId: 'unknown' },
      error: '未知的模型供应商 ID',
    },
    {
      name: 'unknown model',
      payload: { ...validCustomProvider, modelId: 'unknown-model' },
      error: '未知的模型 ID',
    },
    {
      name: 'empty API key',
      payload: { ...validCustomProvider, apiKey: '   ' },
      error: 'API Key 不能为空',
    },
    {
      name: 'malformed overrides',
      payload: {
        ...validCustomProvider,
        generationOverrides: { temperature: 'secret-provider-key' },
      },
      error: '自定义 AI 供应商配置无效',
    },
  ])('$name 在四路都 fail closed 且不进入 AI/activity/signature', async ({ payload, error }) => {
    for (const route of [
      'details',
      'details-stream',
      'sublimation',
      'sublimation-stream',
    ] as const) {
      const harness = createRouteHarness(route);
      const response = await harness.service(request({
        ...harness.body,
        customProvider: payload,
      }));
      const responseBody = await response.text();

      expect(response.status, route).toBe(400);
      expect(JSON.parse(responseBody), route).toEqual({ error });
      expect(harness.generate, route).not.toHaveBeenCalled();
      expect(harness.activity, route).not.toHaveBeenCalled();
      expect(harness.sign, route).not.toHaveBeenCalled();
      expect(`${responseBody}${JSON.stringify(harness.logs)}`, route)
        .not.toContain('secret-provider-key');
    }
  });

  it.each([
    {
      policy: 'rate limit',
      kind: 'rateLimit',
      status: 429,
      body: { error: 'rate-limited' },
    },
    {
      policy: 'safety',
      kind: 'safety',
      status: 400,
      body: { error: 'unsafe-input' },
    },
  ] as const)('$policy 在四路都精确 short-circuit 后续副作用', async ({
    kind,
    status,
    body,
  }) => {
    for (const route of [
      'details',
      'details-stream',
      'sublimation',
      'sublimation-stream',
    ] as const) {
      const policyResponse = new Response(JSON.stringify(body), { status });
      const harness = createRouteHarness(route, kind === 'rateLimit'
        ? { rateLimit: policyResponse }
        : { safety: policyResponse });

      const response = await harness.service(request({
        ...harness.body,
        customProvider: validCustomProvider,
      }));

      expect(response.status, route).toBe(status);
      expect(await response.json(), route).toEqual(body);
      expect(harness.generate, route).not.toHaveBeenCalled();
      expect(harness.activity, route).not.toHaveBeenCalled();
      expect(harness.sign, route).not.toHaveBeenCalled();
      // Details structured 保持既有 provider-before-policy 顺序；其他三路在 policy 前不解析 Provider。
      expect(harness.findProvider.mock.calls.length, route).toBe(route === 'details' ? 1 : 0);
    }
  });
});
