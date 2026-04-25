import { describe, expect, it } from 'bun:test';

import { AI_PROVIDER_CATALOG } from '@/lib/ai/constants';
import { buildCustomProviderPayload, isUsingUserProvidedKey } from '@/lib/ai/custom-provider';
import { resolveAiSessionProvider } from '@/lib/ai-session/provider';

const getProvider = (providerId: string) => {
  const provider = AI_PROVIDER_CATALOG.find((item) => item.id === providerId);
  if (!provider) throw new Error(`missing provider fixture: ${providerId}`);
  return provider;
};

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

  it('预置 provider 可以使用目录外的自填 modelId', () => {
    const resolved = resolveAiSessionProvider({
      providerId: 'kourichat',
      modelId: 'vendor/custom-model-2026-04-25',
      apiKey: 'sk-test',
    });

    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.value.providerMode).toBe('custom');
    expect(resolved.value.providerId).toBe('kourichat');
    expect(resolved.value.modelId).toBe('vendor/custom-model-2026-04-25');
    expect(resolved.value.providerOverride?.model).toBe('vendor/custom-model-2026-04-25');
    expect(resolved.value.providerOverride?.baseUrl).toBe(getProvider('kourichat').baseUrl);
  });

  it('system provider 不接受目录外自填 modelId', () => {
    const resolved = resolveAiSessionProvider({
      providerId: 'system',
      modelId: 'vendor/custom-model-2026-04-25',
      apiKey: '',
    });

    expect(resolved.ok).toBe(false);
    if (resolved.ok) return;
    expect(resolved.error).toBe('未知的模型 ID');
    expect(resolved.status).toBe(400);
  });

  it('自填 modelId 拒绝空值和控制字符', () => {
    for (const modelId of ['', '   ', 'valid\nbad']) {
      const resolved = resolveAiSessionProvider({
        providerId: 'kourichat',
        modelId,
        apiKey: 'sk-test',
      });

      expect(resolved.ok).toBe(false);
      if (resolved.ok) return;
      expect(resolved.error).toBe('未知的模型 ID');
      expect(resolved.status).toBe(400);
    }
  });
});
