// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AVAILABLE, unavailable, type CapabilitySnapshot } from '../src/capability/index';
import { AppShell } from '../src/shell/AppShell';
import { ProductNav } from '../src/shell/ProductNav';

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

type NavProps = Parameters<typeof ProductNav>[0];

/** 渲染整棵导航，供断言点击、禁用与文案。 */
const renderNav = (capabilities: CapabilitySnapshot, overrides: Partial<NavProps> = {}): void => {
  render(
    <ProductNav pathname="/" capabilities={capabilities} onNavigate={() => {}} {...overrides} />,
  );
};

const entryFor = (href: string): HTMLElement | null =>
  container.querySelector<HTMLElement>(`[data-testid="nav-entry-${href}"]`);
const disabledEntryFor = (href: string): HTMLElement | null =>
  container.querySelector<HTMLElement>(`[data-testid="nav-entry-disabled-${href}"]`);

describe('ProductNav', () => {
  it('renders only available entries by default', () => {
    renderNav({
      '/local-library': AVAILABLE,
      '/ranking': unavailable('requires-sign-in'),
    });

    expect(entryFor('/local-library')).not.toBeNull();
    // 默认 hide：一个把 18 个入口里 15 个标灰的导航不是导航。
    expect(entryFor('/ranking')).toBeNull();
    expect(disabledEntryFor('/ranking')).toBeNull();
  });

  it('never renders an unavailable entry as a clickable link', () => {
    // DESK-PROD-001：MUST NOT 保留可点击但失效的内部链接。
    renderNav({ '/ranking': unavailable('requires-sign-in') }, { unavailable: 'explain' });

    const entry = disabledEntryFor('/ranking');
    expect(entry).not.toBeNull();
    expect(entry?.tagName).not.toBe('A');
    expect(entry?.getAttribute('aria-disabled')).toBe('true');
    expect(entry?.textContent).toBe('排行榜');
    expect(container.querySelector('a[href="/ranking"]')).toBeNull();
  });

  it('states a concrete reason instead of a generic disabled state', () => {
    renderNav({ '/ranking': unavailable('requires-sign-in') }, { unavailable: 'explain' });

    expect(disabledEntryFor('/ranking')?.getAttribute('title')).toBe('需要登录后使用');
  });

  it('prefers the host-provided detail over the generic reason text', () => {
    renderNav(
      { '/ranking': unavailable('not-configured', '请先在设置里配置 AI Provider') },
      { unavailable: 'explain' },
    );

    expect(disabledEntryFor('/ranking')?.getAttribute('title')).toBe('请先在设置里配置 AI Provider');
  });

  it('surfaces an undeclared capability as unknown rather than assuming it works', () => {
    renderNav({}, { unavailable: 'explain' });

    // 缺键必须是"未声明"，而且不可点击。把缺键当 available 会让任何忘记注入的新入口默认可点。
    expect(disabledEntryFor('/ranking')?.getAttribute('title')).toBe('当前运行时未声明此入口的可用状态');
  });

  it('refuses external entries when the host provides no way to open them', () => {
    // 打开站外站点需要宿主能力（Tauri 侧要新增 native command）。没有处理器时渲染成禁用并说明原因，
    // 比渲染一个点了没反应的链接更诚实。
    const externalHref = 'https://wantu-waystation.pages.dev/';

    renderNav({ [externalHref]: AVAILABLE });
    expect(container.querySelector(`a[href="${externalHref}"]`)).toBeNull();
    expect(disabledEntryFor(externalHref)?.getAttribute('title')).toContain('系统浏览器');

    renderNav({ [externalHref]: AVAILABLE }, { onNavigateExternal: () => {} });
    expect(container.querySelector(`a[href="${externalHref}"]`)).not.toBeNull();
  });

  it('routes internal clicks to the host handler instead of navigating on its own', () => {
    // 共享导航只提供 <a href>，由宿主接自己的 router。这是"共享导航不锁定底层 router"的具体形态。
    const onNavigate = vi.fn((_href: string, event: React.MouseEvent<HTMLAnchorElement>) => {
      event.preventDefault();
    });
    renderNav({ '/local-library': AVAILABLE }, { onNavigate });

    const link = entryFor('/local-library');
    expect(link?.getAttribute('href')).toBe('/local-library');

    act(() => {
      link?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });

    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate.mock.calls[0]?.[0]).toBe('/local-library');
  });

  it('marks the active entry after normalizing the incoming pathname', () => {
    render(
      <ProductNav
        pathname="/local-library?from=nav"
        capabilities={{ '/local-library': AVAILABLE }}
        onNavigate={() => {}}
      />,
    );

    expect(entryFor('/local-library')?.getAttribute('aria-current')).toBe('page');
  });

  it('can narrow rendering to selected groups', () => {
    renderNav({ '/local-library': AVAILABLE, '/ranking': AVAILABLE }, { groupIds: ['character'] });

    expect(entryFor('/local-library')).not.toBeNull();
    expect(entryFor('/ranking')).toBeNull();
  });
});

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
