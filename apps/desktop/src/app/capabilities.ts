import {
  AVAILABLE,
  unavailable,
  type CapabilityAvailability,
  type CapabilitySnapshot,
} from '@mahoshojo/ui-web/capability';
import { NAV_GROUPS } from '@mahoshojo/ui-web/navigation';

import { DELIVERED_ROUTES } from './routes';

/**
 * Desktop 的导航能力快照。
 *
 * ## 为什么由 `DELIVERED_ROUTES` 推导，而不是逐条手写
 *
 * 手写清单早晚会与实际交付的路由不一致，而不一致的方向恰好是最坏的那种：列出一个已删除的页面会给出
 * 可点击的死链，而 `DESK-PROD-001` 明确禁止「可点击但失效」。推导让两者不可能分叉——往
 * `DELIVERED_ROUTES` 加一行就是声明「该页面在本运行时可用」，而它必须与 `routeTree` 同步。
 *
 * ## 遍历全部入口，包括站外的那些
 *
 * 站外入口同样需要一个明确判定，而不是因为「不在 `routeTree` 里」就被漏掉——漏掉会让
 * `ProductNav` 把它们显示成「未声明」，那是一个错误的理由：它们的问题不是本仓库没声明，而是宿主
 * 没有打开外部站点的能力。
 */
export const buildCapabilitySnapshot = (): CapabilitySnapshot => {
  const delivered = new Set(DELIVERED_ROUTES);
  const snapshot: Record<string, CapabilityAvailability> = {};

  // 先把已交付路由全部标为可用，**再**用导航入口覆盖未交付的那些。顺序不能反：`/`（首页）与
  // `/settings` 都不是 `NAV_GROUPS` 的成员——它们分别是壳的容器与设置入口，不出现在分组导航里。
  // 只遍历导航入口会让这两条永远落在 `unknown` 上，而 `ProductNav` 对 `unknown` 的处理是「不可点击
  // 并说明未声明」：首页在导航里不可点击虽然不至于白屏，但能力快照与事实不符本身就是缺陷。
  for (const href of delivered) {
    snapshot[href] = AVAILABLE;
  }

  for (const group of NAV_GROUPS) {
    for (const item of group.items) {
      if (delivered.has(item.href)) continue;
      snapshot[item.href] = unavailable(
        'not-implemented',
        item.isExternal === true
          ? '打开站外站点需要系统浏览器能力，Desktop 尚未接入'
          : '该页面尚未在 Desktop 交付',
      );
    }
  }

  return snapshot;
};