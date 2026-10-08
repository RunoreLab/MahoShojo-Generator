// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AVAILABLE, unavailable, type CapabilitySnapshot } from '../src/capability/index';
import { encyclopediaEntries } from '../src/encyclopedia/index';
import {
  HOME_FEATURE_CATEGORIES,
  HOME_RECOMMENDED_ENTRIES,
  HomeEncyclopediaCard,
  HomeFeatureGrid,
  HomeHero,
  HomePageView,
  HomeAccountWelcome,
  getHomeFeatureAssets,
  homeAssetUrl,
  type HomeAssetSource,
  type HomeFeatureCategory,
} from '../src/home/index';


const TEST_CATEGORIES: readonly HomeFeatureCategory[] = [
  { id: 'generation', title: '内容生成', columns: 2, features: [
    { id: 'form', href: '/details', assetFile: 'form.svg', width: 100, height: 50, alt: '问卷' },
    { id: 'name', href: '/name', assetFile: 'name.svg', width: 100, height: 50, alt: '名称' },
  ] },
  { id: 'library', title: '内容管理', columns: 1, features: [
    { id: 'library', href: '/library', assetFile: 'library.svg', width: 100, height: 50, alt: '本地库' },
  ] },
];

let container: HTMLDivElement;
let root: Root;

const ASSET_SOURCE: HomeAssetSource = { baseUrl: '/' };

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

/** 全部入口可用的快照，模拟 Web。 */
const allAvailable = (): CapabilitySnapshot =>
  Object.fromEntries(TEST_CATEGORIES.flatMap((c) => c.features.map((f) => [f.href, AVAILABLE])));

describe('home asset addressing', () => {
  it('keeps the base injectable and the asset path relative to it', () => {
    expect(homeAssetUrl({ baseUrl: '/' }, 'logo.svg')).toBe('/logo.svg');
    expect(homeAssetUrl({ baseUrl: '/app/' }, 'logo.svg')).toBe('/app/logo.svg');
  });

  it('never emits a double slash after the origin', () => {
    // 协议自带的 `//` 不算；要看的是 base 与文件名之间有没有多出一个斜杠。
    for (const baseUrl of ['/', '/app/', 'https://example.invalid/sub/']) {
      for (const category of TEST_CATEGORIES) {
        for (const feature of category.features) {
          const url = homeAssetUrl({ baseUrl }, feature.assetFile);
          expect(url.slice(url.indexOf('//') + 2), `${baseUrl} + ${feature.assetFile}`).not.toContain('//');
        }
      }
    }
  });
});

describe('HomeHero', () => {
  it('renders both logo variants from the injected asset source', () => {
    render(<HomeHero assetSource={ASSET_SOURCE} />);
    expect(container.querySelector('[data-testid="home-logo-light"]')?.getAttribute('src')).toBe('/logo.svg');
    expect(container.querySelector('[data-testid="home-logo-dark"]')?.getAttribute('src')).toBe('/logo-white.svg');
  });
});

describe('HomeEncyclopediaCard', () => {
  it('opens the encyclopedia index and routes the click through the host', () => {
    const onNavigate = vi.fn();
    render(<HomeEncyclopediaCard assetSource={ASSET_SOURCE} onNavigate={onNavigate} />);

    const anchor = container.querySelector<HTMLAnchorElement>('a[href="/encyclopedia"]');
    expect(anchor).not.toBeNull();
    expect(container.querySelector('img')?.getAttribute('src')).toBe('/encyclopedia.svg');

    act(() => {
      anchor!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(onNavigate).toHaveBeenCalledWith('/encyclopedia');
  });

  it('drops unknown slugs from the recommendation row', () => {
    render(
      <HomeEncyclopediaCard
        assetSource={ASSET_SOURCE}
        onNavigate={() => {}}
        recommended={[{ slug: 'site-guide' }, { slug: 'no-such-entry' }]}
      />,
    );
    const hrefs = [...container.querySelectorAll('a[href^="/encyclopedia/"]')].map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(['/encyclopedia/site-guide']);
  });
});

describe('HomeFeatureGrid', () => {
  const renderGrid = (capabilities: CapabilitySnapshot, props: Record<string, unknown> = {}) => {
    render(
      <HomeFeatureGrid categories={TEST_CATEGORIES} assetSource={ASSET_SOURCE} capabilities={capabilities} onNavigate={() => {}} {...props} />,
    );
  };

  it('renders every category and entry when everything is available', () => {
    renderGrid(allAvailable());
    for (const category of TEST_CATEGORIES) {
      expect(container.textContent, `缺少分组 ${category.title}`).toContain(category.title);
    }
    const tiles = container.querySelectorAll('a.feature-button');
    expect(tiles).toHaveLength(getHomeFeatureAssets(TEST_CATEGORIES.flatMap((c) => [...c.features])).length);
  });

  it('hides unavailable entries by default instead of greying out a roadmap', () => {
    renderGrid({ '/encyclopedia': AVAILABLE });
    expect(container.querySelectorAll('a.feature-button')).toHaveLength(0);
    expect(container.querySelector('[data-testid="home-feature-grid"]')?.textContent).toBe('');
  });

  it('explains unavailable entries when the host asks for it', () => {
    renderGrid(
      { '/name': AVAILABLE, '/details': unavailable('not-implemented', '该页面尚未在 Desktop 交付') },
      { unavailable: 'explain' },
    );

    expect(container.querySelectorAll('a.feature-button')).toHaveLength(1);
    const disabled = container.querySelector('[aria-disabled="true"]');
    expect(disabled?.getAttribute('title')).toBe('该页面尚未在 Desktop 交付');
  });

  it('treats an undeclared entry as unavailable rather than available', () => {
    // 缺键必须按 unknown 处理：新增一个忘记注入的入口若默认可点，就是一个点了没反应的死链。
    renderGrid({}, { unavailable: 'explain' });
    expect(container.querySelectorAll('a.feature-button')).toHaveLength(0);
    expect(container.querySelector('[aria-disabled="true"]')?.getAttribute('title')).toContain('未声明');
  });

  it('never renders an unavailable entry as a clickable link', () => {
    const hrefs = [
      ...TEST_CATEGORIES.flatMap((c) => c.features.map((f) => f.href)),
    ];
    for (const href of hrefs) {
      renderGrid({ [href]: unavailable('not-implemented') }, { unavailable: 'explain' });
      const anchors = [...container.querySelectorAll('a.feature-button')];
      expect(anchors.map((a) => a.getAttribute('href'))).not.toContain(href);
      act(() => root.unmount());
      root = createRoot(container);
    }
  });

  it('routes a click on an available entry through the host', () => {
    const onNavigate = vi.fn();
    renderGrid({ '/name': AVAILABLE }, { onNavigate });

    const anchor = container.querySelector<HTMLAnchorElement>('a.feature-button');
    act(() => {
      anchor!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(onNavigate).toHaveBeenCalledWith('/name');
  });

  it('drops a category whose entries are all unavailable', () => {
    // 留一个只有标题的空分组，用户会以为点错了。
    renderGrid({ '/name': AVAILABLE }, { unavailable: 'hide' });
    const titles = [...container.querySelectorAll('h2')].map((h) => h.textContent);
    expect(titles).toHaveLength(1);
    expect(titles[0]).toContain('内容生成');
  });
});

describe('HOME_FEATURE_CATEGORIES', () => {
  // 目录是产品事实的唯一定义处：结构缺陷（重复 id、站外产品路径、缺渐变 class）会让两个
  // 宿主同时出错，因此在这里断言形状而不是靠生成脚本兜底。
  it('keeps unique feature ids and internal product hrefs', () => {
    const ids = HOME_FEATURE_CATEGORIES.flatMap((category) => category.features.map((f) => f.id));
    expect(new Set(ids).size).toBe(ids.length);
    for (const category of HOME_FEATURE_CATEGORIES) {
      for (const feature of category.features) {
        expect(feature.href.startsWith('/')).toBe(true);
        expect(feature.assetFile.length).toBeGreaterThan(0);
        expect(feature.className).toBeTruthy();
      }
    }
  });

  it('keeps every recommended slug inside the encyclopedia catalog', () => {
    // 推荐位是固定产品选位；指向不存在的 slug 会被渲染层静默丢掉，等于推荐位悄悄失效。
    const known = new Set(encyclopediaEntries.map((entry) => entry.slug));
    for (const entry of HOME_RECOMMENDED_ENTRIES) {
      expect(known.has(entry.slug)).toBe(true);
    }
  });
});


describe('HomePageView', () => {
  it('keeps the Web layout and places platform notes after the common product sections', () => {
    const navigate = vi.fn();
    render(<HomePageView
      assetSource={ASSET_SOURCE}
      capabilities={{ '/details': AVAILABLE, '/encyclopedia': AVAILABLE }}
      onNavigate={navigate}
      resolveInternalHref={(href) => `#${href}`}
      account={<div data-testid="account-slot">账号欢迎</div>}
      platformNotice="平台说明"
      platformTools={<button>本机工具</button>}
      footer={<footer>页脚</footer>}
    />);
    const card = container.querySelector('.container > .card')!;
    expect(card.className).toBe('card');
    expect(card.querySelector('[data-testid="home-logo-light"]')).not.toBeNull();
    expect(card.querySelector('[data-testid="account-slot"]')).not.toBeNull();
    const grid = card.querySelector('[data-testid="home-feature-grid"]')!;
    expect(grid.parentElement?.className).toBe('mt-4');
    expect(card.textContent!.indexOf('平台说明')).toBeGreaterThan(card.textContent!.indexOf('设定来源'));
    expect(card.textContent!.indexOf('本机工具')).toBeGreaterThan(card.textContent!.indexOf('平台说明'));
    expect(container.querySelector('.container > footer')?.textContent).toBe('页脚');
    const link = card.querySelector<HTMLAnchorElement>('a[href="#/details"]')!;
    act(() => link.click());
    expect(navigate).toHaveBeenCalledWith('/details');
    expect(card.querySelector('a[href="#/battle"]')).toBeNull();
  });
});


it.each(['/character-manager', '/me', '/encyclopedia', '/details'])('preserves native modified clicks for home link %s', (href) => {
  const navigate = vi.fn();
  render(<HomePageView
    assetSource={ASSET_SOURCE}
    capabilities={{ '/details': AVAILABLE }}
    onNavigate={navigate}
    account={<HomeAccountWelcome state="signed-in" name="用户" primaryHref="/character-manager" secondaryLinks={[{ href: '/me', label: '个人页' }]} onNavigate={navigate} />}
  />);
  const link = container.querySelector<HTMLAnchorElement>(`a[href="${href}"]`)!;
  for (const options of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, ...options });
    act(() => { link.dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  }
  const cancelled = new MouseEvent('click', { bubbles: true, cancelable: true });
  cancelled.preventDefault();
  act(() => { link.dispatchEvent(cancelled); });
  expect(navigate).not.toHaveBeenCalled();
  const ordinary = new MouseEvent('click', { bubbles: true, cancelable: true });
  act(() => { link.dispatchEvent(ordinary); });
  expect(ordinary.defaultPrevented).toBe(true);
  expect(navigate).toHaveBeenCalledExactlyOnceWith(href);
});
