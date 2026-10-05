import {
  AVAILABLE,
  unavailable,
  type CapabilityAvailability,
  type CapabilitySnapshot,
} from '@mahoshojo/ui-web/capability';
import { NAV_GROUPS } from '@mahoshojo/ui-web/navigation';
import { TOPBAR_PRODUCT_HREFS } from '@mahoshojo/ui-web/shell';

import { DELIVERED_ROUTES } from './delivered-routes';

/**
 * Desktop 的导航能力快照。
 *
 * ## 为什么由 `DELIVERED_ROUTES` 推导，而不是逐条手写
 *
 * 手写清单早晚会与实际交付的路由不一致，而不一致的方向恰好是最坏的那种：列出一个已删除的页面会给出
 * 可点击的死链，而 `DESK-PROD-001` 明确禁止「可点击但失效」。推导让两者不可能分叉——往
 * `DELIVERED_ROUTES` 加一行就是声明「该页面在本运行时可用」，而它必须与 `routeTree` 同步。
 *
 * ## 为什么还要遍历站外入口
 *
 * 站外入口同样需要一个明确判定，而不是因为「不在 `routeTree` 里」就被漏掉——漏掉会让
 * 共源顶栏把它们显示成「未声明」，那是一个错误的理由：它们的问题不是本仓库没声明，而是宿主
 * 没有打开外部站点的能力。
 */
export const buildCapabilitySnapshot = (): CapabilitySnapshot => {
  const delivered = new Set(DELIVERED_ROUTES);
  const snapshot: Record<string, CapabilityAvailability> = {};

  // 先把已交付路由全部标为可用，**再**用入口清单覆盖未交付的那些。顺序不能反：`/`（首页）与
  // `/settings` 都不是 `NAV_GROUPS` 的成员——它们分别是壳的容器与设置入口，不出现在分组导航里。
  // 只遍历入口清单会让这两条永远落在 `unknown` 上，而共源组件对 `unknown` 的处理是「不可点击
  // 并说明未声明」：首页在导航里不可点击虽然不至于白屏，但能力快照与事实不符本身就是缺陷。
  for (const href of delivered) {
    snapshot[href] = AVAILABLE;
  }

  // `TOPBAR_PRODUCT_HREFS` 是 NAV_GROUPS 之外、共源顶栏自身消费的产品路径（logo 首页、
  // 消息中心、账号下拉的个人页/角色管理）。未声明时顶栏会把它们按 `unknown` 置灰——
  // 首页被标成「未声明」是能力快照与路由事实的分叉，必须并入声明集合（D5.0d）。
  const declared = new Set([
    ...NAV_GROUPS.flatMap((group) => group.items.map((item) => ({ href: item.href, isExternal: item.isExternal === true }))),
    ...TOPBAR_PRODUCT_HREFS.map((href) => ({ href, isExternal: false })),
  ]);

  for (const { href, isExternal } of declared) {
    if (delivered.has(href)) continue;
    snapshot[href] = unavailable(
      'not-implemented',
      isExternal
        ? '打开站外站点需要系统浏览器能力，Desktop 尚未接入'
        : '该页面尚未在 Desktop 交付',
    );
  }

  return snapshot;
};

/** 全部被声明过的产品路径（不含已交付但不在入口里的 `/`、`/settings`）。 */
export const DECLARED_PRODUCT_PATHS: readonly string[] = [
  ...new Set([
    ...NAV_GROUPS.flatMap((group) => group.items.map((item) => item.href)),
    ...TOPBAR_PRODUCT_HREFS,
  ]),
];
