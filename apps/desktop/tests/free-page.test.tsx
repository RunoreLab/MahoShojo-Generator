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

const mocks = vi.hoisted(() => ({ execute: vi.fn(), save: vi.fn(), listen: vi.fn(), profiles: vi.fn(), readAttachments: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: () => true }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ onCloseRequested: mocks.listen }) }));
vi.mock('../src/features/free/generation', async (original) => ({ ...await original<object>(), executeFreeGeneration: mocks.execute }));
vi.mock('@mahoshojo/ui-web/free', async (original) => ({ ...await original<object>(), readFreeAttachmentFiles: mocks.readAttachments }));
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
  mocks.readAttachments.mockResolvedValue({ added: [], skipped: 0 });
  mocks.listen.mockImplementation(async () => vi.fn());
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

  it('client execution rewrites stream to non-stream without touching the chosen schema (G2-r1)', async () => {
    window.localStorage.setItem(FREE_DRAFT_KEY, JSON.stringify({
      version: 1, schemaId: 'magical-girl', generationMode: 'stream', prompt: 'x', selectedLanguage: 'zh-CN',
    }));
    await mount();
    await click('恢复草稿');
    // 草稿 generationMode=stream 但执行位置为客户端：回写 non-stream；
    // 已选结构化 Schema 不得顺带被改写（流式归并只对服务器通路成立）。
    const stored = JSON.parse(window.localStorage.getItem(FREE_DRAFT_KEY)!);
    expect(stored.generationMode).toBe('non-stream');
    expect(stored.schemaId).toBe('magical-girl');
    expect(container.textContent).toContain('客户端执行仅支持结构化（非流式）生成');
    const schemaSelect = [...container.querySelectorAll('select')].find((el) => el.getAttribute('aria-label') === '选择 Schema')!;
    expect((schemaSelect as HTMLSelectElement).value).toBe('magical-girl');
    expect(schemaSelect.querySelectorAll('option').length).toBe(5);
  });

  it('server stream mode keeps the switch and narrows schema to streamable ids', async () => {
    window.localStorage.setItem(DESKTOP_AI_CONFIG_STORAGE_KEY, JSON.stringify({
      version: 2,
      selection: { executionPreference: 'server', clientConnectionId: 'local' },
      hiddenPresetIds: [],
    }));
    resetDesktopAiConfigStoreForTests();
    window.localStorage.setItem(FREE_DRAFT_KEY, JSON.stringify({
      version: 1, schemaId: 'magical-girl', generationMode: 'stream', prompt: 'x', selectedLanguage: 'zh-CN',
    }));
    await mount();
    await click('恢复草稿');
    // 服务器通路的流式归并照旧：结构化 Schema 回写为 general。
    const stored = JSON.parse(window.localStorage.getItem(FREE_DRAFT_KEY)!);
    expect(stored.generationMode).toBe('stream');
    expect(stored.schemaId).toBe('general');
    const schemaSelect = [...container.querySelectorAll('select')].find((el) => el.getAttribute('aria-label') === '选择 Schema')!;
    expect((schemaSelect as HTMLSelectElement).value).toBe('general');
    expect(schemaSelect.querySelectorAll('option').length).toBe(2);
  });

  it('clearing attachments while a read is in flight discards the late merge (G2-r1)', async () => {
    const mkAttachment = (id: string) => ({
      id, name: `${id}.txt`, type: 'text/plain', size: 3, includedBytes: 3, content: 'abc',
    });
    let resolveLate: (value: { added: unknown[]; skipped: number }) => void = () => undefined;
    const late = new Promise<{ added: unknown[]; skipped: number }>((resolve) => { resolveLate = resolve; });
    mocks.readAttachments
      .mockImplementationOnce(async () => ({ added: [mkAttachment('a')], skipped: 0 }))
      .mockImplementationOnce(() => late);
    window.localStorage.setItem(FREE_DRAFT_KEY, JSON.stringify(storedDraft('x')));
    await mount();
    await click('恢复草稿');

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    const pick = async () => {
      await act(async () => {
        Object.defineProperty(fileInput, 'files', { configurable: true, value: [new File(['x'], 'pick.txt')] });
        fileInput.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await settle();
    };

    // 第一次读取正常落地。
    await pick();
    expect(container.textContent).toContain('a.txt');

    // 第二次读取在途：用户先清空附件，再落地迟到的读取结果。
    await pick();
    await click('清空附件');
    expect(container.textContent).not.toContain('a.txt');
    await act(async () => { resolveLate({ added: [mkAttachment('late')], skipped: 0 }); });
    await settle();
    // 迟到结果必须按代际丢弃——不得把已清空的清单复活。
    expect(container.textContent).not.toContain('late.txt');
    expect(container.textContent).toContain('0 个');
  });
});
