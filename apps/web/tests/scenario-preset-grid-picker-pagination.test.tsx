// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ScenarioPresetGridPicker } from '@/components/ScenarioPresetGridPicker';
import type { ScenarioPreset } from '@/lib/scenario-presets';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const preset = (n: number): ScenarioPreset => ({
  title: `情景 ${n}`,
  description: `描述 ${n}`,
  filename: `S${String(n).padStart(2, '0')}.json`,
  template: 'scenario',
});

const fifteenPresets = Array.from({ length: 15 }, (_, index) => preset(index + 1));

let container: HTMLDivElement;
let root: Root;

const button = (label: string): HTMLButtonElement => {
  const target = [...document.body.querySelectorAll('button')]
    .find((candidate) => candidate.textContent?.trim() === label);
  if (!(target instanceof HTMLButtonElement)) throw new Error(`button not found: ${label}`);
  return target;
};

const renderPicker = (presets: ScenarioPreset[], currentPage: number, onPageChange: (page: number) => void): void => {
  act(() => {
    root.render(
      <ScenarioPresetGridPicker
        title="选择预设情景"
        presets={presets}
        currentPage={currentPage}
        onPageChange={onPageChange}
        selectedFilenames={[]}
        onToggle={vi.fn()}
      />,
    );
  });
};

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe('ScenarioPresetGridPicker pagination self-defense', () => {
  it('父组件传入越界页码时钳制到有效范围，翻页回调基于钳制后的页码', () => {
    const onPageChange = vi.fn();

    renderPicker(fifteenPresets, 0, onPageChange);
    expect(container.textContent).toContain('第 1 / 4 页');
    expect(container.textContent).toContain('情景 1');
    expect(button('上一页').disabled).toBe(true);

    renderPicker(fifteenPresets, 99, onPageChange);
    expect(container.textContent).toContain('第 4 / 4 页');
    expect(container.textContent).toContain('情景 15');
    expect(container.textContent).not.toContain('情景 2');
    expect(button('下一页').disabled).toBe(true);

    act(() => button('上一页').click());
    expect(onPageChange).toHaveBeenCalledWith(3);
  });

  it('数据收缩后不再渲染空白页，也不显示越界页码', () => {
    const onPageChange = vi.fn();

    renderPicker(fifteenPresets, 4, onPageChange);
    expect(container.textContent).toContain('第 4 / 4 页');
    expect(container.textContent).toContain('情景 15');

    renderPicker(fifteenPresets.slice(0, 4), 4, onPageChange);
    expect(container.textContent).not.toContain('第 4 / 4 页');
    expect(container.textContent).not.toContain('上一页');
    for (let index = 1; index <= 4; index += 1) {
      expect(container.textContent).toContain(`情景 ${index}`);
    }
  });
});
