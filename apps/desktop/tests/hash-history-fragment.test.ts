import { afterEach, describe, expect, it, vi } from 'vitest';

import { decodeFragmentId } from '@mahoshojo/ui-web/markdown';

import {
  getRouteFragmentFromHashHistory,
  navigateByProductHref,
  resolveInternalHrefForHashHistory,
} from '../src/app/hash-history-fragment';

/**
 * hash history 的 fragment 切分。
 *
 * ## 为什么这条规则需要一个测试
 *
 * `@tanstack/react-router` 解析后的 `location` **没有** `hash` 字段（`router.state.location.hash`
 * 实测为 `undefined`），因此 Desktop 条目页的 fragment 只能从原始 URL 字符串里切。而原始字符串是
 * `#/encyclopedia/site-guide#角色生成`——路由与 fragment 共处同一个 `#`。切错一处的症状很隐蔽：
 * 页面照常渲染，只是 deep link 永远不生效，而那正是 D3.0 的验收项之一。
 */
describe('getRouteFragmentFromHashHistory', () => {
  it('returns the segment after the second hash', () => {
    expect(getRouteFragmentFromHashHistory('#/encyclopedia/site-guide#角色生成')).toBe('角色生成');
    expect(getRouteFragmentFromHashHistory('#/encyclopedia/site-guide#scoring')).toBe('scoring');
  });

  it('accepts a leading hash that is absent', () => {
    expect(getRouteFragmentFromHashHistory('/encyclopedia/site-guide#scoring')).toBe('scoring');
  });

  it('returns nothing when there is no fragment at all', () => {
    // 目录页与不带锚点的条目页都走这条路径；误返回一个非空值会让页面尝试滚到一个不存在的节点。
    expect(getRouteFragmentFromHashHistory('#/encyclopedia')).toBe('');
    expect(getRouteFragmentFromHashHistory('#/encyclopedia/site-guide')).toBe('');
    expect(getRouteFragmentFromHashHistory('')).toBe('');
    expect(getRouteFragmentFromHashHistory('#')).toBe('');
    expect(getRouteFragmentFromHashHistory(undefined)).toBe('');
  });

  it('keeps a percent-encoded fragment encoded for the shared decoder', () => {
    // 浏览器写入 CJK fragment 时会做 percent-encoding。共享层的 decodeFragmentId 负责解码，
    // 因此这里必须原样透传，而不是自己猜编码。
    const encoded = '%E8%A7%92%E8%89%B2%E7%94%9F%E6%88%90';
    const fragment = getRouteFragmentFromHashHistory(`#/encyclopedia/site-guide#${encoded}`);
    expect(fragment).toBe(encoded);
    expect(decodeFragmentId(fragment)).toBe('角色生成');
  });

  it('does not mistake a query separator for a fragment', () => {
    // `?c=ai#分类` 里第一个 `#` 才是 fragment 的起点；query 里的 `=` 不是。
    expect(getRouteFragmentFromHashHistory('#/encyclopedia?c=ai#ai')).toBe('ai');
  });
});

/**
 * hash history 下共源 `<a href>` 的产品路径 → 运行时 href 解析。
 *
 * 共源组件渲染的是产品路径（`/encyclopedia/foo`）；Desktop 地址栏里它们必须带 `#` 前缀，
 * 否则「复制链接」「新标签打开」与脚本失败后的原生跳转都会落在 Tauri 自定义协议伺服不
 * 到的裸路径上。导航回调拿到的仍是不带 `#` 的产品路径，因此解析只发生在渲染层。
 */
describe('resolveInternalHrefForHashHistory', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('prefixes product paths with the hash marker', () => {
    expect(resolveInternalHrefForHashHistory('/encyclopedia')).toBe('#/encyclopedia');
    expect(resolveInternalHrefForHashHistory('/encyclopedia?q=x&c=y')).toBe('#/encyclopedia?q=x&c=y');
    expect(resolveInternalHrefForHashHistory('/')).toBe('#/');
  });

  it('passes non-product hrefs through unchanged', () => {
    // `/` 之外的一切形态都原样透传——给它补 `#` 只会把站外/协议相对地址变成坏内部路由。
    expect(resolveInternalHrefForHashHistory('https://example.com/x')).toBe('https://example.com/x');
    expect(resolveInternalHrefForHashHistory('mailto:a@b.c')).toBe('mailto:a@b.c');
    expect(resolveInternalHrefForHashHistory('foo/bar')).toBe('foo/bar');
  });

  it('expands a same-page anchor into the full route+fragment form', () => {
    // hash history 下裸 `#frag` 会被当成名为 frag 的路由；正确的地址栏形态是
    // `#<当前路由>#frag`——路由部分从当前地址现取。
    vi.stubGlobal('window', { location: { hash: '#/encyclopedia/site-guide?x=1' } });
    expect(resolveInternalHrefForHashHistory('#角色生成')).toBe('#/encyclopedia/site-guide?x=1#角色生成');
  });

  it('keeps a same-page anchor literal when no host window exists', () => {
    // node 环境下没有 location：透传比编造一个 `#/` 前缀安全。
    expect(resolveInternalHrefForHashHistory('#frag')).toBe('#frag');
  });
});

/**
 * 共源 href → hash router 的结构化导航。
 *
 * 共源层吐的是 `/path?query#frag` 形态的产品路径字符串；`router.navigate` 只吃结构化
 * 参数——整串塞进 `to` 会让 `?`/`#` 被当成 pathname 的一部分（query 丢失 / slug 404）。
 * 所有「共源回调 → 宿主跳转」的装配点共用这一个拆分器。
 */
describe('navigateByProductHref', () => {
  const fakeRouter = () => ({
    navigate: vi.fn(async () => undefined),
  });

  it('splits path, query and fragment into structured navigate options', () => {
    const router = fakeRouter();
    navigateByProductHref(router as never, '/encyclopedia?q=限流&c=ai#分类');
    expect(router.navigate).toHaveBeenCalledWith({
      to: '/encyclopedia',
      search: { q: '限流', c: 'ai' },
      hash: '分类',
      replace: false,
    });
  });

  it('navigates plain paths without inventing search or hash', () => {
    const router = fakeRouter();
    navigateByProductHref(router as never, '/local-library');
    expect(router.navigate).toHaveBeenCalledWith({ to: '/local-library', search: {}, replace: false });
  });

  it('keeps a bare #fragment on the current route and preserves its search', () => {
    const router = fakeRouter();
    navigateByProductHref(router as never, '#术语定义');
    expect(router.navigate).toHaveBeenCalledWith({
      to: '.',
      search: true,
      hash: '术语定义',
      replace: false,
    });
  });

  it('honours replace for high-frequency URL writes', () => {
    const router = fakeRouter();
    navigateByProductHref(router as never, '/encyclopedia?q=x', { replace: true });
    expect(router.navigate).toHaveBeenCalledWith({ to: '/encyclopedia', search: { q: 'x' }, replace: true });
  });
});