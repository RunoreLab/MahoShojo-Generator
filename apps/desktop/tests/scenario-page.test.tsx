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

const mocks = vi.hoisted(() => ({ execute: vi.fn(), save: vi.fn(), listen: vi.fn(), profiles: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: () => true }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ onCloseRequested: mocks.listen }) }));
vi.mock('../src/features/scenario/generation', async (original) => ({ ...await original<object>(), executeScenarioGeneration: mocks.execute }));
vi.mock('../src/platform/provider-profile-bridge', () => ({ listProviderProfileIds: async () => ['local'], getProviderProfile: mocks.profiles }));
vi.mock('../src/platform/local-card-bridge', () => ({ IpcLocalCardRepository: class { putIfAbsent = mocks.save; } }));

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
  it('restores answers draft on explicit action, generates once and saves the card', async () => {
    window.localStorage.setItem(SCENARIO_DRAFT_KEY, JSON.stringify(
      storedDraft({ '故事发生的场景是怎样的？': '雨后的天台' }),
    ));
    await mount();
    expect(container.querySelector('[data-testid="page-scenario"]')).toBeTruthy();
    expect(mocks.execute).not.toHaveBeenCalled();
    // 待恢复期间生成门禁关闭。
    expect(button('生成情景').disabled).toBe(true);
    await click('恢复草稿');
    const textarea = [...container.querySelectorAll('textarea')].find(
      (el) => el.getAttribute('aria-label') === '故事发生的场景是怎样的？',
    )!;
    expect(textarea.value).toBe('雨后的天台');
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
    await click('保存到本地卡库');
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('已保存到本地卡库');
  });

  it('confirms replacement before regenerating an unsaved result', async () => {
    window.localStorage.setItem(SCENARIO_DRAFT_KEY, JSON.stringify(
      storedDraft({ '故事发生的场景是怎样的？': 'x' }),
    ));
    await mount();
    await click('恢复草稿');
    await click('生成情景');
    await click('重新生成');
    expect(container.querySelector('dialog')?.open).toBe(true);
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    await click('取消');
    expect(container.querySelector('dialog')?.open).toBe(false);
    await click('重新生成'); await click('确定重新生成');
    expect(mocks.execute).toHaveBeenCalledTimes(2);
  });

  it('client execution disables the stream switch and rewrites a streamed draft back to non-stream', async () => {
    window.localStorage.setItem(SCENARIO_DRAFT_KEY, JSON.stringify({
      ...storedDraft({ '故事发生的场景是怎样的？': '钟楼' }),
      generationMode: 'stream',
      scenarioTitleHint: '夜雨',
    }));
    await mount();
    await click('恢复草稿');
    // 草稿 generationMode=stream 但执行位置为客户端：effect 应回写 non-stream。
    const stored = JSON.parse(window.localStorage.getItem(SCENARIO_DRAFT_KEY)!);
    expect(stored.generationMode).toBe('non-stream');
    expect(container.textContent).toContain('客户端执行仅支持结构化（非流式）生成');
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
    await click('恢复草稿');
    // 可编辑 localStorage 恢复的签名卡：本机未验证，不得宣称官方签名（G2-r1）。
    expect(container.textContent).toContain('含签名字段（本机未验证）');
    expect(container.textContent).not.toContain('官方签名（服务器生成）');
  });

  it('fresh hosted-json signed card is labelled official signature', async () => {
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
    await click('恢复草稿');
    await click('生成情景');
    // 本会话内的新鲜 hosted-json 响应：如实显示服务器签名来源。
    expect(container.textContent).toContain('官方签名（服务器生成）');
    expect(container.textContent).not.toContain('本机未验证');
  });
});
