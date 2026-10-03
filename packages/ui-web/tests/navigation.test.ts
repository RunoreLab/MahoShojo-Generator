import { describe, expect, test } from 'vitest';

import {
  getNavGroupForPath,
  getTopbarCanonicalPathname,
  getTopbarCoverage,
  isTopbarCoveredPath,
  NAV_GROUPS,
  TOPBAR_COVERED_ROUTES,
} from '../src/navigation';

describe('navigation config', () => {
  test('topbar coverage includes primary user-facing pages', () => {
    expect(TOPBAR_COVERED_ROUTES).toEqual([
      '/',
      '/battle',
      '/arena',
      '/arena-stream',
      '/creator',
      '/name',
      '/details',
      '/canshou',
      '/free',
      '/scenario',
      '/character-manager',
      '/character-party',
      '/local-library',
      '/questionnaire-editor',
      '/sublimation',
      '/tachie',
      '/tavern',
      '/magic-tavern',
      '/magic-tea-party',
      '/me',
      '/badge-manager',
      '/redeem',
      '/password-recovery',
      '/pvp',
      '/pvp/[roomId]',
      '/ranking',
      '/messages',
      '/report-appeals',
      '/investigation',
      '/beta-access',
      '/encyclopedia',
      '/encyclopedia/[slug]',
    ]);

    for (const path of TOPBAR_COVERED_ROUTES) {
      expect(isTopbarCoveredPath(path)).toBe(true);
    }

    for (const path of [
      '/404',
      '/arrested',
    ]) {
      expect(isTopbarCoveredPath(path)).toBe(false);
    }
  });

  test('navigation targets mark covered primary pages explicitly', () => {
    const targets = NAV_GROUPS.flatMap((group) => group.items.map((item) => [item.href, item.isTopbarCovered]));

    expect(targets).toContainEqual(['/ranking', true]);
    expect(targets).toContainEqual(['/encyclopedia', true]);
    expect(targets).toContainEqual(['/name', true]);
    expect(targets).toContainEqual(['/free', true]);
    expect(targets).toContainEqual(['/scenario', true]);
    expect(targets).toContainEqual(['/sublimation', true]);
    expect(targets).toContainEqual(['/battle', true]);
    expect(targets.map(([href]) => href)).not.toContain('/messages');
  });

  test('route group metadata covers navigation targets but coverage controls active topbar display', () => {
    expect(getNavGroupForPath('/battle')?.id).toBe('battle');
    expect(getNavGroupForPath('/arena')?.id).toBe('battle');
    expect(getNavGroupForPath('/pvp')?.id).toBe('battle');
    expect(getNavGroupForPath('/ranking')?.id).toBe('battle');

    expect(getNavGroupForPath('/creator')?.id).toBe('creative');
    expect(getNavGroupForPath('/name')?.id).toBe('creative');
    expect(getNavGroupForPath('/scenario')?.id).toBe('creative');

    expect(getNavGroupForPath('/character-manager')?.id).toBe('character');
    expect(getNavGroupForPath('/me')?.id).toBe('character');
    expect(getNavGroupForPath('/sublimation')?.id).toBe('character');

    expect(getNavGroupForPath('/encyclopedia/site-guide')?.id).toBe('knowledge');
    expect(getTopbarCoverage('/ranking')).toEqual({ isCovered: true, activeGroupId: 'battle' });
    expect(getTopbarCoverage('/battle')).toEqual({ isCovered: true, activeGroupId: 'battle' });
    expect(getTopbarCoverage('/scenario')).toEqual({ isCovered: true, activeGroupId: 'creative' });
    expect(getTopbarCoverage('/encyclopedia/[slug]')).toEqual({ isCovered: true, activeGroupId: 'knowledge' });
    expect(getTopbarCoverage('/pvp/[roomId]')).toEqual({ isCovered: true, activeGroupId: 'battle' });
    expect(getTopbarCoverage('/messages')).toEqual({ isCovered: true, activeGroupId: null });
    expect(getTopbarCoverage('/investigation')).toEqual({ isCovered: true, activeGroupId: 'knowledge' });
  });

  test('App Router dynamic pathnames can be mapped to legacy topbar route patterns', () => {
    expect(getTopbarCanonicalPathname('/pvp/room-7')).toBe('/pvp/[roomId]');
    expect(getTopbarCanonicalPathname('/encyclopedia/site-guide')).toBe('/encyclopedia/[slug]');
    expect(getTopbarCanonicalPathname('/ranking?season=current#top')).toBe('/ranking');
  });

  test.each([
    ['/pvp/room-7', 'battle'],
    ['/pvp/room-7/?round=2#turn', 'battle'],
    ['/encyclopedia/site-guide', 'knowledge'],
    ['/encyclopedia/使用指南/?from=nav#intro', 'knowledge'],
  ])('coverage accepts the actual dynamic pathname %s', (pathname, activeGroupId) => {
    expect(isTopbarCoveredPath(pathname)).toBe(true);
    expect(getTopbarCoverage(pathname)).toEqual({ isCovered: true, activeGroupId });
  });

  test('the device-level local library entry is a first-class navigation target', () => {
    // DESK-059：承载整库导入导出的页面 MUST 是设备级而非账号级。因此它有自己的产品路径，
    // 而不是个人页的一个 tab——挂在 /me 下会让产品语义变成"本地数据属于账号"。
    expect(NAV_GROUPS.flatMap((group) => group.items.map((item) => item.href))).toContain('/local-library');
    expect(isTopbarCoveredPath('/local-library')).toBe(true);
    expect(getNavGroupForPath('/local-library')?.id).toBe('character');
    expect(getNavGroupForPath('/me')?.id).toBe('character');
  });

  test('normalization accepts the forms a desktop hash history and a browser history both produce', () => {
    // 两个宿主对同一产品路径会给出不同形状：浏览器给 `/scenario?from=nav`，hash history 给
    // `/#/scenario?from=nav`；两者都会被 normalizePathname 归一到同一个 canonical 值。
    expect(getTopbarCanonicalPathname('/')).toBe('/');
    expect(getTopbarCanonicalPathname('')).toBe('/');
    expect(getTopbarCanonicalPathname('/scenario/')).toBe('/scenario');
    expect(getTopbarCanonicalPathname('/scenario?from=nav')).toBe('/scenario');
    expect(getNavGroupForPath('/scenario/')?.id).toBe('creative');
  });

  test('keeps topbar-covered pages that are not navigation-group members out of the group lookup', () => {
    // `/details`（魔法少女调查问卷）与 `/character-manager` 一样是顶栏覆盖页，但只有后者是分组入口：
    // 前者从首页功能卡进入。这两者必须能被区分——否则共享导航要么漏掉一个真实页面，要么给一个
    // 从未出现在导航里的路径编造出分组高亮。
    expect(isTopbarCoveredPath('/details')).toBe(true);
    expect(getNavGroupForPath('/details')).toBeNull();
    expect(isTopbarCoveredPath('/character-manager')).toBe(true);
    expect(getNavGroupForPath('/character-manager')?.id).toBe('character');
  });

  test('external entries are marked so a host can refuse them explicitly instead of rendering a dead link', () => {
    const externalItems = NAV_GROUPS.flatMap((group) => group.items).filter((item) => item.isExternal === true);

    // 打开站外站点需要宿主能力（Tauri 侧是新的 native command）。共享导航只声明"这是站外"，
    // 由宿主决定能不能打开——因此这个集合非空且每一项都有绝对 URL，两条断言缺一都会让
    // `ProductNav` 的站外分支永远走不到。
    expect(externalItems.length).toBeGreaterThan(0);
    for (const item of externalItems) {
      expect(item.href.startsWith('https://'), `${item.href} 应当是绝对 URL`).toBe(true);
      expect(item.isTopbarCovered).toBe(false);
    }
  });
});
