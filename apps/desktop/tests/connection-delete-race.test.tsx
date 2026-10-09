// @vitest-environment jsdom
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DirectProviderProfileV1Schema, type DirectProviderProfileV1 } from '@mahoshojo/contracts/provider-profile';
import { AiConnectionsPanel } from '../src/features/ai-config/AiConnectionsPanel';
import { getDesktopAiConfigStore, resetDesktopAiConfigStoreForTests } from '../src/features/ai-config/use-desktop-ai-config';
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke, Channel: class {} }));
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; };
const original = DirectProviderProfileV1Schema.parse({ version: 1, id: 'p1', name: '连接一', adapter: 'openai-compatible', baseUrl: 'https://example.com/v1', modelId: 'm1', apiKeyRef: 'provider:p1:api-key', createdAt: '2026-10-09T00:00:00.000Z', updatedAt: '2026-10-09T00:00:00.000Z' });
let root: Root; let container: HTMLDivElement;
let profiles: Map<string, DirectProviderProfileV1>; let secrets: Set<string>;
let deletion: ReturnType<typeof deferred>; let validation: ReturnType<typeof deferred>;
const settle = () => act(async () => { await new Promise(r => setTimeout(r, 30)); });
const button = (name: string) => [...container.querySelectorAll('button')].find(el => el.textContent === name)!;
const click = async (name: string) => { await act(async () => button(name).click()); await settle(); };
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.localStorage.clear(); resetDesktopAiConfigStoreForTests();
  profiles = new Map([['p1', original]]); secrets = new Set([original.apiKeyRef!]);
  deletion = deferred(); validation = deferred();
  mocks.invoke.mockReset(); mocks.invoke.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
    switch (command) {
      case 'list_provider_profile_ids': return [...profiles.keys()];
      case 'get_provider_profile': return profiles.has(args!.profileId as string) ? JSON.stringify(profiles.get(args!.profileId as string)) : null;
      case 'has_provider_secret': return secrets.has(args!.secretRef as string);
      case 'delete_provider_profile': profiles.delete(args!.profileId as string); return;
      case 'delete_provider_secret': await deletion.promise; secrets.delete(args!.secretRef as string); return;
      case 'validate_provider_execution_profile': await validation.promise; return JSON.parse(args!.document as string);
      case 'save_provider_profile': { const profile = JSON.parse(args!.document as string) as DirectProviderProfileV1; profiles.set(profile.id, profile); return; }
      default: throw new Error(`Unexpected command ${command}`);
    }
  });
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });
it('a pending deletion prevents editing and saving a stale credential reference', async () => {
  await act(async () => root.render(<StrictMode><AiConnectionsPanel /></StrictMode>)); await settle();
  await click('删除'); await click('确认删除（连同已存凭据）');
  // Native Profile deletion has returned, but the OS credential cleanup is pending.
  // The old renderer row is still shown until refresh; baseline lets it be edited.
  await click('编辑');
  if (button('保存连接')) await click('保存连接');
  const overlappingSave = mocks.invoke.mock.calls.some(([command]) => command === 'validate_provider_execution_profile');
  await act(async () => deletion.resolve()); await settle();
  await act(async () => validation.resolve()); await settle();
  const danglingSavedProfile = profiles.get('p1');
  expect({ overlappingSave, profileRevived: !!danglingSavedProfile, hasCredential: danglingSavedProfile ? secrets.has(danglingSavedProfile.apiKeyRef!) : null }).toEqual({ overlappingSave: false, profileRevived: false, hasCredential: null });
  expect(getDesktopAiConfigStore().getSnapshot().profiles).toHaveLength(0);
});

it('shows a native deletion failure and preserves the profile, credential and active selection', async () => {
  await act(async () => root.render(<StrictMode><AiConnectionsPanel /></StrictMode>)); await settle();
  const store = getDesktopAiConfigStore();
  await act(async () => store.activateConnection('p1'));
  const nativeInvoke = mocks.invoke.getMockImplementation()!;
  mocks.invoke.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
    if (command === 'delete_provider_profile') throw { code: 'store-failure', message: 'test failure' };
    return nativeInvoke(command, args);
  });
  await click('删除'); await click('确认删除（连同已存凭据）');
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('连接删除未完成');
  expect(store.getSnapshot().deletingConnection).toBe(false);
  expect(store.getSnapshot().selection.clientConnectionId).toBe('p1');
  expect(profiles.get('p1')).toEqual(original);
  expect(secrets.has(original.apiKeyRef!)).toBe(true);
  expect(mocks.invoke.mock.calls.filter(([command]) => command === 'delete_provider_secret')).toHaveLength(0);
});

it('keeps delete single-flight and excludes saves and generation through secret cleanup and refresh', async () => {
  const store = getDesktopAiConfigStore(); store.init();
  await vi.waitFor(() => expect(store.getSnapshot().profilesState).toBe('ready'));
  store.activateConnection('p1');
  const refresh = deferred();
  const nativeInvoke = mocks.invoke.getMockImplementation()!;
  mocks.invoke.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
    if (command === 'list_provider_profile_ids') await refresh.promise;
    return nativeInvoke(command, args);
  });
  const pending = store.deleteConnection('p1');
  expect(store.deleteConnection('p1')).toBe(pending);
  await expect(store.deleteConnection('p2')).rejects.toThrow('正在删除');
  expect(store.getSnapshot().deletingConnection).toBe(true);
  const run = vi.fn();
  await expect(store.withPreparedGeneration(run)).rejects.toThrow('正在删除');
  await expect(store.saveConnection({ id: 'p1', name: 'stale save', baseUrl: original.baseUrl, modelId: 'm1' })).rejects.toThrow('正在删除');
  expect(run).not.toHaveBeenCalled();
  await vi.waitFor(() => expect(mocks.invoke.mock.calls.some(([command]) => command === 'delete_provider_secret')).toBe(true));
  deletion.resolve();
  await vi.waitFor(() => expect(mocks.invoke.mock.calls.filter(([command]) => command === 'list_provider_profile_ids')).toHaveLength(2));
  expect(store.getSnapshot().deletingConnection).toBe(true);
  await expect(store.saveConnection({ id: 'p1', name: 'stale save', baseUrl: original.baseUrl, modelId: 'm1' })).rejects.toThrow('正在删除');
  refresh.resolve(); await pending;
  expect(store.getSnapshot().deletingConnection).toBe(false);
  expect(store.getSnapshot().profiles).toHaveLength(0);
  expect(store.getSnapshot().selection.clientConnectionId).toBeNull();
  expect(mocks.invoke.mock.calls.filter(([command]) => command === 'delete_provider_profile')).toHaveLength(1);
  expect(mocks.invoke.mock.calls.filter(([command]) => command === 'delete_provider_secret')).toHaveLength(1);
});

it('rejects deletion while a connection save owns the transaction', async () => {
  const store = getDesktopAiConfigStore(); store.init();
  await vi.waitFor(() => expect(store.getSnapshot().profilesState).toBe('ready'));
  const pending = store.saveConnection({ id: 'p1', name: '新名称', baseUrl: original.baseUrl, modelId: 'm1' });
  await expect(store.deleteConnection('p1')).rejects.toThrow('正在保存');
  expect(mocks.invoke.mock.calls.some(([command]) => command === 'delete_provider_profile')).toBe(false);
  validation.resolve();
  expect(await pending).toMatchObject({ persisted: true });
  expect(profiles.get('p1')?.name).toBe('新名称');
  expect(secrets.has(original.apiKeyRef!)).toBe(true);
});

it('closes the deleted connection editor after success instead of leaving a stale save form', async () => {
  await act(async () => root.render(<StrictMode><AiConnectionsPanel /></StrictMode>)); await settle();
  await click('编辑'); expect(button('保存连接')).toBeDefined();
  await click('删除'); await click('确认删除（连同已存凭据）');
  await act(async () => deletion.resolve()); await settle();
  expect(button('保存连接')).toBeUndefined();
  expect(getDesktopAiConfigStore().getSnapshot().profiles).toHaveLength(0);
});
