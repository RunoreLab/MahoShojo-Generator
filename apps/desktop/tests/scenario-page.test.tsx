// @vitest-environment jsdom
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { RouterProvider } from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScenarioGenerationOutcome } from '../src/features/scenario/generation';
import { SCENARIO_DRAFT_KEY } from '../src/features/scenario/session';
import { resetDesktopAiConfigStoreForTests } from '../src/features/ai-config/use-desktop-ai-config';
import { DESKTOP_AI_CONFIG_STORAGE_KEY } from '../src/features/ai-config/desktop-ai-config-store';
import { createDesktopRouter } from '../src/app/router';

const mocks = vi.hoisted(() => ({ execute: vi.fn(), download: vi.fn(), save: vi.fn(), get: vi.fn(), listen: vi.fn(), profiles: vi.fn(), scrollResult: vi.fn() }));
vi.mock('../src/platform/download-text-file', () => ({ downloadTextFile: mocks.download }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: () => true }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ onCloseRequested: mocks.listen }) }));
vi.mock('../src/features/scenario/generation', async (original) => ({ ...await original<object>(), executeScenarioGeneration: mocks.execute }));
vi.mock('../src/platform/provider-profile-bridge', () => ({ listProviderProfileIds: async () => ['local'], getProviderProfile: mocks.profiles }));
vi.mock('../src/platform/local-card-bridge', () => ({ IpcLocalCardRepository: class { putIfAbsent = mocks.save; get = mocks.get; } }));

const scenarioCard = {
  title: '雨后采访',
  scenario_type: '采访',
  description: '天台上的一次对话',
  elements: {
    scene: { time: '傍晚', place: '天台', features: '积水' },
    roles: [],
    events: '采访', atmosphere: '安静', development: ['和解'],
  },
  metadata: { created_at: '2026-01-01T00:00:00.000Z' },
};
const completed: ScenarioGenerationOutcome = {
  status: 'completed', mode: 'direct-local', card: scenarioCard, cardKind: 'scenario', rawText: JSON.stringify(scenarioCard),
};
let root: Root;
let container: HTMLDivElement;
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 120)); });
const button = (name: string) => [...container.querySelectorAll('button')].find((item) => item.textContent === name)!;
const click = async (name: string) => { await act(async () => button(name).click()); await settle(); };
const storedDraft = (answers: Record<string, string>) => ({
  version: 1,
  answers,
  fieldsToKeepEmpty: [],
  scenarioTitleHint: '',
  generationMode: 'non-stream',
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
  mocks.listen.mockImplementation(async () => vi.fn());
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [{ code: 'zh-CN', name: '简体中文' }] })));
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  HTMLElement.prototype.scrollIntoView = mocks.scrollResult;
  vi.spyOn(window, 'confirm').mockReturnValue(false);
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
  window.location.hash = '#/scenario';
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const mount = async () => {
  const router = createDesktopRouter(); await router.load();
  await act(async () => root.render(<StrictMode><RouterProvider router={router} /></StrictMode>));
  await settle(); return router;
};

describe('Desktop Scenario route and session UI (native adapter mock)', () => {
  it.each(['completed', 'cancelled', 'non-stream'] as const)('renders only active stream Markdown, preserves raw output and handles %s', async (ending) => {
    const markdown = '# 流式标题\n\n**逐步正文**\n\n[外链](https://example.com/read)\n\n![外图](https://example.com/image.png)\n\n[设置](/settings) [相对路径](settings) [同页](#title) `/encyclopedia/foo`';
    const reasoning = '仅限思考面板的推理';
    let finish!: (outcome: ScenarioGenerationOutcome) => void;
    let emitPartial!: (text: string) => void;
    mocks.execute.mockImplementation((_options, _input, _intent, _signal, partial) => {
      emitPartial = partial;
      return new Promise((resolve) => { finish = resolve; });
    });
    window.localStorage.setItem(SCENARIO_DRAFT_KEY, JSON.stringify(storedDraft({ '故事发生的场景是怎样的？': '流式测试' })));
    await mount();
    await click(ending === 'non-stream' ? '非流式' : '流式');
    await click('生成情景');
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
        status: 'completed', mode: 'direct-local', cardKind: 'general-scenario',
        card: { templateId: '通用情景', title: '流式标题', content: markdown }, rawText: markdown,
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
      expect(JSON.parse(window.localStorage.getItem(SCENARIO_DRAFT_KEY)!).output).toMatchObject({ phase: 'cancelled', rawText: markdown });
      await click('非流式'); await click('流式');
      expect(container.querySelector('[aria-label="流式正文预览"]')).toBeNull();
      expect(mocks.execute).toHaveBeenCalledTimes(1);
      expect(mocks.save).not.toHaveBeenCalled();
    }
  });

  it('does not reinterpret restored raw output as an active Markdown stream after selecting stream', async () => {
    window.localStorage.setItem(SCENARIO_DRAFT_KEY, JSON.stringify({
      ...storedDraft({ '故事发生的场景是怎样的？': '流式测试' }),
      output: { mode: 'direct-local', cardKind: 'general-scenario', card: null, rawText: '# 历史正文', phase: 'cancelled' },
    }));
    await mount(); await click('流式');
    expect(container.querySelector('[aria-label="流式正文预览"]')).toBeNull();
    expect([...container.querySelectorAll('pre')].some((element) => element.textContent === '# 历史正文')).toBe(true);
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('restores answers draft automatically, generates once and saves the card', async () => {
    window.localStorage.setItem(SCENARIO_DRAFT_KEY, JSON.stringify(
      storedDraft({ '故事发生的场景是怎样的？': '雨后的天台' }),
    ));
    await mount();
    expect(container.querySelector('[data-testid="page-scenario"]')).toBeTruthy();
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(button('生成情景').disabled).toBe(false);
    expect(button('恢复草稿')).toBeUndefined();
    const textarea = [...container.querySelectorAll('textarea')].find(
      (el) => el.getAttribute('aria-label') === '故事发生的场景是怎样的？',
    )!;
    expect(textarea.value).toBe('雨后的天台');
    const inputCard = container.querySelector('.container > .card')!;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ top: window.innerHeight + 1 } as DOMRect);
    await click('生成情景');
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    const callInput = mocks.execute.mock.calls[0]![1] as {
      answers: Record<string, string>; language: string; fieldsToKeepEmpty: string[]; titleHint: string;
    };
    expect(callInput).toMatchObject({
      answers: { '故事发生的场景是怎样的？': '雨后的天台' },
      language: 'zh-CN',
      fieldsToKeepEmpty: [],
      titleHint: '',
    });
    expect(container.textContent).toContain('雨后采访');
    const resultSection = container.querySelector('[aria-label="生成结果"]')!;
    expect(inputCard.contains(resultSection)).toBe(false);
    expect(resultSection.classList.contains('card')).toBe(true);
    expect(resultSection.querySelectorAll('.card')).toHaveLength(0);
    expect(resultSection.querySelectorAll('h2')).toHaveLength(1);
    expect(resultSection.querySelector('h2')?.textContent).toBe('雨后采访');
    expect(resultSection.querySelector('pre')?.textContent).toBe(JSON.stringify(scenarioCard, null, 2));
    expect(resultSection.querySelector('[aria-label="情景内容预览"]')?.textContent).toContain('天台上的一次对话');
    expect(resultSection.querySelector('details')?.open).toBe(false);
    expect([...resultSection.querySelectorAll('button')].filter((item) => item.textContent?.includes('下载'))).toHaveLength(1);
    await click('💾 下载设定文件');
    expect(mocks.download).toHaveBeenCalledExactlyOnceWith('情景_雨后采访.json', JSON.stringify(scenarioCard, null, 2));
    expect(button('复制到剪贴板')).toBeTruthy();
    expect(mocks.scrollResult).toHaveBeenCalledTimes(1);
    expect(mocks.scrollResult.mock.instances[0]).toBe(resultSection.parentElement);
    await click('保存到本地卡库');
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('已保存到本地卡库');
    expect(mocks.scrollResult).toHaveBeenCalledTimes(1);
  });

  it('restores a general scenario onto one surface without changing Markdown or export bytes', async () => {
    const general = { templateId: '通用情景', title: '雨夜', content: '# 雨夜\n\n保留 Markdown 正文' };
    window.localStorage.setItem(SCENARIO_DRAFT_KEY, JSON.stringify({
      ...storedDraft({ '故事发生的场景是怎样的？': '钟楼' }),
      output: { mode: 'hosted-stream', cardKind: 'general-scenario', card: general, rawText: general.content, phase: 'completed' },
    }));
    await mount();
    const result = container.querySelector('[aria-label="生成结果"]')!;
    expect(result.classList.contains('card')).toBe(true);
    expect(result.querySelector('.card')).toBeNull();
    expect(result.querySelector('h2')?.textContent).toBe('雨夜');
    expect(result.querySelectorAll('h2')[1]?.textContent).toBe('雨夜');
    expect(result.textContent).toContain('保留 Markdown 正文');
    expect(mocks.execute).not.toHaveBeenCalled();
    await click('💾 下载设定文件');
    expect(mocks.download).toHaveBeenCalledExactlyOnceWith('通用情景_雨夜.json', JSON.stringify(general, null, 2));
  });

  it('keeps one download and full JSON copy when a mobile UA recommends text mode', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile',
      clipboard: { writeText },
    });
    window.localStorage.setItem(SCENARIO_DRAFT_KEY, JSON.stringify(storedDraft({ '故事发生的场景是怎样的？': '钟楼' })));
    await mount();
    await click('生成情景');
    const exports = container.querySelector('[aria-label="保存原始数据"]')!;
    const text = exports.querySelector('textarea')!;
    const payload = JSON.stringify(scenarioCard, null, 2);
    expect(text.value).toBe(payload);
    expect(text.readOnly).toBe(true);
    expect([...exports.querySelectorAll('button')].filter((item) => item.textContent?.includes('下载'))).toHaveLength(1);
    expect(exports.textContent).not.toContain('💾 下载设定文件');
    await click('下载 JSON 文件');
    expect(mocks.download).toHaveBeenCalledExactlyOnceWith('情景_雨后采访.json', payload);
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
    window.localStorage.setItem(SCENARIO_DRAFT_KEY, JSON.stringify(
      storedDraft({ '故事发生的场景是怎样的？': 'x' }),
    ));
    await mount();
    await click('生成情景');
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
    window.localStorage.setItem(SCENARIO_DRAFT_KEY, JSON.stringify({
      ...storedDraft({ '故事发生的场景是怎样的？': '钟楼' }),
      generationMode: 'stream', scenarioTitleHint: '夜雨',
    }));
    await mount();
    expect(button('流式').matches(':disabled')).toBe(false);
    expect(button('流式').getAttribute('aria-pressed')).toBe('true');
    await click('非流式');
    if (generationMode === 'stream') await click('流式');
    const selectedLabel = generationMode === 'stream' ? '流式' : '非流式';
    await click('服务器'); await click('客户端');
    expect(button(selectedLabel).getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector<HTMLInputElement>('input[aria-label="情景标题"]')?.value).toBe('夜雨');
    await click('生成情景');
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(mocks.execute.mock.calls[0]![1]).toMatchObject({ titleHint: generationMode === 'stream' ? '夜雨' : '' });
    expect(mocks.execute.mock.calls[0]![2]).toMatchObject({ mode, generationMode });
  });

  it('restored signed card is labelled unverified, not official (G2-r1 信任标签)', async () => {
    const signed = {
      ...scenarioCard,
      metadata: { created_at: '2026-01-01T00:00:00.000Z', signature: 'forged-sig' },
    };
    window.localStorage.setItem(SCENARIO_DRAFT_KEY, JSON.stringify({
      ...storedDraft({ '故事发生的场景是怎样的？': '钟楼' }),
      output: { mode: 'hosted-json', cardKind: 'scenario', card: signed, rawText: 'x', phase: 'completed' },
    }));
    await mount();
    // 可编辑 localStorage 恢复的签名卡：本机未验证，不得宣称官方签名（G2-r1）。
    expect(container.textContent).toContain('含签名字段（本机未验证）');
    expect(container.textContent).not.toContain('官方签名（服务器生成）');
  });

  it('fresh hosted-json signed card is labelled official signature', async () => {
    // 服务器执行偏好：只有真正以 hosted-json 意图派发的响应才可显示官方
    // 签名——客户端意图下即使 Mock 返回带签名的卡也不得显示（G2-r1 复审）。
    window.localStorage.setItem(DESKTOP_AI_CONFIG_STORAGE_KEY, JSON.stringify({
      version: 2,
      selection: { executionPreference: 'server', clientConnectionId: 'local' },
      hiddenPresetIds: [],
    }));
    const signed = {
      ...scenarioCard,
      metadata: { created_at: '2026-01-01T00:00:00.000Z', signature: 'sig-1' },
    };
    mocks.execute.mockResolvedValue({
      status: 'completed', mode: 'hosted-json', card: signed, cardKind: 'scenario', rawText: 'x',
    });
    window.localStorage.setItem(SCENARIO_DRAFT_KEY, JSON.stringify(
      storedDraft({ '故事发生的场景是怎样的？': 'x' }),
    ));
    await mount();
    await click('生成情景');
    // 断言执行器确实收到 hosted-json 意图（而非客户端意图配服务器假结果）。
    expect((mocks.execute.mock.calls[0]![2] as { mode: string }).mode).toBe('hosted-json');
    // 本会话内的新鲜 hosted-json 响应：如实显示服务器签名来源。
    expect(container.textContent).toContain('官方签名（服务器生成）');
    expect(container.textContent).not.toContain('本机未验证');
    // 保存与标签消费同一份投影：provenance 必须记 official-signed。
    await click('保存到本地卡库');
    const record = mocks.save.mock.calls[0]![0] as {
      provenance: { kind: string; signature?: string; execution?: string };
    };
    expect(record.provenance).toMatchObject({ kind: 'official-signed', signature: 'sig-1', execution: 'hosted' });
  });

  it('客户端意图收到混入签名的响应：入口剥除，标签与保存同记未签名', async () => {
    // G2-r1 复审指出的双判分叉场景：客户端（direct-local）意图配一个自称
    // hosted-json 且携带签名的 Mock 结果。统一投影下两端都必须不承认签名。
    const signed = {
      ...scenarioCard,
      metadata: { created_at: '2026-01-01T00:00:00.000Z', signature: 'forged-sig' },
    };
    mocks.execute.mockResolvedValue({
      status: 'completed', mode: 'hosted-json', card: signed, cardKind: 'scenario', rawText: 'x',
    });
    window.localStorage.setItem(SCENARIO_DRAFT_KEY, JSON.stringify(
      storedDraft({ '故事发生的场景是怎样的？': 'x' }),
    ));
    await mount();
    await click('生成情景');
    expect((mocks.execute.mock.calls[0]![2] as { mode: string }).mode).toBe('direct-local');
    // 只断言结果标题区：页面静态文案（客户端说明「结果不带官方签名」）自带该词。
    const result = container.querySelector('section[aria-label="生成结果"]')!;
    expect(result.querySelector('p')?.textContent).toBe('生成结果 · 未签名（非原生卡）');
    expect(result.querySelector('h2')?.textContent).toBe('雨后采访');
    await click('保存到本地卡库');
    const record = mocks.save.mock.calls[0]![0] as {
      data: { metadata?: Record<string, unknown> };
      provenance: { kind: string; signature?: string };
    };
    expect(record.provenance).toMatchObject({ kind: 'unsigned', execution: 'direct-local' });
    expect(record.data.metadata?.signature).toBeUndefined();
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
    window.localStorage.setItem(SCENARIO_DRAFT_KEY, JSON.stringify(
      storedDraft({ '故事发生的场景是怎样的？': '雨后的天台' }),
    ));
    await mount();
    expect(container.textContent).toContain('已不在支持列表中');
    expect(button('生成情景').disabled).toBe(true);
    button('生成情景').click();
    await settle();
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});

it('creates, edits, exports and saves the common Markdown workspace without generating or replacing the structured result', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  window.localStorage.setItem(SCENARIO_DRAFT_KEY, JSON.stringify(storedDraft({ '故事发生的场景是怎样的？': '钟楼' })));
  await mount();
  await click('生成情景');
  await click('将生成结果转为通用情景卡');
  const editor = () => container.querySelector('[aria-label="通用情景卡编辑器"]')!;
  expect(editor().querySelector('textarea')?.value).toContain('天台上的一次对话');
  const textarea = editor().querySelector('textarea')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, '# 新的设定\n\n未保存编辑'); textarea.dispatchEvent(new Event('input', { bubbles: true })); });
  const saved = JSON.parse(window.localStorage.getItem(SCENARIO_DRAFT_KEY)!);
  expect(saved.generalScenarioDraft.content).toBe('# 新的设定\n\n未保存编辑');
  expect(saved.output.card.title).toBe(scenarioCard.title);
  await click('创建空白通用情景卡');
  expect(window.confirm).toHaveBeenCalled();
  expect(textarea.value).toBe('# 新的设定\n\n未保存编辑');
  const action = (label: string) => [...editor().querySelectorAll('button')].find((item) => item.textContent === label)!;
  await act(async () => { action('下载通用情景卡').click(); action('复制到剪贴板').click(); });
  expect(mocks.download).toHaveBeenLastCalledWith('通用情景_雨后采访.json', JSON.stringify(saved.generalScenarioDraft, null, 2));
  expect(writeText).toHaveBeenLastCalledWith(JSON.stringify(saved.generalScenarioDraft, null, 2));
  let finish: () => void = () => undefined;
  mocks.save.mockImplementationOnce(() => new Promise((resolve) => { finish = () => resolve({ written: true }); }));
  await act(async () => { action('保存到本地卡库').click(); action('保存到本地卡库').click(); });
  expect(mocks.save).toHaveBeenCalledTimes(1);
  expect(editor().querySelector('textarea')?.disabled).toBe(true);
  await act(async () => finish());
  expect(mocks.save).toHaveBeenLastCalledWith(expect.objectContaining({ provenance: { kind: 'unsigned', execution: 'edited' } }));
  expect(container.querySelector('[aria-label="生成结果"] h2')?.textContent).toBe(scenarioCard.title);
  expect(mocks.execute).toHaveBeenCalledTimes(1);
  await act(async () => root.unmount()); root = createRoot(container);
  await mount();
  expect(editor().querySelector('textarea')?.value).toBe('# 新的设定\n\n未保存编辑');
  expect(mocks.execute).toHaveBeenCalledTimes(1);
  vi.mocked(window.confirm).mockReturnValue(true);
  await click('清空本地草稿');
  expect(editor().querySelector('textarea')).toBeNull();
  expect(container.querySelector('[aria-label="生成结果"] h2')?.textContent).toBe(scenarioCard.title);
  expect(mocks.save).toHaveBeenCalledTimes(1);
});

it('keeps corrupt Scenario source but allows new answers and generation', async () => {
  const corrupt = '{broken-scenario';
  window.localStorage.setItem(SCENARIO_DRAFT_KEY, corrupt);
  await mount();
  expect(container.textContent).toContain('自动保存暂不可用');
  expect(container.textContent).not.toContain('当前输入会自动保存到本机');
  const input = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="故事发生的场景是怎样的？"]')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, '新舞台'); input.dispatchEvent(new Event('input', { bubbles: true })); });
  expect(button('生成情景').disabled).toBe(false);
  await click('生成情景');
  expect(mocks.execute).toHaveBeenCalledTimes(1);
  expect(window.localStorage.getItem(SCENARIO_DRAFT_KEY)).toBe(corrupt);
});

it.each(['route', 'close'] as const)('confirms leaving a memory-only Scenario draft via %s without deleting the protected source', async (kind) => {
  const corrupt = '{protected-scenario'; window.localStorage.setItem(SCENARIO_DRAFT_KEY, corrupt);
  const router = await mount();
  const input = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="故事发生的场景是怎样的？"]')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, '新内容'); input.dispatchEvent(new Event('input', { bubbles: true })); });
  const close = mocks.listen.mock.calls.at(-1)![0] as (event: { preventDefault: () => void }) => void;
  const denied = vi.fn();
  await act(async () => { if (kind === 'route') void router.navigate({ to: '/' }); else close({ preventDefault: denied }); }); await settle();
  expect(container.querySelector('[data-testid="page-scenario"]')).not.toBeNull();
  if (kind === 'close') expect(denied).toHaveBeenCalled();
  vi.mocked(window.confirm).mockReturnValue(true);
  const accepted = vi.fn();
  await act(async () => { if (kind === 'route') void router.navigate({ to: '/' }); else close({ preventDefault: accepted }); }); await settle();
  if (kind === 'route') expect(container.querySelector('[data-testid="page-scenario"]')).toBeNull();
  else expect(accepted).not.toHaveBeenCalled();
  expect(window.localStorage.getItem(SCENARIO_DRAFT_KEY)).toBe(corrupt);
});

it('clears a restored Markdown editor without resurrecting it from the preserved generated general card', async () => {
  const general = { templateId: '通用情景', title: '保留结果', content: '# 保留正文' };
  window.localStorage.setItem(SCENARIO_DRAFT_KEY, JSON.stringify({
    ...storedDraft({ '故事发生的场景是怎样的？': '旧回答' }), selectedLanguage: 'en', generationMode: 'stream',
    output: { mode: 'hosted-stream', cardKind: 'general-scenario', card: general, rawText: general.content, phase: 'completed' },
  }));
  await mount();
  expect(container.querySelector('[aria-label="通用情景卡编辑器"] textarea')).not.toBeNull();
  vi.mocked(window.confirm).mockReturnValue(true);
  await click('清空本地草稿');
  const stored = JSON.parse(window.localStorage.getItem(SCENARIO_DRAFT_KEY)!);
  expect(stored).toMatchObject({ generalScenarioDraft: null, generationMode: 'non-stream', selectedLanguage: 'zh-CN', output: { card: general, rawText: general.content, phase: 'completed' } });
  expect(container.querySelector('[aria-label="生成结果"]')).not.toBeNull();
  expect(container.querySelector('[aria-label="通用情景卡编辑器"] textarea')).toBeNull();
  await act(async () => root.unmount()); root = createRoot(container); await mount();
  expect(container.querySelector('[aria-label="通用情景卡编辑器"] textarea')).toBeNull();
  expect(container.querySelector('[aria-label="生成结果"]')).not.toBeNull();
  expect(mocks.execute).not.toHaveBeenCalled();
});

it('reports a failed Scenario clear persistence without losing the generated result or old stored bytes', async () => {
  const general = { templateId: '通用情景', title: '草稿', content: '# 旧编辑' };
  const raw = JSON.stringify({ ...storedDraft({ '故事发生的场景是怎样的？': '旧回答' }), generalScenarioDraft: general, output: { mode: 'hosted-json', cardKind: 'scenario', card: { ...scenarioCard, metadata: { ...scenarioCard.metadata, signature: 'old-signed' } }, rawText: 'raw', phase: 'completed' } });
  window.localStorage.setItem(SCENARIO_DRAFT_KEY, raw); await mount();
  const original = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) { if (key === SCENARIO_DRAFT_KEY) throw new Error('quota'); return original.call(this, key, value); });
  vi.mocked(window.confirm).mockReturnValue(true); await click('清空本地草稿');
  expect(container.textContent).toContain('自动保存暂不可用');
  expect(container.textContent).toContain('草稿写入失败');
  expect(container.textContent).toContain('含签名字段（本机未验证）');
  expect(container.querySelector('[aria-label="通用情景卡编辑器"] textarea')).toBeNull();
  expect(window.localStorage.getItem(SCENARIO_DRAFT_KEY)).toBe(raw);
});

it('通用情景保存命中回收站时提示先恢复且不谎报活动卡已存在', async () => {
  const general = { templateId: '通用情景', title: '回收站情景', content: '唯一副本正文' };
  window.localStorage.setItem(SCENARIO_DRAFT_KEY, JSON.stringify({ ...storedDraft({}), generalScenarioDraft: general }));
  mocks.save.mockResolvedValue({ alreadyPresent: true });
  mocks.get.mockImplementation(async (id) => {
    const existing = mocks.save.mock.calls.at(-1)![0];
    expect(id).toBe(existing.id);
    return { ...existing, deletedAt: existing.updatedAt };
  });
  await mount();
  await click('保存到本地卡库');
  expect(container.textContent).toContain('内容相同的情景卡在回收站中');
  expect(container.textContent).not.toContain('本地卡库已存在相同内容，原记录保持不变。');
  expect(container.querySelector<HTMLTextAreaElement>('#general-scenario-content')?.value).toBe('唯一副本正文');
  // 模拟用户在本地库显式恢复；这里只重试保存，不自动调用恢复命令。
  mocks.get.mockImplementation(async () => mocks.save.mock.calls.at(-1)![0]);
  await click('保存到本地卡库');
  expect(container.textContent).toContain('本地卡库已存在相同内容，原记录保持不变。');
  expect(mocks.execute).not.toHaveBeenCalled();
});

it('生成结果保存命中回收站后仍可重试，保存后重新生成不会丢弃未保存结果', async () => {
  window.localStorage.setItem(SCENARIO_DRAFT_KEY, JSON.stringify({
    ...storedDraft({ '故事发生的场景是怎样的？': '雨后的天台' }),
    output: { mode: 'direct-local', cardKind: 'scenario', card: scenarioCard, rawText: JSON.stringify(scenarioCard), phase: 'completed' },
  }));
  mocks.save.mockResolvedValue({ alreadyPresent: true });
  mocks.get.mockImplementation(async (id) => {
    const existing = mocks.save.mock.calls.at(-1)![0];
    expect(id).toBe(existing.id);
    return { ...existing, deletedAt: existing.updatedAt };
  });
  await mount();
  await click('保存到本地卡库');
  expect(container.textContent).toContain('内容相同的数据卡在回收站中');
  expect(button('保存到本地卡库').disabled).toBe(false);
  await click('重新生成');
  await click('保存后重新生成');
  expect(mocks.execute).not.toHaveBeenCalled();
  expect(container.querySelector<HTMLDialogElement>('dialog')?.open).toBe(true);
  expect(container.querySelector('[aria-label="生成结果"] h2')?.textContent).toBe(scenarioCard.title);
});
