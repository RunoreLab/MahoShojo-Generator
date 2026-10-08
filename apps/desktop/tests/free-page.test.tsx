// @vitest-environment jsdom
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { RouterProvider } from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FreeGenerationOutcome } from '../src/features/free/generation';
import { FREE_DRAFT_KEY } from '../src/features/free/session';
import { resetDesktopAiConfigStoreForTests } from '../src/features/ai-config/use-desktop-ai-config';
import { DESKTOP_AI_CONFIG_STORAGE_KEY } from '../src/features/ai-config/desktop-ai-config-store';
import { createDesktopRouter } from '../src/app/router';

const mocks = vi.hoisted(() => ({ execute: vi.fn(), save: vi.fn(), listen: vi.fn(), profiles: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: () => true }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ onCloseRequested: mocks.listen }) }));
vi.mock('../src/features/free/generation', async (original) => ({ ...await original<object>(), executeFreeGeneration: mocks.execute }));
vi.mock('../src/platform/provider-profile-bridge', () => ({ listProviderProfileIds: async () => ['local'], getProviderProfile: mocks.profiles }));
vi.mock('../src/platform/local-card-bridge', () => ({ IpcLocalCardRepository: class { putIfAbsent = mocks.save; } }));

const generalCard = { templateId: '通用角色', name: '焰汐', content: '## 角色介绍\n\n怕水的火系少女' };
const completed: FreeGenerationOutcome = {
  status: 'completed', mode: 'direct-local', card: generalCard, cardKind: 'general', rawText: JSON.stringify(generalCard),
};
let root: Root;
let container: HTMLDivElement;
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 120)); });
const button = (name: string) => [...container.querySelectorAll('button')].find((item) => item.textContent === name)!;
const click = async (name: string) => { await act(async () => button(name).click()); await settle(); };
const storedDraft = (prompt: string) => ({
  version: 1,
  schemaId: 'general',
  generationMode: 'non-stream',
  prompt,
  selectedLanguage: 'zh-CN',
});

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks(); window.localStorage.clear();
  window.localStorage.setItem(DESKTOP_AI_CONFIG_STORAGE_KEY, JSON.stringify({
    version: 2,
    selection: { executionPreference: 'client', clientConnectionId: 'local' },
    hiddenPresetIds: [],
  }));
  resetDesktopAiConfigStoreForTests();
  mocks.profiles.mockResolvedValue({ id: 'local', name: '本地模型', adapter: 'openai-compatible', baseUrl: 'http://127.0.0.1:11434/v1', modelId: 'model' });
  mocks.execute.mockResolvedValue(completed); mocks.save.mockResolvedValue({ written: true });
  mocks.listen.mockImplementation(async (handler) => { return vi.fn(); });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [{ code: 'zh-CN', name: '简体中文' }] })));
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  vi.spyOn(window, 'confirm').mockReturnValue(false);
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
  window.location.hash = '#/free';
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const mount = async () => {
  const router = createDesktopRouter(); await router.load();
  await act(async () => root.render(<StrictMode><RouterProvider router={router} /></StrictMode>));
  await settle(); return router;
};

describe('Desktop Free route and session UI (native adapter mock)', () => {
  it('restores prompt draft on explicit action, generates once and saves the card', async () => {
    window.localStorage.setItem(FREE_DRAFT_KEY, JSON.stringify(storedDraft('怕水的火系少女')));
    await mount();
    expect(container.querySelector('[data-testid="page-free"]')).toBeTruthy();
    expect(mocks.execute).not.toHaveBeenCalled();
    // 待恢复期间生成门禁关闭。
    expect(button('生成数据卡').disabled).toBe(true);
    await click('恢复草稿');
    const textarea = container.querySelector('textarea')!;
    expect(textarea.value).toBe('怕水的火系少女');
    await click('生成数据卡');
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    const callInput = mocks.execute.mock.calls[0]![1] as { prompt: string; schema: string; language: string; attachments: unknown[] };
    expect(callInput).toMatchObject({ prompt: '怕水的火系少女', schema: 'general', language: 'zh-CN', attachments: [] });
    expect(container.textContent).toContain('焰汐');
    expect(container.textContent).toContain('未签名');
    await click('保存到本地卡库');
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('已保存到本地卡库');
  });

  it('confirms replacement before regenerating an unsaved result', async () => {
    window.localStorage.setItem(FREE_DRAFT_KEY, JSON.stringify(storedDraft('x')));
    await mount();
    await click('恢复草稿');
    await click('生成数据卡');
    await click('重新生成');
    expect(container.querySelector('dialog')?.open).toBe(true);
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    await click('取消');
    expect(container.querySelector('dialog')?.open).toBe(false);
    await click('重新生成'); await click('确定重新生成');
    expect(mocks.execute).toHaveBeenCalledTimes(2);
  });

  it('stream generation mode restricts schema to streamable ids and rewrites a structured pick', async () => {
    window.localStorage.setItem(FREE_DRAFT_KEY, JSON.stringify({
      version: 1, schemaId: 'magical-girl', generationMode: 'stream', prompt: 'x', selectedLanguage: 'zh-CN',
    }));
    await mount();
    await click('恢复草稿');
    // 草稿里 schemaId=magical-girl 但 generationMode=stream：effect 应回写为 general。
    const stored = JSON.parse(window.localStorage.getItem(FREE_DRAFT_KEY)!);
    expect(stored.schemaId).toBe('general');
    const schemaSelect = [...container.querySelectorAll('select')].find((el) => el.getAttribute('aria-label') === '选择 Schema')!;
    expect((schemaSelect as HTMLSelectElement).value).toBe('general');
    expect(schemaSelect.querySelectorAll('option').length).toBe(2);
  });
});
