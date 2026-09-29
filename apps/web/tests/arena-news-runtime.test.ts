// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const source = readFileSync(resolve(process.cwd(), '../../packages/web-package/presets/arena-news/scripts/news.js'), 'utf8');
const runtimeWindow = window as typeof window & { ArenaNews?: { mount(root?: Document | Element): void } };
const spyDocumentListeners = () => vi.spyOn(document, 'addEventListener');
let documentListeners: ReturnType<typeof spyDocumentListeners>;
const spyWindowListeners = () => vi.spyOn(window, 'addEventListener');
let windowListeners: ReturnType<typeof spyWindowListeners>;

function mount(html: string) {
  document.body.innerHTML = `${html}<p data-news-status></p>`;
  window.eval(source);
  runtimeWindow.ArenaNews!.mount();
}
function get<T extends Element = HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing test element: ${selector}`);
  return element;
}
function click(selector: string) { get<HTMLElement>(selector).click(); }
function submit(selector: string) {
  return get<HTMLFormElement>(selector).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}
function navigate(hash: string) {
  history.replaceState(null, '', hash);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

beforeEach(() => {
  history.replaceState(null, '', '/');
  delete runtimeWindow.ArenaNews;
  documentListeners = spyDocumentListeners();
  windowListeners = spyWindowListeners();
});
afterEach(() => {
  for (const [type, listener, options] of documentListeners.mock.calls) document.removeEventListener(type, listener, options);
  for (const [type, listener, options] of windowListeners.mock.calls) window.removeEventListener(type, listener, options);
  documentListeners.mockRestore();
  windowListeners.mockRestore();
  document.body.replaceChildren();
  document.head.querySelector('base[data-runtime-test]')?.remove();
  vi.unstubAllGlobals();
  delete runtimeWindow.ArenaNews;
});

describe('竞技场新闻静态资源运行时', () => {
  it('routes article and advertisement details, returns home, and handles malformed links', () => {
    mount(`<a data-news-link href="#article-one">报道</a><a data-news-link href="#ad-one">广告详情</a>
      <a data-news-link href="#home">返回首页</a>
      <section data-news-view="home"><h1>首页</h1></section>
      <section data-news-view="article-one" hidden><h1>完整报道</h1><p>报道正文</p></section>
      <section data-news-view="ad-one" hidden><h1>模拟广告详情</h1></section>`);
    expect(get('[data-news-view="home"]').hidden).toBe(false);
    for (const key of ['article-one', 'ad-one', 'home']) {
      // Native anchor navigation emits hashchange; emulate that browser event deterministically.
      navigate(get<HTMLAnchorElement>(`a[href="#${key}"]`).hash);
      expect(get(`[data-news-view="${key}"]`).hidden).toBe(false);
      expect(document.querySelectorAll('[data-news-view]:not([hidden])')).toHaveLength(1);
      expect(get(`a[href="#${key}"]`).getAttribute('aria-current')).toBe('page');
      expect(document.activeElement).toBe(get(`[data-news-view="${key}"] h1`));
    }
    for (const hash of ['#missing', '#%E0%A4%A']) {
      navigate(hash);
      expect(get('[data-news-view="home"]').hidden).toBe(false);
    }
  });

  it('intercepts fragment links with an inherited host base URL, preserving the generated document', () => {
    const base = document.createElement('base');
    base.href = 'https://host.example/arena';
    base.setAttribute('data-runtime-test', '');
    document.head.append(base);
    mount(`<a data-news-link href="#article-one"><span>报道</span></a><a href="#ad-one">广告</a>
      <section data-news-view="home"><h1>首页</h1></section>
      <section data-news-view="article-one" hidden><h1>报道详情</h1></section>
      <section data-news-view="ad-one" hidden><h1>广告详情</h1></section>`);
    for (const [selector, hash] of [['a span', '#article-one'], ['a[href="#ad-one"]', '#ad-one']]) {
      const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
      expect(get(selector).dispatchEvent(event)).toBe(false);
      expect(event.defaultPrevented).toBe(true);
      expect(window.location.hash).toBe(hash);
      window.dispatchEvent(new HashChangeEvent('hashchange'));
      expect(get(`[data-news-view="${hash.slice(1)}"]`).hidden).toBe(false);
      expect(window.location.hostname).not.toBe('host.example');
    }
  });

  it('keeps external, modified, download and new-tab clicks outside the router', () => {
    mount(`<section data-news-view="home"><h1>首页</h1></section><section data-news-view="detail" hidden><h1>详情</h1></section>
      <a id="normal" href="#detail">文章</a><a id="external" href="https://example.com/">来源</a>
      <a id="download" href="#detail" download>下载</a><a id="new-tab" href="#detail" target="_blank">新窗口</a>`);
    const cases: [string, MouseEventInit][] = [
      ['#external', {}], ['#download', {}], ['#new-tab', {}],
      ['#normal', { ctrlKey: true }], ['#normal', { metaKey: true }],
      ['#normal', { shiftKey: true }], ['#normal', { altKey: true }], ['#normal', { button: 1 }],
    ];
    for (const [selector, init] of cases) {
      let intercepted: boolean | undefined;
      document.addEventListener('click', (event) => {
        intercepted = event.defaultPrevented;
        event.preventDefault(); // Suppress jsdom navigation after observing the runtime decision.
      }, { once: true });
      get(selector).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...init }));
      expect(intercepted).toBe(false);
      expect(location.hash).toBe('');
    }
  });

  it('refocuses repeated routes and handles in-page accessibility anchors without leaving the route', () => {
    mount(`<a id="detail-link" href="#detail">文章</a><a id="skip" href="#main">跳至正文</a>
      <section data-news-view="home"><h1>首页</h1></section>
      <section data-news-view="detail" hidden><h1>详情</h1><main id="main" tabindex="-1">正文</main><button id="reader">操作</button></section>`);
    navigate('#detail');
    get('#reader').focus();
    click('#detail-link');
    expect(document.activeElement).toBe(get('[data-news-view="detail"] h1'));
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    expect(get('#skip').dispatchEvent(event)).toBe(false);
    expect(location.hash).toBe('#detail');
    expect(document.activeElement).toBe(get('#main'));
    expect(get('[data-news-view="detail"]').hidden).toBe(false);
  });

  it('does not install route behavior on documents without news views', () => {
    mount('<a href="#main">正文</a><main id="main">正文</main>');
    let intercepted: boolean | undefined;
    document.addEventListener('click', (event) => {
      intercepted = event.defaultPrevented;
      event.preventDefault();
    }, { once: true });
    click('a');
    expect(intercepted).toBe(false);
    expect(location.hash).toBe('');
  });

  it('intersects case-insensitive search and category filters, including dynamic cards', () => {
    mount(`<input data-news-query><select data-news-filter><option value="all">全部</option><option value="report">战报</option></select>
      <article data-news-item data-news-category="report interview">STAR 决赛</article>
      <article data-news-item data-news-category="interview">Star 采访</article>
      <p data-news-empty hidden>无匹配</p><span data-news-result-count></span>`);
    const query = get<HTMLInputElement>('[data-news-query]');
    const filter = get<HTMLSelectElement>('[data-news-filter]');
    query.value = ' star ';
    query.dispatchEvent(new Event('input', { bubbles: true }));
    expect(get('[data-news-result-count]').textContent).toBe('2');
    filter.value = 'report';
    filter.dispatchEvent(new Event('change', { bubbles: true }));
    expect(get('[data-news-result-count]').textContent).toBe('1');
    document.body.insertAdjacentHTML('beforeend', '<article data-news-item data-news-category="report" data-news-search="star 新战报">另一条</article>');
    query.dispatchEvent(new Event('input', { bubbles: true }));
    expect(get('[data-news-result-count]').textContent).toBe('2');
    query.value = '不存在';
    query.dispatchEvent(new Event('input', { bubbles: true }));
    expect(get('[data-news-result-count]').textContent).toBe('0');
    expect(get('[data-news-empty]').hidden).toBe(false);
  });

  it('synchronizes duplicate like/save controls and mounts idempotently', () => {
    const button = (id: string, key: string) => `<button id="${id}" data-news-toggle="${key}" data-news-base="12" data-news-on="已选择" data-news-off="选择"><span data-news-toggle-label>选择</span><span data-news-toggle-count>12</span></button>`;
    mount(button('like-card', 'like:one') + button('like-detail', 'like:one') + button('save', 'save:one'));
    runtimeWindow.ArenaNews!.mount();
    click('#like-card span');
    for (const id of ['like-card', 'like-detail']) {
      expect(get(`#${id}`).getAttribute('aria-pressed')).toBe('true');
      expect(get(`#${id} [data-news-toggle-count]`).textContent).toBe('13');
    }
    expect(get('#save').getAttribute('aria-pressed')).toBe('false');
    document.body.insertAdjacentHTML('beforeend', button('dynamic-save', 'save:one'));
    click('#dynamic-save');
    expect(get('#save').getAttribute('aria-pressed')).toBe('true');
    click('#like-detail');
    expect(get('#like-card [data-news-toggle-count]').textContent).toBe('12');
    expect(get('#like-card [data-news-toggle-label]').textContent).toBe('选择');
  });

  it('renders comment and author as text in synchronized lists, rejects blanks and caps additions', () => {
    mount(`<div data-news-comment-list="one"></div><ul data-news-comment-list="one"></ul>
      <form data-news-comments="one"><input name="author"><textarea name="comment" required></textarea></form>`);
    const author = get<HTMLInputElement>('[name="author"]');
    const comment = get<HTMLTextAreaElement>('[name="comment"]');
    author.value = '<img src=x onerror=alert(1)>';
    comment.value = '<script>alert(1)</script><b>正文</b>';
    expect(submit('form')).toBe(false);
    expect(get('div strong').textContent).toBe(author.value);
    expect(get('div p').textContent).toBe('<script>alert(1)</script><b>正文</b>');
    expect(document.querySelector('img,script,b')).toBeNull();
    expect(get('ul').children[0].tagName).toBe('LI');
    expect(comment.value).toBe('');
    comment.value = '   ';
    submit('form');
    expect(get('ul').children).toHaveLength(1);
    author.value = '';
    for (let i = 0; i < 50; i++) { comment.value = `后续评论 ${i}`; submit('form'); }
    expect(get('ul').children).toHaveLength(50);
    expect(get('div').children).toHaveLength(50);
    expect(get('ul').children[1].querySelector('strong')!.textContent).toBe('现场读者');
    expect(get('[data-news-status]').textContent).toContain('50');
  });

  it('handles simulated form controls before native submit, as required by allow-scripts-only sandboxes', () => {
    mount(`<div data-news-comment-list="sandbox"></div>
      <form data-news-comments="sandbox"><input name="author"><textarea name="comment" required></textarea>
      <button type="submit"><span>发表</span></button><input id="submit-input" type="submit" value="发表"></form>
      <form data-news-subscribe><button id="subscribe" type="submit">订阅</button></form>`);
    const nativeSubmit = vi.fn((event: Event) => { event.preventDefault(); event.stopImmediatePropagation(); });
    // Real sandbox blocks submission before the delegated submit listener can run.
    document.querySelectorAll('form').forEach((form) => form.addEventListener('submit', nativeSubmit));
    const body = get<HTMLTextAreaElement>('[name="comment"]');
    for (const selector of ['button span', '#submit-input']) {
      body.value = '沙箱内评论';
      const event = new MouseEvent('click', { bubbles: true, cancelable: true });
      expect(get(selector).dispatchEvent(event)).toBe(false);
    }
    expect(get('[data-news-comment-list]').children).toHaveLength(2);
    expect(nativeSubmit).not.toHaveBeenCalled();
    body.value = '键盘评论';
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    expect(get('[name="author"]').dispatchEvent(enter)).toBe(false);
    expect(get('[data-news-comment-list]').children).toHaveLength(3);
    expect(body.value).toBe('');
    body.value = '尚未提交';
    const newline = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    expect(body.dispatchEvent(newline)).toBe(true);
    expect(get('[data-news-comment-list]').children).toHaveLength(3);
    expect(body.value).toBe('尚未提交');
    click('#subscribe');
    expect(get('[data-news-status]').textContent).toContain('已模拟订阅');
    expect(nativeSubmit).not.toHaveBeenCalled();
  });

  it('preserves native handling for unrecognized forms and modified or composing Enter', () => {
    mount(`<form id="ordinary"><input id="ordinary-text"><button id="ordinary-submit" type="submit">提交</button></form>
      <form data-news-comments="one"><input id="author" name="author"><textarea name="comment">文本</textarea></form>
      <div data-news-comment-list="one"></div>`);
    get('form').addEventListener('submit', (event) => { event.preventDefault(); event.stopImmediatePropagation(); });
    const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
    expect(get('#ordinary-submit').dispatchEvent(clickEvent)).toBe(true);
    const cases: [string, KeyboardEventInit][] = [
      ['#ordinary-text', {}], ['#author', { ctrlKey: true }], ['#author', { metaKey: true }],
      ['#author', { altKey: true }], ['#author', { shiftKey: true }], ['#author', { isComposing: true }],
    ];
    for (const [selector, init] of cases) {
      expect(get(selector).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...init }))).toBe(true);
    }
    expect(get('[data-news-comment-list]').children).toHaveLength(0);
  });

  it('records one vote per poll and keeps other polls independent', () => {
    mount(`<button id="a" data-news-poll="winner" data-news-choice="星队">星队</button>
      <button id="b" data-news-poll="winner" data-news-choice="月队">月队</button>
      <button id="other" data-news-poll="mvp" data-news-choice="读者">读者</button><p data-news-poll-result="winner"></p>`);
    click('#a'); click('#b');
    expect(get<HTMLButtonElement>('#a').disabled).toBe(true);
    expect(get<HTMLButtonElement>('#b').disabled).toBe(true);
    expect(get('#a').getAttribute('aria-pressed')).toBe('true');
    expect(get('#b').getAttribute('aria-pressed')).toBe('false');
    expect(get('[data-news-poll-result]').textContent).toContain('星队');
    expect(get<HTMLButtonElement>('#other').disabled).toBe(false);
    click('#other');
    expect(get<HTMLButtonElement>('#other').disabled).toBe(true);
  });

  it('simulates subscription, sharing and ad actions without storage or network', () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const storage = vi.spyOn(Storage.prototype, 'setItem');
    mount(`<button data-news-action="share" data-news-message="已模拟分享，没有发送请求。">分享</button>
      <button data-news-action="coupon" data-news-message="已模拟领取，无真实交易。">领取</button>
      <form data-news-subscribe><input name="topic" value="早报"><button type="submit">订阅</button></form>`);
    click('[data-news-action="share"]');
    expect(get('[data-news-status]').textContent).toContain('已模拟分享');
    click('[data-news-action="coupon"]');
    expect(get('[data-news-status]').textContent).toContain('无真实交易');
    get<HTMLInputElement>('[name="topic"]').value = '晚报';
    expect(submit('form')).toBe(false);
    expect(get('[data-news-status]').textContent).toContain('已模拟订阅');
    expect(get<HTMLInputElement>('[name="topic"]').value).toBe('早报');
    expect(fetch).not.toHaveBeenCalled();
    expect(storage).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
