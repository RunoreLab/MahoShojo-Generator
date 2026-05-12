import { describe, expect, it } from 'bun:test';

import { AI_PROVIDER_CATALOG } from '@/lib/ai/constants';

describe('ai-provider-catalog', () => {
  it('provider id 必须唯一', () => {
    const seen = new Set<string>();
    const duplicates: string[] = [];

    for (const provider of AI_PROVIDER_CATALOG) {
      if (seen.has(provider.id)) duplicates.push(provider.id);
      seen.add(provider.id);
    }

    expect(duplicates).toEqual([]);
  });

  it('每个 provider 的 model value 必须唯一', () => {
    const errors: Array<{ providerId: string; duplicates: string[] }> = [];

    for (const provider of AI_PROVIDER_CATALOG) {
      const seen = new Set<string>();
      const duplicates = new Set<string>();

      for (const model of provider.models) {
        if (seen.has(model.value)) duplicates.add(model.value);
        seen.add(model.value);
      }

      if (duplicates.size > 0) {
        errors.push({ providerId: provider.id, duplicates: Array.from(duplicates) });
      }
    }

    expect(errors).toEqual([]);
  });

  it('已有 Gemma 模型目录包含新的 Gemma 4 模型', () => {
    const providerIds = ['system', 'google-cloudflare'];

    for (const providerId of providerIds) {
      const provider = AI_PROVIDER_CATALOG.find(item => item.id === providerId);
      const modelValues = provider?.models.map(model => model.value) ?? [];

      expect(modelValues).toContain('gemma-4-31b-it');
      expect(modelValues).toContain('gemma-4-26b-a4b-it');
    }
  });

  it('词元跳动目录包含 OpenAI 兼容端点与关键文本模型', () => {
    const provider = AI_PROVIDER_CATALOG.find(item => item.id === 'tokendance');
    const modelValues = provider?.models.map(model => model.value) ?? [];

    expect(provider?.name).toBe('词元跳动 TokenDance');
    expect(provider?.baseUrl).toBe('https://tokendance.space/gateway/v1');
    expect(provider?.type).toBe('openai');
    expect(modelValues).toEqual(expect.arrayContaining([
      'minimax-m2.7',
      'glm-5.1',
      'deepseek-v4-flash',
      'kimi-k2.6',
      'seed-2.0-pro',
    ]));
  });

  it('小米 MiMo 目录区分普通 API 与 Token Plan 端点', () => {
    const normalProvider = AI_PROVIDER_CATALOG.find(item => item.id === 'xiaomi-mimo');
    const tokenPlanProviders = [
      AI_PROVIDER_CATALOG.find(item => item.id === 'xiaomi-mimo-token-plan-cn'),
      AI_PROVIDER_CATALOG.find(item => item.id === 'xiaomi-mimo-token-plan-ams'),
      AI_PROVIDER_CATALOG.find(item => item.id === 'xiaomi-mimo-token-plan-sgp'),
    ];

    expect(normalProvider?.name).toBe('小米 MiMo');
    expect(normalProvider?.baseUrl).toBe('https://api.xiaomimimo.com/v1');
    expect(normalProvider?.type).toBe('openai');
    expect(normalProvider?.description).toContain('sk-');
    expect(normalProvider?.models.map(model => model.value)).toEqual(expect.arrayContaining([
      'mimo-v2.5-pro',
      'mimo-v2.5',
      'mimo-v2.5-flash',
      'mimo-v2-pro',
      'mimo-v2-omni',
      'mimo-v2-flash',
    ]));

    expect(tokenPlanProviders.map(provider => provider?.baseUrl)).toEqual([
      'https://token-plan-cn.xiaomimimo.com/v1',
      'https://token-plan-ams.xiaomimimo.com/v1',
      'https://token-plan-sgp.xiaomimimo.com/v1',
    ]);
    for (const provider of tokenPlanProviders) {
      expect(provider?.type).toBe('openai');
      expect(provider?.description).toContain('tp-');
      expect(provider?.models.map(model => model.value)).toEqual(expect.arrayContaining([
        'mimo-v2.5-pro',
        'mimo-v2.5',
        'mimo-v2.5-flash',
        'mimo-v2-pro',
        'mimo-v2-omni',
        'mimo-v2-flash',
      ]));
    }
  });

  it('商汤 Token Plan 目录包含免费额度相关模型', () => {
    const provider = AI_PROVIDER_CATALOG.find(item => item.id === 'sensenova-token-plan');
    const modelValues = provider?.models.map(model => model.value) ?? [];

    expect(provider?.name).toBe('商汤 SenseNova Token Plan');
    expect(provider?.baseUrl).toBe('https://api.sensenova.cn/v1');
    expect(provider?.type).toBe('openai');
    expect(provider?.description).toContain('Token Plan');
    expect(modelValues).toEqual(expect.arrayContaining([
      'deepseek-v4-flash',
      'sensenova-6.7-flash-lite',
      'sensenova-u1-fast',
    ]));
  });
});
