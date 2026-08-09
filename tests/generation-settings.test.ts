import { describe, expect, it } from 'vitest';

import { resolveGenerationSettings } from '@/lib/ai/generation-settings/resolve';
import { getModelGenerationCapabilities } from '@/lib/ai/generation-settings/model-capabilities';
import { buildThinkingOptions } from '@/lib/ai/generation-settings/provider-adapters';
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

  it('Gemini 2.5 仍支持 temperature（不走 sampling 参数移除规则）', () => {
    const result = resolve(
      { temperature: 0.7 },
      { providerId: 'google-cloudflare', modelId: 'gemini-2.5-flash' },
    );
    expect(result.standardOptions.temperature).toBe(0.7);
    expect(result.diagnostics.omitted).toHaveLength(0);
  });

  it('未知模型（unknown）：尝试发送 temperature', () => {
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
  it('Gemini 2.5：enabled + effort high → thinkingBudget（非 thinkingLevel）', () => {
    const result = resolve(
      { thinking: { mode: 'enabled', effort: 'high' } },
      { providerId: 'google-cloudflare', modelId: 'gemini-2.5-flash' },
    );
    expect(result.providerOptions).toEqual({
      google: { thinkingConfig: { includeThoughts: true, thinkingBudget: 16384 } },
    });
  });

  it('Gemini 2.5：default（跟随模型默认）回流 reasoning', () => {
    const result = resolve(
      { thinking: { mode: 'default' } },
      { providerId: 'google-cloudflare', modelId: 'gemini-2.5-flash' },
    );
    expect(result.providerOptions).toEqual({
      google: { thinkingConfig: { includeThoughts: true } },
    });
  });

  it('Gemini 2.5：disabled 发送 thinkingBudget:0 真正关闭（而非不发送）', () => {
    const result = resolve(
      { thinking: { mode: 'disabled' } },
      { providerId: 'google-cloudflare', modelId: 'gemini-2.5-flash' },
    );
    expect(result.providerOptions).toEqual({
      google: { thinkingConfig: { thinkingBudget: 0 } },
    });
  });

  it('DeepSeek：enabled → thinking.type=enabled', () => {
    const result = resolve(
      { thinking: { mode: 'enabled' } },
      { providerId: 'deepseek', modelId: 'deepseek-v4-pro' },
    );
    expect(result.providerOptions).toEqual({ deepseek: { thinking: { type: 'enabled' } } });
  });

  it('DeepSeek：disabled → thinking.type=disabled', () => {
    const result = resolve(
      { thinking: { mode: 'disabled' } },
      { providerId: 'deepseek', modelId: 'deepseek-v4-pro' },
    );
    expect(result.providerOptions).toEqual({ deepseek: { thinking: { type: 'disabled' } } });
  });

  it('未知模型：thinking 不可控（不发送参数）', () => {
    const result = resolve(
      { thinking: { mode: 'enabled', effort: 'high' } },
      { providerId: 'custom-vendor', modelId: 'custom-model' },
    );
    expect(result.providerOptions).toBeUndefined();
  });
});

describe('getModelGenerationCapabilities', () => {
  it('未登记模型返回 unknown（开放 / 不猜测）', () => {
    const caps = getModelGenerationCapabilities('vendor', 'custom-model');
    expect(caps.temperature.support).toBe('unknown');
    expect(caps.thinking.support).toBe('unknown');
  });

  it('key 必须区分 providerId + modelId（不因 modelId 相同而混用）', () => {
    const google = getModelGenerationCapabilities('google-cloudflare', 'gemini-2.5-flash');
    const elsewhere = getModelGenerationCapabilities('openai', 'gemini-2.5-flash');
    expect(google.thinking.adapter).toBe('google-thinking-budget');
    expect(elsewhere.thinking.adapter).toBe('unknown');
  });
});

describe('provider-adapters', () => {
  it('google-thinking-budget：enabled/low 映射到 thinkingBudget', () => {
    expect(buildThinkingOptions('google-thinking-budget', 'enabled', 'low')).toEqual({
      google: { thinkingConfig: { includeThoughts: true, thinkingBudget: 4096 } },
    });
    expect(buildThinkingOptions('google-thinking-budget', 'disabled')).toEqual({
      google: { thinkingConfig: { thinkingBudget: 0 } },
    });
  });

  it('google-thinking-level：enabled/high 映射到 thinkingLevel', () => {
    expect(buildThinkingOptions('google-thinking-level', 'enabled', 'high')).toEqual({
      google: { thinkingConfig: { includeThoughts: true, thinkingLevel: 'high' } },
    });
  });

  it('openai-reasoning-effort：enabled→档位，disabled→none', () => {
    expect(buildThinkingOptions('openai-reasoning-effort', 'enabled', 'xhigh')).toEqual({
      openai: { reasoningEffort: 'xhigh' },
    });
    expect(buildThinkingOptions('openai-reasoning-effort', 'disabled')).toEqual({
      openai: { reasoningEffort: 'none' },
    });
  });

  it('deepseek-thinking-toggle：enabled/disabled 开关', () => {
    expect(buildThinkingOptions('deepseek-thinking-toggle', 'enabled')).toEqual({
      deepseek: { thinking: { type: 'enabled' } },
    });
    expect(buildThinkingOptions('deepseek-thinking-toggle', 'disabled')).toEqual({
      deepseek: { thinking: { type: 'disabled' } },
    });
  });

  it('未知 adapter 无法映射', () => {
    expect(buildThinkingOptions('unknown', 'enabled', 'high')).toBeUndefined();
  });
});

describe('AI SDK options 展开约定（providerOptions 需包在 providerOptions: 内）', () => {
  it('resolver 输出按调用点约定展开后 providerOptions 位于顶层', () => {
    const resolved = resolve(
      { thinking: { mode: 'enabled', effort: 'high' } },
      { providerId: 'google-cloudflare', modelId: 'gemini-2.5-flash' },
    );
    const callArgs = {
      ...resolved.standardOptions,
      ...(resolved.providerOptions ? { providerOptions: resolved.providerOptions } : {}),
    };
    expect(callArgs.providerOptions).toEqual({
      google: { thinkingConfig: { includeThoughts: true, thinkingBudget: 16384 } },
    });
    // providerOptions 不在顶层摊平（避免把 google 当作文档顶层字段）
    expect(callArgs.google).toBeUndefined();
  });
});

describe('UserGenerationOverridesSchema', () => {
  it('接受合法覆盖', () => {
    expect(UserGenerationOverridesSchema.safeParse({ temperature: 0.7, maxOutputTokens: 65536 }).success).toBe(true);
    expect(UserGenerationOverridesSchema.safeParse({ thinking: { mode: 'enabled', effort: 'high' } }).success).toBe(true);
    expect(UserGenerationOverridesSchema.safeParse({ thinking: { mode: 'disabled' } }).success).toBe(true);
  });

  it('temperature 只约束有限且非负，不硬编码上限（上限由 capability 决定）', () => {
    expect(UserGenerationOverridesSchema.safeParse({ temperature: 3 }).success).toBe(true);
    expect(UserGenerationOverridesSchema.safeParse({ temperature: -1 }).success).toBe(false);
    expect(UserGenerationOverridesSchema.safeParse({ temperature: Number.NaN }).success).toBe(false);
  });

  it('拒绝非法 maxOutputTokens', () => {
    expect(UserGenerationOverridesSchema.safeParse({ maxOutputTokens: 0 }).success).toBe(false);
    expect(UserGenerationOverridesSchema.safeParse({ maxOutputTokens: 1_000_001 }).success).toBe(false);
  });

  it('strict：拒绝未知字段', () => {
    expect(UserGenerationOverridesSchema.safeParse({ topP: 0.9 }).success).toBe(false);
  });
});