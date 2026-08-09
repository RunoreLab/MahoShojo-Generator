import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

import { AI_PROVIDER_CATALOG, resolveAIProviderModel } from '@/lib/ai/constants';
import { getModelGenerationCapabilities } from '@/lib/ai/generation-settings/model-capabilities';
import { buildThinkingOptions } from '@/lib/ai/generation-settings/provider-adapters';
import { resolveGenerationSettings } from '@/lib/ai/generation-settings/resolve';

describe('advanced generation settings regressions', () => {
  it('DeepSeek 官方 V4 Flash catalog ID 在请求解析边界规范化为 canonical modelId', () => {
    const provider = AI_PROVIDER_CATALOG.find((item) => item.id === 'deepseek');
    expect(provider).toBeDefined();
    if (!provider) return;

    expect(resolveAIProviderModel(provider, 'deepseek-v4-flash-0731')).toEqual({
      modelId: 'deepseek-v4-flash',
      isCustom: false,
    });
  });

  it('DeepSeek V4 的 1M context 不会被误当成最大输出；Thinking 默认时 temperature 不发送', () => {
    const result = resolveGenerationSettings({
      providerId: 'deepseek',
      modelId: 'deepseek-v4-flash',
      taskDefaults: { temperature: 0.8 },
      userOverrides: { maxOutputTokens: 500_000 },
    });

    expect(result.standardOptions.maxOutputTokens).toBe(384_000);
    expect(result.standardOptions.temperature).toBeUndefined();
    expect(result.diagnostics.omitted).toContainEqual({
      field: 'temperature',
      reason: 'ignored-in-thinking-mode',
    });
  });

  it('DeepSeek 只登记可靠的开关能力；旧缓存中的 effort 不会阻断 thinking.type', () => {
    const caps = getModelGenerationCapabilities('deepseek', 'deepseek-v4-pro');
    expect(caps.thinking.efforts).toBeUndefined();

    const result = resolveGenerationSettings({
      providerId: 'deepseek',
      modelId: 'deepseek-v4-pro',
      userOverrides: { thinking: { mode: 'enabled', effort: 'medium' } },
    });
    expect(result.providerOptions).toEqual({
      deepseek: { thinking: { type: 'enabled' } },
    });
  });

  it('Gemini 2.5 Pro 与 Gemini 3 不能关闭 Thinking', () => {
    for (const modelId of ['gemini-2.5-pro', 'gemini-3.6-flash'] as const) {
      const caps = getModelGenerationCapabilities('google-cloudflare', modelId);
      expect(caps.thinking.canDisable).toBe(false);

      const result = resolveGenerationSettings({
        providerId: 'google-cloudflare',
        modelId,
        userOverrides: { thinking: { mode: 'disabled' } },
      });
      expect(result.providerOptions).toBeUndefined();
      expect(result.diagnostics.omitted).toContainEqual({
        field: 'thinking',
        reason: 'cannot-disable',
      });
    }
  });

  it('Gemini 3.1 Pro 不开放 minimal，Gemini 3.6 输出上限为 65536', () => {
    expect(
      getModelGenerationCapabilities('google-cloudflare', 'gemini-3.1-pro-preview').thinking.efforts,
    ).toEqual(['low', 'medium', 'high']);

    expect(
      getModelGenerationCapabilities('google-cloudflare', 'gemini-3.6-flash').maxOutputTokens.max,
    ).toBe(65_536);
  });

  it('Gemini 3 adapter 不再伪造 thinkingLevel:none', () => {
    expect(buildThinkingOptions('google-thinking-level', 'disabled')).toBeUndefined();
  });

  it('Gemma 4 用专用二元 adapter 表达 high=开启 / minimal=关闭', () => {
    for (const modelId of ['gemma-4-31b-it', 'gemma-4-26b-a4b-it'] as const) {
      const caps = getModelGenerationCapabilities('google-cloudflare', modelId);
      expect(caps.temperature.support).toBe('supported');
      expect(caps.maxOutputTokens.support).toBe('supported');
      expect(caps.thinking.adapter).toBe('google-thinking-binary-level');
      expect(caps.thinking.efforts).toEqual(['high']);
      expect(caps.thinking.canDisable).toBe(true);

      const disabled = resolveGenerationSettings({
        providerId: 'google-cloudflare',
        modelId,
        userOverrides: { thinking: { mode: 'disabled' } },
      });
      expect(disabled.providerOptions).toEqual({
        google: { thinkingConfig: { thinkingLevel: 'minimal' } },
      });

      // 即使旧缓存里没有合法 effort，enabled 也必须保持“开启”语义，而不是回退模型默认。
      const enabled = resolveGenerationSettings({
        providerId: 'google-cloudflare',
        modelId,
        userOverrides: { thinking: { mode: 'enabled', effort: 'low' } },
      });
      expect(enabled.providerOptions).toEqual({
        google: { thinkingConfig: { thinkingLevel: 'high' } },
      });
      expect(enabled.diagnostics.warnings).toHaveLength(1);
    }
  });

  it('OpenRouter 按网关元数据约束 sampling、输出上限与 reasoning_effort', () => {
    const gpt = getModelGenerationCapabilities('openrouter', 'openai/gpt-5.5');
    expect(gpt.temperature.support).toBe('unsupported');
    expect(gpt.maxOutputTokens.max).toBe(128_000);
    expect(gpt.thinking.efforts).toEqual(['low', 'medium', 'high', 'xhigh']);
    expect(gpt.thinking.canDisable).toBe(true);

    const gptResolved = resolveGenerationSettings({
      providerId: 'openrouter',
      modelId: 'openai/gpt-5.5',
      userOverrides: {
        temperature: 0.8,
        thinking: { mode: 'disabled' },
      },
    });
    expect(gptResolved.standardOptions.temperature).toBeUndefined();
    expect(gptResolved.diagnostics.omitted).toContainEqual({
      field: 'temperature',
      reason: 'unsupported',
    });
    expect(gptResolved.providerOptions).toEqual({
      openai: { reasoningEffort: 'none' },
    });

    const gemini = getModelGenerationCapabilities('openrouter', 'google/gemini-3.1-pro-preview');
    expect(gemini.temperature.support).toBe('supported');
    expect(gemini.maxOutputTokens.max).toBe(65_536);
    expect(gemini.thinking.efforts).toEqual(['low', 'medium', 'high']);
    expect(gemini.thinking.canDisable).toBe(false);

    const qwen = getModelGenerationCapabilities('openrouter', 'qwen/qwen3.8-max');
    expect(qwen.maxOutputTokens.max).toBe(131_072);
    expect(qwen.thinking.efforts).toEqual(['minimal', 'low', 'medium', 'high', 'xhigh']);
    expect(qwen.thinking.canDisable).toBe(false);

    const claudeCaps = getModelGenerationCapabilities('openrouter', 'anthropic/claude-opus-4.8');
    expect(claudeCaps.thinking.canDisable).toBe(false);

    const claude = resolveGenerationSettings({
      providerId: 'openrouter',
      modelId: 'anthropic/claude-opus-4.8',
      userOverrides: { thinking: { mode: 'enabled', effort: 'max' } },
    });
    expect(claude.providerOptions).toEqual({
      openai: { reasoningEffort: 'max' },
    });

    // DeepSeek 的 OpenRouter 路径仍保守地不开放 Thinking：条件性 temperature 语义尚未建模。
    const deepseekFlash = getModelGenerationCapabilities('openrouter', 'deepseek/deepseek-v4-flash');
    expect(deepseekFlash.maxOutputTokens.max).toBe(393_216);
    expect(deepseekFlash.thinking.support).toBe('unknown');

    const deepseek = getModelGenerationCapabilities('openrouter', 'deepseek/deepseek-v4-pro');
    expect(deepseek.maxOutputTokens.max).toBe(384_000);
    expect(deepseek.thinking.support).toBe('unknown');

    // Kimi K3 虽然网关有 reasoning_effort，但不包含当前 adapter 默认 medium，暂不冒进登记。
    expect(
      getModelGenerationCapabilities('openrouter', 'moonshotai/kimi-k3').thinking.support,
    ).toBe('unknown');
  });

  it('system 是逻辑路由器，不发送 Google/DeepSeek 专属 Thinking providerOptions', () => {
    const gemini = resolveGenerationSettings({
      providerId: 'system',
      modelId: 'gemini-3.6-flash',
      userOverrides: { thinking: { mode: 'enabled', effort: 'high' } },
    });
    const deepseek = resolveGenerationSettings({
      providerId: 'system',
      modelId: 'deepseek-v4-pro',
      userOverrides: { thinking: { mode: 'disabled' } },
    });

    expect(gemini.providerOptions).toBeUndefined();
    expect(deepseek.providerOptions).toBeUndefined();
  });

  it('AiProviderSelector 校验持久化 overrides，并等待当前模型设置加载后再向外 emit', async () => {
    const source = await readFile('components/AiProviderSelector.tsx', 'utf8');

    expect(source).toContain('UserGenerationOverridesSchema.safeParse(JSON.parse(stored))');
    expect(source).toContain('setLoadedGenerationOverridesKey(currentGenerationOverridesKey)');
    expect(source).toContain(
      'loadedGenerationOverridesKey !== currentGenerationOverridesKey',
    );
  });
});
