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
    // 一个——DESK-PROD-004 要求本地启动不自动发起项目请求，而"布局一样"并不证明离线启动已达成。
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
});
