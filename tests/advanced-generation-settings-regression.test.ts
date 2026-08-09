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
});
