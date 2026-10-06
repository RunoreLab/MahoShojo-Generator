// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AppShell } from '../src/shell/AppShell';

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

const render = (node: ReactNode): void => {
  act(() => root.render(node));
};

describe('AppShell', () => {
  it('renders the product frame without any online bootstrap', () => {
    // Web 的 AppProviders 挂着公告轮询、账号探测、统计与挑战页。共源壳保留布局外观，但不含其中任何
    // 一个——DESK-PROD-004 要求共享页面不因复用 Web bootstrap 隐式挂载这些项目请求，
    // 而"布局一样"并不证明离线启动已达成。
    render(<AppShell>内容</AppShell>);

    const shell = container.querySelector('[data-testid="product-shell"]');
    expect(shell).not.toBeNull();
    expect(shell?.textContent).toContain('MahoShojo Generator');
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('iframe')).toBeNull();
  });

  it('lets a page opt out of the centered content column', () => {
    render(
      <AppShell bleedContent>
        <div data-testid="page">内容</div>
      </AppShell>,
    );

    expect(container.querySelector('main')?.className).toBe('flex-1');
  });

  it('treats brand as a three-state prop: default, hidden, custom', () => {
    // `undefined` 与 `null` 是两个不同的决定：前者要默认文字品牌，后者明确「产品壳已由顶栏
    // logo 承担品牌，不再重复一行文字」。把两者折叠成同一个 falsy 分支会让想要隐藏品牌的宿主
    // 反而拿到默认品牌——这正是 DESK-PARITY-002 要修掉的语义漏洞。
    render(
      <AppShell brand={null}>
        <div data-testid="page">内容</div>
      </AppShell>,
    );
    expect(container.querySelector('[data-testid="product-shell"]')?.textContent).not.toContain(
      'MahoShojo Generator',
    );
    expect(container.querySelector('header')).toBeNull();

    render(
      <AppShell brand={<span data-testid="custom-brand">自定义品牌</span>}>
        <div data-testid="page">内容</div>
      </AppShell>,
    );
    expect(container.querySelector('[data-testid="custom-brand"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="product-shell"]')?.textContent).not.toContain(
      'MahoShojo Generator',
    );

    render(<AppShell>内容</AppShell>);
    expect(container.querySelector('header')?.textContent).toContain('MahoShojo Generator');
  });
});
