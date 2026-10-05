// D5.0b 统一 AI 配置层测试：overlay 解析、执行目标解析、预设分层与 store 编排。
//
// 被测不变量：
// - overlay fail-closed；损坏即 blocked，显式重置前拒绝一切写入；
// - 预设目录不含 `system`；Direct 候选 = 已核验 wire ∩ `DESKTOP_DIRECT_ADAPTERS`；
// - secret 只有 set/has/delete 三个调用面，明文永不进 overlay/Profile；
// - 先凭据后 Profile、先 Profile 后凭据的两个删除顺序；
// - 编辑连接时不提供新明文则保留既有 `apiKeyRef` 与 `createdAt`。

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
  desktopConnectionOverridesScope,
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

/** 按真实 bridge 的 IPC 形状模拟 native：投影回显 + opaque 文档存取 + 只写凭据库。 */
const createNativeStub = (initial: DirectProviderProfileV1[] = []) => {
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
        return args?.document;
      case 'save_provider_profile': {
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

  it('fails closed on unsupported version, corrupt selection and non-schema overrides', () => {
    expect(() => parseDesktopAiConfigOverlay('{"version":2}')).toThrow('版本');
    expect(() =>
      parseDesktopAiConfigOverlay(
        JSON.stringify({ version: 1, selection: { kind: 'connection' }, hiddenPresetIds: [] }),
      ),
    ).toThrow('选择');
    expect(() =>
      parseDesktopAiConfigOverlay(
        JSON.stringify({
          version: 1,
          selection: { kind: 'server' },
          hiddenPresetIds: [],
          generationOverrides: { 'a::b': { temperature: 'hot' } },
        }),
      ),
    ).toThrow('schema');
    expect(() =>
      parseDesktopAiConfigOverlay(
        JSON.stringify({ version: 1, selection: { kind: 'server' }, hiddenPresetIds: [1] }),
      ),
    ).toThrow('隐藏');
  });
});

describe('resolveDesktopAiTarget', () => {
  const profile = profileFixture();

  it('server selection is an unavailable placeholder until hosted lands', () => {
    const target = resolveDesktopAiTarget({ kind: 'server' }, [profile], {});
    expect(target.location).toBe('server');
    expect(target.profile).toBeNull();
    expect(target.unavailableReason).toContain('服务器执行');
  });

  it('reports a dangling selection instead of crashing', () => {
    const target = resolveDesktopAiTarget(
      { kind: 'connection', profileId: 'gone' },
      [profile],
      {},
    );
    expect(target.profile).toBeNull();
    expect(target.unavailableReason).toContain('已不存在');
  });

  it('derives direct-local for loopback and direct-remote otherwise', () => {
    expect(resolveDesktopAiTarget({ kind: 'connection', profileId: 'p_local' }, [profile], {}).mode).toBe(
      'direct-local',
    );
    const remote = profileFixture({ baseUrl: 'https://api.example.com/v1' });
    expect(resolveDesktopAiTarget({ kind: 'connection', profileId: 'p_local' }, [remote], {}).mode).toBe(
      'direct-remote',
    );
  });

  it('rejects adapters the native side has not implemented', () => {
    const anthropic = profileFixture({
      adapter: 'anthropic',
      baseUrl: 'https://api.anthropic.com/v1',
    });
    const target = resolveDesktopAiTarget(
      { kind: 'connection', profileId: 'p_local' },
      [anthropic],
      {},
    );
    expect(target.mode).toBeNull();
    expect(target.unavailableReason).toContain('anthropic');
  });

  it('scopes generation overrides by profile id and model id', () => {
    const overrides = { 'p_local::qwen3:8b': { temperature: 0.2 }, 'other::m': { temperature: 1 } };
    const target = resolveDesktopAiTarget(
      { kind: 'connection', profileId: 'p_local' },
      [profile],
      overrides,
    );
    expect(target.generationOverrides).toEqual({ temperature: 0.2 });
    const renamed = profileFixture({ modelId: 'other-model' });
    expect(
      resolveDesktopAiTarget({ kind: 'connection', profileId: 'p_local' }, [renamed], overrides)
        .generationOverrides,
    ).toBeUndefined();
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
  it('auto-selects the first loaded connection (server is a disabled placeholder)', async () => {
    const storage = createStorage();
    const native = createNativeStub([profileFixture()]);
    const store = createStore(storage, native.invoke);
    store.init();
    await vi.waitFor(() => expect(store.getSnapshot().profilesState).toBe('ready'));

    expect(store.getSnapshot().selection).toEqual({ kind: 'connection', profileId: 'p_local' });
    const persisted = JSON.parse(storage.data.get(DESKTOP_AI_CONFIG_STORAGE_KEY)!);
    expect(persisted.selection).toEqual({ kind: 'connection', profileId: 'p_local' });
  });

  it('drops a dangling selection and keeps hidden presets on refresh', async () => {
    const storage = createStorage();
    storage.setItem(
      DESKTOP_AI_CONFIG_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        selection: { kind: 'connection', profileId: 'deleted' },
        hiddenPresetIds: ['deepseek'],
        generationOverrides: { 'deleted::m': { temperature: 1 }, 'p_local::qwen3:8b': { temperature: 0.5 } },
      }),
    );
    const store = createStore(storage, createNativeStub([profileFixture()]).invoke);
    store.init();
    await vi.waitFor(() => expect(store.getSnapshot().profilesState).toBe('ready'));

    expect(store.getSnapshot().selection).toEqual({ kind: 'connection', profileId: 'p_local' });
    expect(store.getSnapshot().hiddenPresetIds.has('deepseek')).toBe(true);
    // 孤儿 overrides 清掉，存活连接的 scope 保留。
    expect(store.getSnapshot().generationOverrides).toEqual({
      'p_local::qwen3:8b': { temperature: 0.5 },
    });
  });

  it('blocks on corrupt overlay: refuses writes until explicit reset', async () => {
    const storage = createStorage();
    storage.setItem(DESKTOP_AI_CONFIG_STORAGE_KEY, '{broken');
    const native = createNativeStub([profileFixture()]);
    const store = createStore(storage, native.invoke);
    store.init();

    expect(store.getSnapshot().overlayState).toBe('blocked');
    store.selectConnection('p_local');
    store.hidePreset('deepseek');
    expect(store.getSnapshot().selection.kind).toBe('server');
    // 原数据不被覆盖。
    expect(storage.data.get(DESKTOP_AI_CONFIG_STORAGE_KEY)).toBe('{broken');

    store.resetBlockedOverlay();
    await vi.waitFor(() => expect(store.getSnapshot().profilesState).toBe('ready'));
    expect(store.getSnapshot().overlayState).toBe('ready');
    expect(storage.data.get(DESKTOP_AI_CONFIG_STORAGE_KEY)).toContain('"version":1');
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

  it('writes the credential before the profile and never persists plaintext', async () => {
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

    const secretIndex = native.calls.indexOf('set_provider_secret');
    const saveIndex = native.calls.indexOf('save_provider_profile');
    expect(secretIndex).toBeGreaterThanOrEqual(0);
    expect(secretIndex).toBeLessThan(saveIndex);
    // 写入的是凭据目标名，Profile 内只有 apiKeyRef。
    expect(native.profiles.get('p_new')?.apiKeyRef).toBe('provider:p_new:api-key');
    expect(JSON.stringify(native.profiles.get('p_new'))).not.toContain('sk-secret');
    expect(storage.data.get(DESKTOP_AI_CONFIG_STORAGE_KEY)!).not.toContain('sk-secret');
    // 保存后自动选中。
    expect(store.getSnapshot().selection).toEqual({ kind: 'connection', profileId: 'p_new' });
    expect(store.getSnapshot().secretStatus['p_new']).toBe(true);
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

  it('deletes the profile before attempting its credential', async () => {
    const native = createNativeStub([profileFixture()]);
    native.secrets.add('provider:p_local:api-key');
    const store = createStore(createStorage(), native.invoke);
    store.init();
    await vi.waitFor(() => expect(store.getSnapshot().profilesState).toBe('ready'));
    store.selectConnection('p_local');

    await store.deleteConnection('p_local');

    const commands = native.calls;
    expect(commands.indexOf('delete_provider_profile')).toBeLessThan(
      commands.lastIndexOf('delete_provider_secret'),
    );
    expect(native.profiles.size).toBe(0);
    expect(native.secrets.size).toBe(0);
    expect(store.getSnapshot().selection).toEqual({ kind: 'server' });
  });

  it('scopes generation overrides per connection+model and persists them', async () => {
    const storage = createStorage();
    const store = createStore(storage, createNativeStub([profileFixture()]).invoke);
    store.init();
    await vi.waitFor(() => expect(store.getSnapshot().profilesState).toBe('ready'));

    store.setGenerationOverrides('p_local', 'qwen3:8b', { temperature: 0.3 });
    const scope = desktopConnectionOverridesScope('p_local', 'qwen3:8b');
    expect(store.getSnapshot().generationOverrides[scope]).toEqual({ temperature: 0.3 });
    expect(JSON.parse(storage.data.get(DESKTOP_AI_CONFIG_STORAGE_KEY)!).generationOverrides[scope]).toEqual(
      { temperature: 0.3 },
    );

    store.setGenerationOverrides('p_local', 'qwen3:8b', undefined);
    expect(store.getSnapshot().generationOverrides[scope]).toBeUndefined();
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
