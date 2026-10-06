import { useCallback } from 'react';
import { Outlet, createRootRoute, createRoute, lazyRouteComponent, useLocation, useRouter } from '@tanstack/react-router';
import { AppShell, ProductFooter, ProductTopBar } from '@mahoshojo/ui-web/shell';
import {
  HOME_FEATURE_CATEGORIES,
  HOME_RECOMMENDED_ENTRIES,
  HomeAccountWelcome,
  HomeEncyclopediaCard,
  HomeFeatureGrid,
  HomeHero,
  type HomeAssetSource,
} from '@mahoshojo/ui-web/home';

import { projectTopBarAccount } from '../features/account/topbar-projection';
import { useDesktopCloudSession } from '../features/account/use-desktop-cloud-session';
import { DesktopAnnouncementCenter } from '../features/announcements/desktop-announcement-center';
import { ExternalLinksProvider, useExternalLinks } from '../features/external-links/external-links-provider';
import { buildCapabilitySnapshot } from './capabilities';
import { resolveInternalHrefForHashHistory } from './hash-history-fragment';

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
 * 不注册尚未交付的功能路径：由 `buildCapabilitySnapshot` 把它们标成不可用，
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
 * 体内：每次渲染重建出一个新对象会让 `ProductTopBar` 的 `capabilities` prop 每次都变，虽然它目前不参与
 * 任何 memo，但一个「本该是常量」的表达式写在渲染路径上正是将来被误加进依赖数组的起点。
 */
const CAPABILITIES = buildCapabilitySnapshot();

/**
 * 壳。
 *
 * 这是 Desktop 唯一的装配点，职责只有三件：给共源顶栏喂宿主投影、把导航点击交给 router、把页面
 * 内容放进共源外框。**它不挂载任何在线 bootstrap**——公告轮询、账号探测、统计、消息摘要与远端
 * 图片都不在这里（`DESK-PROD-004` 要求本地启动与本地旅程不自动请求项目服务）：
 *
 * - 账号投影来自 `DesktopCloudSessionStore` 的当前快照；冷启动是 `idle → 'unknown'` 的
 *   中性「账号」占位，点按经 `requestAuth` 才触发第一次 `cloud_auth_status`；
 * - 消息摘要不注入：Desktop 没有消息中心，`/messages` 在快照里是 not-implemented，
 *   按 `hide` 策略整条入口不出现——也不会有任何未读角标的伪造；
 * - 公告轮播挂在壳上但数据不轮询：`DesktopAnnouncementsStore` 启动只读内置快照 +
 *   native 落盘缓存，on-launch 策略下随后做一次受控刷新（`DESK-PARITY-003`）；
 * - 站外入口经 `open_external_url` 交给系统浏览器：固定产品链接直接开，内容链接
 *   默认先确认（`ExternalLinksProvider`，DESK-PARITY-003）。
 */
const DesktopShellInner = () => {
  const router = useRouter();
  // `router.state` 始终是最新值但不是响应式——只在这里读它不会让壳在导航/
  // 前进后退后重渲染，active group 会停在旧分组。当前路径必须走订阅式
  // `useLocation`（TanStack 对「渲染依赖路由状态」的官方入口）。
  const pathname = useLocation({ select: (location) => location.pathname });
  const { state: cloudSession, store: cloudSessionStore } = useDesktopCloudSession();
  const { openFixed } = useExternalLinks();

  return (
    <AppShell
      topBar={
        <ProductTopBar
          pathname={pathname}
          capabilities={CAPABILITIES}
          logoSrc="/logo.svg"
          account={projectTopBarAccount(cloudSession.phase)}
          onNavigate={(href, event) => {
            // 共享顶栏渲染真实 `<a href>`，因此这里必须阻止默认行为，否则会触发一次整页加载。
            // Web 侧同理接 `router.push`——「宿主负责路由」这件事在两端是同一种形状。
            event.preventDefault();
            void router.navigate({ to: href });
          }}
          resolveInternalHref={resolveInternalHrefForHashHistory}
          onNavigateExternal={(href, event) => {
            // 顶栏的站外入口是固定产品链接：阻止 WebView 导航，交给 native 校验 +
            // 系统浏览器打开。
            event.preventDefault();
            openFixed(href);
          }}
          onRequestAuth={() => {
            void cloudSessionStore.requestAuth();
          }}
          onSignOut={() => {
            void cloudSessionStore.signOut();
          }}
        />
      }
    >
      <DesktopAnnouncementCenter />
      <Outlet />
    </AppShell>
  );
};

/**
 * 受控外链是壳级能力：顶栏、公告、百科与页脚共用同一个确认弹窗与同一个
 * `open_external_url` 通道，因此 provider 包在最外层。
 */
const DesktopShell = () => (
  <ExternalLinksProvider>
    <DesktopShellInner />
  </ExternalLinksProvider>
);

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
    const { state: cloudSession } = useDesktopCloudSession();
    const { openFixed } = useExternalLinks();

    // 欢迎区只投影「已验证」会话：冷启动 idle 与 signed-out/unreachable 一律按
    // 匿名渲染——DESK-ONLINE-008 要求未验证身份不显示已登录承诺。
    const phase = cloudSession.phase;
    const welcome: { state: 'loading' | 'signed-in' | 'anonymous'; name?: string } =
      phase.kind === 'checking' || phase.kind === 'authenticating'
        ? { state: 'loading' }
        : phase.kind === 'ready' && phase.session.state === 'active'
          ? {
              state: 'signed-in',
              name: phase.session.account.displayName ?? phase.session.account.username,
            }
          : { state: 'anonymous' };

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
        <HomeAccountWelcome
          state={welcome.state}
          name={welcome.name}
          primaryHref="/character-manager"
          onNavigate={navigate}
          resolveInternalHref={resolveInternalHrefForHashHistory}
        />
        <HomeEncyclopediaCard
          assetSource={DESKTOP_ASSET_SOURCE}
          onNavigate={navigate}
          resolveInternalHref={resolveInternalHrefForHashHistory}
          recommended={HOME_RECOMMENDED_ENTRIES}
        />
        <HomeFeatureGrid
          assetSource={DESKTOP_ASSET_SOURCE}
          categories={HOME_FEATURE_CATEGORIES}
          capabilities={CAPABILITIES}
          onNavigate={navigate}
          resolveInternalHref={resolveInternalHrefForHashHistory}
          unavailable="hide"
        />
        <section className="rounded-lg border border-(--app-border) bg-(--app-surface) p-4">
          <h2 className="mb-1 text-sm font-medium text-(--app-text-muted)">本机工具</h2>
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
        <ProductFooter
          assetSource={DESKTOP_ASSET_SOURCE}
          onNavigateInternal={navigate}
          resolveInternalHref={resolveInternalHrefForHashHistory}
          onNavigateExternal={openFixed}
        />
      </section>
    );
  },
});

/** 百科代码随导航加载；首页不解析 Markdown 与数学排版引擎。`?q`/`?c` 是可分享的筛选状态。 */
const encyclopediaIndexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/encyclopedia',
  validateSearch: (search: Record<string, unknown>): { q?: string; c?: string } => {
    const validated: { q?: string; c?: string } = {};
    if (typeof search.q === 'string' && search.q !== '') validated.q = search.q;
    if (typeof search.c === 'string' && search.c !== '') validated.c = search.c;
    return validated;
  },
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

/** 本地角色编辑；`?card=<id>` 打开一条本地库记录，其余查询参数一律丢弃。 */
const characterManagerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/character-manager',
  validateSearch: (search: Record<string, unknown>): { card?: string } =>
    typeof search.card === 'string' && search.card !== '' ? { card: search.card } : {},
  component: lazyRouteComponent(() => import('./character-manager-page'), 'DesktopCharacterManager'),
});

const detailsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/details',
  component: lazyRouteComponent(() => import('./details-page'), 'DesktopDetails'),
});

export const routeTree = rootRoute.addChildren([
  indexRoute,
  detailsRoute,
  characterManagerRoute,
  encyclopediaIndexRoute,
  encyclopediaEntryRoute,
  localLibraryRoute,
  settingsRoute,
]);
