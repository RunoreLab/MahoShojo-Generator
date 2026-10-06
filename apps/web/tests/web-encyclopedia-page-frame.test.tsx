// @vitest-environment jsdom
/**
 * Web 百科的页面骨架与导航语义门禁。
 *
 * `app-router-low-risk-pages` 把 `WebEncyclopediaIndex` / `WebEncyclopediaEntry` 整体 mock 掉，
 * `ui-web` 的视图测试又不看宿主接线——「页面骨架还在不在」与「宿主导航回调语义对不对」在两层之间
 * 曾是盲区（共源抽取删掉白卡骨架、把全部导航统一成 `scroll:false` 时没有任何测试报警）。
 * 这里渲染真实的 Web 包装组件，断言 `frame → 限宽容器 → 白卡 → view` 层次与宿主注入的文案。
 */
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { EncyclopediaNavigate } from '@mahoshojo/ui-web/encyclopedia-views';

const routerPush = vi.fn();
const routerReplace = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush, replace: routerReplace }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('next/link', () => ({
  default: function LinkMock({
    children,
    href,
    ...props
  }: {
    children?: ReactNode;
    href: string;
    [key: string]: unknown;
  }) {
    return (
      <a href={href} {...props}>
        {children}
      </a>
    );
  },
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('fetch', vi.fn(async () => new Response('# 标题\n\n正文。', { status: 200 })));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('Web encyclopedia page frame', () => {
  it('renders the shared frame around the index and injects the web subtitle', async () => {
    const { WebEncyclopediaIndex } = await import('@/components/encyclopedia/WebEncyclopediaViews');
    await act(async () => root.render(<WebEncyclopediaIndex />));

    const frame = container.querySelector('[data-testid="encyclopedia-page-frame"]');
    expect(frame?.classList.contains('magic-background-white')).toBe(true);
    expect(frame?.querySelector('.max-w-6xl [data-testid="encyclopedia-page-card"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="encyclopedia-index"]')).not.toBeNull();
    // Web 宿主文案：条目数与投稿入口是站内事实；「随应用离线可用」是 Desktop 事实，不得泄漏。
    expect(container.textContent).toContain('篇条目');
    expect(container.textContent).toContain('欢迎提交 PR');
    expect(container.textContent).not.toContain('离线');
  });

  it('renders the shared frame around the entry', async () => {
    const { WebEncyclopediaEntry } = await import('@/components/encyclopedia/WebEncyclopediaEntry');
    await act(async () => root.render(<WebEncyclopediaEntry slug="site-guide" />));

    const frame = container.querySelector('[data-testid="encyclopedia-page-frame"]');
    expect(frame?.classList.contains('magic-background-white')).toBe(true);
    expect(container.querySelector('[data-testid="encyclopedia-entry"]')).not.toBeNull();
  });
});

describe('useWebEncyclopediaNavigate', () => {
  const mountNavigate = async () => {
    const { useWebEncyclopediaNavigate } = await import('@/components/encyclopedia/WebEncyclopediaViews');
    let navigate: EncyclopediaNavigate | undefined;
    const Probe = () => {
      navigate = useWebEncyclopediaNavigate();
      return null;
    };
    await act(async () => root.render(<Probe />));
    return navigate!;
  };

  it('scrolls to the top on real page navigation', async () => {
    const navigate = await mountNavigate();
    navigate('/encyclopedia/site-guide');
    // 单参数调用：不携 `scroll:false`，让 Next 默认语义生效——回到页面顶部。
    expect(routerPush).toHaveBeenCalledWith('/encyclopedia/site-guide');
  });

  it('keeps filter write-backs on replace + preserveScroll', async () => {
    const navigate = await mountNavigate();
    navigate('/encyclopedia?q=x', { replace: true, preserveScroll: true });
    expect(routerReplace).toHaveBeenCalledWith('/encyclopedia?q=x', { scroll: false });
    expect(routerPush).not.toHaveBeenCalled();
  });
});
