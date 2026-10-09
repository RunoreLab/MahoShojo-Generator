// D5.0b 统一 AI 配置层测试：overlay 解析、执行目标解析、预设分层与 store 编排。
//
// 被测不变量：
// - overlay fail-closed；损坏即 blocked，显式重置前拒绝一切写入；
// - 执行位置与客户端连接正交：默认 client+null；悬空保留原 ID 由解析层诊断；
//   删除当前连接显式解除引用，绝不自动换供应商；
// - 预设目录不含 `system`；Direct 候选 = 已核验 wire ∩ `DESKTOP_DIRECT_ADAPTERS`；
// - secret 只有 set/has/delete 三个调用面，明文永不进 overlay/Profile；
// - Profile native 校验先于凭据写入，Profile 落盘在凭据之后；
// - 编辑连接时不提供新明文则保留既有 `apiKeyRef` 与 `createdAt`，adapter 不被改写。

import { describe, expect, it, vi } from 'vitest';

import {
  AI_PROVIDER_PRESETS,
  findAiProviderPreset,
  type AiProviderPreset,
} from '@mahoshojo/ai-core/provider-catalog';
import {
  DirectProviderProfileV1Schema,
  type DirectProviderProfileV1,
} from '@mahoshojo/contracts/provider-profile';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async () => undefined),
  Channel: class {
    onmessage?: (event: unknown) => void;
  },
}));

import {
  DESKTOP_AI_CONFIG_DEFAULT_OVERLAY,
  DESKTOP_DIRECT_ADAPTERS,
  describeDesktopPresetEntry,
  describeDesktopPresetModelSupport,
  listDesktopPresetEntries,
  parseDesktopAiConfigOverlay,
  resolveDesktopAiTarget,
  serializeDesktopAiConfigOverlay,
} from '../src/features/ai-config/desktop-ai-config';
import {
  DESKTOP_AI_CONFIG_STORAGE_KEY,
  DesktopAiConfigStore,
  DesktopSaveConnectionCommitError,
  type DesktopAiConfigKvStorage,
  type DesktopAiConfigInvokeFn,
} from '../src/features/ai-config/desktop-ai-config-store';
import { saveConnectionDraft } from '../src/features/ai-config/connection-editor';

const NOW = '2026-10-05T00:00:00.000Z';
const now = () => NOW;

const createStorage = (): DesktopAiConfigKvStorage & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
};

const profileFixture = (
  overrides: Partial<DirectProviderProfileV1> = {},
): DirectProviderProfileV1 =>
  DirectProviderProfileV1Schema.parse({
    version: 1,
    id: 'p_local',
    name: '本地模型',
    adapter: 'openai-compatible',
    baseUrl: 'http://127.0.0.1:11434/v1',
    modelId: 'qwen3:8b',
    apiKeyRef: 'provider:p_local:api-key',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  });

const clientSelection = (profileId: string | null) => ({
  executionPreference: 'client' as const,
  clientConnectionId: profileId,
});

/** 按真实 bridge 的 IPC 形状模拟 native：投影回显 + opaque 文档存取 + 只写凭据库。 */
const createNativeStub = (
  initial: DirectProviderProfileV1[] = [],
  options: {
    failSecretProbe?: boolean;
    failValidation?: boolean;
    failProfileSave?: boolean;
    /** 写入已生效但响应回程报错（IPC 失败 ≠ 未落盘）。 */
    failProfileSaveAfterWrite?: boolean;
    /** 落盘核验读不到：`get_provider_profile` 本身报错。 */
    failProfileRead?: boolean;
  } = {},
) => {
  const profiles = new Map(initial.map((profile) => [profile.id, profile]));
  const secrets = new Set<string>();
  const calls: string[] = [];
  // 可变故障开关：测试可在 init/保存途中翻转（如先正常加载、再让核验读取失败）。
  const flags = {
    failSecretProbe: false,
    failValidation: false,
    failProfileSave: false,
    failProfileSaveAfterWrite: false,
    failProfileRead: false,
    ...options,
  };
  const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
    calls.push(command);
    switch (command) {
      case 'list_provider_profile_ids':
        return [...profiles.keys()];
      case 'get_provider_profile':
        if (flags.failProfileRead) {
          throw { code: 'store-failure', message: 'read failed' };
        }
        return profiles.get(args?.profileId as string) ?? null;
      case 'validate_provider_execution_profile':
        if (flags.failValidation) {
          throw { code: 'provider-profile-rejected', message: 'native rejected the profile' };
        }
        return args?.document;
      case 'save_provider_profile': {
        if (flags.failProfileSave) {
          throw { code: 'store-failure', message: 'disk full' };
        }
        const document = args?.document as DirectProviderProfileV1;
        profiles.set(document.id, document);
        if (flags.failProfileSaveAfterWrite) {
          throw { code: 'store-failure', message: 'response lost after commit' };
        }
        return undefined;
      }
      case 'delete_provider_profile':
        profiles.delete(args?.profileId as string);
        return undefined;
      case 'set_provider_secret':
        secrets.add(args?.secretRef as string);
        return undefined;
      case 'has_provider_secret':
        if (flags.failSecretProbe) throw new Error('keychain unavailable');
        return secrets.has(args?.secretRef as string);
      case 'delete_provider_secret':
        secrets.delete(args?.secretRef as string);
        return undefined;
      default:
        throw new Error(`unexpected command ${command}`);
    }
  }) as unknown as DesktopAiConfigInvokeFn;
  return { invoke, profiles, secrets, calls, flags };
};

const createStore = (
  storage = createStorage(),
  invoke: DesktopAiConfigInvokeFn = createNativeStub().invoke,
) => new DesktopAiConfigStore({ storage, invoke, now });

const presetById = (id: string): AiProviderPreset => {
  const preset = findAiProviderPreset(id);
  if (!preset) throw new Error(`test preset ${id} missing`);
  return preset;
};

describe('parseDesktopAiConfigOverlay', () => {
  it('round-trips the default overlay', () => {
    const parsed = parseDesktopAiConfigOverlay(
      serializeDesktopAiConfigOverlay(DESKTOP_AI_CONFIG_DEFAULT_OVERLAY),
    );
    expect(parsed).toEqual(DESKTOP_AI_CONFIG_DEFAULT_OVERLAY);
  });

  it('defaults to client execution with no connection selected', () => {
    expect(DESKTOP_AI_CONFIG_DEFAULT_OVERLAY.selection).toEqual({
      executionPreference: 'client',
      clientConnectionId: null,
    });
  });

  it('fails closed on unsupported version, corrupt selection and non-schema overrides', () => {
    expect(() => parseDesktopAiConfigOverlay('{"version":1}')).toThrow('版本');
    expect(() => parseDesktopAiConfigOverlay('{"version":5}')).toThrow('版本');
    expect(() => parseDesktopAiConfigOverlay('{"version":4}')).toThrow('选择');
    expect(() =>
      parseDesktopAiConfigOverlay(
        JSON.stringify({
          version: 2,
          selection: { executionPreference: 'client' },
          hiddenPresetIds: [],
        }),
      ),
    ).toThrow('选择');
    expect(() =>
      parseDesktopAiConfigOverlay(
        JSON.stringify({
          version: 2,
          selection: clientSelection(null),
          hiddenPresetIds: [],
          generationOverrides: { p1: { m1: { temperature: 'hot' } } },
        }),
      ),
    ).toThrow('schema');
    expect(() =>
      parseDesktopAiConfigOverlay(
        JSON.stringify({
          version: 2,
          selection: clientSelection(null),
          hiddenPresetIds: [],
          generationOverrides: { p1: 'flat' },
        }),
      ),
    ).toThrow('覆盖');
    expect(() =>
      parseDesktopAiConfigOverlay(
        JSON.stringify({
          version: 2,
          selection: clientSelection(null),
          hiddenPresetIds: [1],
        }),
      ),
    ).toThrow('隐藏');
  });

  it('migrates v2 without modelsByProfileId and writes back as v4', () => {
    const parsed = parseDesktopAiConfigOverlay(
      JSON.stringify({
        version: 2,
        selection: clientSelection('p1'),
        hiddenPresetIds: ['deepseek'],
        generationOverrides: { p1: { m1: { temperature: 0.4 } } },
      }),
    );
    expect(parsed.modelsByProfileId).toEqual({});
    expect(parsed.generationOverrides).toEqual({ p1: { m1: { temperature: 0.4 } } });
    // 下一次落盘即以 v4 写回（受检、幂等）。
    expect(serializeDesktopAiConfigOverlay(parsed)).toContain('"version":4');
    expect(JSON.parse(serializeDesktopAiConfigOverlay(parsed)).modelsByProfileId).toEqual({});
  });

  it('round-trips v3 modelsByProfileId and rejects corrupt model selection entries', () => {
    const overlay = parseDesktopAiConfigOverlay(
      JSON.stringify({
        version: 3,
        selection: clientSelection('p1'),
        hiddenPresetIds: [],
        generationOverrides: {},
        modelsByProfileId: {
          p1: { selectedModelId: 'm2', customModelIds: ['m2', 'm3'] },
          p2: { customModelIds: [] },
        },
      }),
    );
    expect(overlay.modelsByProfileId).toEqual({
      p1: { selectedModelId: 'm2', customModelIds: ['m2', 'm3'] },
      p2: { customModelIds: [] },
    });

    const corruptEntries = [
      { p1: { selectedModelId: 42, customModelIds: [] } },
      { p1: { selectedModelId: 'm1' } },
      { p1: { customModelIds: ['m1', '  '] } },
      { p1: { customModelIds: 'm1' } },
      { p1: { customModelIds: [], futureField: true } },
      'not-an-object',
    ];
    for (const modelsByProfileId of corruptEntries) {
      expect(() =>
        parseDesktopAiConfigOverlay(
          JSON.stringify({
            version: 3,
            selection: clientSelection(null),
            hiddenPresetIds: [],
            generationOverrides: {},
            modelsByProfileId,
          }),
        ),
      ).toThrow('模型选择');
    }
  });
});

describe('resolveDesktopAiTarget', () => {
  const profile = profileFixture();

  it('server preference resolves to an executable hosted target without requiring login', () => {
    const target = resolveDesktopAiTarget(
      { executionPreference: 'server', clientConnectionId: 'p_local' },
      [profile],
      {},
      {},
    );
    expect(target.location).toBe('server');
    // hosted 通路不消费客户端连接；可执行性由 dispatch 时 DESK-094 门禁裁决。
    expect(target.profile).toBeNull();
    expect(target.mode).toBeNull();
    expect(target.unavailableReason).toBeNull();
    // 「使用系统默认配置」未选择模型时生效为 'default'（服务器默认顺序），
    // 候选清单来自系统目录（与 Web 同一事实源，含 glm-5.3-flash）。
    expect(target.modelId).toBe('default');
    expect(target.availableModelIds).toContain('default');
    expect(target.availableModelIds).toContain('glm-5.3-flash');
  });

  it('guides configuration when no client connection is selected', () => {
    const target = resolveDesktopAiTarget(clientSelection(null), [profile], {}, {});
    expect(target.location).toBe('client');
    expect(target.profile).toBeNull();
    expect(target.unavailableReason).toContain('尚未选择客户端连接');
  });

  it('reports a dangling selection instead of crashing or switching providers', () => {
    const target = resolveDesktopAiTarget(clientSelection('gone'), [profile], {}, {});
    expect(target.profile).toBeNull();
    expect(target.unavailableReason).toContain('已不存在');
  });

  it('derives direct-local for loopback and direct-remote otherwise', () => {
    expect(resolveDesktopAiTarget(clientSelection('p_local'), [profile], {}, {}).mode).toBe(
      'direct-local',
    );
    const remote = profileFixture({ baseUrl: 'https://api.example.com/v1' });
    expect(resolveDesktopAiTarget(clientSelection('p_local'), [remote], {}, {}).mode).toBe(
      'direct-remote',
    );
  });

  it('rejects adapters the native side has not implemented', () => {
    const anthropic = profileFixture({
      adapter: 'anthropic',
      baseUrl: 'https://api.anthropic.com/v1',
    });
    const target = resolveDesktopAiTarget(clientSelection('p_local'), [anthropic], {}, {});
    expect(target.mode).toBeNull();
    expect(target.unavailableReason).toContain('anthropic');
  });

  it('scopes generation overrides by profile id and model id', () => {
    const overrides = {
      p_local: { 'qwen3:8b': { temperature: 0.2 } },
      other: { m: { temperature: 1 } },
    };
    const target = resolveDesktopAiTarget(clientSelection('p_local'), [profile], overrides, {});
    expect(target.generationOverrides).toEqual({ temperature: 0.2 });
    const renamed = profileFixture({ modelId: 'other-model' });
    expect(
      resolveDesktopAiTarget(clientSelection('p_local'), [renamed], overrides, {})
        .generationOverrides,
    ).toBeUndefined();
  });

  it('cannot collide overrides between ids containing colons', () => {
    // 旧 `${profileId}::${modelId}` 复合键下 ("a","b::c") 与 ("a::b","c") 同键；
    // 嵌套结构天然无碰撞。
    const overrides = {
      'a::b': { c: { temperature: 0.1 } },
      a: { 'b::c': { temperature: 0.9 } },
    };
    const first = profileFixture({ id: 'a::b', modelId: 'c' });
    const second = profileFixture({ id: 'a', modelId: 'b::c' });
    expect(
      resolveDesktopAiTarget(clientSelection('a::b'), [first], overrides, {}).generationOverrides,
    ).toEqual({ temperature: 0.1 });
    expect(
      resolveDesktopAiTarget(clientSelection('a'), [second], overrides, {}).generationOverrides,
    ).toEqual({ temperature: 0.9 });
  });

  it('defaults the effective model to profile.modelId and lists deduped candidates', () => {
    const target = resolveDesktopAiTarget(clientSelection('p_local'), [profile], {}, {});
    expect(target.modelId).toBe('qwen3:8b');
    expect(target.availableModelIds).toEqual(['qwen3:8b']);

    const withCustom = resolveDesktopAiTarget(clientSelection('p_local'), [profile], {}, {
      p_local: { customModelIds: ['qwen3:8b', 'qwen3:14b', 'qwen3:14b'] },
    });
    expect(withCustom.availableModelIds).toEqual(['qwen3:8b', 'qwen3:14b']);
    // 缺省选择跟随默认模型。
    expect(withCustom.modelId).toBe('qwen3:8b');
  });

  it('uses the explicit selectedModelId and scopes overrides by the effective model', () => {
    const overrides = {
      p_local: {
        'qwen3:8b': { temperature: 0.2 },
        'qwen3:14b': { temperature: 0.9 },
      },
    };
    const models = {
      p_local: { selectedModelId: 'qwen3:14b', customModelIds: ['qwen3:14b'] },
    };
    const target = resolveDesktopAiTarget(clientSelection('p_local'), [profile], overrides, models);
    expect(target.modelId).toBe('qwen3:14b');
    expect(target.generationOverrides).toEqual({ temperature: 0.9 });
  });

  it('marks a dangling selectedModelId as reselection-required instead of falling back', () => {
    const overrides = { p_local: { 'gone-model': { temperature: 0.3 } } };
    const models = { p_local: { selectedModelId: 'gone-model', customModelIds: [] } };
    const target = resolveDesktopAiTarget(clientSelection('p_local'), [profile], overrides, models);
    // 悬空选择保留原值供诊断、请求重新选择；mode=null 阻断执行，不静默回落。
    expect(target.mode).toBeNull();
    expect(target.modelId).toBe('gone-model');
    expect(target.generationOverrides).toEqual({ temperature: 0.3 });
    expect(target.unavailableReason).toContain('重新选择');
  });
});

describe('preset layering (DESKTOP_DIRECT_ADAPTERS = openai-compatible)', () => {
  it('never offers the system entry as a client connection', () => {
    expect(AI_PROVIDER_PRESETS.some((preset) => preset.id === 'system')).toBe(false);
    expect(listDesktopPresetEntries(new Set()).every((entry) => entry.preset.id !== 'system')).toBe(
      true,
    );
  });

  it('marks a verified openai-compatible preset as copyable', () => {
    const entry = describeDesktopPresetEntry(presetById('kourichat'), false);
    expect(entry.presetSupport.supported).toBe(true);
    expect(entry.directCapableModels.length).toBeGreaterThan(0);
    expect(entry.directCapableModels.every((model) => entry.preset.models.includes(model))).toBe(true);
  });

  it('explains project-forward endpoints instead of hiding them', () => {
    const entry = describeDesktopPresetEntry(presetById('google-cloudflare'), false);
    expect(entry.presetSupport).toEqual({ supported: false, reason: 'project-forward-endpoint' });
    expect(entry.directCapableModels).toHaveLength(0);
  });

  it('per-model support follows verified wire intersected with DESKTOP_DIRECT_ADAPTERS', () => {
    const preset = presetById('kourichat');
    const modelId = preset.models[0]!.value;
    expect(describeDesktopPresetModelSupport(preset, modelId)).toEqual({
      supported: true,
      adapter: 'openai-compatible',
    });
    // 凭空 modelId 继承 preset 级 wire 声明；收录模型标记 none 的则是 unsupported-model。
    expect(DESKTOP_DIRECT_ADAPTERS.has('openai-compatible')).toBe(true);
  });

  it('tracks hidden preset ids', () => {
    const entries = listDesktopPresetEntries(new Set(['kourichat']));
    expect(entries.find((entry) => entry.preset.id === 'kourichat')?.hidden).toBe(true);
    expect(entries.find((entry) => entry.preset.id === 'deepseek')?.hidden).toBe(false);
  });
});

describe('DesktopAiConfigStore', () => {
  it('keeps client+null on fresh profiles load instead of auto-selecting the first', async () => {
    const storage = createStorage();
    const native = createNativeStub([profileFixture()]);
    const store = createStore(storage, native.invoke);
    store.init();
    await vi.waitFor(() => expect(store.getSnapshot().profilesState).toBe('ready'));

    // 没有「找到一个就自动选中」：执行位置保持客户端偏好，连接等用户显式选择。
    expect(store.getSnapshot().selection).toEqual(clientSelection(null));
    expect(
      resolveDesktopAiTarget(
        store.getSnapshot().selection,
        store.getSnapshot().profiles,
        store.getSnapshot().generationOverrides,
        store.getSnapshot().modelsByProfileId,
      ).unavailableReason,
    ).toContain('尚未选择客户端连接');
  });

  it('keeps a dangling selection for diagnosis instead of silently falling back', async () => {
    const storage = createStorage();
    storage.setItem(
      DESKTOP_AI_CONFIG_STORAGE_KEY,
      JSON.stringify({
        version: 2,
        selection: { executionPreference: 'client', clientConnectionId: 'deleted' },
        hiddenPresetIds: ['deepseek'],
        generationOverrides: {
          deleted: { m: { temperature: 1 } },
          p_local: { 'qwen3:8b': { temperature: 0.5 } },
        },
      }),
    );
    const store = createStore(storage, createNativeStub([profileFixture()]).invoke);
    store.init();
    await vi.waitFor(() => expect(store.getSnapshot().profilesState).toBe('ready'));

    // 悬空引用保留原 ID（诊断见 resolveDesktopAiTarget），不自动改选其他连接。
    expect(store.getSnapshot().selection).toEqual(clientSelection('deleted'));
    expect(store.getSnapshot().hiddenPresetIds.has('deepseek')).toBe(true);
    // 孤儿 overrides 清掉，存活连接的覆盖保留。
    expect(store.getSnapshot().generationOverrides).toEqual({
      p_local: { 'qwen3:8b': { temperature: 0.5 } },
    });
  });

  it('switches execution preference without losing the client connection', async () => {
    const storage = createStorage();
    const native = createNativeStub([profileFixture()]);
    const store = createStore(storage, native.invoke);
    store.init();
    await vi.waitFor(() => expect(store.getSnapshot().profilesState).toBe('ready'));
    store.selectClientConnection('p_local');
    expect(store.getSnapshot().selection).toEqual(clientSelection('p_local'));

    store.selectExecutionLocation('server');
    expect(store.getSnapshot().selection).toEqual({
      executionPreference: 'server',
      clientConnectionId: 'p_local',
    });

    store.selectExecutionLocation('client');
    expect(store.getSnapshot().selection).toEqual(clientSelection('p_local'));
  });

  it('selectClientConnection does not flip an explicit server preference', () => {
    const store = createStore();
    store.init();

    store.selectExecutionLocation('server');
    store.selectClientConnection('p_local');
    // 选择客户端连接与执行位置正交：服务器偏好不被偷改（D5.0c 开放后有现实意义）。
    expect(store.getSnapshot().selection).toEqual({
      executionPreference: 'server',
      clientConnectionId: 'p_local',
    });
  });

  it('blocks on corrupt overlay: refuses writes until explicit reset', async () => {
    const storage = createStorage();
    storage.setItem(DESKTOP_AI_CONFIG_STORAGE_KEY, '{broken');
    const native = createNativeStub([profileFixture()]);
    const store = createStore(storage, native.invoke);
    store.init();

    expect(store.getSnapshot().overlayState).toBe('blocked');
    store.selectClientConnection('p_local');
    store.selectExecutionLocation('server');
    store.hidePreset('deepseek');
    expect(store.getSnapshot().selection).toEqual(clientSelection(null));
    // 原数据不被覆盖。
    expect(storage.data.get(DESKTOP_AI_CONFIG_STORAGE_KEY)).toBe('{broken');

    store.resetBlockedOverlay();
    await vi.waitFor(() => expect(store.getSnapshot().profilesState).toBe('ready'));
    expect(store.getSnapshot().overlayState).toBe('ready');
    expect(storage.data.get(DESKTOP_AI_CONFIG_STORAGE_KEY)).toContain('"version":4');
  });

  it('persists hide/restore of presets', async () => {
    const storage = createStorage();
    const store = createStore(storage, createNativeStub().invoke);
    store.init();
    await vi.waitFor(() => expect(store.getSnapshot().overlayState).toBe('ready'));

    store.hidePreset('kourichat');
    store.hidePreset('kourichat'); // 幂等
    expect([...store.getSnapshot().hiddenPresetIds]).toEqual(['kourichat']);
    store.hidePreset('deepseek');
    store.unhidePreset('kourichat');
    expect([...store.getSnapshot().hiddenPresetIds]).toEqual(['deepseek']);
    store.restoreAllPresets();
    expect(store.getSnapshot().hiddenPresetIds.size).toBe(0);
    expect(JSON.parse(storage.data.get(DESKTOP_AI_CONFIG_STORAGE_KEY)!).hiddenPresetIds).toEqual([]);
  });

  it('persists model selection per profile without touching execution preference', async () => {
    const storage = createStorage();
    const native = createNativeStub([profileFixture()]);
    const store = createStore(storage, native.invoke);
    store.init();
    await vi.waitFor(() => expect(store.getSnapshot().profilesState).toBe('ready'));
    store.selectClientConnection('p_local');

    store.addCustomModel('p_local', 'qwen3:14b');
    store.selectModel('p_local', 'qwen3:14b');

    expect(store.getSnapshot().modelsByProfileId['p_local']).toEqual({
      selectedModelId: 'qwen3:14b',
      customModelIds: ['qwen3:14b'],
    });
    // 执行位置与连接选择不因模型切换被改写。
    expect(store.getSnapshot().selection).toEqual(clientSelection('p_local'));
    const persisted = JSON.parse(storage.data.get(DESKTOP_AI_CONFIG_STORAGE_KEY)!);
    expect(persisted.version).toBe(4);
    expect(persisted.modelsByProfileId.p_local).toEqual({
      selectedModelId: 'qwen3:14b',
      customModelIds: ['qwen3:14b'],
    });
    // 重启后生效模型为显式选择。
    const reopened = createStore(storage, createNativeStub([profileFixture()]).invoke);
    reopened.init();
    await vi.waitFor(() => expect(reopened.getSnapshot().profilesState).toBe('ready'));
    expect(
      resolveDesktopAiTarget(
        reopened.getSnapshot().selection,
        reopened.getSnapshot().profiles,
        reopened.getSnapshot().generationOverrides,
        reopened.getSnapshot().modelsByProfileId,
      ).modelId,
    ).toBe('qwen3:14b');
  });

  it('rejects invalid/duplicate custom model ids and refuses unknown candidates', async () => {
    const storage = createStorage();
    const native = createNativeStub([profileFixture()]);
    const store = createStore(storage, native.invoke);
    store.init();
    await vi.waitFor(() => expect(store.getSnapshot().profilesState).toBe('ready'));

    expect(() => store.addCustomModel('p_local', '   ')).toThrow('无效');
    expect(() => store.addCustomModel('p_local', `m${'x'.repeat(256)}`)).toThrow('无效');
    expect(() => store.addCustomModel('p_local', 'm\n1')).toThrow('无效');
    expect(() => store.addCustomModel('p_local', 'qwen3:8b')).toThrow('已在');
    store.addCustomModel('p_local', '  qwen3:14b  ');
    expect(() => store.addCustomModel('p_local', 'qwen3:14b')).toThrow('已在');
    expect(store.getSnapshot().modelsByProfileId['p_local']?.customModelIds).toEqual(['qwen3:14b']);

    // 不在候选清单里的模型不得写入选择偏好；未知 Profile 同样拒绝。
    store.selectModel('p_local', 'unlisted-model');
    store.selectModel('missing', 'qwen3:14b');
    expect(store.getSnapshot().modelsByProfileId['p_local']?.selectedModelId).toBeUndefined();
    expect(store.getSnapshot().modelsByProfileId['missing']).toBeUndefined();
  });

  it('keeps a dangling model selection diagnosable after removing the selected model', async () => {
    const storage = createStorage();
    const native = createNativeStub([profileFixture()]);
    const store = createStore(storage, native.invoke);
    store.init();
    await vi.waitFor(() => expect(store.getSnapshot().profilesState).toBe('ready'));
    store.selectClientConnection('p_local');
    store.addCustomModel('p_local', 'qwen3:14b');
    store.selectModel('p_local', 'qwen3:14b');
    store.setGenerationOverrides('p_local', 'qwen3:14b', { temperature: 0.3 });

    store.removeCustomModel('p_local', 'qwen3:14b');
    // 选中模型被删 → 悬空，解析层提示重新选择而非静默回落；
    // 该模型的生成覆盖保留（重加同名模型即恢复）。
    const entry = store.getSnapshot().modelsByProfileId['p_local'];
    expect(entry?.selectedModelId).toBe('qwen3:14b');
    expect(entry?.customModelIds).toEqual([]);
    const target = resolveDesktopAiTarget(
      store.getSnapshot().selection,
      store.getSnapshot().profiles,
      store.getSnapshot().generationOverrides,
      store.getSnapshot().modelsByProfileId,
    );
    expect(target.mode).toBeNull();
    expect(target.unavailableReason).toContain('重新选择');
    expect(store.getSnapshot().generationOverrides['p_local']).toEqual({
      'qwen3:14b': { temperature: 0.3 },
    });

    // 重新选择默认模型后恢复可执行；自定义清单清空+无选择时整条回收。
    store.selectModel('p_local', 'qwen3:8b');
    expect(
      resolveDesktopAiTarget(
        store.getSnapshot().selection,
        store.getSnapshot().profiles,
        store.getSnapshot().generationOverrides,
        store.getSnapshot().modelsByProfileId,
      ).unavailableReason,
    ).toBeNull();
    store.removeCustomModel('p_local', 'never-added');
    expect(store.getSnapshot().modelsByProfileId['p_local']?.selectedModelId).toBe('qwen3:8b');
  });

  it('activates a connection as one atomic overlay write (location + id + model)', async () => {
    const storage = createStorage();
    storage.setItem(
      DESKTOP_AI_CONFIG_STORAGE_KEY,
      JSON.stringify({
        version: 3,
        selection: { executionPreference: 'server', clientConnectionId: 'p_local' },
        hiddenPresetIds: [],
        generationOverrides: {},
        modelsByProfileId: {
          p_local: { selectedModelId: 'qwen3:14b', customModelIds: ['qwen3:14b'] },
        },
      }),
    );
    const store = createStore(storage, createNativeStub([profileFixture()]).invoke);
    store.init();
    await vi.waitFor(() => expect(store.getSnapshot().profilesState).toBe('ready'));

    const setSpy = vi.spyOn(storage, 'setItem');
    store.activateConnection('p_local');
    // DESK-AIP-003.3：执行位置+连接+模型是同一次受检 overlay 更新。
    expect(setSpy).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().selection).toEqual({
      executionPreference: 'client',
      clientConnectionId: 'p_local',
    });
    // 缺省沿用该连接已存的模型偏好。
    expect(store.getSnapshot().modelsByProfileId['p_local']?.selectedModelId).toBe('qwen3:14b');

    // 显式模型切换；不在候选清单的模型拒绝写入。
    store.activateConnection('p_local', 'qwen3:8b');
    expect(store.getSnapshot().modelsByProfileId['p_local']?.selectedModelId).toBe('qwen3:8b');
    store.activateConnection('p_local', 'ghost-model');
    expect(store.getSnapshot().modelsByProfileId['p_local']?.selectedModelId).toBe('qwen3:8b');
    store.activateConnection('missing');
    expect(store.getSnapshot().selection.clientConnectionId).toBe('p_local');

    const persisted = JSON.parse(storage.data.get(DESKTOP_AI_CONFIG_STORAGE_KEY)!);
    expect(persisted.selection).toEqual({
      executionPreference: 'client',
      clientConnectionId: 'p_local',
    });
    expect(persisted.modelsByProfileId.p_local.selectedModelId).toBe('qwen3:8b');
  });

  it('cleans modelsByProfileId entries of deleted profiles on refresh', async () => {
    const storage = createStorage();
    const native = createNativeStub([profileFixture(), profileFixture({ id: 'p_two', name: '二号' })]);
    const store = createStore(storage, native.invoke);
    store.init();
    await vi.waitFor(() => expect(store.getSnapshot().profilesState).toBe('ready'));

    store.addCustomModel('p_local', 'qwen3:14b');
    store.addCustomModel('p_two', 'other-model');
    expect(store.getSnapshot().modelsByProfileId['p_two']).toBeDefined();

    await store.deleteConnection('p_two');
    expect(store.getSnapshot().modelsByProfileId['p_two']).toBeUndefined();
    expect(store.getSnapshot().modelsByProfileId['p_local']).toBeDefined();
  });

  it('validates the profile natively before writing the credential, and never persists plaintext', async () => {
    const storage = createStorage();
    const native = createNativeStub();
    const store = createStore(storage, native.invoke);
    store.init();
    await vi.waitFor(() => expect(store.getSnapshot().overlayState).toBe('ready'));

    await store.saveConnection({
      id: 'p_new',
      name: '新连接',
      baseUrl: 'http://127.0.0.1:1234/v1',
      modelId: 'model-x',
      apiKey: 'sk-secret',
    });

    const validateIndex = native.calls.indexOf('validate_provider_execution_profile');
    const secretIndex = native.calls.indexOf('set_provider_secret');
    const saveIndex = native.calls.indexOf('save_provider_profile');
    // native 校验先于凭据写入，Profile 落盘在最后。
    expect(validateIndex).toBeGreaterThanOrEqual(0);
    expect(validateIndex).toBeLessThan(secretIndex);
    expect(secretIndex).toBeLessThan(saveIndex);
    // 写入的是 staged 凭据目标名（一次性 ref），Profile 内只有 apiKeyRef。
    expect(native.profiles.get('p_new')?.apiKeyRef).toMatch(/^provider-key:[0-9a-f-]{36}$/u);
    expect(native.secrets.has(native.profiles.get('p_new')!.apiKeyRef!)).toBe(true);
    expect(JSON.stringify(native.profiles.get('p_new'))).not.toContain('sk-secret');
    expect(storage.data.get(DESKTOP_AI_CONFIG_STORAGE_KEY)!).not.toContain('sk-secret');
    // r1-B：保存不再隐式选中——「保存」与「激活为当前连接」是两个显式操作。
    expect(store.getSnapshot().selection).toEqual(clientSelection(null));
    expect(store.getSnapshot().secretStatus['p_new']).toBe('present');
  });

  it('does not rewrite the credential when native profile validation fails', async () => {
    const storage = createStorage();
    const native = createNativeStub([profileFixture()], { failValidation: true });
    native.secrets.add('provider:p_local:api-key');
    const store = createStore(storage, native.invoke);
    store.init();
    await vi.waitFor(() => expect(store.getSnapshot().profilesState).toBe('ready'));

    // native 校验失败时新 Key 不得写进凭据库——否则旧 Profile 会静默开始使用新 Key。
    await expect(
      store.saveConnection({
        id: 'p_local',
        name: '改名',
        baseUrl: 'http://127.0.0.1:11434/v1',
        modelId: 'qwen3:8b',
        apiKey: 'sk-new-key',
      }),
    ).rejects.toThrow();
    expect(native.calls).toContain('validate_provider_execution_profile');
    expect(native.calls).not.toContain('set_provider_secret');
    expect(native.profiles.get('p_local')?.name).toBe('本地模型');
  });

  it('save_provider_profile failure leaves the old profile and credential untouched', async () => {
    // staged secretRef 的核心回归：Profile 落盘失败不得让旧 Profile 静默换用新 Key。
    const storage = createStorage();
    const native = createNativeStub([profileFixture()], { failProfileSave: true });
    native.secrets.add('provider:p_local:api-key');
    const store = createStore(storage, native.invoke);
    store.init();
    await vi.waitFor(() => expect(store.getSnapshot().profilesState).toBe('ready'));

    await expect(
      store.saveConnection({
        id: 'p_local',
        name: '改名',
        baseUrl: 'http://127.0.0.1:11434/v1',
        modelId: 'qwen3:8b',
        apiKey: 'sk-new-key',
      }),
    ).rejects.toThrow();

    const persisted = native.profiles.get('p_local')!;
    expect(persisted.name).toBe('本地模型');
    expect(persisted.apiKeyRef).toBe('provider:p_local:api-key');
    // staged ref 已回滚删除，凭据库只剩旧 ref——旧 Profile 仍指向旧凭据。
    expect([...native.secrets]).toEqual(['provider:p_local:api-key']);
    expect(native.calls).toContain('delete_provider_secret');
  });

  it('commit 响应丢失但写入已生效：按已保存收尾，staged 凭据不误删', async () => {
    // D5.1-AIP-r1-r1：IPC 报错 ≠ 未落盘。读回的记录逐字段等于本次候选时
    // 按成功路径收尾——staged ref 已被该 Profile 引用，删除会留悬空凭据。
    const storage = createStorage();
    const native = createNativeStub([profileFixture()], { failProfileSaveAfterWrite: true });
    native.secrets.add('provider:p_local:api-key');
    const store = createStore(storage, native.invoke);
    store.init();
    await vi.waitFor(() => expect(store.getSnapshot().profilesState).toBe('ready'));

    const result = await store.saveConnection({
      id: 'p_local',
      name: '改名',
      baseUrl: 'http://127.0.0.1:11434/v1',
      modelId: 'qwen3:8b',
      apiKey: 'sk-new-key',
    });
    expect(result).toEqual({ profileId: 'p_local', persisted: true });

    const saved = native.profiles.get('p_local')!;
    expect(saved.name).toBe('改名');
    expect(saved.apiKeyRef).toMatch(/^provider-key:[0-9a-f-]{36}$/u);
    // staged ref 保留（Profile 正在引用）；旧凭据按成功路径清理。
    expect(native.secrets.has(saved.apiKeyRef!)).toBe(true);
    expect(native.secrets.has('provider:p_local:api-key')).toBe(false);
    expect(native.calls).toContain('delete_provider_secret');
  });

  it('commit 报错且落盘核验读不到记录：保守保留 staged 凭据，报错如实失败', async () => {
    // 核验本身失败时盲删可能让已落盘 Profile 指向不存在的凭据——宁可留下
    // 无引用的孤儿 secret，也不制造悬空引用。
    const storage = createStorage();
    const native = createNativeStub([profileFixture()], { failProfileSave: true });
    native.secrets.add('provider:p_local:api-key');
    const store = createStore(storage, native.invoke);
    store.init();
    await vi.waitFor(() => expect(store.getSnapshot().profilesState).toBe('ready'));

    native.flags.failProfileRead = true;
    await expect(
      store.saveConnection({
        id: 'p_local',
        name: '改名',
        baseUrl: 'http://127.0.0.1:11434/v1',
        modelId: 'qwen3:8b',
        apiKey: 'sk-new-key',
      }),
    ).rejects.toBeInstanceOf(DesktopSaveConnectionCommitError);

    // staged ref 没有被删除——若写入实际已生效，Profile 指向的凭据仍在。
    const stagedRefs = [...native.secrets].filter((ref) => ref.startsWith('provider-key:'));
    expect(stagedRefs).toHaveLength(1);
    expect(native.secrets.has('provider:p_local:api-key')).toBe(true);
    expect(native.calls).not.toContain('delete_provider_secret');
  });

  it('编辑既有连接提交失败：saveConnectionDraft 不冒报「已保存」', async () => {
    // r1-r1 审查回归：旧记录仍在 ≠ 本次修改已保存——核验必须比对候选文档。
    const storage = createStorage();
    const native = createNativeStub([profileFixture()], { failProfileSave: true });
    native.secrets.add('provider:p_local:api-key');
    const store = createStore(storage, native.invoke);
    store.init();
    await vi.waitFor(() => expect(store.getSnapshot().profilesState).toBe('ready'));

    const failure = await saveConnectionDraft(store, {
      id: 'p_local',
      name: '改名',
      baseUrl: 'http://127.0.0.1:11434/v1',
      modelId: 'qwen3:8b',
      apiKey: 'sk-new-key',
    }).then(
      () => null,
      (cause: unknown) => cause,
    );

    expect(failure).toBeInstanceOf(DesktopSaveConnectionCommitError);
    expect((failure as Error).message).toContain('disk full');
    expect((failure as Error).message).not.toContain('已保存');
    // 旧记录与旧凭据原样保留；staged ref 已回滚。
    expect(native.profiles.get('p_local')?.name).toBe('本地模型');
    expect([...native.secrets]).toEqual(['provider:p_local:api-key']);
  });

  it('commit 已落盘但激活链路未跟上：如实呈现「已保存但未启用」', async () => {
    // save_provider_profile 的 IPC 报错读回核验时发现候选已落盘——
    // saveConnectionDraft 应投影为部分成功，而不是报错失败或静默成功。
    const storage = createStorage();
    const native = createNativeStub([profileFixture()], { failProfileSaveAfterWrite: true });
    native.secrets.add('provider:p_local:api-key');
    const store = createStore(storage, native.invoke);
    store.init();
    await vi.waitFor(() => expect(store.getSnapshot().profilesState).toBe('ready'));

    // 提交核验通过：saveConnection 已按已保存收尾，激活语义不在编辑保存路径内。
    await expect(
      saveConnectionDraft(store, {
        id: 'p_local',
        name: '改名',
        baseUrl: 'http://127.0.0.1:11434/v1',
        modelId: 'qwen3:8b',
        apiKey: 'sk-new-key',
      }),
    ).resolves.toBeUndefined();
    expect(native.profiles.get('p_local')?.name).toBe('改名');
    // 编辑既有连接不做激活——选择保持原样。
    expect(store.getSnapshot().selection).toEqual(clientSelection(null));
  });

  it('保存成功但激活写盘失败：如实报告「已保存但未启用」', async () => {
    const storage = createStorage();
    const native = createNativeStub();
    const store = createStore(storage, native.invoke);
    store.init();
    await vi.waitFor(() => expect(store.getSnapshot().overlayState).toBe('ready'));

    // 只在激活写盘（含 p_new 的选择更新）时失败；Profile/凭据落盘不受影响。
    const original = storage.setItem.bind(storage);
    vi.spyOn(storage, 'setItem').mockImplementation((key, value) => {
      if (value.includes('"clientConnectionId":"p_new"')) throw new Error('quota exceeded');
      original(key, value);
    });

    const failure = await saveConnectionDraft(
      store,
      {
        id: 'p_new',
        name: '新连接',
        baseUrl: 'http://127.0.0.1:1234/v1',
        modelId: 'm',
        apiKey: 'sk-secret',
      },
      { activate: true },
    ).then(
      () => null,
      (cause: unknown) => cause,
    );

    expect((failure as Error).message).toContain('连接已保存，但启用为当前连接失败');
    // Profile 与 staged 凭据确实已落盘——部分成功被如实区分。
    expect(native.profiles.has('p_new')).toBe(true);
    expect(store.getSnapshot().selection).toEqual(clientSelection(null));
  });

  it('new-connection save failure leaves no orphan credential behind', async () => {
    const storage = createStorage();
    const native = createNativeStub([], { failProfileSave: true });
    const store = createStore(storage, native.invoke);
    store.init();
    await vi.waitFor(() => expect(store.getSnapshot().profilesState).toBe('ready'));

    await expect(
      store.saveConnection({
        id: 'p_new',
        name: '新连接',
        baseUrl: 'http://127.0.0.1:1234/v1',
        modelId: 'm',
        apiKey: 'sk-orphan-risk',
      }),
    ).rejects.toThrow();

    expect(native.profiles.size).toBe(0);
    expect(native.secrets.size).toBe(0);
  });

  it('refuses to edit a legacy profile whose adapter the editor cannot express', async () => {
    const legacy = profileFixture({
      id: 'p_anthropic',
      adapter: 'anthropic',
      baseUrl: 'https://api.anthropic.com/v1',
    });
    const native = createNativeStub([legacy]);
    const store = createStore(createStorage(), native.invoke);
    store.init();
    await vi.waitFor(() => expect(store.getSnapshot().profilesState).toBe('ready'));

    await expect(
      store.saveConnection({
        id: 'p_anthropic',
        name: '改名而已',
        baseUrl: 'https://api.anthropic.com/v1',
        modelId: 'claude',
      }),
    ).rejects.toThrow(/openai-compatible/u);
    // 原 Profile 完全未被触碰，adapter 没被静默改写成 openai-compatible。
    expect(native.profiles.get('p_anthropic')?.adapter).toBe('anthropic');
    expect(native.profiles.get('p_anthropic')?.name).toBe('本地模型');
    expect(native.calls).not.toContain('save_provider_profile');
  });

  it('clearApiKey removes the apiKeyRef and deletes the old credential after save', async () => {
    const storage = createStorage();
    const native = createNativeStub([profileFixture()]);
    native.secrets.add('provider:p_local:api-key');
    const store = createStore(storage, native.invoke);
    store.init();
    await vi.waitFor(() => expect(store.getSnapshot().profilesState).toBe('ready'));

    await store.saveConnection({
      id: 'p_local',
      name: '本地模型',
      baseUrl: 'http://127.0.0.1:11434/v1',
      modelId: 'qwen3:8b',
      clearApiKey: true,
    });

    const saved = native.profiles.get('p_local')!;
    // Profile 不再携带凭据引用；旧凭据在落盘成功后删除。
    expect(saved.apiKeyRef).toBeUndefined();
    expect(native.secrets.has('provider:p_local:api-key')).toBe(false);
    const deleteIndex = native.calls.lastIndexOf('delete_provider_secret');
    const saveIndex = native.calls.indexOf('save_provider_profile');
    expect(deleteIndex).toBeGreaterThan(saveIndex);
    expect(store.getSnapshot().secretStatus['p_local']).toBe('absent');
  });

  it('rejects a draft that both clears and replaces the credential', async () => {
    const storage = createStorage();
    const native = createNativeStub([profileFixture()]);
    native.secrets.add('provider:p_local:api-key');
    const store = createStore(storage, native.invoke);
    store.init();
    await vi.waitFor(() => expect(store.getSnapshot().profilesState).toBe('ready'));

    await expect(
      store.saveConnection({
        id: 'p_local',
        name: '本地模型',
        baseUrl: 'http://127.0.0.1:11434/v1',
        modelId: 'qwen3:8b',
        clearApiKey: true,
        apiKey: 'sk-conflict',
      }),
    ).rejects.toThrow('清除凭据');

    // 矛盾输入不落任何盘：Profile 与凭据都保持原样。
    expect(native.profiles.get('p_local')?.apiKeyRef).toBe('provider:p_local:api-key');
    expect(native.calls).not.toContain('save_provider_profile');
    expect(native.calls).not.toContain('set_provider_secret');
  });

  it('keeps the existing apiKeyRef and createdAt when editing without a new key', async () => {
    const original = profileFixture({ createdAt: '2026-01-01T00:00:00.000Z' });
    const storage = createStorage();
    const native = createNativeStub([original]);
    const store = createStore(storage, native.invoke);
    store.init();
    await vi.waitFor(() => expect(store.getSnapshot().profilesState).toBe('ready'));

    await store.saveConnection({
      id: 'p_local',
      name: '改名',
      baseUrl: 'http://127.0.0.1:11434/v1',
      modelId: 'qwen3:8b',
    });

    const saved = native.profiles.get('p_local')!;
    expect(saved.name).toBe('改名');
    expect(saved.apiKeyRef).toBe('provider:p_local:api-key');
    expect(saved.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(saved.updatedAt).toBe(NOW);
  });

  it('requires explicit allowPublicHttp for non-loopback plaintext HTTP', async () => {
    const native = createNativeStub();
    const store = createStore(createStorage(), native.invoke);
    store.init();
    await vi.waitFor(() => expect(store.getSnapshot().overlayState).toBe('ready'));

    await expect(
      store.saveConnection({
        id: 'p_http',
        name: '远端明文',
        baseUrl: 'http://203.0.113.10:8080/v1',
        modelId: 'm',
      }),
    ).rejects.toThrow();

    await store.saveConnection({
      id: 'p_http',
      name: '远端明文',
      baseUrl: 'http://203.0.113.10:8080/v1',
      modelId: 'm',
      allowPublicHttp: true,
    });
    expect(native.profiles.get('p_http')?.transport?.allowPublicHttp).toBe(true);
  });

  it('deletes the profile first, then the credential recorded on it', async () => {
    const native = createNativeStub([profileFixture()]);
    native.secrets.add('provider:p_local:api-key');
    const store = createStore(createStorage(), native.invoke);
    store.init();
    await vi.waitFor(() => expect(store.getSnapshot().profilesState).toBe('ready'));
    store.selectClientConnection('p_local');

    await store.deleteConnection('p_local');

    const commands = native.calls;
    expect(commands.indexOf('delete_provider_profile')).toBeLessThan(
      commands.lastIndexOf('delete_provider_secret'),
    );
    expect(native.profiles.size).toBe(0);
    expect(native.secrets.size).toBe(0);
    // 显式解除当前连接引用：不自动换供应商。
    expect(store.getSnapshot().selection).toEqual(clientSelection(null));
  });

  it('deletes the credential by the profile\'s actual apiKeyRef, not a derived one', async () => {
    // 旧数据的 secret ref 可能与派生规则不同；删除必须指向真实记录的 ref。
    const legacy = profileFixture({ apiKeyRef: 'provider:legacy-name:api-key' });
    const native = createNativeStub([legacy]);
    native.secrets.add('provider:legacy-name:api-key');
    const store = createStore(createStorage(), native.invoke);
    store.init();
    await vi.waitFor(() => expect(store.getSnapshot().profilesState).toBe('ready'));

    await store.deleteConnection('p_local');

    expect(native.secrets.size).toBe(0);
    expect(native.calls).toContain('delete_provider_secret');
    expect(native.calls.filter((c) => c === 'delete_provider_secret')).toHaveLength(1);
  });

  it('marks credential existence failures as error instead of pretending absent', async () => {
    const native = createNativeStub([profileFixture()], { failSecretProbe: true });
    const store = createStore(createStorage(), native.invoke);
    store.init();
    await vi.waitFor(() => expect(store.getSnapshot().profilesState).toBe('ready'));

    expect(store.getSnapshot().secretStatus['p_local']).toBe('error');
  });

  it('scopes generation overrides per connection+model and persists them', async () => {
    const storage = createStorage();
    const store = createStore(storage, createNativeStub([profileFixture()]).invoke);
    store.init();
    await vi.waitFor(() => expect(store.getSnapshot().profilesState).toBe('ready'));

    store.setGenerationOverrides('p_local', 'qwen3:8b', { temperature: 0.3 });
    expect(store.getSnapshot().generationOverrides).toEqual({
      p_local: { 'qwen3:8b': { temperature: 0.3 } },
    });
    expect(
      JSON.parse(storage.data.get(DESKTOP_AI_CONFIG_STORAGE_KEY)!).generationOverrides,
    ).toEqual({ p_local: { 'qwen3:8b': { temperature: 0.3 } } });

    // id/modelId 含冒号也不会与其他条目串键。
    store.setGenerationOverrides('p_local', 'qwen3:8b::vision', { temperature: 0.9 });
    store.setGenerationOverrides('p_local', 'qwen3:8b', undefined);
    expect(store.getSnapshot().generationOverrides).toEqual({
      p_local: { 'qwen3:8b::vision': { temperature: 0.9 } },
    });
    store.setGenerationOverrides('p_local', 'qwen3:8b::vision', undefined);
    expect(store.getSnapshot().generationOverrides).toEqual({});
  });

  it('round-trips overrides for keys like __proto__ without prototype pollution', async () => {
    // JS 原型键是合法 profileId/modelId：字典必须按 own-property 语义存取。
    const storage = createStorage();
    const protoProfile = profileFixture({ id: '__proto__', modelId: '__proto__' });
    const store = createStore(storage, createNativeStub([protoProfile]).invoke);
    store.init();
    await vi.waitFor(() => expect(store.getSnapshot().profilesState).toBe('ready'));

    store.setGenerationOverrides('__proto__', '__proto__', { temperature: 0.7 });
    const stored = store.getSnapshot().generationOverrides;
    expect(Object.getPrototypeOf(stored)).toBeNull();
    expect(Object.keys(stored)).toEqual(['__proto__']);
    expect(stored['__proto__']?.['__proto__']).toEqual({ temperature: 0.7 });
    // 落盘 JSON 里 __proto__ 是真实 own property（注意 {__proto__: x} 字面量是
    // 原型 setter 语义，不能拿它做期望值——这里逐层读 own property 断言）。
    const persisted = JSON.parse(storage.data.get(DESKTOP_AI_CONFIG_STORAGE_KEY)!)
      .generationOverrides as Record<string, Record<string, unknown>>;
    expect(Object.keys(persisted)).toEqual(['__proto__']);
    expect(Object.keys(persisted['__proto__']!)).toEqual(['__proto__']);
    expect(persisted['__proto__']!['__proto__']).toEqual({ temperature: 0.7 });

    // 重启读取不丢数据、不污染原型。
    const reopened = createStore(storage, createNativeStub([protoProfile]).invoke);
    reopened.init();
    await vi.waitFor(() => expect(reopened.getSnapshot().profilesState).toBe('ready'));
    expect(reopened.getSnapshot().generationOverrides['__proto__']?.['__proto__']).toEqual({
      temperature: 0.7,
    });
    expect(
      resolveDesktopAiTarget(
        clientSelection('__proto__'),
        reopened.getSnapshot().profiles,
        reopened.getSnapshot().generationOverrides,
        reopened.getSnapshot().modelsByProfileId,
      ).generationOverrides,
    ).toEqual({ temperature: 0.7 });
  });

  it('keeps memory and disk on the last good state when overlay persist fails', async () => {
    // r1-B 原子性：先持久化候选、成功后才替换内存——写盘失败时两边都停在
    // 上一有效状态，且失败的修改不会残留在内存里等下一次写入偷渡落盘。
    const storage = createStorage();
    const store = createStore(storage, createNativeStub([profileFixture()]).invoke);
    store.init();
    await vi.waitFor(() => expect(store.getSnapshot().overlayState).toBe('ready'));

    const diskBefore = storage.data.get(DESKTOP_AI_CONFIG_STORAGE_KEY)!;
    vi.spyOn(storage, 'setItem').mockImplementationOnce(() => {
      throw new Error('quota exceeded');
    });
    expect(() => store.selectClientConnection('p_local')).toThrow('quota');
    expect(store.getSnapshot().selection).toEqual(clientSelection(null));
    expect(storage.data.get(DESKTOP_AI_CONFIG_STORAGE_KEY)).toBe(diskBefore);

    // 恢复可写后，下一次成功写入只包含新操作，不带回失败的修改。
    store.selectExecutionLocation('server');
    const persisted = JSON.parse(storage.data.get(DESKTOP_AI_CONFIG_STORAGE_KEY)!);
    expect(persisted.selection).toEqual({
      executionPreference: 'server',
      clientConnectionId: null,
    });
  });

  it('serializes concurrent saveConnection calls (single-flight per draft)', async () => {
    const storage = createStorage();
    const native = createNativeStub();
    const store = createStore(storage, native.invoke);
    store.init();
    await vi.waitFor(() => expect(store.getSnapshot().overlayState).toBe('ready'));

    const draft = {
      id: 'p_new',
      name: '新连接',
      baseUrl: 'http://127.0.0.1:1234/v1',
      modelId: 'm',
    };
    const first = store.saveConnection(draft);
    // 同一候选 ID 的渲染内重复提交幂等复用同一事务——native 只落盘一次。
    const second = store.saveConnection({ ...draft });
    await expect(first).resolves.toEqual({ profileId: 'p_new', persisted: true });
    await expect(second).resolves.toEqual({ profileId: 'p_new', persisted: true });
    expect(
      native.calls.filter((command) => command === 'save_provider_profile'),
    ).toHaveLength(1);

    // 不同草稿撞进事务窗口：立即拒绝而不是排队顶替。
    const third = store.saveConnection({ ...draft, id: 'p_other' });
    // 上一事务已完成（saveConnectionInFlight 已清），这条应正常成功。
    await expect(third).resolves.toEqual({ profileId: 'p_other', persisted: true });
  });

  it('rejects a second different draft while a save is still in flight', async () => {
    const storage = createStorage();
    const native = createNativeStub();
    // 让 save_provider_profile 挂起，保证第二次提交落在事务窗口内。
    let releaseSave: (() => void) | null = null;
    const invoke = (async (command: string, args?: Record<string, unknown>) => {
      if (command === 'save_provider_profile') {
        await new Promise<void>((resolve) => {
          releaseSave = resolve;
        });
      }
      return native.invoke(command, args);
    }) as DesktopAiConfigInvokeFn;
    const store = createStore(storage, invoke);
    store.init();
    await vi.waitFor(() => expect(store.getSnapshot().overlayState).toBe('ready'));

    const pending = store.saveConnection({
      id: 'p_a',
      name: '甲',
      baseUrl: 'http://127.0.0.1:1234/v1',
      modelId: 'm',
    });
    await expect(
      store.saveConnection({
        id: 'p_b',
        name: '乙',
        baseUrl: 'http://127.0.0.1:1234/v1',
        modelId: 'm',
      }),
    ).rejects.toThrow('正在保存');
    // 等第一个事务真正挂到 save_provider_profile 上再放行。
    await vi.waitFor(() => expect(releaseSave).toBeTypeOf('function'));
    releaseSave!();
    await pending;
    // 被拒的草稿从未触达 native。
    expect(native.profiles.has('p_b')).toBe(false);
    expect(native.profiles.has('p_a')).toBe(true);
  });

  it('rejects the reserved system scope id as a profile id', async () => {
    const native = createNativeStub();
    const store = createStore(createStorage(), native.invoke);
    store.init();
    await vi.waitFor(() => expect(store.getSnapshot().overlayState).toBe('ready'));

    // `system` 是「使用系统默认配置」的生成覆盖 scope——同名 Profile 会撞键。
    await expect(
      store.saveConnection({
        id: 'system',
        name: '撞名',
        baseUrl: 'http://127.0.0.1:1234/v1',
        modelId: 'm',
      }),
    ).rejects.toThrow('保留');
    expect(native.calls).not.toContain('save_provider_profile');
  });

  it('persists the system-channel model selection and resolves it like Web', async () => {
    const storage = createStorage();
    const store = createStore(storage, createNativeStub().invoke);
    store.init();
    await vi.waitFor(() => expect(store.getSnapshot().overlayState).toBe('ready'));

    store.selectExecutionLocation('server');
    store.selectSystemModel('glm-5.3-flash');
    expect(store.getSnapshot().selection.systemModelId).toBe('glm-5.3-flash');
    expect(
      resolveDesktopAiTarget(
        store.getSnapshot().selection,
        store.getSnapshot().profiles,
        store.getSnapshot().generationOverrides,
        store.getSnapshot().modelsByProfileId,
      ).modelId,
    ).toBe('glm-5.3-flash');
    expect(
      JSON.parse(storage.data.get(DESKTOP_AI_CONFIG_STORAGE_KEY)!).selection.systemModelId,
    ).toBe('glm-5.3-flash');

    // 不在公开清单内的 ID 拒绝写入——写入路径不产生悬空值。
    store.selectSystemModel('not-a-real-model');
    expect(store.getSnapshot().selection.systemModelId).toBe('glm-5.3-flash');

    // 目录移除后的悬空系统模型保留原值、要求重新选择（不静默回落默认）。
    const dangling = resolveDesktopAiTarget(
      { executionPreference: 'server', clientConnectionId: null, systemModelId: 'retired-model' },
      [],
      {},
      {},
    );
    expect(dangling.modelId).toBe('retired-model');
    expect(dangling.unavailableReason).toContain('重新选择');
  });

  it('keeps system-channel state through activation and refresh cleanup', async () => {
    const storage = createStorage();
    const native = createNativeStub([profileFixture()]);
    const store = createStore(storage, native.invoke);
    store.init();
    await vi.waitFor(() => expect(store.getSnapshot().profilesState).toBe('ready'));

    store.selectSystemModel('glm-5.3-flash');
    store.setGenerationOverrides('system', 'glm-5.3-flash', { temperature: 0.2 });
    store.activateConnection('p_local');
    // 激活客户端连接不清掉系统通道偏好——两个维度正交。
    expect(store.getSnapshot().selection.systemModelId).toBe('glm-5.3-flash');
    expect(store.getSnapshot().generationOverrides['system']).toEqual({
      'glm-5.3-flash': { temperature: 0.2 },
    });

    // 删除客户端连接触发孤儿清理：'system' scope 不是孤儿 Profile 数据。
    store.selectClientConnection('p_local');
    await store.deleteConnection('p_local');
    expect(store.getSnapshot().generationOverrides['system']).toEqual({
      'glm-5.3-flash': { temperature: 0.2 },
    });
    expect(store.getSnapshot().selection.systemModelId).toBe('glm-5.3-flash');
    expect(store.getSnapshot().selection.clientConnectionId).toBeNull();
  });

  it('reports saved-but-not-activated through isProfilePersisted verification', async () => {
    const storage = createStorage();
    const native = createNativeStub();
    const store = createStore(storage, native.invoke);
    store.init();
    await vi.waitFor(() => expect(store.getSnapshot().overlayState).toBe('ready'));

    const result = await store.saveConnection({
      id: 'p_new',
      name: '新连接',
      baseUrl: 'http://127.0.0.1:1234/v1',
      modelId: 'm',
    });
    expect(result).toEqual({ profileId: 'p_new', persisted: true });
    // native 记录核验独立于本地列表缓存。
    expect(await store.isProfilePersisted('p_new')).toBe(true);
    expect(await store.isProfilePersisted('never-saved')).toBe(false);
  });

  it('never issues a secret-read command: only set/has/delete exist', async () => {
    const native = createNativeStub([profileFixture()]);
    const store = createStore(createStorage(), native.invoke);
    store.init();
    await vi.waitFor(() => expect(store.getSnapshot().profilesState).toBe('ready'));

    await store.saveConnection({
      id: 'p_two',
      name: '二号',
      baseUrl: 'http://127.0.0.1:1234/v1',
      modelId: 'm',
      apiKey: 'k',
    });
    await store.deleteConnection('p_two');
    const secretCommands = native.calls.filter((command) => command.includes('secret'));
    expect(secretCommands.length).toBeGreaterThan(0);
    expect(
      secretCommands.every((command) =>
        ['set_provider_secret', 'has_provider_secret', 'delete_provider_secret'].includes(command),
      ),
    ).toBe(true);
  });
});
