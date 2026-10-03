import { useCallback } from 'react';
import { Outlet, createRootRoute, createRoute, lazyRouteComponent, useRouter } from '@tanstack/react-router';
import { AppShell, ProductNav } from '@mahoshojo/ui-web/shell';
import {
  HomeEncyclopediaCard,
  HomeHero,
  type HomeAssetSource,
} from '@mahoshojo/ui-web/home';

import { buildCapabilitySnapshot } from './capabilities';

/**
 * Desktop 的产品路由树（code-based）。
 *
 * ## 为什么是 code-based 而不是文件路由
 *
 * D2.5 的目标不是预建完整 UI 框架。文件路由生成器会引入一个构建期插件与一套约定，当前路由规模较小。`ADR-desktop-shared-product` §6 明确「无实际需要不引入生成插件/Start」，因此这里手写路由树
 * ——它能被直接读、被直接测，也不需要在计划里记一个「将来迁到文件路由」的债。
 *
 * ## 路由只承载已交付的东西
 *
 * 每条路由对应一个真实可操作的面。`DESK-PROD-001` 要求功能未落地时隐藏入口或说明原因，因此这里
 * 不注册「问卷」「竞技场」这类尚无实现的路径：由 `buildCapabilitySnapshot` 把它们标成不可用，
 * 而不是留下一条会白屏的路由。
 *
 * 归档页面以真实控制器的在途状态保护导航、刷新及 native close；
 * 其他 feature 按各自任务 owner 决定（`DESK-PROD-008`）。路由原语本身是否可用由
 * `tests/desktop-router-history.test.tsx` 断言，不靠注释成立。
 */

/**
 * Desktop 的资源服务根。
 *
 * 宿主事实，不是产品事实（`D3.0-1`）：Tauri 用自定义协议伺服 `dist/`，因此品牌资源位于
 * origin 根。它和 Web 侧那个 `baseUrl: '/'` 形状相同但来源不同——把两者当成"同一个常量"共享，
 * 会让任一端改动悄悄影响另一端。
 */
const DESKTOP_ASSET_SOURCE: HomeAssetSource = { baseUrl: '/' };

/**
 * 导航能力快照。
 *
 * 它由 `DELIVERED_ROUTES` 推导，而后者是模块级常量，因此快照也是。在模块作用域算一次而不是在组件
 * 体内：每次渲染重建出一个新对象会让 `ProductNav` 的 `capabilities` prop 每次都变，虽然它目前不参与
 * 任何 memo，但一个「本该是常量」的表达式写在渲染路径上正是将来被误加进依赖数组的起点。
 */
const CAPABILITIES = buildCapabilitySnapshot();

/**
 * 壳。
 *
 * 这是 Desktop 唯一的装配点，职责只有三件：给共源导航喂能力快照、把导航点击交给 router、把页面内容
 * 放进共源外框。**它不挂载任何在线 bootstrap**——公告轮询、账号探测、统计、挑战页与远端图片都不
 * 在这里，因为 `DESK-PROD-004` 要求本地启动与本地旅程不自动请求项目服务。一个「长得像 Web」的布局
 * 不构成离线启动达成的证据。
 */
const DesktopShell = () => {
  const router = useRouter();

  return (
    <AppShell
      navigation={
        <ProductNav
          pathname={router.state.location.pathname}
          capabilities={CAPABILITIES}
          onNavigate={(href, event) => {
            // 共享导航渲染真实 `<a href>`，因此这里必须阻止默认行为，否则会触发一次整页加载。
            // Web 侧同理接 `router.push`——「宿主负责路由」这件事在两端是同一种形状。
            event.preventDefault();
            void router.navigate({ to: href });
          }}
          // 站外入口不提供处理器：打开外部站点需要新的 native 能力（Tauri 的 opener），不属于 D2.5
          // 的范围。缺省时 `ProductNav` 把它们渲染成不可点击并说明原因，而不是给一个点了没反应的链接。
        />
      }
    >
      <Outlet />
    </AppShell>
  );
};

const rootRoute = createRootRoute({
  component: DesktopShell,
});

/**
 * 产品首页。
 *
 * 视图是共享实现（`@mahoshojo/ui-web/home`），本文件只提供 Desktop 的两样东西：能力快照与那句
 * 说明。首页不发起任何请求——它读的是本地快照与本地产物（`DESK-PROD-004`）。
 *
 * ## 说明为什么只说「有差异」而不列清单
 *
 * 列出现在有哪些能力、与网页版差在哪里，会在每次交付后立刻过时，而过时的差异说明比没有更糟：
 * 用户会照着它去找一个已经能用的功能。因此只说明差异存在，把它留给设置页与更新说明去讲细节。
 */
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: () => {
    const router = useRouter();
    const navigate = useCallback((href: string) => {
      void router.navigate({ to: href });
    }, [router]);

    return (
      <section data-testid="page-home" className="flex flex-col gap-6">
        <HomeHero
          assetSource={DESKTOP_ASSET_SOURCE}
          width={220}
          height={140}
          subtitle="本地浏览百科、导入与导出不需要账号，也不访问项目服务器。"
        />
        <p className="text-center text-sm text-(--app-text-muted)">
          桌面版的功能与网页版存在差异，各项功能预计将逐步开放。
        </p>
        <HomeEncyclopediaCard assetSource={DESKTOP_ASSET_SOURCE} onNavigate={navigate} />
        <section className="rounded-lg border border-(--app-border) bg-(--app-surface) p-4">
          <h2 className="mb-1 text-sm font-medium text-(--app-text-muted)">本机数据</h2>
          <ul className="flex flex-col gap-1 text-sm">
            <li>
              <a
                href="#/local-library"
                onClick={(event) => {
                  event.preventDefault();
                  navigate('/local-library');
                }}
                className="text-(--app-accent-strong) underline"
              >
                本地库
              </a>
              ：本机数据卡与 Web 包的整库导入导出。
            </li>
            <li>
              <a
                href="#/settings"
                onClick={(event) => {
                  event.preventDefault();
                  navigate('/settings');
                }}
                className="text-(--app-accent-strong) underline"
              >
                设置
              </a>
              ：AI Provider、凭据与运行时信息。
            </li>
          </ul>
        </section>
      </section>
    );
  },
});

/** 百科代码随导航加载；首页不解析 Markdown 与数学排版引擎。 */
const encyclopediaIndexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/encyclopedia',
  component: lazyRouteComponent(() => import('./encyclopedia-pages'), 'DesktopEncyclopediaIndex'),
});

const encyclopediaEntryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/encyclopedia/$slug',
  component: lazyRouteComponent(() => import('./encyclopedia-pages'), 'DesktopEncyclopediaEntry'),
});

/** 归档与备份控制器只在进入本地库时加载。 */
const localLibraryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/local-library',
  component: lazyRouteComponent(() => import('./local-library-page'), 'DesktopLocalLibrary'),
});

/** Provider 与运行时信息只在进入设置时加载。 */
const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: lazyRouteComponent(() => import('./settings-page'), 'DesktopSettings'),
});

export const routeTree = rootRoute.addChildren([
  indexRoute,
  encyclopediaIndexRoute,
  encyclopediaEntryRoute,
  localLibraryRoute,
  settingsRoute,
]);
