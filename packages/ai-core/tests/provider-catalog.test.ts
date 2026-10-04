import { readFileSync } from 'node:fs';

import {
  AI_PROVIDER_CATALOG,
  AI_PROVIDER_PRESETS,
  CUSTOM_AI_MODEL_OPTION_VALUE,
  MAX_CUSTOM_AI_MODEL_ID_LENGTH,
  SYSTEM_PROVIDER_OPTION,
  describeAiPresetDirectSupport,
  describeAiPresetModelDirectSupport,
  findAiProviderPreset,
  isDirectCapableAiPreset,
  isSystemProviderOption,
  listDirectCapableAiPresetModels,
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

  it('派生 catalog 保持旧形状：system 在最前，其后为全部项目预设', () => {
    expect(AI_PROVIDER_CATALOG[0]).toBe(SYSTEM_PROVIDER_OPTION);
    expect(AI_PROVIDER_CATALOG.length).toBe(AI_PROVIDER_PRESETS.length + 1);
    expect(AI_PROVIDER_CATALOG.slice(1).map((p) => p.id)).toEqual(
      AI_PROVIDER_PRESETS.map((p) => p.id)
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

  it('legacy wire golden：旧选择器/协议敏感的字段被冻结', () => {
    // fixture 只含真正 wire-sensitive 的数据（id/baseUrl/type/model value 顺序），
    // 不含 label/description——UI 文案升级不产生噪音，改动 legacy wire 立即失败。
    // 目录发生有意变更时重新生成 fixture（见 packages/ai-core/fixtures/）。
    const legacyWire = JSON.parse(
      readFileSync(new URL('../fixtures/legacy-provider-wire.json', import.meta.url), 'utf8')
    );
    const projected = AI_PROVIDER_CATALOG.map((provider) => ({
      id: provider.id,
      baseUrl: provider.baseUrl,
      type: provider.type,
      models: provider.models.map((model) => model.value),
    }));
    expect(projected).toEqual(legacyWire);
  });

  it('发布的预设集合与派生目录对外不可变', () => {
    expect(Object.isFrozen(AI_PROVIDER_PRESETS)).toBe(true);
    expect(Object.isFrozen(AI_PROVIDER_CATALOG)).toBe(true);
    expect(Object.isFrozen(SYSTEM_PROVIDER_OPTION)).toBe(true);
  });
});

describe('system option 与预设分层', () => {
  it('SYSTEM_PROVIDER_OPTION 不在预设集合中，isSystemProviderOption 语义识别', () => {
    expect(AI_PROVIDER_PRESETS.some((p) => p.id === 'system')).toBe(false);
    expect(isSystemProviderOption(SYSTEM_PROVIDER_OPTION)).toBe(true);
    expect(isSystemProviderOption({ id: 'system' })).toBe(true);
    expect(isSystemProviderOption({ id: 'deepseek' })).toBe(false);
    expect(isSystemProviderOption(null)).toBe(false);
    expect(isSystemProviderOption(undefined)).toBe(false);
  });

  it('findAiProviderPreset 只查项目预设，system 永远查不到', () => {
    expect(findAiProviderPreset('system')).toBeNull();
    expect(findAiProviderPreset('deepseek')?.id).toBe('deepseek');
    expect(findAiProviderPreset('no-such-preset')).toBeNull();
  });
});

describe('Direct 能力语义（fail-closed，显式声明而非 type 推导）', () => {
  it('system 是服务器策略而非可直连端点', () => {
    expect(describeAiPresetDirectSupport(SYSTEM_PROVIDER_OPTION)).toEqual({
      supported: false,
      reason: 'server-policy',
    });
  });

  it('已声明 wire 的 provider-public 预设返回对应 adapter', () => {
    const deepseek = findAiProviderPreset('deepseek')!;
    expect(deepseek.endpointKind).toBe('provider-public');
    expect(deepseek.direct?.adapter).toBe('openai-compatible');
    expect(describeAiPresetDirectSupport(deepseek)).toEqual({
      supported: true,
      adapter: 'openai-compatible',
    });
  });

  it('未声明 direct 的 provider-public 预设按 unverified 拒绝，不从 type 推导', () => {
    const undeclared = {
      ...findAiProviderPreset('deepseek')!,
      direct: undefined,
    };
    expect(describeAiPresetDirectSupport(undeclared)).toEqual({
      supported: false,
      reason: 'unverified',
    });
    // 没有 endpointKind 的裸目录项同样不得被当作支持。
    const bare = { ...undeclared, endpointKind: undefined } as unknown as typeof undeclared;
    expect(describeAiPresetDirectSupport(bare)).toEqual({
      supported: false,
      reason: 'unverified',
    });
  });

  it('已核验但 native 未实现对应 adapter 的 wire 报 unsupported-protocol', () => {
    const anthropicOnly = {
      ...findAiProviderPreset('deepseek')!,
      direct: { adapter: 'anthropic' as const, reviewedAt: '2026-10-04' },
    };
    expect(describeAiPresetDirectSupport(anthropicOnly)).toEqual({
      supported: false,
      reason: 'unsupported-protocol',
    });
  });

  it('project-forward 端点即使将来有 adapter 也不得直连', () => {
    const forwards = AI_PROVIDER_PRESETS.filter((p) => p.endpointKind === 'project-forward');
    expect(forwards.map((p) => p.id).sort()).toEqual(['google-cloudflare', 'mystery']);
    for (const preset of forwards) {
      expect(describeAiPresetDirectSupport(preset)).toEqual({
        supported: false,
        reason: 'project-forward-endpoint',
      });
    }
  });

  it('project-forward 端点不得携带任何 direct 声明（预设级或模型级）', () => {
    const forwards = AI_PROVIDER_PRESETS.filter((p) => p.endpointKind === 'project-forward');
    for (const preset of forwards) {
      expect(preset.direct).toBeUndefined();
      expect(preset.models.every((model) => model.direct === undefined)).toBe(true);
    }
  });

  it('多协议端点无 preset 级结论：OpenCode 预设级 unverified、逐模型判定', () => {
    const zen = findAiProviderPreset('opencode-zen')!;
    const go = findAiProviderPreset('opencode-go')!;
    for (const preset of [zen, go]) {
      expect(preset.endpointKind).toBe('provider-public');
      expect(preset.direct).toBeUndefined();
      expect(describeAiPresetDirectSupport(preset)).toEqual({
        supported: false,
        reason: 'unverified',
      });
    }
    // 已核验走 /chat/completions 的收录模型可直连。
    expect(describeAiPresetModelDirectSupport(zen, 'deepseek-v4-flash')).toEqual({
      supported: true,
      adapter: 'openai-compatible',
    });
    expect(describeAiPresetModelDirectSupport(go, 'kimi-k3')).toEqual({
      supported: true,
      adapter: 'openai-compatible',
    });
    // 未核验模型与未收录 modelId 一律 unverified——新增模型不静默继承。
    expect(describeAiPresetModelDirectSupport(zen, 'big-pickle')).toEqual({
      supported: false,
      reason: 'unverified',
    });
    expect(describeAiPresetModelDirectSupport(zen, 'gpt-5.6-luna')).toEqual({
      supported: false,
      reason: 'unverified',
    });
    expect(describeAiPresetModelDirectSupport(go, 'some-unlisted-model')).toEqual({
      supported: false,
      reason: 'unverified',
    });
  });

  it('模型级 direct 覆盖优先于 preset 级声明', () => {
    const zen = findAiProviderPreset('opencode-zen')!;
    const blocked = {
      ...zen,
      direct: { adapter: 'openai-compatible' as const, reviewedAt: '2026-10-04' },
      models: zen.models.map((model) =>
        model.value === 'deepseek-v4-flash' ? { ...model, direct: 'none' as const } : model
      ),
    };
    // 显式核验为不可直连的模型优先于整条声明。
    expect(describeAiPresetModelDirectSupport(blocked, 'deepseek-v4-flash')).toEqual({
      supported: false,
      reason: 'unsupported-model',
    });
  });

  it('单协议端点上未收录的自定义 modelId 继承 preset 级声明', () => {
    const deepseek = findAiProviderPreset('deepseek')!;
    expect(describeAiPresetModelDirectSupport(deepseek, 'custom-model-v1')).toEqual({
      supported: true,
      adapter: 'openai-compatible',
    });
  });

  it('每条 direct 声明都携带 adapter 与 reviewedAt 核验日期', () => {
    const reviewedAtPattern = /^\d{4}-\d{2}-\d{2}$/;
    for (const preset of AI_PROVIDER_PRESETS) {
      if (preset.direct !== undefined) {
        expect(preset.direct.adapter).toBeTruthy();
        expect(preset.direct.reviewedAt).toMatch(reviewedAtPattern);
      }
      for (const model of preset.models) {
        if (model.direct !== undefined && model.direct !== 'none') {
          expect(model.direct.adapter).toBeTruthy();
          expect(model.direct.reviewedAt).toMatch(reviewedAtPattern);
        }
      }
    }
  });

  it('listDirectCapableAiPresets 给出至少一个已核验可直连模型的 preset', () => {
    const capable = listDirectCapableAiPresets();
    expect(capable.length).toBeGreaterThan(0);
    expect(capable.every((p) => p.endpointKind === 'provider-public')).toBe(true);
    expect(capable.some((p) => p.id === 'system')).toBe(false);
    // 每个入选 preset 至少一个收录模型可直连；多协议端点也按模型计入。
    for (const preset of capable) {
      const capableModels = listDirectCapableAiPresetModels(preset);
      expect(capableModels.length).toBeGreaterThan(0);
    }
    // OpenCode 两个预设虽无 preset 级声明，但收录模型已核验可直连。
    expect(capable.map((p) => p.id)).toContain('opencode-zen');
    expect(capable.map((p) => p.id)).toContain('opencode-go');
    // project-forward 永远不在 Direct 来源内。
    expect(capable.map((p) => p.id)).not.toContain('google-cloudflare');
    expect(capable.map((p) => p.id)).not.toContain('mystery');
    // isDirectCapableAiPreset 仍是 preset 级整条判定：多协议端点返回 false。
    const zen = findAiProviderPreset('opencode-zen')!;
    expect(isDirectCapableAiPreset(zen)).toBe(false);
    expect(isDirectCapableAiPreset(findAiProviderPreset('deepseek')!)).toBe(true);
  });
});
