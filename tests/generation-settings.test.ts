import { describe, expect, it } from 'vitest';

import { resolveGenerationSettings } from '@/lib/ai/generation-settings/resolve';
import { getModelGenerationCapabilities } from '@/lib/ai/generation-settings/model-capabilities';
import { buildThinkingProviderOptions } from '@/lib/ai/generation-settings/provider-adapters';
import { UserGenerationOverridesSchema } from '@/lib/ai/generation-settings/schemas';
import type { UserGenerationOverrides } from '@/lib/ai/generation-settings/types';

const resolve = (overrides: UserGenerationOverrides = {}, opts: { providerId?: string; modelId?: string } = {}) =>
  resolveGenerationSettings({
    providerId: opts.providerId ?? 'openai',
    modelId: opts.modelId ?? 'gpt-5.6',
    taskDefaults: { temperature: 0.8, maxOutputTokens: 2048 },
    providerDefaults: { defaultMaxOutputTokens: 4096 },
    userOverrides: overrides,
  });

describe('resolveGenerationSettings - temperature', () => {
  it('支持 temperature 的模型：用户覆盖优先于任务默认', () => {
    const result = resolve({ temperature: 0.7 });
    expect(result.standardOptions.temperature).toBe(0.7);
    expect(result.diagnostics.omitted).toHaveLength(0);
  });

  it('未设置时使用任务默认 temperature', () => {
    const result = resolve({});
    expect(result.standardOptions.temperature).toBe(0.8);
  });

  it('已知不支持 temperature 的模型：丢弃并记录 omitted', () => {
    const result = resolve(
      { temperature: 0.7 },
      { providerId: 'google-cloudflare', modelId: 'gemini-2.5-flash' },
    );
    expect(result.standardOptions.temperature).toBeUndefined();
    expect(result.diagnostics.omitted).toContainEqual({ field: 'temperature', reason: 'unsupported' });
  });

  it('未知模型（unknown）：尝试发送', () => {
    const result = resolve({ temperature: 0.7 }, { providerId: 'custom-vendor', modelId: 'custom-model' });
    expect(result.standardOptions.temperature).toBe(0.7);
  });
});

describe('resolveGenerationSettings - maxOutputTokens', () => {
  it('优先级：用户 > 任务 > Provider 默认', () => {
    expect(resolve({ maxOutputTokens: 1000 }).standardOptions.maxOutputTokens).toBe(1000);
    expect(resolve({}).standardOptions.maxOutputTokens).toBe(2048);
  });

  it('用户未设置且任务未设置时使用 Provider 默认', () => {
    const result = resolveGenerationSettings({
      providerId: 'kourichat',
      modelId: 'deepseek-v4-flash',
      providerDefaults: { defaultMaxOutputTokens: 65536 },
      userOverrides: {},
    });
    expect(result.standardOptions.maxOutputTokens).toBe(65536);
  });

  it('非法值（<=0、非整数）被剔除', () => {
    expect(resolve({ maxOutputTokens: 0 }).standardOptions.maxOutputTokens).toBeUndefined();
    expect(resolve({ maxOutputTokens: 1.5 }).standardOptions.maxOutputTokens).toBeUndefined();
  });
});

describe('resolveGenerationSettings - thinking', () => {
  it('Google Gemini：enabled + effort high → thinkingLevel=high，且保留 includeThoughts', () => {
    const result = resolve(
      { thinking: { mode: 'enabled', effort: 'high' } },
      { providerId: 'google-cloudflare', modelId: 'gemini-2.5-flash' },
    );
    expect(result.providerOptions).toEqual({
      google: { thinkingConfig: { includeThoughts: true, thinkingLevel: 'high' } },
    });
  });

  it('Google Gemini：default（跟随模型默认）仍开启思考并回流 reasoning', () => {
    const result = resolve(
      { thinking: { mode: 'default' } },
      { providerId: 'google-cloudflare', modelId: 'gemini-2.5-flash' },
    );
    expect(result.providerOptions).toEqual({
      google: { thinkingConfig: { includeThoughts: true } },
    });
  });

  it('Google Gemini：disabled 不发送任何 thinking 参数', () => {
    const result = resolve(
      { thinking: { mode: 'disabled' } },
      { providerId: 'google-cloudflare', modelId: 'gemini-2.5-flash' },
    );
    expect(result.providerOptions).toBeUndefined();
  });

  it('OpenAI：enabled + effort → reasoningEffort', () => {
    const result = resolve({ thinking: { mode: 'enabled', effort: 'medium' } });
    expect(result.providerOptions).toEqual({ openai: { reasoningEffort: 'medium' } });
  });

  it('DeepSeek：enabled + effort → deepseek.reasoningEffort', () => {
    const result = resolve(
      { thinking: { mode: 'enabled', effort: 'high' } },
      { providerId: 'deepseek', modelId: 'deepseek-v4-pro' },
    );
    expect(result.providerOptions).toEqual({ deepseek: { reasoningEffort: 'high' } });
  });

  it('未知模型：enabled 尽力发送（unknown adapter 有 effort 时映射失败则警告）', () => {
    const result = resolve(
      { thinking: { mode: 'enabled', effort: 'high' } },
      { providerId: 'custom-vendor', modelId: 'custom-model' },
    );
    // unknown adapter 无法映射 → 增加 warning，不静默丢弃档位
    expect(result.diagnostics.warnings.length).toBeGreaterThan(0);
  });
});

describe('getModelGenerationCapabilities', () => {
  it('未登记模型返回 unknown（开放）', () => {
    const caps = getModelGenerationCapabilities('vendor', 'custom-model');
    expect(caps.temperature.support).toBe('unknown');
    expect(caps.thinking.support).toBe('unknown');
  });

  it('key 必须区分 providerId + modelId', () => {
    const google = getModelGenerationCapabilities('google-cloudflare', 'gemini-2.5-flash');
    const openaiSameModel = getModelGenerationCapabilities('openai', 'gemini-2.5-flash');
    expect(google.thinking.adapter).toBe('google');
    expect(openaiSameModel.thinking.adapter).not.toBe('google');
  });
});

describe('provider-adapters', () => {
  it('google 档位映射到 thinkingLevel 且保留 includeThoughts', () => {
    expect(buildThinkingProviderOptions('google', 'low')).toEqual({
      google: { thinkingConfig: { includeThoughts: true, thinkingLevel: 'low' } },
    });
  });

  it('未知 adapter 无法映射', () => {
    expect(buildThinkingProviderOptions('unknown', 'high')).toBeUndefined();
  });
});

describe('UserGenerationOverridesSchema', () => {
  it('接受合法覆盖', () => {
    expect(UserGenerationOverridesSchema.safeParse({ temperature: 0.7, maxOutputTokens: 65536 }).success).toBe(true);
    expect(UserGenerationOverridesSchema.safeParse({ thinking: { mode: 'enabled', effort: 'high' } }).success).toBe(true);
    expect(UserGenerationOverridesSchema.safeParse({ thinking: { mode: 'disabled' } }).success).toBe(true);
  });

  it('拒绝非法 temperature 与超范围 maxOutputTokens', () => {
    expect(UserGenerationOverridesSchema.safeParse({ temperature: 3 }).success).toBe(false);
    expect(UserGenerationOverridesSchema.safeParse({ maxOutputTokens: 0 }).success).toBe(false);
    expect(UserGenerationOverridesSchema.safeParse({ maxOutputTokens: 1_000_001 }).success).toBe(false);
  });

  it('strict：拒绝未知字段', () => {
    expect(UserGenerationOverridesSchema.safeParse({ topP: 0.9 }).success).toBe(false);
  });
});