// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ScenarioPanel } from '@/components/arena/components/ScenarioPanel';
import { useBattleStore } from '@/components/arena/stores/useBattleStore';
import { SCENARIO_PRESET_LIST } from '@/lib/scenario-presets';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const resetStore = () => {
  useBattleStore.setState(useBattleStore.getInitialState(), true);
};

const auxScenario = (id: string, title: string) => ({
  id,
  content: { title },
  fileName: `${title}.json`,
  isNative: false,
  isPreset: false,
});

let container: HTMLDivElement;
let root: Root;
let queryClient: QueryClient;

const button = (label: string): HTMLButtonElement => {
  const target = [...document.body.querySelectorAll('button')]
    .find((candidate) => candidate.textContent?.trim() === label);
  if (!(target instanceof HTMLButtonElement)) throw new Error(`button not found: ${label}`);
  return target;
};

const renderPanel = (): void => {
  act(() => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <ScenarioPanel
          onOpenScenarioModal={() => undefined}
          onRandomMatchScenario={() => undefined}
          onOpenAuxScenarioModal={() => undefined}
          isAuthenticated
        />
      </QueryClientProvider>,
    );
  });
};

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async () => Response.json([])));
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  resetStore();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  queryClient.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('shared Arena scenario section via solo adapter', () => {
  it('渲染主情景入口、预算行与辅助情景区块；无主情景时禁用新增辅助情景', () => {
    useBattleStore.setState({
      battleMode: 'scenario',
      scenario: {
        content: { title: '雨夜守城' },
        fileName: '雨夜守城.json',
        isNative: true,
        isPreset: false,
      },
      auxScenarios: [auxScenario('aux-1', '支线 A'), auxScenario('aux-2', '支线 B')],
    });
    renderPanel();

    expect(container.textContent).toContain('浏览在线情景库');
    expect(container.textContent).toContain('随机匹配情景');
    expect(container.textContent).toContain('已加载情景: 雨夜守城.json');
    expect(container.textContent).toContain('(原生)');

    const auxHeader = [...container.querySelectorAll('button')]
      .find((candidate) => candidate.textContent?.includes('辅助情景（可选）'));
    if (!auxHeader) throw new Error('aux section header not found');
    expect(auxHeader.textContent).toContain('已选辅助情景 2');
    expect(auxHeader.textContent).toContain('参考项合计 2/256');

    act(() => auxHeader.click());
    expect(container.textContent).toContain('支线 A');

    // 清除主情景（共享能力，solo 侧接 clearScenario）
    act(() => button('清除主情景').click());
    expect(useBattleStore.getState().scenario.content).toBeNull();
    expect(container.textContent).toContain('（请先选择主情景）');
  });

  it('支持辅助情景移除与清空', () => {
    useBattleStore.setState({
      battleMode: 'scenario',
      scenario: {
        content: { title: '雨夜守城' },
        fileName: '雨夜守城.json',
        isNative: false,
        isPreset: false,
      },
      auxScenarios: [auxScenario('aux-1', '支线 A'), auxScenario('aux-2', '支线 B')],
    });
    renderPanel();

    const auxHeader = [...container.querySelectorAll('button')]
      .find((candidate) => candidate.textContent?.includes('辅助情景（可选）'));
    if (!auxHeader) throw new Error('aux section header not found');
    act(() => auxHeader.click());

    const removeButton = container.querySelector<HTMLButtonElement>('button[aria-label="移除 支线 A"]');
    if (!removeButton) throw new Error('aux remove button not found');
    act(() => removeButton.click());
    expect(useBattleStore.getState().auxScenarios.map((item) => item.id)).toEqual(['aux-2']);

    act(() => button('清空').click());
    expect(useBattleStore.getState().auxScenarios).toEqual([]);
  });

  it('主情景粘贴非法 JSON 失败时呈现错误并保留输入，不清空粘贴区域', async () => {
    useBattleStore.setState({ battleMode: 'scenario' });
    renderPanel();
    act(() => button('展开情景粘贴区域（手机端推荐）').click());

    const textarea = container.querySelector<HTMLTextAreaElement>('textarea');
    if (!textarea) throw new Error('scenario paste textarea not found');
    const invalidJson = '{ 不是合法 JSON ';
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )?.set;
      setter?.call(textarea, invalidJson);
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => button('从文本加载情景').click());

    await vi.waitFor(() => {
      expect(useBattleStore.getState().error).toContain('❌');
      expect(useBattleStore.getState().scenario.content).toBeNull();
    });
    expect(textarea.value).toBe(invalidJson);
  });

  it('预设情景分页可在全部页间翻页：15 个预设应有 4 页且最后一页可达', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = input instanceof URL ? input.toString() : input;
      if (url.includes('/api/get-scenario-presets')) return Response.json(SCENARIO_PRESET_LIST);
      return Response.json([]);
    }));
    useBattleStore.setState({ battleMode: 'scenario' });
    renderPanel();

    const presetHeader = [...container.querySelectorAll('button')]
      .find((candidate) => candidate.textContent?.includes('预设情景（内置）'));
    if (!presetHeader) throw new Error('preset section header not found');
    act(() => presetHeader.click());

    await vi.waitFor(() => {
      expect(container.textContent).toContain('第 1 / 4 页');
    });

    act(() => button('下一页').click());
    expect(container.textContent).toContain('第 2 / 4 页');
    act(() => button('下一页').click());
    expect(container.textContent).toContain('第 3 / 4 页');
    act(() => button('下一页').click());
    expect(container.textContent).toContain('第 4 / 4 页');
    expect(container.textContent).toContain('废土行迹·战斗冲突：封路与突围');
    expect(container.textContent).not.toContain('谨遵女王之意');
    expect(button('下一页').disabled).toBe(true);

    act(() => button('上一页').click());
    expect(container.textContent).toContain('第 3 / 4 页');
  });

  it('辅助情景粘贴非法 JSON 失败时呈现错误并保留输入，不清空粘贴区域', async () => {
    useBattleStore.setState({
      battleMode: 'scenario',
      scenario: {
        content: { title: '雨夜守城' },
        fileName: '雨夜守城.json',
        isNative: false,
        isPreset: false,
      },
    });
    renderPanel();

    const auxHeader = [...container.querySelectorAll('button')]
      .find((candidate) => candidate.textContent?.includes('辅助情景（可选）'));
    if (!auxHeader) throw new Error('aux section header not found');
    act(() => auxHeader.click());
    act(() => button('展开辅助情景粘贴区域').click());

    const textarea = [...container.querySelectorAll('textarea')]
      .find((candidate) => candidate.placeholder.includes('辅助情景'));
    if (!textarea) throw new Error('aux paste textarea not found');
    const invalidJson = '{ 不是合法 JSON ';
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )?.set;
      setter?.call(textarea, invalidJson);
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => button('从文本添加辅助情景').click());

    await vi.waitFor(() => {
      expect(useBattleStore.getState().error).toContain('❌');
      expect(useBattleStore.getState().auxScenarios).toEqual([]);
    });
    expect(textarea.value).toBe(invalidJson);
  });
});
