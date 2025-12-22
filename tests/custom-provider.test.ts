import { describe, expect, it } from 'bun:test';

import { buildCustomProviderPayload, isUsingUserProvidedKey } from '@/lib/ai/custom-provider';

describe('custom provider helpers', () => {
  it('空配置不产生 payload', () => {
    expect(buildCustomProviderPayload(null)).toBeUndefined();
    expect(buildCustomProviderPayload(undefined)).toBeUndefined();
  });

  it('系统默认策略不产生 payload', () => {
    expect(buildCustomProviderPayload({ providerId: 'system', modelId: 'default', apiKey: '' })).toBeUndefined();
  });

  it('系统自定义模型会产生 payload（不要求 apiKey）', () => {
    expect(buildCustomProviderPayload({ providerId: 'system', modelId: 'gemini-2.5-flash', apiKey: '' })).toEqual({
      providerId: 'system',
      modelId: 'gemini-2.5-flash',
      apiKey: '',
    });
  });

  it('非系统 provider 需要 apiKey 才产生 payload', () => {
    expect(buildCustomProviderPayload({ providerId: 'kourichat', modelId: 'gemini-2.5-flash', apiKey: '' })).toBeUndefined();
    expect(buildCustomProviderPayload({ providerId: 'kourichat', modelId: 'gemini-2.5-flash', apiKey: '   ' })).toBeUndefined();
    expect(buildCustomProviderPayload({ providerId: 'kourichat', modelId: 'gemini-2.5-flash', apiKey: 'sk-xxx' })).toEqual({
      providerId: 'kourichat',
      modelId: 'gemini-2.5-flash',
      apiKey: 'sk-xxx',
    });
  });

  it('isUsingUserProvidedKey 只对非 system 且 apiKey 非空返回 true', () => {
    expect(isUsingUserProvidedKey(null)).toBe(false);
    expect(isUsingUserProvidedKey({ providerId: 'system', modelId: 'gemini-2.5-flash', apiKey: '' })).toBe(false);
    expect(isUsingUserProvidedKey({ providerId: 'kourichat', modelId: 'gemini-2.5-flash', apiKey: '' })).toBe(false);
    expect(isUsingUserProvidedKey({ providerId: 'kourichat', modelId: 'gemini-2.5-flash', apiKey: '  ' })).toBe(false);
    expect(isUsingUserProvidedKey({ providerId: 'kourichat', modelId: 'gemini-2.5-flash', apiKey: 'sk-xxx' })).toBe(true);
  });
});

