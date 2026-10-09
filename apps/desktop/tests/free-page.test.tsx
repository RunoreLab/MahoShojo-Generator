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
import { createPagePreferencesAdapter, PagePreferencesCard } from '@mahoshojo/ui-web/settings';
import { DESKTOP_FREE_PREFERENCES } from '../src/app/settings-page-preferences';

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
  it.each(['completed', 'cancelled', 'non-stream'] as const)('renders only active stream Markdown, preserves raw output and handles %s', async (ending) => {
    const markdown = '# 流式标题\n\n**逐步正文**\n\n[外链](https://example.com/read)\n\n![外图](https://example.com/image.png)\n\n[设置](/settings) [相对路径](settings) [同页](#title) `/encyclopedia/foo`';
    const reasoning = '仅限思考面板的推理';
    let finish!: (outcome: FreeGenerationOutcome) => void;
    let emitPartial!: (text: string) => void;
    mocks.execute.mockImplementation((_options, _input, _intent, _signal, partial) => {
      emitPartial = partial;
      return new Promise((resolve) => { finish = resolve; });
    });
    window.localStorage.setItem(FREE_DRAFT_KEY, JSON.stringify(storedDraft('流式测试')));
    await mount();
    await click(ending === 'non-stream' ? '非流式' : '流式');
    await click('生成数据卡');
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(mocks.execute.mock.calls[0]![2]).toMatchObject({ generationMode: ending === 'non-stream' ? 'non-stream' : 'stream' });
    const fetchCount = vi.mocked(fetch).mock.calls.length;
    await act(async () => emitPartial('# 流式标题'));
    await act(async () => emitPartial(markdown));
    const preview = container.querySelector('[aria-label="流式正文预览"]');
    if (ending === 'non-stream') {
      expect(preview).toBeNull();
    } else {
      expect(preview?.querySelector('h1, h2, h3')?.textContent).toBe('流式标题');
      expect(preview?.querySelector('strong')?.textContent).toBe('逐步正文');
      expect(preview?.textContent).not.toContain(reasoning);
      expect(preview?.textContent).not.toContain('官方签名');
      expect(preview?.querySelector('img, audio, video, iframe, a[href]')).toBeNull();
    }
    expect(vi.mocked(fetch).mock.calls.length).toBe(fetchCount);
    const raw = [...container.querySelectorAll('details')].find((element) => element.querySelector('summary')?.textContent === '原始输出正文')!;
    expect(raw.querySelector('pre')?.textContent).toBe(markdown);
    expect(raw.open).toBe(ending === 'non-stream');
    expect(container.querySelector('[aria-label="生成结果"]')).toBeNull();
    expect(button('保存到本地卡库')).toBeUndefined();
    expect(mocks.save).not.toHaveBeenCalled();
    if (ending === 'completed') {
      await act(async () => finish({
        status: 'completed', mode: 'direct-local', cardKind: 'general',
        card: { templateId: '通用角色', name: '流式标题', content: markdown }, rawText: markdown,
        reasoning: { status: 'done', source: 'provider', text: reasoning },
      }));
      await settle();
      expect(container.querySelector('[aria-label="流式正文预览"]')).toBeNull();
      const result = container.querySelector('[aria-label="生成结果"]')!;
      expect(result.textContent).toContain('逐步正文');
      expect(result.textContent).not.toContain(reasoning);
      await act(async () => container.querySelector<HTMLButtonElement>('.ai-reasoning-panel button')!.click());
      expect(container.querySelector('.ai-reasoning-panel')?.textContent).toContain(reasoning);
      expect(raw.querySelector('pre')?.textContent).not.toContain(reasoning);
      expect(button('保存到本地卡库').matches(':disabled')).toBe(false);
      await click('保存到本地卡库');
      expect(mocks.save).toHaveBeenCalledTimes(1);
      expect(mocks.save.mock.calls[0]![0]).toMatchObject({ data: { content: markdown }, provenance: { kind: 'unsigned', execution: 'direct-local' } });
    } else {
      await click('取消生成');
      expect(mocks.execute.mock.calls[0]![3].aborted).toBe(true);
      await act(async () => finish({ status: 'cancelled', mode: 'direct-local', rawText: markdown, reason: 'aborted' }));
      await settle();
      expect(container.querySelector('[aria-label="流式正文预览"]')).toBeNull();
      expect(raw.open).toBe(true);
      expect(raw.querySelector('pre')?.textContent).toBe(markdown);
      expect(JSON.parse(window.localStorage.getItem(FREE_DRAFT_KEY)!).output).toMatchObject({ phase: 'cancelled', rawText: markdown });
      await click('非流式'); await click('流式');
      expect(container.querySelector('[aria-label="流式正文预览"]')).toBeNull();
      expect(mocks.execute).toHaveBeenCalledTimes(1);
      expect(mocks.save).not.toHaveBeenCalled();
    }
  });

  it('does not reinterpret restored raw output as an active Markdown stream after selecting stream', async () => {
    window.localStorage.setItem(FREE_DRAFT_KEY, JSON.stringify({
      ...storedDraft('流式测试'),
      output: { mode: 'direct-local', cardKind: 'general', card: null, rawText: '# 历史正文', phase: 'cancelled' },
    }));
    await mount(); await click('流式');
    expect(container.querySelector('[aria-label="流式正文预览"]')).toBeNull();
    expect([...container.querySelectorAll('pre')].some((element) => element.textContent === '# 历史正文')).toBe(true);
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('restores prompt draft automatically, generates once and saves the card', async () => {
    window.localStorage.setItem(FREE_DRAFT_KEY, JSON.stringify(storedDraft('怕水的火系少女')));
    await mount();
    expect(container.querySelector('[data-testid="page-free"]')).toBeTruthy();
    expect(mocks.execute).not.toHaveBeenCalled();
    // 合法草稿静默恢复，不自动生成。
    expect(button('生成数据卡').disabled).toBe(false);
    expect(button('恢复草稿')).toBeUndefined();
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
    await click('生成数据卡');
    await click('重新生成');
    expect(container.querySelector('dialog')?.open).toBe(true);
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    await click('取消');
    expect(container.querySelector('dialog')?.open).toBe(false);
    await click('重新生成'); await click('确定重新生成');
    expect(mocks.execute).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['direct-local', 'http://127.0.0.1:11434/v1', 'stream'],
    ['direct-local', 'http://127.0.0.1:11434/v1', 'non-stream'],
    ['direct-remote', 'https://model.example/v1', 'stream'],
    ['direct-remote', 'https://model.example/v1', 'non-stream'],
  ] as const)('dispatches %s (%s) with selected %s mode', async (mode, baseUrl, generationMode) => {
    mocks.profiles.mockResolvedValue({ id: 'local', name: '测试模型', adapter: 'openai-compatible', baseUrl, modelId: 'model' });
    window.localStorage.setItem(FREE_DRAFT_KEY, JSON.stringify(storedDraft('自由创作')));
    await mount();
    expect(button('流式').matches(':disabled')).toBe(false);
    await click('流式');
    if (generationMode === 'non-stream') await click('非流式');
    expect(button(generationMode === 'stream' ? '流式' : '非流式').getAttribute('aria-pressed')).toBe('true');
    const schemaSelect = container.querySelector<HTMLSelectElement>('select[aria-label="选择 Schema"]')!;
    expect([...schemaSelect.options].map((option) => option.value)).toEqual(generationMode === 'stream'
      ? ['general', 'general-scenario']
      : ['magical-girl', 'canshou', 'general', 'scenario', 'general-scenario']);
    await click('生成数据卡');
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(mocks.execute.mock.calls[0]![2]).toMatchObject({ mode, generationMode });
  });

  it.each(['client', 'server'] as const)('reconciles a restored stream schema using the same whitelist on %s', async (executionPreference) => {
    window.localStorage.setItem(DESKTOP_AI_CONFIG_STORAGE_KEY, JSON.stringify({
      version: 2, selection: { executionPreference, clientConnectionId: 'local' }, hiddenPresetIds: [],
    }));
    resetDesktopAiConfigStoreForTests();
    window.localStorage.setItem(FREE_DRAFT_KEY, JSON.stringify({
      ...storedDraft('自由创作'), schemaId: 'magical-girl', generationMode: 'stream',
    }));
    await mount();
    expect(JSON.parse(window.localStorage.getItem(FREE_DRAFT_KEY)!)).toMatchObject({ generationMode: 'stream', schemaId: 'general' });
    const schemaSelect = container.querySelector<HTMLSelectElement>('select[aria-label="选择 Schema"]')!;
    expect(schemaSelect.value).toBe('general');
    expect([...schemaSelect.options].map((option) => option.value)).toEqual(['general', 'general-scenario']);
  });

  it.each([
    ['non-stream', 'magical-girl'],
    ['stream', 'general-scenario'],
  ] as const)('keeps %s and schema %s unchanged when switching execution location', async (generationMode, schemaId) => {
    window.localStorage.setItem(FREE_DRAFT_KEY, JSON.stringify({ ...storedDraft('自由创作'), generationMode, schemaId }));
    await mount();
    const selectedLabel = generationMode === 'stream' ? '流式' : '非流式';
    for (const location of ['服务器', '客户端']) {
      await click(location);
      expect(button(selectedLabel).getAttribute('aria-pressed')).toBe('true');
      expect(container.querySelector<HTMLSelectElement>('select[aria-label="选择 Schema"]')!.value).toBe(schemaId);
      expect(JSON.parse(window.localStorage.getItem(FREE_DRAFT_KEY)!)).toMatchObject({ generationMode, schemaId });
    }
  });

  it('limits schemas on an explicit stream selection and restores all options on non-stream', async () => {
    window.localStorage.setItem(FREE_DRAFT_KEY, JSON.stringify({ ...storedDraft('自由创作'), schemaId: 'scenario' }));
    await mount();
    await click('流式');
    const schemaSelect = container.querySelector<HTMLSelectElement>('select[aria-label="选择 Schema"]')!;
    expect(schemaSelect.value).toBe('general');
    expect(schemaSelect.options.length).toBe(2);
    await click('非流式');
    expect(schemaSelect.value).toBe('general');
    expect(schemaSelect.options.length).toBe(5);
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
    expect(container.textContent).toContain('已不在支持列表中');
    expect(button('生成数据卡').disabled).toBe(true);
    expect(button('恢复草稿')).toBeUndefined();
    button('生成数据卡').click();
    await settle();
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});

it('copies the prompt and clears only the prompt and attachments, preserving result and configuration', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  window.localStorage.setItem(FREE_DRAFT_KEY, JSON.stringify({ ...storedDraft('原提示词'), selectedLanguage: 'en', showLanguageSection: true }));
  await mount();
  await click('生成数据卡');
  await click('复制提示词');
  expect(writeText).toHaveBeenCalledWith('原提示词');
  mocks.readAttachments.mockResolvedValueOnce({ added: [{ id: 'ref', name: 'reference.txt', type: 'text/plain', size: 3, includedBytes: 3, content: 'abc' }], skipped: 0 });
  const fileInput = container.querySelector('input[type="file"]')!;
  await act(async () => { Object.defineProperty(fileInput, 'files', { configurable: true, value: [new File(['abc'], 'reference.txt')] }); fileInput.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(container.textContent).toContain('reference.txt');
  await click('清空存档');
  expect(container.textContent).not.toContain('reference.txt');
  expect(container.querySelector<HTMLTextAreaElement>('textarea[aria-label="提示词"]')?.value).toBe('');
  const stored = JSON.parse(window.localStorage.getItem(FREE_DRAFT_KEY)!);
  expect(stored).toMatchObject({ schemaId: 'general', selectedLanguage: 'en', generationMode: 'non-stream', prompt: '', output: { card: generalCard } });
  expect(container.querySelector('[aria-label="生成结果"]')).not.toBeNull();
  expect(window.confirm).not.toHaveBeenCalled();
});

it('keeps corrupt Free source through fresh input, generation and clearing the prompt', async () => {
  const corrupt = '{broken-free'; window.localStorage.setItem(FREE_DRAFT_KEY, corrupt);
  await mount();
  const input = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="提示词"]')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, '新提示词'); input.dispatchEvent(new Event('input', { bubbles: true })); });
  expect(button('生成数据卡').disabled).toBe(false);
  await click('生成数据卡');
  expect(mocks.execute).toHaveBeenCalledTimes(1);
  await click('清空存档');
  expect(input.value).toBe('');
  expect(container.querySelector('[aria-label="生成结果"]')).not.toBeNull();
  expect(window.localStorage.getItem(FREE_DRAFT_KEY)).toBe(corrupt);
});

it.each(['route', 'close'] as const)('confirms leaving a memory-only Free draft via %s without deleting the protected source', async (kind) => {
  const corrupt = '{protected-free'; window.localStorage.setItem(FREE_DRAFT_KEY, corrupt);
  const router = await mount();
  const input = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="提示词"]')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, '新内容'); input.dispatchEvent(new Event('input', { bubbles: true })); });
  const close = mocks.listen.mock.calls.at(-1)![0] as (event: { preventDefault: () => void }) => void;
  const denied = vi.fn();
  await act(async () => { if (kind === 'route') void router.navigate({ to: '/' }); else close({ preventDefault: denied }); }); await settle();
  expect(container.querySelector('[data-testid="page-free"]')).not.toBeNull();
  if (kind === 'close') expect(denied).toHaveBeenCalled();
  vi.mocked(window.confirm).mockReturnValue(true);
  const accepted = vi.fn();
  await act(async () => { if (kind === 'route') void router.navigate({ to: '/' }); else close({ preventDefault: accepted }); }); await settle();
  if (kind === 'route') expect(container.querySelector('[data-testid="page-free"]')).toBeNull();
  else expect(accepted).not.toHaveBeenCalled();
  expect(window.localStorage.getItem(FREE_DRAFT_KEY)).toBe(corrupt);
});


it('reads and writes the two preferences through the real page and settings card across remounts', async () => {
  const adapter = createPagePreferencesAdapter(DESKTOP_FREE_PREFERENCES);
  const settings = () => act(async () => root.render(<PagePreferencesCard adapter={adapter} />));
  const toggle = (label: string) => container.querySelector<HTMLButtonElement>(`[role="switch"][aria-label="${label}"]`)!;
  const pageToggle = (label: string) => [...container.querySelectorAll('button')].find((item) => item.textContent?.startsWith(label))!;
  await settings();
  expect(toggle('默认展开「字段速览」').getAttribute('aria-checked')).toBe('false');
  await act(async () => toggle('默认展开「字段速览」').click());
  await act(async () => toggle('默认展开「生成语言」').click());
  await mount();
  expect(pageToggle('Schema 字段说明').getAttribute('aria-expanded')).toBe('true');
  expect(container.querySelector('select[aria-label="生成语言"]')).not.toBeNull();
  expect(mocks.execute).not.toHaveBeenCalled();
  await act(async () => pageToggle('Schema 字段说明').click());
  await act(async () => pageToggle('生成语言').click());
  await settings();
  expect(toggle('默认展开「字段速览」').getAttribute('aria-checked')).toBe('false');
  expect(toggle('默认展开「生成语言」').getAttribute('aria-checked')).toBe('false');
  await act(async () => toggle('默认展开「字段速览」').click());
  await act(async () => pageToggle('重置该页偏好').click());
  await act(async () => pageToggle('确认重置').click());
  await mount();
  expect(pageToggle('Schema 字段说明').getAttribute('aria-expanded')).toBe('false');
  expect(container.querySelector('select[aria-label="生成语言"]')).toBeNull();
  expect(mocks.execute).not.toHaveBeenCalled();
});

it('shows the settings error and preserves storage when a preference cannot be written', async () => {
  const adapter = createPagePreferencesAdapter(DESKTOP_FREE_PREFERENCES);
  await act(async () => root.render(<PagePreferencesCard adapter={adapter} />));
  const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="默认展开「字段速览」"]')!.click());
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('修改未保存');
  expect(localStorage.getItem(DESKTOP_FREE_PREFERENCES.storageKey)).toBeNull();
  write.mockRestore();
});


it('shows protected-source feedback in settings without replacing malformed draft bytes', async () => {
  const raw = '{protected-settings-source'; localStorage.setItem(DESKTOP_FREE_PREFERENCES.storageKey, raw);
  const adapter = createPagePreferencesAdapter(DESKTOP_FREE_PREFERENCES);
  await act(async () => root.render(<PagePreferencesCard adapter={adapter} />));
  expect(container.textContent).toContain('为保护内容暂不可在此修改');
  expect(container.querySelector('[role="switch"]')).toBeNull();
  expect([...container.querySelectorAll('button')].find((item) => item.textContent === '重置该页偏好')?.disabled).toBe(true);
  expect(localStorage.getItem(DESKTOP_FREE_PREFERENCES.storageKey)).toBe(raw);
});
