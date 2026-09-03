// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MaterialPanel } from '@/components/arena/components/MaterialPanel';
import { useBattleStore } from '@/components/arena/stores/useBattleStore';
import type { ArenaMaterialState } from '@/lib/arena/materials';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const materialFixture = (): ArenaMaterialState => ({
  id: 'material-1',
  name: '设定集 A',
  content: { foo: 'bar' },
  fileName: 'a.json',
  sourceKind: 'mahoshojo-data-card',
  sourceType: '设定',
  isNative: false,
  isPreset: false,
});

const resetStore = () => {
  useBattleStore.setState(useBattleStore.getInitialState(), true);
};

const renderPanel = (): void => {
  act(() => {
    root.render(
      <MaterialPanel onOpenMaterialModal={() => undefined} />,
    );
  });
};

const button = (label: string): HTMLButtonElement => {
  const target = [...document.body.querySelectorAll('button')]
    .find((candidate) => candidate.textContent?.trim() === label);
  if (!(target instanceof HTMLButtonElement)) throw new Error(`button not found: ${label}`);
  return target;
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  localStorage.clear();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  resetStore();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('shared Arena material section via solo adapter', () => {
  it('渲染素材列表与预算统计行，并支持移除与清空', () => {
    useBattleStore.setState({ materials: [materialFixture()] });
    renderPanel();

    expect(container.textContent).toContain('浏览在线数据卡');
    expect(container.textContent).toContain('已选素材 1；参考项合计 1/256');
    expect(container.textContent).toContain('设定集 A');
    expect(container.textContent).toContain('数据卡 / 设定');

    const removeButton = container.querySelector<HTMLButtonElement>('button[aria-label="移除 设定集 A"]');
    if (!removeButton) throw new Error('material remove button not found');
    act(() => removeButton.click());
    expect(useBattleStore.getState().materials).toEqual([]);
    expect(container.textContent).toContain('未添加素材');

    act(() => button('清空').click());
    expect(useBattleStore.getState().materials).toEqual([]);
  });
});
