import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

import { AI_PROVIDER_CATALOG } from '@/lib/ai/constants';
import {
  buildCustomProviderPayload,
  buildCustomProviderRequestPayload,
  isDeepSeekV4Model,
  isUsingUserProvidedKey,
} from '@/lib/ai/custom-provider';
import { parseAiSessionCustomProvider, resolveAiSessionProvider } from '@/lib/ai-session/provider';

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

  it('自定义 provider payload 会透传有效的最大输出 Tokens', () => {
    expect(buildCustomProviderPayload({
      providerId: 'kourichat',
      modelId: 'deepseek-v4-flash',
      apiKey: 'sk-xxx',
      maxOutputTokens: 65536,
    })).toEqual({
      providerId: 'kourichat',
      modelId: 'deepseek-v4-flash',
      apiKey: 'sk-xxx',
      maxOutputTokens: 65536,
    });

    expect(buildCustomProviderPayload({
      providerId: 'kourichat',
      modelId: 'deepseek-v4-flash',
      apiKey: 'sk-xxx',
      maxOutputTokens: 0,
    })).toEqual({
      providerId: 'kourichat',
      modelId: 'deepseek-v4-flash',
      apiKey: 'sk-xxx',
    });
  });

  it('自定义 provider 请求 payload 会保留最大输出 Tokens 并修剪 API Key', () => {
    expect(buildCustomProviderRequestPayload({
      providerId: 'kourichat',
      modelId: 'deepseek-ai/DeepSeek-V4-Flash',
      apiKey: '  sk-xxx  ',
      maxOutputTokens: 65536,
    })).toEqual({
      providerId: 'kourichat',
      modelId: 'deepseek-ai/DeepSeek-V4-Flash',
      apiKey: 'sk-xxx',
      maxOutputTokens: 65536,
    });
  });

  it('竞技场生成请求复用请求 payload helper，避免丢失最大输出 Tokens', async () => {
    const source = await readFile('components/arena/hooks/useBattleEngine.ts', 'utf8');
    const helperCalls = source.match(/buildCustomProviderRequestPayload\(userProviderConfig\)/g) ?? [];

    expect(helperCalls.length).toBeGreaterThanOrEqual(2);
    expect(source).not.toMatch(/customProvider\s*=\s*\{[\s\S]{0,240}providerId:\s*userProviderConfig\.providerId/);
  });

  it('DeepSeek V4 模型识别覆盖普通与带命名空间的 modelId', () => {
    expect(isDeepSeekV4Model('deepseek-v4-flash')).toBe(true);
    expect(isDeepSeekV4Model('deepseek-ai/DeepSeek-V4-Pro')).toBe(true);
    expect(isDeepSeekV4Model('vendor/deepseek_v4_flash')).toBe(true);
    expect(isDeepSeekV4Model('deepseek-v3.2')).toBe(false);
    expect(isDeepSeekV4Model('not-deepseek-v4-flash')).toBe(false);
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

  it('自定义 provider 解析会把最大输出 Tokens 放入 provider 默认值', () => {
    const resolved = resolveAiSessionProvider({
      providerId: 'kourichat',
      modelId: 'deepseek-v4-flash',
      apiKey: 'sk-test',
      maxOutputTokens: 65536,
    });

    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.value.providerOverride?.defaultMaxOutputTokens).toBe(65536);
  });

  it('自定义 provider schema 拒绝非法最大输出 Tokens', () => {
    for (const maxOutputTokens of [0, -1, 1.5, 1_000_001]) {
      const parsed = parseAiSessionCustomProvider({
        providerId: 'kourichat',
        modelId: 'deepseek-v4-flash',
        apiKey: 'sk-test',
        maxOutputTokens,
      });

      expect(parsed.ok).toBe(false);
      if (parsed.ok) return;
      expect(parsed.error).toBe('customProvider 无效');
    }
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
