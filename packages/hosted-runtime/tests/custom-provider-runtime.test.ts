import { describe, expect, it } from 'vitest';

import {
  inferCustomProviderMode,
  resolveCustomProviderRuntime,
  type CustomProviderRuntimeDependencies,
} from '../src/custom-provider-runtime';

const providers = [
  {
    id: 'system',
    name: '系统',
    baseUrl: '',
    type: 'openai' as const,
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: '  https://api.deepseek.com  ',
    type: 'deepseek' as const,
    mode: 'auto' as const,
  },
];

const dependencies: CustomProviderRuntimeDependencies = {
  findProvider: (providerId) => providers.find((provider) => provider.id === providerId) ?? null,
  resolveModel: (_provider, modelId) => modelId.trim().toLowerCase() === 'deepseek-v4-flash-0731'
    ? { modelId: 'deepseek-v4-flash' }
    : { modelId: modelId.trim() },
};

describe('custom provider runtime helper', () => {
  it('providerMode 以 trim 后的 providerId 判定', () => {
    expect(inferCustomProviderMode(undefined)).toBe('system');
    expect(inferCustomProviderMode({ providerId: ' system ' })).toBe('system');
    expect(inferCustomProviderMode({ providerId: ' deepseek ' })).toBe('custom');
    expect(inferCustomProviderMode({ providerId: '   ' })).toBe('system');
  });

  it('Provider override 使用 canonical model，availability channel 保留 legacy modelId', () => {
    const resolved = resolveCustomProviderRuntime({
      providerId: 'deepseek',
      modelId: 'deepseek-v4-flash-0731',
      apiKey: '  secret-key  ',
      maxOutputTokens: 65_536,
      generationOverrides: {
        temperature: 0.4,
        thinking: { mode: 'enabled', effort: 'high' },
      },
    }, dependencies);

    expect(resolved.response).toBeUndefined();
    expect(resolved.options).toEqual({
      channelContext: {
        providerId: 'deepseek',
        modelId: 'deepseek-v4-flash-0731',
      },
      loadBalanceStrategy: 'sequential',
      providerOverride: {
        name: 'DeepSeek',
        apiKey: 'secret-key',
        baseUrl: 'https://api.deepseek.com',
        model: 'deepseek-v4-flash',
        type: 'deepseek',
        mode: 'auto',
        retryCount: 1,
        skipProbability: 0,
        defaultMaxOutputTokens: 65_536,
        providerId: 'deepseek',
        generationOverrides: {
          temperature: 0.4,
          thinking: { mode: 'enabled', effort: 'high' },
        },
      },
      generationSettingsContext: {
        providerId: 'deepseek',
        userOverrides: {
          temperature: 0.4,
          thinking: { mode: 'enabled', effort: 'high' },
        },
      },
    });
  });

  it('保留 system model channel 与 Provider 失败 wire', async () => {
    const system = resolveCustomProviderRuntime({
      providerId: 'system',
      modelId: 'deepseek-v4-flash-0731',
      apiKey: '',
    }, dependencies);
    expect(system).toEqual({
      options: {
        channelContext: {
          providerId: 'system',
          modelId: 'deepseek-v4-flash',
        },
        generationSettingsContext: { providerId: 'system' },
      },
    });

    const unknownProvider = resolveCustomProviderRuntime({
      providerId: 'unknown',
      modelId: 'model',
      apiKey: 'key',
    }, dependencies);
    expect(unknownProvider.response?.status).toBe(400);
    expect(unknownProvider.response?.headers.get('content-type'))
      .toBe('text/plain;charset=UTF-8');
    expect(await unknownProvider.response?.json()).toEqual({ error: '未知的模型供应商 ID' });

    const missingKey = resolveCustomProviderRuntime({
      providerId: 'deepseek',
      modelId: 'deepseek-v4-pro',
      apiKey: '  ',
    }, dependencies);
    expect(missingKey.response?.status).toBe(400);
    expect(await missingKey.response?.json()).toEqual({ error: 'API Key 不能为空' });
  });
});
