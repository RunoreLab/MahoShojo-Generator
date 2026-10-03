// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { slugifyHeading } from '../src/markdown/text/index';
import {
  ALL_CATEGORY,
  encyclopediaContentUrl,
  encyclopediaEntries,
  getEncyclopediaEntry,
  parseEncyclopediaFilter,
  serializeEncyclopediaFilter,
  type EncyclopediaContentSource,
} from '../src/encyclopedia/index';
import {
  EncyclopediaEntryView,
  EncyclopediaIndexView,
  EncyclopediaLinks,
} from '../src/encyclopedia/views/index';

let container: HTMLDivElement;
let root: Root;

const CONTENT_SOURCE: EncyclopediaContentSource = { baseUrl: '/' };

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  vi.stubGlobal('fetch', vi.fn(async () => new Response('# 标题\n\n正文内容。', { status: 200 })));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const render = (node: ReactNode): void => {
  act(() => root.render(node));
};

/**
 * 让 `useEncyclopediaContent` 的 fetch 落地，并把 `useHashScrollTarget` 里的
 * `requestAnimationFrame` 同步跑完。
 *
 * 滚动被刻意放进 rAF：正文交给 React 渲染与 effect 之间的时序在两个宿主并不相同，等一帧是唯一不依赖
 * 具体调度细节的做法。它同时意味着测试必须真的等一帧，而不是 `await Promise.resolve()`。
 */
const flush = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve();
  });
  await act(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
};

describe('encyclopedia filter round-trip', () => {
  it('ignores unknown categories instead of rendering a broken filter', () => {
    expect(parseEncyclopediaFilter('c=not-a-category&q=x')).toEqual({ query: 'x', categoryId: ALL_CATEGORY });
    expect(parseEncyclopediaFilter('c=ai')).toEqual({ query: '', categoryId: 'ai' });
    expect(parseEncyclopediaFilter(null)).toEqual({ query: '', categoryId: ALL_CATEGORY });
  });

  it('serializes an empty filter to an empty query string', () => {
    // 空串让宿主能渲染干净的路径，而不是留下一个悬空的 `?`。
    expect(serializeEncyclopediaFilter({ query: '  ', categoryId: ALL_CATEGORY })).toBe('');
    expect(serializeEncyclopediaFilter({ query: ' x ', categoryId: 'ai' })).toBe('c=ai&q=x');
  });
});

describe('EncyclopediaIndexView', () => {
  const renderIndex = (props: Record<string, unknown> = {}) => {
    render(<EncyclopediaIndexView onNavigate={() => {}} {...props} />);
  };

  it('lists every catalog entry on the unfiltered index', () => {
    renderIndex();
    const anchors = [...container.querySelectorAll('a[href^="/encyclopedia/"]')];
    const slugs = new Set(anchors.map((anchor) => anchor.getAttribute('href')?.replace('/encyclopedia/', '')));
    for (const entry of encyclopediaEntries) {
      expect(slugs.has(entry.slug), `目录缺少 ${entry.slug}`).toBe(true);
    }
  });

  it('filters by keyword across title, summary and keywords', () => {
    // `429` 与 `限流` 落在两条不同分类的条目上，用它们确认检索同时命中标题与关键词。
    renderIndex({ initialQuery: '限流' });
    expect(container.textContent).toContain('429 Too Many Requests');
    expect(container.textContent).toContain('立绘渠道鉴权');
    expect(container.textContent).not.toContain('站内功能速览');
  });

  it('filters by category and reports the matched count', () => {
    renderIndex({ initialCategoryId: 'ai' });
    expect(container.textContent).toContain('AI 生成失败');
    expect(container.textContent).not.toContain('站内功能速览');
  });

  it('explains an empty result instead of rendering a blank page', () => {
    renderIndex({ initialQuery: '不存在的关键词' });
    expect(container.textContent).toContain('没有找到匹配条目');
  });

  it('routes entry clicks through the host handler', () => {
    const onNavigate = vi.fn();
    renderIndex({ onNavigate });
    const first = container.querySelector<HTMLAnchorElement>('a[href^="/encyclopedia/"]');
    act(() => {
      first!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(onNavigate).toHaveBeenCalledWith(first!.getAttribute('href'));
  });

  it('writes the filter back to the URL only when a path is provided', () => {
    const onNavigate = vi.fn();
    render(<EncyclopediaIndexView onNavigate={onNavigate} path="/encyclopedia" initialCategoryId="ai" />);

    const reset = [...container.querySelectorAll('button')].find((button) => button.textContent === '重置筛选');
    act(() => {
      reset!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    // 筛选状态要变成可分享的 URL，否则用户没法把「只看某一类」发给同事。
    expect(onNavigate).toHaveBeenCalledWith('/encyclopedia');
  });
});

describe('EncyclopediaLinks', () => {
  it('renders known entries and drops unknown slugs', () => {
    render(
      <EncyclopediaLinks
        items={[
          { slug: 'site-guide' },
          { slug: 'no-such-entry' },
          { slug: 'glossary', text: '自定义文案' },
        ]}
        onNavigate={() => {}}
      />,
    );

    const hrefs = [...container.querySelectorAll('a')].map((anchor) => anchor.getAttribute('href'));
    expect(hrefs).toEqual(['/encyclopedia/site-guide', '/encyclopedia/glossary']);
    expect(container.textContent).toContain('自定义文案');
  });

  it('renders nothing when every slug is unknown', () => {
    // 全部无效时留一个空容器，比渲染一排死链好。
    render(<EncyclopediaLinks items={[{ slug: 'no-such-entry' }]} onNavigate={() => {}} />);
    expect(container.innerHTML).toBe('');
  });
});

describe('EncyclopediaEntryView', () => {
  const renderEntry = (props: Record<string, unknown> = {}) => {
    render(
      <EncyclopediaEntryView slug="site-guide" contentSource={CONTENT_SOURCE} onNavigate={() => {}} {...props} />,
    );
  };

  it('shows the page title and reads the body from the injected content source', async () => {
    renderEntry();
    await flush();

    expect(container.querySelector('h1')?.textContent).toBe(getEncyclopediaEntry('site-guide')?.title);
    expect(container.textContent).toContain('正文内容。');
    expect(fetch).toHaveBeenCalledWith(encyclopediaContentUrl(CONTENT_SOURCE, 'site-guide.md'));
  });

  it('reports a missing entry without pretending the page is empty content', async () => {
    renderEntry({ slug: 'no-such-entry' });
    await flush();
    expect(container.textContent).toContain('该百科条目不存在');
  });

  it('reports a fetch failure instead of rendering an empty article', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 404 })));
    renderEntry();
    await flush();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('404');
  });

  it('gives the page heading the slug of the title it strips from the body', async () => {
    // 正文首个 H1 与目录标题相同时会被剥掉，因此那条标题的锚点只能存在于外层 <h1> 上。
    // deep link 指向文章标题本身时必须仍然有效——锚点是 slug，不是标题原文。
    renderEntry();
    await flush();

    const title = getEncyclopediaEntry('site-guide')?.title ?? '';
    expect(container.querySelector('h1')?.id).toBe(slugifyHeading(title));
    expect(container.textContent).not.toContain('# 标题');
  });

  it('keeps a body heading that intentionally differs from the page title', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('# 另一个标题\n\n正文内容。', { status: 200 })),
    );
    renderEntry();
    await flush();

    // 不剥：那条标题是正文自己的，剥掉会丢掉内容。
    expect(container.textContent).toContain('另一个标题');
  });

  it('writes heading ids into the rendered body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('# 标题\n\n## 角色生成\n\n正文。', { status: 200 })));
    renderEntry();
    await flush();
    expect(container.querySelector('#角色生成')).not.toBeNull();
  });

  it('scrolls to a CJK fragment once the body has arrived', async () => {
    // 用真实渲染出来的 heading 作为目标：fragment 解码、getElementById 与 offset 计算
    // 全部走真实路径，而不是注入假的取节点实现。
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('# 标题\n\n## 角色生成\n\n正文。', { status: 200 })),
    );
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});

    renderEntry({ hash: '#%E8%A7%92%E8%89%B2%E7%94%9F%E6%88%90' });
    await flush();

    expect(container.querySelector('#角色生成')).not.toBeNull();
    expect(scrollTo).toHaveBeenCalledTimes(1);
  });

  it('does not scroll when the fragment matches nothing', async () => {
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    renderEntry({ hash: '#%E4%B8%8D%E5%AD%98%E5%9C%A8' });
    await flush();

    // 指向不存在节点的链接是"没跳过去"，抛错才是白屏。
    expect(scrollTo).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('does not scroll before the body is ready', async () => {
    let resolveFetch: ((response: Response) => void) | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolveFetch = resolve;
          }),
      ),
    );
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});

    renderEntry({ hash: '#角色生成' });
    await flush();
    // 正文是异步取回的：首帧时目标 heading 还不存在，滚动必须等它到达。
    expect(container.querySelector('[role="status"]')).not.toBeNull();
    expect(scrollTo).not.toHaveBeenCalled();

    await act(async () => {
      resolveFetch?.(new Response('# 标题\n\n## 角色生成\n\n正文。', { status: 200 }));
      await Promise.resolve();
    });
    await flush();
    expect(scrollTo).toHaveBeenCalledTimes(1);
  });

  it('ignores a fragment that matches no element instead of throwing', async () => {
    renderEntry({ hash: '#不存在的锚点' });
    await flush();
    expect(container.textContent).toContain(getEncyclopediaEntry('site-guide')?.title);
  });
});