import { describe, expect, it } from 'vitest';

import { AI_PROVIDER_CATALOG } from '@/lib/ai/constants';

const getProvider = (providerId: string) => {
  const provider = AI_PROVIDER_CATALOG.find((item) => item.id === providerId);
  if (!provider) throw new Error(`missing provider fixture: ${providerId}`);
  return provider;
};

describe('opencode providers', () => {
  it('OpenCode Zen 已注册且配置正确', () => {
    const zen = getProvider('opencode-zen');
    expect(zen.type).toBe('openai');
    expect(zen.baseUrl).toBe('https://opencode.ai/zen/v1');
    expect(zen.docsUrl).toBe('https://opencode.ai/auth');
    expect(zen.models.length).toBeGreaterThan(0);
  });

  it('OpenCode Go 已注册且配置正确', () => {
    const go = getProvider('opencode-go');
    expect(go.type).toBe('openai');
    expect(go.baseUrl).toBe('https://opencode.ai/zen/go/v1');
    expect(go.docsUrl).toBe('https://opencode.ai/auth');
    expect(go.models.length).toBeGreaterThan(0);
  });

  it('两个新增 provider 的模型列表非空且各自 value 唯一', () => {
    for (const provider of [getProvider('opencode-zen'), getProvider('opencode-go')]) {
      expect(provider.models.length).toBeGreaterThan(0);
      const values = provider.models.map((model) => model.value);
      for (const value of values) {
        expect(value.trim().length).toBeGreaterThan(0);
      }
      expect(new Set(values).size).toBe(values.length);
    }
  });
});
