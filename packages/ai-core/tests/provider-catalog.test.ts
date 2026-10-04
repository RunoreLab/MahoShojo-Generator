import { readFileSync } from 'node:fs';

import type { DirectProviderAdapter } from '@mahoshojo/contracts';
import {
  AI_PROVIDER_CATALOG,
  AI_PROVIDER_PRESETS,
  CUSTOM_AI_MODEL_OPTION_VALUE,
  MAX_CUSTOM_AI_MODEL_ID_LENGTH,
  SYSTEM_PROVIDER_OPTION,
  describeAiPresetDirectSupport,
  describeAiPresetDirectWire,
  describeAiPresetModelDirectSupport,
  describeAiPresetModelDirectWire,
  findAiProviderPreset,
  isDirectCapableAiPreset,
  isSystemProviderOption,
  listDirectCapableAiPresetModels,
  listDirectCapableAiPresets,
  resolveAIProviderModel,
} from '@mahoshojo/ai-core/provider-catalog';

/** 测试宿主的 Direct 执行能力集：由调用方注入，ai-core 不镜像 native 实现。 */
const OPENAI_COMPATIBLE_ONLY: ReadonlySet<DirectProviderAdapter> = new Set([
  'openai-compatible',
]);

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

describe('Direct wire 核验（端点证据层，fail-closed）', () => {
  it('system 是服务器策略而非端点，wire 判定为 server-policy', () => {
    expect(describeAiPresetDirectWire(SYSTEM_PROVIDER_OPTION)).toEqual({
      status: 'unavailable',
      reason: 'server-policy',
    });
  });

  it('已声明 wire 的 provider-public 预设返回 verified 与核验证据', () => {
    const deepseek = findAiProviderPreset('deepseek')!;
    expect(deepseek.endpointKind).toBe('provider-public');
    expect(deepseek.direct?.adapter).toBe('openai-compatible');
    expect(describeAiPresetDirectWire(deepseek)).toEqual({
      status: 'verified',
      adapter: 'openai-compatible',
      sourceUrl: deepseek.direct!.sourceUrl,
      reviewedAt: deepseek.direct!.reviewedAt,
    });
  });

  it('未声明 direct 的 provider-public 预设按 unverified 拒绝，不从 type 推导', () => {
    const undeclared = {
      ...findAiProviderPreset('deepseek')!,
      direct: undefined,
    };
    expect(describeAiPresetDirectWire(undeclared)).toEqual({ status: 'unverified' });
    // 没有 endpointKind 的裸目录项同样不得被当作已核验。
    const bare = { ...undeclared, endpointKind: undefined } as unknown as typeof undeclared;
    expect(describeAiPresetDirectWire(bare)).toEqual({ status: 'unverified' });
  });

  it('project-forward 端点永远核验为 project-forward-endpoint', () => {
    const forwards = AI_PROVIDER_PRESETS.filter((p) => p.endpointKind === 'project-forward');
    expect(forwards.map((p) => p.id).sort()).toEqual(['google-cloudflare', 'mystery']);
    for (const preset of forwards) {
      expect(describeAiPresetDirectWire(preset)).toEqual({
        status: 'unavailable',
        reason: 'project-forward-endpoint',
      });
    }
  });

  it('多协议端点核验证据按 (preset, model) 归属，不跨端点继承', () => {
    const zen = findAiProviderPreset('opencode-zen')!;
    const go = findAiProviderPreset('opencode-go')!;
    // 两端点都无 preset 级声明。
    for (const preset of [zen, go]) {
      expect(preset.direct).toBeUndefined();
      expect(describeAiPresetDirectWire(preset)).toEqual({ status: 'unverified' });
    }
    // MiniMax 在 Zen 走 /chat/completions、在 Go 走 /messages：Go 侧（未收录）
    // 不得因 Zen 侧已核验而获得 openai-compatible 结论。
    expect(describeAiPresetModelDirectWire(zen, 'minimax-m3')).toMatchObject({
      status: 'verified',
      adapter: 'openai-compatible',
    });
    expect(describeAiPresetModelDirectWire(go, 'minimax-m3')).toEqual({
      status: 'unverified',
    });
    // 各端点核验证据的 provenance 指向各自官方文档。
    expect(describeAiPresetModelDirectWire(go, 'kimi-k3')).toMatchObject({
      status: 'verified',
      adapter: 'openai-compatible',
      sourceUrl: 'https://opencode.ai/docs/go/',
    });
    // 未核验模型与未收录 modelId 一律 unverified——新增模型不静默继承。
    expect(describeAiPresetModelDirectWire(zen, 'big-pickle')).toEqual({ status: 'unverified' });
    expect(describeAiPresetModelDirectWire(zen, 'gpt-5.6-luna')).toEqual({ status: 'unverified' });
  });

  it('模型级 direct 覆盖优先于 preset 级声明（none → unsupported-model）', () => {
    const zen = findAiProviderPreset('opencode-zen')!;
    const blocked = {
      ...zen,
      direct: { adapter: 'openai-compatible' as const, reviewedAt: '2026-10-04' },
      models: zen.models.map((model) =>
        model.value === 'deepseek-v4-flash' ? { ...model, direct: 'none' as const } : model
      ),
    };
    expect(describeAiPresetModelDirectWire(blocked, 'deepseek-v4-flash')).toEqual({
      status: 'unavailable',
      reason: 'unsupported-model',
    });
  });

  it('单协议端点上未收录的自定义 modelId 继承 preset 级声明', () => {
    const deepseek = findAiProviderPreset('deepseek')!;
    expect(describeAiPresetModelDirectWire(deepseek, 'custom-model-v1')).toMatchObject({
      status: 'verified',
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
});

describe('Direct 支持度判定（wire 核验 ∩ 宿主注入的已实现 adapter）', () => {
  it('已核验 wire 且宿主实现该 adapter 时 supported', () => {
    const deepseek = findAiProviderPreset('deepseek')!;
    expect(describeAiPresetDirectSupport(deepseek, OPENAI_COMPATIBLE_ONLY)).toEqual({
      supported: true,
      adapter: 'openai-compatible',
    });
    expect(describeAiPresetModelDirectSupport(deepseek, 'custom-model-v1', OPENAI_COMPATIBLE_ONLY)).toEqual({
      supported: true,
      adapter: 'openai-compatible',
    });
  });

  it('system 与 project-forward 在宿主能力判定前已被排除', () => {
    expect(describeAiPresetDirectSupport(SYSTEM_PROVIDER_OPTION, OPENAI_COMPATIBLE_ONLY)).toEqual({
      supported: false,
      reason: 'server-policy',
    });
    for (const preset of AI_PROVIDER_PRESETS.filter((p) => p.endpointKind === 'project-forward')) {
      expect(describeAiPresetDirectSupport(preset, OPENAI_COMPATIBLE_ONLY)).toEqual({
        supported: false,
        reason: 'project-forward-endpoint',
      });
    }
  });

  it('已核验但宿主未实现对应 adapter 的 wire 报 unsupported-protocol', () => {
    const anthropicOnly = {
      ...findAiProviderPreset('deepseek')!,
      direct: { adapter: 'anthropic' as const, reviewedAt: '2026-10-04' },
    };
    expect(describeAiPresetDirectSupport(anthropicOnly, OPENAI_COMPATIBLE_ONLY)).toEqual({
      supported: false,
      reason: 'unsupported-protocol',
    });
    // wire 层仍如实报告该端点已核验使用 anthropic——不支持是宿主事实而非证据缺失。
    expect(describeAiPresetDirectWire(anthropicOnly)).toMatchObject({
      status: 'verified',
      adapter: 'anthropic',
    });
  });

  it('宿主能力集为空时一切已核验 wire 均报 unsupported-protocol', () => {
    const nothing: ReadonlySet<DirectProviderAdapter> = new Set();
    expect(describeAiPresetDirectSupport(findAiProviderPreset('deepseek')!, nothing)).toEqual({
      supported: false,
      reason: 'unsupported-protocol',
    });
  });

  it('多协议端点 OpenCode 逐模型判定：verified 模型 ∩ 宿主能力', () => {
    const zen = findAiProviderPreset('opencode-zen')!;
    const go = findAiProviderPreset('opencode-go')!;
    for (const preset of [zen, go]) {
      expect(describeAiPresetDirectSupport(preset, OPENAI_COMPATIBLE_ONLY)).toEqual({
        supported: false,
        reason: 'unverified',
      });
    }
    expect(describeAiPresetModelDirectSupport(zen, 'deepseek-v4-flash', OPENAI_COMPATIBLE_ONLY)).toEqual({
      supported: true,
      adapter: 'openai-compatible',
    });
    expect(describeAiPresetModelDirectSupport(go, 'kimi-k3', OPENAI_COMPATIBLE_ONLY)).toEqual({
      supported: true,
      adapter: 'openai-compatible',
    });
    expect(describeAiPresetModelDirectSupport(zen, 'big-pickle', OPENAI_COMPATIBLE_ONLY)).toEqual({
      supported: false,
      reason: 'unverified',
    });
    expect(describeAiPresetModelDirectSupport(go, 'some-unlisted-model', OPENAI_COMPATIBLE_ONLY)).toEqual({
      supported: false,
      reason: 'unverified',
    });
  });

  it('模型级 none 核验在宿主判定中返回 unsupported-model', () => {
    const zen = findAiProviderPreset('opencode-zen')!;
    const blocked = {
      ...zen,
      direct: { adapter: 'openai-compatible' as const, reviewedAt: '2026-10-04' },
      models: zen.models.map((model) =>
        model.value === 'deepseek-v4-flash' ? { ...model, direct: 'none' as const } : model
      ),
    };
    expect(describeAiPresetModelDirectSupport(blocked, 'deepseek-v4-flash', OPENAI_COMPATIBLE_ONLY)).toEqual({
      supported: false,
      reason: 'unsupported-model',
    });
  });

  it('listDirectCapableAiPresets 给出至少一个已核验可直连模型的 preset', () => {
    const capable = listDirectCapableAiPresets(OPENAI_COMPATIBLE_ONLY);
    expect(capable.length).toBeGreaterThan(0);
    expect(capable.every((p) => p.endpointKind === 'provider-public')).toBe(true);
    expect(capable.some((p) => p.id === 'system')).toBe(false);
    // 每个入选 preset 至少一个收录模型可直连；多协议端点也按模型计入。
    for (const preset of capable) {
      const capableModels = listDirectCapableAiPresetModels(preset, OPENAI_COMPATIBLE_ONLY);
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
    expect(isDirectCapableAiPreset(zen, OPENAI_COMPATIBLE_ONLY)).toBe(false);
    expect(isDirectCapableAiPreset(findAiProviderPreset('deepseek')!, OPENAI_COMPATIBLE_ONLY)).toBe(true);
  });
});
