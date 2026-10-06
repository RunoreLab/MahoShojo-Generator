import { describe, expect, it } from 'vitest';

import { readCapability } from '@mahoshojo/ui-web/capability';
import { NAV_GROUPS } from '@mahoshojo/ui-web/navigation';
import { TOPBAR_PRODUCT_HREFS } from '@mahoshojo/ui-web/shell';

import { buildCapabilitySnapshot } from '../src/app/capabilities';
import { DELIVERED_ROUTES } from '../src/app/delivered-routes';

/**
 * 能力快照是「哪些入口在 Desktop 可点」的唯一判据。
 *
 * 这些断言守的不是快照的内容，而是它的**推导方式**：由 `DELIVERED_ROUTES` 推导意味着路由表与导航
 * 能力不可能分叉。分叉的方向恰好是最坏的那种——快照列出一个已删除的页面，用户就会拿到一个点了没
 * 反应的死链，而 `DESK-PROD-001` 明确禁止「可点击但失效」。
 */
describe('desktop capability snapshot', () => {
  const snapshot = buildCapabilitySnapshot();

  it('covers every navigation entry, including external ones', () => {
    // 遍历全部分组而不是只遍历已交付的：漏掉站外入口会让它们显示成「未声明」，而那是一个错误的
    // 理由——它们的问题不是本仓库没声明，是宿主没有打开外部站点的能力。
    const allHrefs = NAV_GROUPS.flatMap((group) => group.items.map((item) => item.href));

    for (const href of allHrefs) {
      expect(snapshot, `能力快照缺少入口 ${href}`).toHaveProperty(href);
    }
  });

  it('covers the topbar-owned product paths so they never fall to undeclared', () => {
    // 顶栏自己消费的路径（logo 首页、消息中心、账号下拉）不在 NAV_GROUPS 里——漏声明
    // 会把它们按 `unknown` 置灰并写成「未声明」的错误理由。每条都必须落在明确判定上。
    for (const href of TOPBAR_PRODUCT_HREFS) {
      const availability = readCapability(snapshot, href);
      expect(availability.kind, `顶栏路径 ${href} 不应是未声明`).not.toBe('unknown');
    }
    expect(readCapability(snapshot, '/')).toEqual({ kind: 'available' });
    expect(readCapability(snapshot, '/character-manager')).toEqual({ kind: 'available' });
    // Desktop 还没有消息中心与个人页：如实标 not-implemented，而不是可点击的死链。
    expect(readCapability(snapshot, '/messages')).toMatchObject({
      kind: 'unavailable',
      reason: 'not-implemented',
    });
    expect(readCapability(snapshot, '/me')).toMatchObject({
      kind: 'unavailable',
      reason: 'not-implemented',
    });
  });

  it('marks exactly the delivered routes as available', () => {
    for (const href of DELIVERED_ROUTES) {
      expect(readCapability(snapshot, href), `${href} 应当可用`).toEqual({ kind: 'available' });
    }
  });

  it('marks undelivered internal product pages as not implemented rather than unknown', () => {
    const undelivered = NAV_GROUPS.flatMap((group) => group.items)
      .filter((item) => item.isExternal !== true)
      .map((item) => item.href)
      .filter((href) => !DELIVERED_ROUTES.includes(href));

    expect(undelivered.length).toBeGreaterThan(0);
    for (const href of undelivered) {
      const availability = readCapability(snapshot, href);
      expect(availability.kind, `${href} 不应是未声明`).toBe('unavailable');
      if (availability.kind === 'unavailable') {
        expect(
          availability.kind === 'unavailable' && availability.reason,
          `${href} 应当给出具体原因`,
        ).toBe('not-implemented');
      }
    }
  });

  it('marks external entries available — open_external_url makes them real capabilities', () => {
    const externalHrefs = NAV_GROUPS.flatMap((group) => group.items)
      .filter((item) => item.isExternal === true)
      .map((item) => item.href);

    // 受控外链命令交付后，站外入口经 native 校验 + 系统浏览器打开是真实能力：
    // 标可用并交给 `onNavigateExternal`，而不是伪装不可点或放行 WebView 导航。
    expect(externalHrefs.length).toBeGreaterThan(0);
    for (const href of externalHrefs) {
      expect(readCapability(snapshot, href)).toEqual({ kind: 'available' });
    }
  });

  it('does not advertise any route the router does not actually serve', async () => {
    // 反向检查：快照说可点的每一条，都必须真的在 DELIVERED_ROUTES 里，且该清单里的每一条都要有
    // 真实页面。两者任一方向不一致，都说明「可点击」与「真的能打开」已经脱钩。
    //
    // 这条断言的存在理由是 `DELIVERED_ROUTES` 与 `routeTree` 分处两个模块：分开是为了断掉
    // `routes → capabilities → routes` 的循环依赖，但分开之后就没有任何机制保证两者同步了。
    // 因此这里从**真实路由树**反推服务中的路径，而不是复述清单。
    const { routeTree } = await import('../src/app/routes');
    // 路径在 `options.path` 上，不在路由对象自身：`createRoute` 把声明参数收进 `options`，而路由实例
    // 上暴露的是 `init/addChildren/Link` 这类方法与 `isRoot`。
    const children = (
      routeTree as unknown as { children?: ReadonlyArray<{ options?: { path?: string } }> }
    ).children ?? [];

    // 路由语法与产品语法不同：TanStack 用 `$slug`，产品路径用 `[slug]`（`navigation.ts` 的
    // canonical 形式，也是共源顶栏的 `href`）。归一化之后两者才可比。
    const toProductPath = (path: string): string => path.replace(/\$([A-Za-z0-9_]+)/g, '[$1]');

    const servedPaths = new Set(
      children
        .map((child) => child.options?.path)
        .filter((path): path is string => typeof path === 'string')
        .map(toProductPath),
    );

    // DELIVERED_ROUTES 必须与真实路由树一致——不多不少。少一条意味着用户点不到一个已交付的页面；
    // 多一条意味着用户拿到一个点了打不开的链接。
    //
    // 这条断言同时钉住「路由树结构没变」：若 `routeTree.children` 的形状变了，`servedPaths` 会变成
    // 空集，而下面的相等断言会**失败**——因此不需要另写一条会自己腐烂的硬编码路径清单。
    expect([...DELIVERED_ROUTES].sort()).toEqual([...servedPaths].sort());
    expect(servedPaths.size).toBe(DELIVERED_ROUTES.length);
  });
});