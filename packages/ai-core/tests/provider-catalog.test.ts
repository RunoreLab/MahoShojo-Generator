import {
  AI_PROVIDER_CATALOG,
  AI_PROVIDER_REGISTRY,
  CUSTOM_AI_MODEL_OPTION_VALUE,
  MAX_CUSTOM_AI_MODEL_ID_LENGTH,
  SYSTEM_PROVIDER_OPTION,
  describeAiPresetDirectSupport,
  findAiProviderPreset,
  isDirectCapableAiPreset,
  isSystemProviderOption,
  listDirectCapableAiPresets,
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

  it('派生 catalog 保持旧形状：system 在最前，其后为全部 Registry 预设', () => {
    expect(AI_PROVIDER_CATALOG[0]).toBe(SYSTEM_PROVIDER_OPTION);
    expect(AI_PROVIDER_CATALOG.length).toBe(AI_PROVIDER_REGISTRY.length + 1);
    expect(AI_PROVIDER_CATALOG.slice(1).map((p) => p.id)).toEqual(
      AI_PROVIDER_REGISTRY.map((p) => p.id)
    );
    // 旧消费者依赖的字段形状不变。
    for (const entry of AI_PROVIDER_CATALOG) {
      expect(entry).toEqual(
        expect.objectContaining({
          id: expect.any(String),
          name: expect.any(String),
          description: expect.any(String),
          docsUrl: expect.any(String),
          baseUrl: expect.any(String),
          type: expect.stringMatching(/^(openai|google|deepseek)$/),
          models: expect.any(Array),
        })
      );
    }
  });
});

describe('system option 与 registry 分层', () => {
  it('SYSTEM_PROVIDER_OPTION 不在 Registry 中，isSystemProviderOption 语义识别', () => {
    expect(AI_PROVIDER_REGISTRY.some((p) => p.id === 'system')).toBe(false);
    expect(isSystemProviderOption(SYSTEM_PROVIDER_OPTION)).toBe(true);
    expect(isSystemProviderOption({ id: 'system' })).toBe(true);
    expect(isSystemProviderOption({ id: 'deepseek' })).toBe(false);
    expect(isSystemProviderOption(null)).toBe(false);
    expect(isSystemProviderOption(undefined)).toBe(false);
  });

  it('findAiProviderPreset 只查 Registry，system 永远查不到', () => {
    expect(findAiProviderPreset('system')).toBeNull();
    expect(findAiProviderPreset('deepseek')?.id).toBe('deepseek');
    expect(findAiProviderPreset('no-such-preset')).toBeNull();
  });
});

describe('Direct 能力语义', () => {
  it('system 是服务器策略而非可直连端点', () => {
    expect(describeAiPresetDirectSupport(SYSTEM_PROVIDER_OPTION)).toEqual({
      supported: false,
      reason: 'server-policy',
    });
  });

  it('provider-public 预设按协议返回 openai-compatible adapter', () => {
    const deepseek = findAiProviderPreset('deepseek')!;
    expect(deepseek.endpointKind).toBe('provider-public');
    expect(describeAiPresetDirectSupport(deepseek)).toEqual({
      supported: true,
      adapter: 'openai-compatible',
    });
  });

  it('project-forward 端点即使将来有 adapter 也不得直连', () => {
    const forwards = AI_PROVIDER_REGISTRY.filter((p) => p.endpointKind === 'project-forward');
    expect(forwards.map((p) => p.id).sort()).toEqual(['google-cloudflare', 'mystery']);
    for (const preset of forwards) {
      expect(describeAiPresetDirectSupport(preset)).toEqual({
        supported: false,
        reason: 'project-forward-endpoint',
      });
    }
  });

  it('google 协议的公开端点在 adapter 实现前标为 unsupported-protocol', () => {
    const preset = { ...findAiProviderPreset('deepseek')!, type: 'google' as const };
    expect(describeAiPresetDirectSupport(preset)).toEqual({
      supported: false,
      reason: 'unsupported-protocol',
    });
  });

  it('listDirectCapableAiPresets 排除 system 与不可直连项', () => {
    const capable = listDirectCapableAiPresets();
    expect(capable.length).toBeGreaterThan(0);
    expect(capable.every((p) => p.endpointKind === 'provider-public')).toBe(true);
    expect(capable.some((p) => p.id === 'system')).toBe(false);
    expect(capable.every((p) => isDirectCapableAiPreset(p))).toBe(true);
    // 注册表分类自洽：capable + project-forward = 当前全部 registry
    //（现有 google 预设均落在 project-forward，无一剩余 unsupported）
    expect(capable.length).toBe(
      AI_PROVIDER_REGISTRY.filter((p) => p.endpointKind === 'provider-public').length
    );
  });
});
