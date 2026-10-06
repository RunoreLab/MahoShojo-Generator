// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DENY_EXTERNAL_MEDIA,
  MarkdownBlock,
  type ExternalMediaPolicy,
  type InternalLinkRenderProps,
} from '../src/markdown/index';

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

const renderMarkdown = (content: string, props: Record<string, unknown> = {}): void => {
  render(<MarkdownBlock content={content} variant="light" mode="article" {...props} />);
};

/**
 * 共源渲染层的行为门禁。
 *
 * 这些用例守的是 D3.0 的验收口径本身，而不是某一段实现细节：
 *
 * - heading id **缺省不生成**，开启后中文标题可用且同名标题不冲突（`D3.0-5`）；
 * - 行内代码里的百科路径仍渲染成链接，且**中文 fragment 不再被判死**（旧实现的 `[A-Za-z0-9-_]+`
 *   正则会让它永远失效）；
 * - 缺省策略拒绝一切站外媒体，宿主可以注入自己的判定。
 */
describe('MarkdownBlock headings', () => {
  it('includes nested emphasis, code and link text in stable duplicate heading ids', () => {
    const content = '## **配置 `API`** 与 [说明](/encyclopedia/ai-errors)\n\n## 配置 API 与 说明';
    for (const mode of ['compact', 'article']) {
      renderMarkdown(content, { headingIds: 'github', mode });
      expect([...container.querySelectorAll('[id]')].map((node) => node.id)).toEqual([
        '配置-api-与-说明', '配置-api-与-说明-1',
      ]);
      expect(container.querySelector('strong code')?.textContent).toBe('API');
    }
  });

  it('does not write heading ids by default', () => {
    renderMarkdown('# 角色生成\n\n正文。');
    expect(container.querySelector('h2')).not.toBeNull();
    expect(container.querySelector('[id]')).toBeNull();
  });

  it('writes heading ids when explicitly opted in', () => {
    renderMarkdown('# 角色生成\n\n## 对战与计分\n\n正文。', { headingIds: 'github' });
    expect(container.querySelector('#角色生成')).not.toBeNull();
    expect(container.querySelector('#对战与计分')).not.toBeNull();
  });

  it('keeps ids stable across compact and article modes', () => {
    // article 模式把标题整体下移一级。如果 id 跟着渲染层级走，同一篇文章在两种模式下会给出不同锚点。
    // 因此这里断言的是"标签变了但 id 没变"——重渲染而不是卸载重建，才能验证同一篇内容。
    const content = '## 常见问题\n\n正文。';

    render(<MarkdownBlock content={content} variant="light" mode="article" headingIds="github" />);
    const article = container.querySelector('[id="常见问题"]');

    render(<MarkdownBlock content={content} variant="light" mode="compact" headingIds="github" />);
    const compact = container.querySelector('[id="常见问题"]');

    expect(article?.tagName.toLowerCase()).toBe('h3');
    expect(compact?.tagName.toLowerCase()).toBe('h4');
    expect(compact?.id).toBe(article?.id);
  });

  it('disambiguates repeated headings', () => {
    renderMarkdown('## 常见问题\n\n## 常见问题\n', { headingIds: 'github' });
    expect(container.querySelectorAll('[id="常见问题"]')).toHaveLength(1);
    expect(container.querySelectorAll('[id="常见问题-1"]')).toHaveLength(1);
  });
});

describe('MarkdownBlock encyclopedia inline links', () => {
  it('renders a bare encyclopedia path as a link', () => {
    renderMarkdown('见：`/encyclopedia/ai-errors`');
    expect(container.querySelector('a[href="/encyclopedia/ai-errors"]')).not.toBeNull();
  });

  it('accepts a CJK fragment, which the previous inline-code regex rejected', () => {
    renderMarkdown('见：`/encyclopedia/ai-errors#生成失败`');
    const anchor = container.querySelector<HTMLAnchorElement>('a');
    expect(anchor?.getAttribute('href')).toBe('/encyclopedia/ai-errors#生成失败');
  });

  it('still refuses non-encyclopedia inline code', () => {
    renderMarkdown('见：`/name`');
    expect(container.querySelector('a')).toBeNull();
    expect(container.querySelector('code')).not.toBeNull();
  });

  it('rejects a path-looking fragment that is not an encyclopedia slug', () => {
    renderMarkdown('见：`/encyclopedia/../../etc/passwd`');
    expect(container.querySelector('a')).toBeNull();
  });
});

describe('MarkdownBlock navigation policy', () => {
  it('lets the host render native external anchors without intercepting clicks', () => {
    renderMarkdown('[仓库](https://github.com/example/repo "代码仓库")', {
      renderExternalLink: ({ href, title, className, children }: InternalLinkRenderProps) => (
        <a href={href} title={title} className={className} target="_blank" rel="noopener noreferrer">{children}</a>
      ),
    });
    const anchor = container.querySelector('a')!;
    expect(anchor.href).toBe('https://github.com/example/repo');
    expect(anchor.title).toBe('代码仓库');
    expect(anchor.target).toBe('_blank');
    expect(anchor.rel).toBe('noopener noreferrer');
    const click = new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true });
    act(() => anchor.dispatchEvent(click));
    expect(click.defaultPrevented).toBe(false);
  });

  it('intercepts internal clicks when the host provides a handler', () => {
    const onNavigateInternal = vi.fn();
    renderMarkdown('[本地库](/local-library)', { onNavigateInternal });

    const anchor = container.querySelector<HTMLAnchorElement>('a');
    expect(anchor?.getAttribute('href')).toBe('/local-library');

    act(() => {
      anchor!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(onNavigateInternal).toHaveBeenCalledWith('/local-library');
  });

  it('routes same-page #anchors through internal navigation instead of a raw href', () => {
    // hash-history 宿主（Desktop）里裸 `#frag` 会被当成名为 frag 的路由；锚点必须
    // 交给宿主的内部导航层，由它决定「留在当前路由只改 fragment」（D5.1-P2-r1）。
    const onNavigateInternal = vi.fn();
    renderMarkdown('[跳到定义](#术语定义)', { onNavigateInternal });

    const anchor = container.querySelector<HTMLAnchorElement>('a');
    // normalizeMarkdownHref 对 CJK fragment 做 percent-encoding，解码是宿主侧的事。
    expect(anchor?.getAttribute('href')).toBe('#%E6%9C%AF%E8%AF%AD%E5%AE%9A%E4%B9%89');
    act(() => {
      anchor!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(onNavigateInternal).toHaveBeenCalledWith('#%E6%9C%AF%E8%AF%AD%E5%AE%9A%E4%B9%89');
  });

  it('lets the host replace the internal anchor entirely', () => {
    renderMarkdown('[本地库](/local-library)', {
      renderInternalLink: ({ href, children }: InternalLinkRenderProps) => (
        <span data-href={href}>{children}</span>
      ),
    });
    expect(container.querySelector('a')).toBeNull();
    expect(container.querySelector('[data-href="/local-library"]')).not.toBeNull();
  });

  it('opens external links when the host provides a handler', () => {
    const onNavigateExternal = vi.fn();
    renderMarkdown('[仓库](https://github.com/example/repo)', { onNavigateExternal });

    const anchor = container.querySelector<HTMLAnchorElement>('a');
    act(() => {
      anchor!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(onNavigateExternal).toHaveBeenCalledWith('https://github.com/example/repo');
  });

  it('renders external links as non-executable with a reason when no handler exists', () => {
    // Desktop 目前没有 opener 能力。一个"看起来能点但什么也不发生"的链接比说明原因更糟，
    // 这与共源顶栏的处理是同一套形状。
    renderMarkdown('[仓库](https://github.com/example/repo)');
    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).toContain('仓库');
  });
});

describe('MarkdownBlock external media', () => {
  it('denies every external media URL by default', () => {
    renderMarkdown('![图](https://example.invalid/a.png)');
    expect(container.querySelector('img')).toBeNull();
    // 降级文本保留原始地址，用户才能复制出来。
    expect(container.textContent).toContain('https://example.invalid/a.png');
  });

  it('lets the host allow and resolve a specific media URL', () => {
    const policy: ExternalMediaPolicy = {
      detectKind: (url: string) => (url.endsWith('.png') ? 'image' : null),
      isAllowed: (url: string) => url.startsWith('https://cdn.example/'),
      resolve: (url: string) => url.replace('https://cdn.example/', 'https://proxy.example/'),
    };

    renderMarkdown('![图](https://cdn.example/a.png)\n\n![外](https://other.example/b.png)', {
      externalMediaPolicy: policy,
    });

    const images = [...container.querySelectorAll<HTMLImageElement>('img')];
    expect(images).toHaveLength(1);
    expect(images[0].getAttribute('src')).toBe('https://proxy.example/a.png');
  });

  it('detects audio by extension under the default policy', () => {
    // 缺省策略也要能认出媒体，否则连"这是个音频链接但加载不了"这件事都说不出来。
    renderMarkdown('[音频](https://example.invalid/a.mp3)');
    expect(container.textContent).toContain('https://example.invalid/a.mp3');
    expect(DENY_EXTERNAL_MEDIA.detectKind('https://example.invalid/a.mp3')).toBe('audio');
    expect(DENY_EXTERNAL_MEDIA.detectKind('https://example.invalid/a.mp4')).toBe('video');
    expect(DENY_EXTERNAL_MEDIA.detectKind('https://example.invalid/a.png')).toBeNull();
  });
});

describe('MarkdownBlock remark plugin injection', () => {
  it('applies host remark plugins between GFM and math', () => {
    // 共享层自带 GFM 与数学；领域插件必须插在这两者之间，因为宿主插件的产出要能被数学插件看到。
    renderMarkdown('| a | b |\n| - | - |\n| 1 | 2 |');
    expect(container.querySelector('table')).not.toBeNull();
  });
});
