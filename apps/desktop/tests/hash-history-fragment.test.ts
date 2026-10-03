import { describe, expect, it } from 'vitest';

import { decodeFragmentId } from '@mahoshojo/ui-web/markdown';

import { getRouteFragmentFromHashHistory } from '../src/app/hash-history-fragment';

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