import { createHashHistory, createRouter } from '@tanstack/react-router';

import { routeTree } from './routes';

/**
 * Desktop 路由实例。
 *
 * ## 为什么是 hash history 而不是默认的 browser history
 *
 * Tauri 用自定义协议（Windows 上是 `http://tauri.localhost`）提供前端产物，而它**不做 SPA fallback**：
 * 请求 `/local-library` 只会得到一个资源不存在的响应，而不是 `index.html`。因此 browser history 下
 * 任何刷新或深链都会打不开页面。TanStack 官方文档把 hash history 定位为「server 不支持把 HTTP 请求
 * 重写到 index.html 的环境」，Tauri 正是这一类；Tauri 自身的 history 模式问题见
 * tauri-apps/tauri#2020（wry 的自定义协议资源加载）。
 *
 * 代价是 URL 变成 `/#/local-library`。这个代价是产品要接受的：它换来「刷新永远打得开」，而后者是
 * 桌面应用的基本要求，不是可选项。
 *
 * 共享导航不受影响：`@mahoshojo/ui-web/navigation` 只产出产品路径，宿主各自决定如何映射
 * （共源顶栏渲染 `<a href>` 并把点击交给宿主）。因此将来若换 router 或改 history 类型，
 * 要改的只有这个文件。
 */
export const createDesktopRouter = () =>
  createRouter({
    routeTree,
    // 默认的 `defaultPreload` 会为匹配到的路由发起 loader；Desktop 首期没有任何 loader，
    // 显式关掉是为了让「壳不发起任何请求」这条性质来自配置而不是来自「恰好没有 loader」。
    defaultPreload: false,
    defaultPreloadStaleTime: 0,
    history: createHashHistory(),
  });

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createDesktopRouter>;
  }
}