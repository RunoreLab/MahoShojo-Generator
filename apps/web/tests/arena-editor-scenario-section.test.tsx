// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ScenarioPanel } from '@/components/arena/components/ScenarioPanel';
import { useBattleStore } from '@/components/arena/stores/useBattleStore';

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
});
