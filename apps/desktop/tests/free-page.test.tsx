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

const mocks = vi.hoisted(() => ({ execute: vi.fn(), download: vi.fn(), save: vi.fn(), listen: vi.fn(), profiles: vi.fn(), readAttachments: vi.fn() }));
vi.mock('../src/platform/download-text-file', () => ({ downloadTextFile: mocks.download }));
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
    expect(container.querySelector('[aria-label="生成结果"] > p')?.textContent).toBe('生成结果 · 未签名（自由生成为非原生卡）');
    const exports = container.querySelector('[aria-label="保存原始数据"]')!;
    expect([...exports.querySelectorAll('button')].filter((item) => item.textContent?.includes('下载'))).toHaveLength(1);
    await click('💾 下载设定文件');
    expect(mocks.download).toHaveBeenCalledExactlyOnceWith('数据卡_角色_焰汐.json', JSON.stringify(generalCard, null, 2));
    expect(button('复制到剪贴板')).toBeTruthy();
    await click('保存到本地卡库');
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('已保存到本地卡库');
  });

  it('keeps one download and full JSON copy when a mobile UA recommends text mode', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile',
      clipboard: { writeText },
    });
    window.localStorage.setItem(FREE_DRAFT_KEY, JSON.stringify(storedDraft('怕水的火系少女')));
    await mount();
    await click('恢复草稿');
    await click('生成数据卡');
    const exports = container.querySelector('[aria-label="保存原始数据"]')!;
    const text = exports.querySelector('textarea')!;
    const payload = JSON.stringify(generalCard, null, 2);
    expect(text.value).toBe(payload);
    expect(text.readOnly).toBe(true);
    expect([...exports.querySelectorAll('button')].filter((item) => item.textContent?.includes('下载'))).toHaveLength(1);
    expect(exports.textContent).not.toContain('💾 下载设定文件');
    await click('下载 JSON 文件');
    expect(mocks.download).toHaveBeenCalledExactlyOnceWith('数据卡_角色_焰汐.json', payload);
    await click('复制 JSON');
    expect(writeText).toHaveBeenCalledExactlyOnceWith(payload);
    expect(exports.textContent).toContain('JSON 已复制到剪贴板');
    await click('复制到剪贴板');
    expect(writeText).toHaveBeenCalledTimes(2);
    expect(writeText).toHaveBeenLastCalledWith(payload);
    expect(text.value).toBe(payload);
    expect(mocks.download).toHaveBeenCalledTimes(1);
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

  it('client execution presents non-stream as effective without touching the chosen schema (G2-r1 / AIP-r1)', async () => {
    window.localStorage.setItem(FREE_DRAFT_KEY, JSON.stringify({
      version: 1, schemaId: 'magical-girl', generationMode: 'stream', prompt: 'x', selectedLanguage: 'zh-CN',
    }));
    await mount();
    await click('恢复草稿');
    // D5.1-AIP-r1：草稿的流式偏好保留、切回服务器即恢复；客户端按生效的
    // 「非流式」呈现，Schema 列表也按生效模式展开（流式归并只对服务器通路成立）。
    const stored = JSON.parse(window.localStorage.getItem(FREE_DRAFT_KEY)!);
    expect(stored.generationMode).toBe('stream');
    expect(stored.schemaId).toBe('magical-girl');
    expect(container.textContent).toContain('客户端执行为结构化（非流式）直出');
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

  it('blocks generation while the saved system model has left the catalog', async () => {
    // D5.1-AIP-r1-r1：曾选系统模型被目录移除——解析层保留诊断值并告警，
    // 生成按钮禁用；即使绕过按钮状态派发，入口守卫也不触达执行器。
    window.localStorage.setItem(DESKTOP_AI_CONFIG_STORAGE_KEY, JSON.stringify({
      version: 3,
      selection: {
        executionPreference: 'server',
        clientConnectionId: 'local',
        systemModelId: 'retired-model',
      },
      hiddenPresetIds: [],
      generationOverrides: {},
      modelsByProfileId: {},
    }));
    window.localStorage.setItem(FREE_DRAFT_KEY, JSON.stringify(storedDraft('怕水的火系少女')));
    await mount();
    await click('恢复草稿');
    expect(container.textContent).toContain('已不在支持列表中');
    expect(button('生成数据卡').disabled).toBe(true);
    button('生成数据卡').click();
    await settle();
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});
