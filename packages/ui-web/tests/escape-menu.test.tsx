// @vitest-environment jsdom
/**
 * `ShellEscapeMenu` 与共享 Escape 层级栈的宿主无关行为断言（DESK-PARITY-007）。
 *
 * 这里的 fixture 故意用最小宿主：条目/当前路径/导航回调全部以 props 注入。
 * 本文件守四件事——打开条件（干净按键 + 栈空 + 焦点不在文本输入）、模态语义
 * （初始焦点/Tab 圈闭/焦点归还）、一次 Escape 至多一层（含显式阻断）、以及
 * 导航只发回调（守卫归宿主 Router）。
 */
import { act, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BaseModal } from '../src/modal/BaseModal';
import { useEscapeLayer } from '../src/modal/escape-stack';
import { ShellEscapeMenu, type ShellEscapeMenuEntry } from '../src/shell/EscapeMenu';

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

const ENTRIES: readonly ShellEscapeMenuEntry[] = [
  { href: '/', label: '首页' },
  { href: '/local-library', label: '本地库' },
  { href: '/encyclopedia', label: '百科' },
  { href: '/settings', label: '设置' },
];

const render = (node: ReactNode): void => {
  act(() => root.render(node));
};

const settle = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

const pressEscape = async (
  target: EventTarget = document,
  init: KeyboardEventInit = {},
): Promise<void> => {
  await act(async () => {
    target.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true, ...init }),
    );
    await Promise.resolve();
  });
  await settle();
};

const pressKey = async (
  key: string,
  target: EventTarget = document,
  init: KeyboardEventInit = {},
): Promise<void> => {
  await act(async () => {
    target.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }),
    );
    await Promise.resolve();
  });
};

const menuDialog = () =>
  document.querySelector('[data-testid="escape-menu-root"] [role="dialog"]');
const menuButton = (label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('[data-testid="escape-menu-root"] button')].find(
    (button) => button.textContent?.includes(label),
  ) ?? null;

const renderMenu = (props: Partial<Parameters<typeof ShellEscapeMenu>[0]> = {}) => {
  render(
    <ShellEscapeMenu
      enabled
      entries={ENTRIES}
      pathname="/"
      onNavigate={vi.fn()}
      {...props}
    />,
  );
};

describe('ShellEscapeMenu open conditions', () => {
  it('opens on a clean Escape and focuses 继续 first', async () => {
    renderMenu();

    expect(menuDialog()).toBeNull();
    await pressEscape();

    expect(menuDialog()).not.toBeNull();
    expect(menuDialog()?.textContent).toContain('快捷菜单');
    for (const label of ['继续', '首页', '本地库', '百科', '设置']) {
      expect(menuDialog()?.textContent).toContain(label);
    }
    expect(document.activeElement).toBe(menuButton('继续'));
  });

  it('does not open when disabled', async () => {
    renderMenu({ enabled: false });
    await pressEscape();
    expect(menuDialog()).toBeNull();
  });

  it('ignores a repeated Escape (key held down)', async () => {
    renderMenu();
    await pressEscape(document, { repeat: true });
    expect(menuDialog()).toBeNull();
  });

  it('ignores an Escape during IME composition', async () => {
    renderMenu();
    await pressEscape(document, { isComposing: true });
    expect(menuDialog()).toBeNull();
  });

  it('ignores an Escape that was already defaultPrevented upstream', async () => {
    render(
      <div onKeyDown={(event) => event.key === 'Escape' && event.preventDefault()}>
        <button type="button">shield</button>
        <ShellEscapeMenu enabled entries={ENTRIES} pathname="/" onNavigate={vi.fn()} />
      </div>,
    );
    const shield = container.querySelector('button')!;
    shield.focus();
    await pressEscape(shield);
    expect(menuDialog()).toBeNull();
  });

  it('does not open while focus sits in a native text input, textarea or contenteditable', async () => {
    render(
      <>
        <input aria-label="文本输入" />
        <textarea aria-label="多行输入" />
        <div contentEditable aria-label="可编辑区" tabIndex={0} />
        <input type="checkbox" aria-label="非文本开关" />
        <ShellEscapeMenu enabled entries={ENTRIES} pathname="/" onNavigate={vi.fn()} />
      </>,
    );

    for (const label of ['文本输入', '多行输入', '可编辑区']) {
      const target = container.querySelector<HTMLElement>(`[aria-label="${label}"]`)!;
      target.focus();
      await pressEscape(target);
      expect(menuDialog(), `${label} 里的 Escape 属于编辑语义`).toBeNull();
    }

    // 非文本型 input（checkbox）不是文本编辑目标——菜单照常打开。
    const checkbox = container.querySelector<HTMLElement>('[aria-label="非文本开关"]')!;
    checkbox.focus();
    await pressEscape(checkbox);
    expect(menuDialog()).not.toBeNull();
  });
});

describe('ShellEscapeMenu modal semantics', () => {
  it('closes on Escape and restores focus to the element that opened it', async () => {
    render(
      <>
        <button type="button">焦点起点</button>
        <ShellEscapeMenu enabled entries={ENTRIES} pathname="/" onNavigate={vi.fn()} />
      </>,
    );
    const opener = container.querySelector('button')!;
    opener.focus();

    await pressEscape();
    expect(menuDialog()).not.toBeNull();
    expect(document.activeElement).toBe(menuButton('继续'));

    await pressEscape();
    expect(menuDialog()).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('traps Tab inside the dialog', async () => {
    renderMenu();
    await pressEscape();

    const dialog = menuDialog()!;
    const focusables = [...dialog.querySelectorAll<HTMLElement>('button:not([disabled])')];
    expect(focusables.length).toBeGreaterThan(1);

    // 焦点在最后一个可聚焦元素时按 Tab → 回到第一个。
    focusables.at(-1)!.focus();
    await pressKey('Tab');
    expect(document.activeElement).toBe(focusables[0]);

    // 焦点在第一个时 Shift+Tab → 环回末尾。
    await pressKey('Tab', document, { shiftKey: true });
    expect(document.activeElement).toBe(focusables.at(-1));
  });

  it('supports arrow-key navigation between actions', async () => {
    renderMenu({ pathname: '/encyclopedia' });
    await pressEscape();
    expect(document.activeElement).toBe(menuButton('继续'));

    // ArrowDown 从「继续」走到「首页」→「本地库」；当前页「百科」是 disabled
    // 当前项，箭头导航跳过它直接落到「设置」。
    await pressKey('ArrowDown', document.activeElement!);
    expect(document.activeElement?.textContent).toContain('首页');
    await pressKey('ArrowDown', document.activeElement!);
    expect(document.activeElement?.textContent).toContain('本地库');
    await pressKey('ArrowDown', document.activeElement!);
    expect(document.activeElement?.textContent).toContain('设置');
    // 再按一次环回「继续」。
    await pressKey('ArrowDown', document.activeElement!);
    expect(document.activeElement?.textContent).toContain('继续');
    // ArrowUp 反向回「设置」。
    await pressKey('ArrowUp', document.activeElement!);
    expect(document.activeElement?.textContent).toContain('设置');
  });

  it('marks the current page as current instead of navigating', async () => {
    const onNavigate = vi.fn();
    renderMenu({ pathname: '/settings', onNavigate });
    await pressEscape();

    const current = menuButton('设置');
    expect(current?.disabled).toBe(true);
    expect(current?.getAttribute('aria-current')).toBe('page');
    expect(current?.textContent).toContain('当前页');
  });

  it('navigates through the host callback and closes first', async () => {
    const onNavigate = vi.fn();
    renderMenu({ pathname: '/', onNavigate });
    await pressEscape();

    const target = menuButton('本地库');
    await act(async () => {
      target?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });

    expect(onNavigate).toHaveBeenCalledWith('/local-library');
    expect(menuDialog()).toBeNull();
  });

  it('closes when the backdrop is clicked', async () => {
    renderMenu();
    await pressEscape();
    const backdrop = document.querySelector<HTMLElement>('[aria-label="关闭快捷菜单"]');
    await act(async () => {
      backdrop?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });
    expect(menuDialog()).toBeNull();
  });
});

describe('Escape 层级栈与菜单的优先级', () => {
  it('a single Escape consumes only the topmost layer — menu stays closed while a modal is open', async () => {
    const Harness = () => {
      const [modalOpen, setModalOpen] = useState(true);
      return (
        <>
          <BaseModal isOpen={modalOpen} title="上层模态" onClose={() => setModalOpen(false)}>
            内容
          </BaseModal>
          <ShellEscapeMenu enabled entries={ENTRIES} pathname="/" onNavigate={vi.fn()} />
        </>
      );
    };
    render(<Harness />);
    await settle();
    expect(document.body.textContent).toContain('上层模态');

    // 上层模态框占栈顶：Escape 关它，菜单不得打开。
    await pressEscape();
    expect(menuDialog()).toBeNull();
    expect(document.body.textContent).not.toContain('上层模态');

    // 栈空后的下一次 Escape 才轮到菜单兜底。
    await pressEscape();
    expect(menuDialog()).not.toBeNull();
  });

  it('a layer that explicitly blocks keeps the menu closed', async () => {
    const onEscape = vi.fn(() => true);
    const Blocker = () => {
      useEscapeLayer({ active: true, onEscape });
      return null;
    };
    render(
      <>
        <Blocker />
        <ShellEscapeMenu enabled entries={ENTRIES} pathname="/" onNavigate={vi.fn()} />
      </>,
    );
    await settle();

    await pressEscape();
    expect(onEscape).toHaveBeenCalledTimes(1);
    expect(menuDialog()).toBeNull();
  });

  it('a declining layer yields to the fallback and the menu opens', async () => {
    const Decliner = () => {
      useEscapeLayer({ active: true, onEscape: () => false });
      return null;
    };
    render(
      <>
        <Decliner />
        <ShellEscapeMenu enabled entries={ENTRIES} pathname="/" onNavigate={vi.fn()} />
      </>,
    );
    await settle();

    await pressEscape();
    expect(menuDialog()).not.toBeNull();
  });

  it('two stacked dialogs: one Escape closes only the topmost', async () => {
    const Top = () => {
      const [open, setOpen] = useState(true);
      return open ? <BaseModal isOpen title="内层" onClose={() => setOpen(false)}>inner</BaseModal> : null;
    };
    render(
      <>
        <BaseModal isOpen title="外层" onClose={vi.fn()}>outer</BaseModal>
        <Top />
      </>,
    );
    await settle();

    await pressEscape();
    // 内层关闭、外层仍在：一次 Escape 恰好一层。
    expect(document.body.textContent).not.toContain('inner');
    expect(document.body.textContent).toContain('外层');
  });
});
