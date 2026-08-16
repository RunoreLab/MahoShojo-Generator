import { describe, expect, it } from 'vitest';

import { AI_PROVIDER_CATALOG } from '@/lib/ai/constants';

const getProvider = (id: string) => AI_PROVIDER_CATALOG.find((provider) => provider.id === id);

describe('opencode providers', () => {
  it('OpenCode Zen 已注册且配置正确', () => {
    const zen = getProvider('opencode-zen');
    expect(zen).toBeDefined();
    expect(zen?.type).toBe('openai');
    expect(zen?.baseUrl).toBe('https://opencode.ai/zen/v1');
    expect(zen?.docsUrl).toBe('https://opencode.ai/auth');
    expect(zen?.models.length).toBeGreaterThan(0);
  });

  it('OpenCode Go 已注册且配置正确', () => {
    const go = getProvider('opencode-go');
    expect(go).toBeDefined();
    expect(go?.type).toBe('openai');
    expect(go?.baseUrl).toBe('https://opencode.ai/zen/go/v1');
    expect(go?.docsUrl).toBe('https://opencode.ai/auth');
    expect(go?.models.length).toBeGreaterThan(0);
  });

  it('两个新增 provider 的模型列表互不冲突且非空', () => {
    const zen = getProvider('opencode-zen');
    const go = getProvider('opencode-go');
    const zenValues = new Set(zen?.models.map((model) => model.value));
    const goValues = new Set(go?.models.map((model) => model.value));

    expect(zenValues.size).toBe(zen?.models.length);
    expect(goValues.size).toBe(go?.models.length);
    for (const value of zenValues) {
      expect(value.trim().length).toBeGreaterThan(0);
    }
    for (const value of goValues) {
      expect(value.trim().length).toBeGreaterThan(0);
    }
  });
});
