import { describe, expect, it, vi } from 'vitest';
import { DesktopAiConfigStore, DESKTOP_AI_CONFIG_STORAGE_KEY } from '../src/features/ai-config/desktop-ai-config-store';
import { parseDesktopAiConfigOverlay, serializeDesktopAiConfigOverlay, resolveDesktopAiTarget } from '../src/features/ai-config/desktop-ai-config';
import { buildProfile } from '../src/features/providers/profile-draft';
import { openDirectAiStream } from '../src/platform/direct-ai-bridge';
import type { DirectProviderProfileV1 } from '@mahoshojo/contracts/provider-profile';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), Channel: class { onmessage?: (event: unknown) => void; } }));
// 本文件测 store 编排；IPC wire 格式由 provider-profile-bridge 的双向契约测试负责。
const profiles = vi.hoisted(() => new Map<string, unknown>());
vi.mock('../src/platform/provider-profile-bridge', () => ({
  listProviderProfileIds: async () => [...profiles.keys()],
  getProviderProfile: async (_: unknown, id: string) => profiles.get(id) ?? null,
  saveProviderProfile: async (_: unknown, profile: DirectProviderProfileV1) => { profiles.set(profile.id, profile); },
  validateProviderExecutionProfile: async (_: unknown, profile: unknown) => profile,
  deleteProviderProfile: async (_: unknown, id: string) => { profiles.delete(id); },
}));
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; };
const create = async (options: { failWrite?: boolean; failReadback?: boolean; holdWrite?: Promise<void> } = {}) => {
  profiles.clear();
  const data = new Map<string, string>();
  const secrets = new Map<string, string>();
  const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
    const key = String(args?.secretRef);
    if (command === 'set_provider_secret') {
      if (options.holdWrite) await options.holdWrite;
      if (options.failWrite) throw { code: 'secret-store-failure', message: 'credential unavailable' };
      secrets.set(key, String(args?.value));
    }
    if (command === 'has_provider_secret') return options.failReadback ? false : secrets.has(key);
    if (command === 'delete_provider_secret') secrets.delete(key);
  });
  const store = new DesktopAiConfigStore({ invoke, storage: { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); }, removeItem: (key) => { data.delete(key); } } });
  store.init();
  await store.refreshProfiles();
  store.selectProviderTarget({ kind: 'preset', providerId: 'deepseek' });
  return { store, data, invoke, secrets };
};
const resolved = (store: DesktopAiConfigStore) => { const s = store.getSnapshot(); return resolveDesktopAiTarget(s.selection, s.profiles, s.generationOverrides, s.modelsByProfileId, s.presetsByProviderId); };
const oldProfile = (): DirectProviderProfileV1 => ({ version: 1, id: 'legacy', name: 'legacy', adapter: 'openai-compatible', baseUrl: 'http://127.0.0.1:11434/v1', modelId: 'x'.repeat(256), createdAt: '2026-10-09T00:00:00Z', updatedAt: '2026-10-09T00:00:00Z' });

describe('AIP target identity and migration', () => {
  it.each([2, 3, 4])('migrates v%s without rewriting old models, keys or custom Profiles', (version) => {
    const raw = JSON.stringify({ version, selection: { executionPreference: 'server', clientConnectionId: 'legacy' }, hiddenPresetIds: [], generationOverrides: { legacy: { [oldProfile().modelId]: { temperature: 0.2 } } }, ...(version > 2 ? { modelsByProfileId: { legacy: { selectedModelId: oldProfile().modelId, customModelIds: [oldProfile().modelId] } } } : {}) });
    const parsed = parseDesktopAiConfigOverlay(raw);
    expect(parsed.selection.clientTarget).toEqual({ kind: 'custom', profileId: 'legacy' });
    expect(parsed.selection.serverTarget).toEqual({ kind: 'system' });
    const next = JSON.parse(serializeDesktopAiConfigOverlay(parsed));
    expect(next.version).toBe(5);
    expect(next.selection).not.toHaveProperty('clientConnectionId');
    expect(next.generationOverrides.legacy[oldProfile().modelId]).toEqual({ temperature: 0.2 });
    expect(parseDesktopAiConfigOverlay(JSON.stringify(next))).toEqual(parsed);
  });

  it('selects presets without creating Profiles and remembers each execution location', async () => {
    const { store } = await create();
    expect(resolved(store).providerTarget).toEqual({ kind: 'preset', providerId: 'deepseek' });
    expect(resolved(store).availableModelIds.length).toBeGreaterThan(0);
    expect(profiles.size).toBe(0);
    store.selectExecutionLocation('server');
    expect(resolved(store).providerTarget).toEqual({ kind: 'system' });
    store.selectProviderTarget({ kind: 'preset', providerId: 'openrouter' });
    store.selectExecutionLocation('client');
    expect(resolved(store).providerTarget).toEqual({ kind: 'preset', providerId: 'deepseek' });
    expect(() => store.selectProviderTarget({ kind: 'system' })).toThrow('执行位置');
    store.selectExecutionLocation('server');
    expect(resolved(store).providerTarget).toEqual({ kind: 'preset', providerId: 'openrouter' });
    expect(() => store.selectProviderTarget({ kind: 'custom', profileId: 'legacy' })).toThrow('执行位置');
  });

  it('uses inline model IDs immediately, rejects new >200/control IDs, and isolates override keys', async () => {
    const { store, data } = await create();
    store.useInlineModel('  custom-model  ');
    expect(resolved(store).modelId).toBe('custom-model');
    store.setPresetGenerationOverrides('deepseek', '__proto__', { temperature: 0.4 });
    expect(store.getSnapshot().presetsByProviderId.deepseek?.generationOverrides['__proto__']).toEqual({ temperature: 0.4 });
    const before = data.get(DESKTOP_AI_CONFIG_STORAGE_KEY);
    store.useInlineModel('x'.repeat(201));
    expect(store.getSnapshot().modelInputError).toContain('200');
    expect(data.get(DESKTOP_AI_CONFIG_STORAGE_KEY)).toBe(before);
    await expect(store.withPreparedGeneration(async () => undefined)).rejects.toThrow('200');
    store.selectExecutionLocation('server');
    expect(store.getSnapshot().modelInputError).toBeNull();
    store.selectProviderTarget({ kind: 'preset', providerId: 'deepseek' });
    store.useInlineModel('bad\u0000id');
    expect(store.getSnapshot().modelInputError).toBeTruthy();
  });

  it('blocks generation when an inline model cannot be saved instead of using the previous model', async () => {
    const { store, data } = await create();
    const previous = resolved(store).modelId;
    vi.spyOn(data, 'set').mockImplementation(() => { throw new Error('quota'); });
    expect(() => store.useInlineModel('new-model')).toThrow('quota');
    expect(resolved(store).modelId).toBe(previous);
    await expect(store.withPreparedGeneration(async () => undefined)).rejects.toThrow('模型选择未保存');
  });

  it.each(['constructor', 'toString', '__proto__'])('dispatches a fresh preset model named %s without inherited overrides', async (modelId) => {
    const { store } = await create();
    store.selectExecutionLocation('server');
    store.selectProviderTarget({ kind: 'preset', providerId: 'deepseek' });
    store.useInlineModel(modelId);
    store.setPresetKeyDraft('deepseek', 'test-only-key');
    const run = vi.fn(async (_target: ReturnType<typeof resolved>) => undefined);
    await store.withPreparedGeneration(run);
    expect(run).toHaveBeenCalledTimes(1);
    const prepared = run.mock.calls[0]![0];
    expect(prepared.modelId).toBe(modelId);
    expect(prepared.generationOverrides).toBeUndefined();
  });

  it('does not inherit a custom Profile or model override from ordinary-object dictionaries', () => {
    const profile = { ...oldProfile(), id: 'constructor', modelId: 'constructor' };
    const target = resolveDesktopAiTarget({ executionPreference: 'client', clientConnectionId: profile.id }, [profile], {}, {});
    expect(target.modelId).toBe('constructor');
    expect(target.generationOverrides).toBeUndefined();
  });

  it('retains old 256-character custom models but does not permit new long model values', async () => {
    const { store } = await create();
    const profile = oldProfile();
    profiles.set(profile.id, profile);
    await store.refreshProfiles();
    store.activateConnection(profile.id);
    expect(resolved(store).modelId).toHaveLength(256);
    expect(resolved(store).unavailableReason).toBeNull();
    const draft = { id: profile.id, name: 'renamed', baseUrl: profile.baseUrl, modelId: profile.modelId };
    expect(buildProfile(draft, () => profile.updatedAt, profile).modelId).toBe(profile.modelId);
    expect(() => buildProfile(draft)).toThrow('200');
    expect(() => buildProfile({ ...draft, modelId: 'y'.repeat(201) }, () => profile.updatedAt, profile)).toThrow('200');
  });

  it('keeps unavailable providers as a diagnosis rather than converting or silently falling back', () => {
    const overlay = parseDesktopAiConfigOverlay(JSON.stringify({ version: 5, selection: { executionPreference: 'client', clientTarget: { kind: 'preset', providerId: 'retired-provider' }, serverTarget: { kind: 'system' } }, hiddenPresetIds: [], generationOverrides: {}, modelsByProfileId: {}, presetsByProviderId: {} }));
    const target = resolveDesktopAiTarget(overlay.selection, [], {}, {}, {});
    expect(target.unavailableReason).toContain('供应商已不在');
    expect(target.profile).toBeNull();
  });
});

describe('AIP credential preparation', () => {
  it('persists and probes a preset key once before dispatch, blocks repeated clicks and replacement until completion', async () => {
    const gate = deferred();
    const finish = deferred();
    const { store, invoke, data, secrets } = await create({ holdWrite: gate.promise });
    store.setPresetKeyDraft('deepseek', 'test-only-key');
    const run = vi.fn(async () => finish.promise);
    const first = store.withPreparedGeneration(run);
    expect(store.getSnapshot().generationActive).toBe(true);
    await store.withPreparedGeneration(run);
    expect(run).not.toHaveBeenCalled();
    expect(() => store.selectExecutionLocation('server')).toThrow('生成期间');
    expect(() => store.setPresetKeyDraft('deepseek', 'replacement')).toThrow('生成期间');
    gate.resolve();
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    expect(secrets.get('preset:deepseek:api-key')).toBe('test-only-key');
    expect(invoke.mock.calls.filter(([command]) => command === 'set_provider_secret')).toHaveLength(1);
    expect(store.getPresetKeyDraft('deepseek')).toBe('');
    expect([...data.values()].join('')).not.toContain('test-only-key');
    await expect(store.clearPresetKey('deepseek')).rejects.toThrow('生成期间');
    finish.resolve(); await first;
    expect(store.getSnapshot().generationActive).toBe(false);
  });

  it.each([{ failWrite: true }, { failReadback: true }])('does not dispatch or lose the draft on credential failure: %j', async (options) => {
    const { store } = await create(options);
    store.setPresetKeyDraft('deepseek', 'test-only-key');
    const run = vi.fn(async () => undefined);
    await expect(store.withPreparedGeneration(run)).rejects.toThrow();
    expect(run).not.toHaveBeenCalled();
    expect(store.getSnapshot().generationActive).toBe(false);
    expect(store.getPresetKeyDraft('deepseek')).toBe('test-only-key');
  });

  it('cancels pending preparation on page exit without starting a late generation', async () => {
    const gate = deferred(); const { store } = await create({ holdWrite: gate.promise });
    store.setPresetKeyDraft('deepseek', 'test-only-key');
    const run = vi.fn(async () => undefined);
    const request = store.withPreparedGeneration(run);
    store.cancelPreparingGeneration(); gate.resolve(); await request;
    expect(run).not.toHaveBeenCalled();
    expect(store.getSnapshot().generationActive).toBe(false);
  });

  it.each(['save', 'clear'] as const)('ignores a stale presence probe after %s', async (operation) => {
    const { store, invoke, secrets } = await create();
    store.setPresetKeyDraft('deepseek', 'test-only-key');
    await store.savePresetKey('deepseek');
    const stale = deferred();
    const staleValue = operation === 'clear';
    const original = invoke.getMockImplementation()!;
    let first = true;
    invoke.mockImplementation(async (command, args) => {
      if (first && command === 'has_provider_secret') { first = false; await stale.promise; return staleValue; }
      return original(command, args);
    });
    const refresh = store.refreshPresetSecret('deepseek');
    if (operation === 'save') {
      store.setPresetKeyDraft('deepseek', 'replacement-test-key');
      await store.savePresetKey('deepseek');
    } else await store.clearPresetKey('deepseek');
    stale.resolve(); await refresh;
    expect(store.getSnapshot().presetSecretStatus.deepseek).toBe(operation === 'save' ? 'present' : 'absent');
    expect(secrets.has('preset:deepseek:api-key')).toBe(operation === 'save');
  });

  it('does not register each intermediate typed custom model as another saved model', async () => {
    const { store } = await create();
    const profile = { ...oldProfile(), modelId: 'default-model' };
    profiles.set(profile.id, profile); await store.refreshProfiles(); store.activateConnection(profile.id);
    for (const value of ['m', 'mo', 'model']) store.useInlineModel(value);
    expect(store.getSnapshot().modelsByProfileId[profile.id]).toMatchObject({ inlineModelId: 'model', customModelIds: [] });
    expect(resolved(store).modelId).toBe('model');
    store.addCustomModel(profile.id, 'another-model');
    expect(resolved(store).modelId).toBe('model');
    store.removeCustomModel(profile.id, 'another-model');
    expect(resolved(store).modelId).toBe('model');
    store.selectModel(profile.id, 'default-model');
    expect(resolved(store).modelId).toBe('default-model');
  });

  it('preserves unsubmitted keys by stable preset identity across execution and provider changes', async () => {
    const { store } = await create();
    store.setPresetKeyDraft('deepseek', 'deepseek-test-key');
    store.selectProviderTarget({ kind: 'preset', providerId: 'openrouter' });
    expect(store.getPresetKeyDraft('openrouter')).toBe('');
    store.selectExecutionLocation('server');
    store.selectProviderTarget({ kind: 'preset', providerId: 'deepseek' });
    expect(store.getPresetKeyDraft('deepseek')).toBe('deepseek-test-key');
  });
});

it('sends only a validated stable target, never a renderer endpoint or key, to the target command', async () => {
  const invoke = vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>(async () => undefined);
  await openDirectAiStream({ invoke, profileId: '', providerTarget: { kind: 'preset', providerId: 'deepseek' }, createChannel: () => ({}) }, {
    requestId: 'aip-target', contractVersion: 1, mode: 'direct-remote', messages: [{ role: 'user', content: 'test' }], modelId: 'deepseek-chat', responseFormat: 'text',
  }, () => undefined);
  expect(invoke.mock.calls[0]?.[0]).toBe('stream_target_ai');
  const args = invoke.mock.calls[0]?.[1] as Record<string, unknown>;
  expect(args.target).toEqual({ kind: 'preset', providerId: 'deepseek' });
  expect(args).not.toHaveProperty('profileId');
  expect(args).not.toHaveProperty('apiKey');
  expect(args).not.toHaveProperty('baseUrl');
});
