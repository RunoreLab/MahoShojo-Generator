import { describe, expect, it } from 'vitest';

import { resolveGenerationSettings } from '@/lib/ai/generation-settings/resolve';
import { getModelGenerationCapabilities } from '@/lib/ai/generation-settings/model-capabilities';
import { buildThinkingOptions } from '@/lib/ai/generation-settings/provider-adapters';
import { UserGenerationOverridesSchema } from '@/lib/ai/generation-settings/schemas';
import { AI_PROVIDER_CATALOG } from '@/lib/ai/constants';
import type { UserGenerationOverrides } from '@/lib/ai/generation-settings/types';

const resolve = (overrides: UserGenerationOverrides = {}, opts: { providerId?: string; modelId?: string } = {}) =>
  resolveGenerationSettings({
    providerId: opts.providerId ?? 'google-cloudflare',
    modelId: opts.modelId ?? 'gemini-2.5-flash',
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

  it('未知模型（unknown）：不会自动继承任务默认 temperature', () => {
    const result = resolve({}, { providerId: 'custom-vendor', modelId: 'custom-model' });
    expect(result.standardOptions.temperature).toBeUndefined();
    // 任务默认不是用户显式设置，不需要作为“被丢弃的用户字段”制造诊断噪音。
    expect(result.diagnostics.omitted).toHaveLength(0);
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

  it('Gemini 2.5 Flash 的 maxOutputTokens 上限为 65536（而非 1_000_000）', () => {
    const caps = getModelGenerationCapabilities('google-cloudflare', 'gemini-2.5-flash');
    expect(caps.maxOutputTokens.max).toBe(65_536);
  });

  it('Gemini 2.5 Flash 不登记 xhigh 之外的越界档位（max 不开放）', () => {
    const caps = getModelGenerationCapabilities('google-cloudflare', 'gemini-2.5-flash');
    expect(caps.thinking.efforts).toEqual(['minimal', 'low', 'medium', 'high', 'xhigh']);
  });

  it('DeepSeek V4 Flash 同时登记 canonical API ID 与 catalog 兼容 ID', () => {
    const catalogModel = AI_PROVIDER_CATALOG
      .find((p) => p.id === 'deepseek')
      ?.models.find((m) => m.label === 'DeepSeek V4 Flash');
    expect(catalogModel?.value).toBe('deepseek-v4-flash-0731');

    const legacyCaps = getModelGenerationCapabilities('deepseek', 'deepseek-v4-flash-0731');
    const canonicalCaps = getModelGenerationCapabilities('deepseek', 'deepseek-v4-flash');
    expect(legacyCaps.thinking.adapter).toBe('deepseek-thinking-toggle');
    expect(canonicalCaps.thinking.adapter).toBe('deepseek-thinking-toggle');
    expect(canonicalCaps.maxOutputTokens.max).toBe(384_000);
  });
});

describe('capability ↔ catalog 一致性：registry 声称支持的预置模型应能在 catalog 找到', () => {
  const registered = [
    ['google-cloudflare', 'gemini-2.5-flash'],
    ['google-cloudflare', 'gemini-2.5-pro'],
    ['google-cloudflare', 'gemini-2.5-flash-lite'],
    ['google-cloudflare', 'gemini-3.6-flash'],
    ['google-cloudflare', 'gemini-3.5-flash-lite'],
    ['google-cloudflare', 'gemini-3.1-pro-preview'],
    ['deepseek', 'deepseek-v4-flash-0731'],
    ['deepseek', 'deepseek-v4-pro'],
    ['system', 'gemini-2.5-flash'],
    ['system', 'gemini-3.6-flash'],
    ['system', 'gemini-3.5-flash-lite'],
    ['system', 'deepseek-v4-flash-0731'],
    ['system', 'deepseek-v4-pro'],
  ] as const;

  it('每个 registry 预置模型都存在于 AI_PROVIDER_CATALOG 对应 provider 的 models 中（system 动态解析除外）', () => {
    for (const [providerId, modelId] of registered) {
      const provider = AI_PROVIDER_CATALOG.find((p) => p.id === providerId);
      expect(provider, `provider ${providerId} 应存在于 catalog`).toBeDefined();
      // system 通过负载均衡动态选模型，其模型并不要求在 system 的固定列表中小而全，故显式 whitelist。
      if (providerId !== 'system') {
        expect(
          provider?.models.some((m) => m.value === modelId),
          `${providerId}::${modelId} 应存在于 catalog`,
        ).toBe(true);
      }
      const caps = getModelGenerationCapabilities(providerId, modelId);
      // 已登记 ≠ 全部 unknown（temperature 可能是 unsupported，如 Gemini 3.x）。
      expect(
        caps.temperature.support !== 'unknown' ||
          caps.thinking.support !== 'unknown' ||
          caps.maxOutputTokens.support !== 'unknown',
        `${providerId}::${modelId} 应已登记至少一项能力`,
      ).toBe(true);
    }
  });
});

describe('Gemini 2.5 Flash 硬限制：非法参数不得被发送', () => {
  it('maxOutputTokens = 100000（> 65536）被 clamp 到 65536', () => {
    const result = resolve(
      { maxOutputTokens: 100_000 },
      { providerId: 'google-cloudflare', modelId: 'gemini-2.5-flash' },
    );
    expect(result.standardOptions.maxOutputTokens).toBe(65_536);
  });

  it('所有 UI Thinking 档位生成的 thinkingBudget <= 24576', () => {
    const efforts = ['minimal', 'low', 'medium', 'high', 'xhigh'] as const;
    for (const effort of efforts) {
      const result = resolve(
        { thinking: { mode: 'enabled', effort } },
        { providerId: 'google-cloudflare', modelId: 'gemini-2.5-flash' },
      );
      const budget = (result.providerOptions?.google as { thinkingConfig?: { thinkingBudget?: number } })
        ?.thinkingConfig?.thinkingBudget;
      expect(budget, `effort=${effort}`).toBeLessThanOrEqual(24_576);
    }
  });

  it('能力上限小于用户输入时强约束（temperature 同理被 clamp）', () => {
    const result = resolve(
      { temperature: 3 },
      { providerId: 'google-cloudflare', modelId: 'gemini-2.5-flash' },
    );
    expect(result.standardOptions.temperature).toBe(2);
  });
});

describe('Gemini 3.x：移除 sampling 参数（temperature 不发送），thinking 用 thinkingLevel', () => {
  it('Gemini 3.6 Flash 的 temperature 被丢弃（unsupported），并由 diagnostics 说明', () => {
    const result = resolve(
      { temperature: 0.7 },
      { providerId: 'google-cloudflare', modelId: 'gemini-3.6-flash' },
    );
    expect(result.standardOptions.temperature).toBeUndefined();
    expect(result.diagnostics.omitted).toContainEqual({ field: 'temperature', reason: 'unsupported' });
  });

  it('Gemini 3.6 Flash enabled/high → google.thinkingLevel: high', () => {
    const result = resolve(
      { thinking: { mode: 'enabled', effort: 'high' } },
      { providerId: 'google-cloudflare', modelId: 'gemini-3.6-flash' },
    );
    expect(result.providerOptions).toEqual({ google: { thinkingConfig: { includeThoughts: true, thinkingLevel: 'high' } } });
  });

  it('Gemini 3.6 Flash 的非法档位只降级强度，不会连 Thinking 开启意图一起丢弃', () => {
    const overCap = resolve(
      { thinking: { mode: 'enabled', effort: 'xhigh' } },
      { providerId: 'google-cloudflare', modelId: 'gemini-3.6-flash' },
    );
    expect(overCap.providerOptions).toEqual({
      google: { thinkingConfig: { includeThoughts: true } },
    });
    expect(overCap.diagnostics.warnings.length).toBeGreaterThan(0);
  });

  it('Gemini 3.6 Flash maxOutputTokens 上限 65536', () => {
    const result = resolve(
      { maxOutputTokens: 100_000 },
      { providerId: 'google-cloudflare', modelId: 'gemini-3.6-flash' },
    );
    expect(result.standardOptions.maxOutputTokens).toBe(65_536);
  });

  it('Gemini 3.1 Pro 仍支持 temperature（仅 3.6/3.5 Lite 起移除 sampling）', () => {
    const result = resolve(
      { temperature: 0.7 },
      { providerId: 'google-cloudflare', modelId: 'gemini-3.1-pro-preview' },
    );
    expect(result.standardOptions.temperature).toBe(0.7);
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