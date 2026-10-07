// @vitest-environment jsdom
/**
 * 设置页受控展示原语的 DOM/交互断言（设置页 UI/UX 修订）。
 *
 * 钉住的不变量：
 *
 * 1. **开关滑块显式水平定位**——`<button>` UA 的 `text-align:center` 会把
 *    缺省 `left` 的绝对定位子元素静态位置推到中间，translate 后滑块溢出
 *    轨道（截图可见的「开关错位」）。断言滑块必带 inline-start 偏移类。
 * 2. **关态轨道用 `--app-switch-track`**——`--app-border` 在亮色主题下
 *    近透明，当轨道底色没有对比度。
 * 3. **分段选项组是 `radiogroup` 语义**——roving tabindex（组内一个 Tab
 *    停留点）+ 方向键/Home/End 移动并选中，与原生 radio 键盘模型一致。
 */
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SettingsOptionButtons, SettingsToggle } from '../src/settings/primitives';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const render = async (node: ReactNode): Promise<void> => {
  await act(async () => {
    root.render(node);
  });
};

const click = async (element: Element): Promise<void> => {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
};

const keydown = async (element: Element, key: string): Promise<void> => {
  await act(async () => {
    element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
};

describe('SettingsToggle', () => {
  const findSwitch = () => container.querySelector('[role="switch"]');
  const findThumb = () => findSwitch()?.querySelector('span');

  it('exposes switch semantics and reports toggles through onChange', async () => {
    const onChange = vi.fn();
    await render(<SettingsToggle checked={false} onChange={onChange} ariaLabel="开关" />);

    const toggle = findSwitch();
    expect(toggle).not.toBeNull();
    expect(toggle?.getAttribute('aria-checked')).toBe('false');
    expect(toggle?.getAttribute('aria-label')).toBe('开关');

    await click(toggle!);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('keeps the thumb inside the track: explicit inline-start offset, not UA-centred static position', async () => {
    await render(<SettingsToggle checked={false} onChange={() => {}} />);

    const thumb = findThumb();
    expect(thumb).not.toBeNull();
    // 回归钉：`absolute` 缺省水平偏移会被 button 的 text-align:center 推到中间。
    expect(thumb?.className).toMatch(/(?:^|\s)(?:left|start)-/u);
    expect(thumb?.className).toContain('translate-x-0');
    // 滑块走专用 token——product-shell.css 会在暗色下把 .bg-white 重写成深表面色。
    expect(thumb?.className).toContain('bg-(--app-switch-thumb)');
  });

  it('uses the dedicated switch-track token when off and accent when on', async () => {
    const onChange = vi.fn();
    await render(<SettingsToggle checked={false} onChange={onChange} />);
    expect(findSwitch()?.className).toContain('bg-(--app-switch-track)');

    await render(<SettingsToggle checked onChange={onChange} />);
    expect(findSwitch()?.className).toContain('bg-(--app-accent-strong)');
  });

  it('does not toggle while disabled', async () => {
    const onChange = vi.fn();
    await render(<SettingsToggle checked={false} onChange={onChange} disabled />);
    await click(findSwitch()!);
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('SettingsOptionButtons', () => {
  const OPTIONS = [
    { value: 'a', label: '甲' },
    { value: 'b', label: '乙' },
    { value: 'c', label: '丙' },
  ] as const;

  const findRadios = () => [...container.querySelectorAll('[role="radio"]')];

  const renderGroup = async (value: string, onChange = vi.fn(), disabled?: boolean) => {
    await render(
      <SettingsOptionButtons
        value={value}
        options={[...OPTIONS]}
        onChange={onChange}
        ariaLabel="选项"
        disabled={disabled}
      />,
    );
    return onChange;
  };

  it('renders a radiogroup of radios with aria-checked reflecting the value', async () => {
    await renderGroup('b');

    expect(container.querySelector('[role="radiogroup"]')).not.toBeNull();
    const radios = findRadios();
    expect(radios).toHaveLength(3);
    expect(radios.map((radio) => radio.getAttribute('aria-checked'))).toEqual([
      'false',
      'true',
      'false',
    ]);
  });

  it('keeps exactly one tab stop on the selected option; falls back to the first when unmatched', async () => {
    await renderGroup('b');
    expect(findRadios().map((radio) => radio.getAttribute('tabindex'))).toEqual(['-1', '0', '-1']);

    await renderGroup('not-an-option');
    expect(findRadios().map((radio) => radio.getAttribute('tabindex'))).toEqual(['0', '-1', '-1']);
  });

  it('selects on click', async () => {
    const onChange = await renderGroup('a');
    await click(findRadios()[2]!);
    expect(onChange).toHaveBeenCalledWith('c');
  });

  it('arrow keys move selection forward/backward with wrap and move focus', async () => {
    const onChange = await renderGroup('a');
    const radios = findRadios();

    (radios[0] as HTMLElement).focus();
    await keydown(radios[0]!, 'ArrowRight');
    expect(onChange).toHaveBeenCalledWith('b');
    expect(document.activeElement).toBe(findRadios()[1]);

    await keydown(document.activeElement!, 'ArrowLeft');
    expect(onChange).toHaveBeenCalledWith('a');

    onChange.mockClear();
    await keydown(document.activeElement!, 'ArrowLeft');
    // 从第一项向左环绕到末项。
    expect(onChange).toHaveBeenCalledWith('c');
  });

  it('Home/End jump to the edges and other keys do nothing', async () => {
    const onChange = await renderGroup('b');
    const radios = findRadios();

    await keydown(radios[1]!, 'End');
    expect(onChange).toHaveBeenCalledWith('c');
    await keydown(document.activeElement!, 'Home');
    expect(onChange).toHaveBeenCalledWith('a');

    onChange.mockClear();
    await keydown(document.activeElement!, 'x');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('disables every option when the group is disabled', async () => {
    await renderGroup('a', vi.fn(), true);
    for (const radio of findRadios()) {
      expect(radio).toHaveProperty('disabled', true);
    }
  });
});
