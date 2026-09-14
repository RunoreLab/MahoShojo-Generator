import {
  AI_PROVIDER_CATALOG,
  CUSTOM_AI_MODEL_OPTION_VALUE,
  MAX_CUSTOM_AI_MODEL_ID_LENGTH,
  resolveAIProviderModel,
} from '@mahoshojo/ai-core/provider-catalog';

describe('shared provider catalog', () => {
  it('exposes the system default and every configured system model', () => {
    const system = AI_PROVIDER_CATALOG.find((provider) => provider.id === 'system')!;
    expect(system.models.some((model) => model.value === 'default')).toBe(true);
    expect(system.models.length).toBeGreaterThan(1);
    for (const model of system.models) {
      expect(resolveAIProviderModel(system, model.value)).toEqual({ modelId: model.value, isCustom: false });
    }
    expect(resolveAIProviderModel(system, 'unconfigured-model')).toBeNull();
  });

  it('allows custom BYOK models while preserving the existing DeepSeek alias', () => {
    const provider = AI_PROVIDER_CATALOG.find((item) => item.id === 'deepseek')!;
    expect(resolveAIProviderModel(provider, ' custom/model-v1 ')).toEqual({ modelId: 'custom/model-v1', isCustom: true });
    expect(resolveAIProviderModel(provider, 'deepseek-v4-flash-0731')?.modelId).toBe('deepseek-v4-flash');
    for (const invalid of ['', CUSTOM_AI_MODEL_OPTION_VALUE, 'bad\nmodel', 'x'.repeat(MAX_CUSTOM_AI_MODEL_ID_LENGTH + 1)]) {
      expect(resolveAIProviderModel(provider, invalid)).toBeNull();
    }
  });
});
