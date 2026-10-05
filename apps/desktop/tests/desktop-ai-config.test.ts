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
  type DesktopAiConfigKvStorage,
  type DesktopAiConfigInvokeFn,
} from '../src/features/ai-config/desktop-ai-config-store';

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
  } = {},
) => {
  const profiles = new Map(initial.map((profile) => [profile.id, profile]));
  const secrets = new Set<string>();
  const calls: string[] = [];
  const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
    calls.push(command);
    switch (command) {
      case 'list_provider_profile_ids':
        return [...profiles.keys()];
      case 'get_provider_profile':
        return profiles.get(args?.profileId as string) ?? null;
      case 'validate_provider_execution_profile':
        if (options.failValidation) {
          throw { code: 'provider-profile-rejected', message: 'native rejected the profile' };
        }
        return args?.document;
      case 'save_provider_profile': {
        if (options.failProfileSave) {
          throw { code: 'store-failure', message: 'disk full' };
        }
        const document = args?.document as DirectProviderProfileV1;
        profiles.set(document.id, document);
        return undefined;
      }
      case 'delete_provider_profile':
        profiles.delete(args?.profileId as string);
        return undefined;
      case 'set_provider_secret':
        secrets.add(args?.secretRef as string);
        return undefined;
      case 'has_provider_secret':
        if (options.failSecretProbe) throw new Error('keychain unavailable');
        return secrets.has(args?.secretRef as string);
      case 'delete_provider_secret':
        secrets.delete(args?.secretRef as string);
        return undefined;
      default:
        throw new Error(`unexpected command ${command}`);
    }
  }) as unknown as DesktopAiConfigInvokeFn;
  return { invoke, profiles, secrets, calls };
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
    expect(() => parseDesktopAiConfigOverlay('{"version":3}')).toThrow('版本');
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
});

describe('resolveDesktopAiTarget', () => {
  const profile = profileFixture();

  it('server preference resolves to an executable hosted target without requiring login', () => {
    const target = resolveDesktopAiTarget(
      { executionPreference: 'server', clientConnectionId: 'p_local' },
      [profile],
      {},
    );
    expect(target.location).toBe('server');
    // hosted 通路不消费客户端连接；可执行性由 dispatch 时 DESK-094 门禁裁决。
    expect(target.profile).toBeNull();
    expect(target.mode).toBeNull();
    expect(target.unavailableReason).toBeNull();
  });

  it('guides configuration when no client connection is selected', () => {
    const target = resolveDesktopAiTarget(clientSelection(null), [profile], {});
    expect(target.location).toBe('client');
    expect(target.profile).toBeNull();
    expect(target.unavailableReason).toContain('尚未选择客户端连接');
  });

  it('reports a dangling selection instead of crashing or switching providers', () => {
    const target = resolveDesktopAiTarget(clientSelection('gone'), [profile], {});
    expect(target.profile).toBeNull();
    expect(target.unavailableReason).toContain('已不存在');
  });

  it('derives direct-local for loopback and direct-remote otherwise', () => {
    expect(resolveDesktopAiTarget(clientSelection('p_local'), [profile], {}).mode).toBe(
      'direct-local',
    );
    const remote = profileFixture({ baseUrl: 'https://api.example.com/v1' });
    expect(resolveDesktopAiTarget(clientSelection('p_local'), [remote], {}).mode).toBe(
      'direct-remote',
    );
  });

  it('rejects adapters the native side has not implemented', () => {
    const anthropic = profileFixture({
      adapter: 'anthropic',
      baseUrl: 'https://api.anthropic.com/v1',
    });
    const target = resolveDesktopAiTarget(clientSelection('p_local'), [anthropic], {});
    expect(target.mode).toBeNull();
    expect(target.unavailableReason).toContain('anthropic');
  });

  it('scopes generation overrides by profile id and model id', () => {
    const overrides = {
      p_local: { 'qwen3:8b': { temperature: 0.2 } },
      other: { m: { temperature: 1 } },
    };
    const target = resolveDesktopAiTarget(clientSelection('p_local'), [profile], overrides);
    expect(target.generationOverrides).toEqual({ temperature: 0.2 });
    const renamed = profileFixture({ modelId: 'other-model' });
    expect(
      resolveDesktopAiTarget(clientSelection('p_local'), [renamed], overrides)
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
      resolveDesktopAiTarget(clientSelection('a::b'), [first], overrides).generationOverrides,
    ).toEqual({ temperature: 0.1 });
    expect(
      resolveDesktopAiTarget(clientSelection('a'), [second], overrides).generationOverrides,
    ).toEqual({ temperature: 0.9 });
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
    expect(storage.data.get(DESKTOP_AI_CONFIG_STORAGE_KEY)).toContain('"version":2');
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
    // 保存后自动选中。
    expect(store.getSnapshot().selection).toEqual(clientSelection('p_new'));
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
      ).generationOverrides,
    ).toEqual({ temperature: 0.7 });
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
