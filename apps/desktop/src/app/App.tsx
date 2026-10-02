import { RouterProvider } from '@tanstack/react-router';

import { createDesktopRouter } from './router';

/**
 * Desktop 组合入口。
 *
 * 它只做一件事：创建 router 并挂上 provider。所有产品装配（壳、导航、能力快照）都在路由树的 root
 * 组件里，因此**换 router 不需要改这个文件以外的产品代码**——这是 `ADR-desktop-shared-product` §6
 * 「共享导航不锁定底层 router」在宿主侧的对应形态。
 *
 * router 在模块作用域创建而不是组件内 `useState`：重建 router 会丢失导航历史，而 StrictMode 的
 * 双次渲染会让「在 render 里创建」变成一种真实存在的 bug。
 */
const router = createDesktopRouter();

export const App = () => <RouterProvider router={router} />;