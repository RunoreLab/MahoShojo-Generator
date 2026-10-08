/**
 * 本运行时已交付的产品路径。
 *
 * ## 它为什么单独成模块
 *
 * 它是**数据**，而 `routes.tsx` 是**实现**。原先它定义在 `routes.tsx` 里，`capabilities.ts` 为了读它
 * 反向 import 那个模块，于是形成 `routes → capabilities → routes` 的环：一旦 `routes.tsx` 在模块
 * 求值期调用 `buildCapabilitySnapshot()`，就会撞上「`capabilities` 尚未初始化完」，
 * 表现为 `buildCapabilitySnapshot is not a function`。
 *
 * 把数据与实现分开既断了环，也让「哪条路径已交付」成为一处可以单独读、单独测的事实。
 *
 * ## 它是导航能力快照的唯一来源
 *
 * `@mahoshojo/ui-web/navigation` 里的入口中，只有列在这里的路径会在 Desktop 呈现为可点击。缺项不会
 * 自动渲染成可点链接——共源组件对未声明项按 `unknown` 处理，因此往这份清单里加一行就是
 * 「交付了一个页面」这个决定的显式记录（`DESK-PROD-001`）。
 *
 * **加一行必须同时在 `routes.tsx` 里真的有对应路由**，否则用户会拿到一个可点击但打不开的入口。
 * `tests/desktop-capabilities.test.ts` 覆盖了「快照宣称的可用集合等于本清单」，反向的
 * 「本清单的每一条都有真实页面」由阅读路由树保证。
 */
export const DELIVERED_ROUTES: readonly string[] = [
  '/',
  '/details',
  '/canshou',
  '/free',
  '/scenario',
  '/character-manager',
  '/encyclopedia',
  '/encyclopedia/[slug]',
  '/local-library',
  '/me',
  '/messages',
  '/settings',
];
