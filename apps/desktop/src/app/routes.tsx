import { useCallback } from 'react';
import { Outlet, createRootRoute, createRoute, lazyRouteComponent, useLocation, useRouter } from '@tanstack/react-router';
import { BookOpen, FolderOpen, Home, Settings } from 'lucide-react';
import { readCapability } from '@mahoshojo/ui-web/capability';
import {
  AppShell,
  ProductFooter,
  ProductTopBar,
  ShellEscapeMenu,
  type ShellEscapeMenuEntry,
} from '@mahoshojo/ui-web/shell';
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
import { useTopbarAvatar } from '../features/account/use-topbar-avatar';
import { DesktopAnnouncementCenter } from '../features/announcements/desktop-announcement-center';
import { useTopbarMessages } from '../features/messages/topbar-messages';
import { useDesktopConfig } from '../features/config/use-desktop-config';
import { usePublicCachePolicySync } from '../features/public-cache/use-public-cache-policy-sync';
import { ExternalLinksProvider, useExternalLinks } from '../features/external-links/external-links-provider';
import { buildCapabilitySnapshot } from './capabilities';
import { navigateByProductHref, resolveInternalHrefForHashHistory } from './hash-history-fragment';

/**
 * `parseSearch` 会把 JSON 可解析的查询值物化成 number/boolean（`?q=429` → `429`），
 * 而搜索框语义上只有文本。这里把标量统一归一回字符串；对象/数组一律丢弃——
 * 它们不是合法的关键词形态，留着只会让下游拿到非预期类型。
 */
const searchParamText = (value: unknown): string | undefined => {
  if (typeof value === 'string') return value === '' ? undefined : value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
};

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
 * 自带全幅页面背景的产品路径（`magic-background*` 图层自己铺到视口）。
 *
 * 这些页面与 Web 同构的骨架是 `magic-background* > .container > .card`（百科为共源
 * `EncyclopediaPageFrame` 的 `magic-background-white > max-w-6xl > 白卡`）：页面背景必须
 * 横向铺满，`main` 再套一层限宽内边距只是把背景裁进栏盒（渐变同源时肉眼看不出接缝，
 * 但骨架不同构）。`bleedContent` 让壳的 `main` 退化为 `flex-1` 全宽容器；无背景的
 * 裸 section 页面（本地库、设置）继续走受限宽 `main`（D5.1-P2-r4；百科骨架见 D5.1
 * 百科 UI compatibility 收口）。
 */
/**
 * Esc 快捷菜单条目（D5.1-N1，DESK-PARITY-007）。
 *
 * 只列「已交付且可导航」的产品路径——与顶栏同一能力快照来源，未交付入口
 * 不会出现在菜单里（也不会出现禁用的死项）。`pathname` 命中的条目在菜单内
 * 标记为当前项而不是冗余跳转。
 */
const ESCAPE_MENU_ENTRIES: readonly ShellEscapeMenuEntry[] = (
  [
    { href: '/', label: '首页', icon: <Home className="h-4 w-4" /> },
    { href: '/local-library', label: '本地库', icon: <FolderOpen className="h-4 w-4" /> },
    { href: '/encyclopedia', label: '百科', icon: <BookOpen className="h-4 w-4" /> },
    { href: '/settings', label: '设置', icon: <Settings className="h-4 w-4" /> },
  ] as const
).filter((entry) => readCapability(CAPABILITIES, entry.href).kind === 'available');

const FULL_BLEED_PATHS = new Set(['/', '/details', '/canshou', '/free', '/character-manager', '/encyclopedia', '/messages']);

/** 条目页是前缀而不是字面路径：`/encyclopedia/<slug>`。 */
const isFullBleedPath = (pathname: string) =>
  FULL_BLEED_PATHS.has(pathname) || pathname.startsWith('/encyclopedia/');

/**
 * 壳。
 *
 * 这是 Desktop 唯一的装配点，职责只有三件：给共源顶栏喂宿主投影、把导航点击交给 router、把页面
 * 内容放进共源外框。**它不把 Web 在线 bootstrap 搬进壳里**——登录探测、统计、消息摘要与远端
 * 图片不在这里；允许的后台在线请求由各自宿主 adapter 按「离线可用、不阻塞、有界、不泄漏」
 * 原则发起（`DESK-PROD-004` r2 口径，不再要求冷启动零项目请求）：
 *
 * - 账号投影来自 `DesktopCloudSessionStore` 的当前快照：cached-first——本机凭据
 *   读到账号就立即渲染用户名（不经过「账号 → 用户 → 用户名」三段式），随后一次
 *   `cloud_auth_status` 后台验证给出服务端结论；不可达时身份保留并标注「离线」；
 * - 消息摘要按 userId 缓存（D5.1d-1）：登录后经 `cloud_messages_request`
 *   固定路由后台取未读数，90s 新鲜度 + 窗口重新可见时补过期——只渲染服务端
 *   返回的计数，拉不到即无角标而不是伪造数字；
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
  const { state: config } = useDesktopConfig();
  // D5.1-K1：把 publicLibraryCache.* 的生效策略持续推到 native——
  // 公开库浏览路径上的缓存捕获不依赖设置页是否被打开过。
  usePublicCachePolicySync();
  // 头像是有身份后的后台资料刷新（`cloud_me_profile` 固定路由）：不在启动
  // 关键路径，取不到就回退首字母——共享顶栏的 avatarDataUrl 插槽本就如此。
  // `not-authenticated`（native 401 已清凭据）只上报一次会话收束信号，
  // 投影结论仍由 store 统一下。
  const convergeSessionProjection = useCallback(() => {
    void cloudSessionStore.refresh();
  }, [cloudSessionStore]);
  const avatarDataUrl = useTopbarAvatar(cloudSession.account, {
    onSessionRejected: convergeSessionProjection,
  });
  // 消息摘要同属「有身份后的后台刷新」（90s 新鲜度 + 窗口可见时补过期）：
  // 只把服务端返回的未读数喂给共享顶栏的 messages 槽位，没有数据就按
  // 「无已知未读」渲染入口——绝不伪造角标。
  const messagesProjection = useTopbarMessages(cloudSession.account, {
    onSessionRejected: convergeSessionProjection,
  });
  const { openFixed } = useExternalLinks();

  const topBarAccount = projectTopBarAccount(cloudSession);

  return (
    <>
    <AppShell
      // DESK-PARITY-002：品牌已由顶栏 favicon 圆形标志承担，壳不再渲染默认文字品牌。
      brand={null}
      bleedContent={isFullBleedPath(pathname)}
      topBar={
        <ProductTopBar
          pathname={pathname}
          capabilities={CAPABILITIES}
          logoSrc="/favicon.svg"
          account={
            topBarAccount.kind === 'signed-in'
              ? { ...topBarAccount, avatarDataUrl }
              : topBarAccount
          }
          messages={cloudSession.account !== null ? messagesProjection : undefined}
          onNavigate={(href, event) => {
            // 共享顶栏渲染真实 `<a href>`，因此这里必须阻止默认行为，否则会触发一次整页加载。
            // Web 侧同理接 `router.push`——「宿主负责路由」这件事在两端是同一种形状。
            event.preventDefault();
            navigateByProductHref(router, href);
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
    {/*
      Esc 快捷菜单只装配在 Desktop 壳上（DESK-PARITY-007）：共享组件只管
      「打开条件/模态语义」，条目与导航都由这里注入；`navigateByProductHref`
      与顶栏/页内链接走同一条 TanStack 导航路径，离开守卫原样生效，菜单
      不提供绕过。撤掉这块 JSX 即整体摘除功能，共享层级栈不受影响。
    */}
    <ShellEscapeMenu
      enabled={config.values.escapeMenuEnabled}
      entries={ESCAPE_MENU_ENTRIES}
      pathname={pathname}
      onNavigate={(href) => navigateByProductHref(router, href)}
    />
    </>
  );
};

/**
 * 受控外链是壳级能力：顶栏、公告、百科与页脚共用同一个确认弹窗与同一个
 * `open_external_url` 通道，因此 provider 包在最外层。
 * `externalLinks.confirmContentLinks`（DESK-SET-004）与设置页读同一份
 * config snapshot；URL 安全校验始终在 native，关闭确认不放宽校验。
 */
const DesktopShell = () => {
  const { state: config } = useDesktopConfig();
  return (
    <ExternalLinksProvider confirmContentLinks={config.values.confirmContentLinks}>
      <DesktopShellInner />
    </ExternalLinksProvider>
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
    const navigate = useCallback(
      (href: string) => navigateByProductHref(router, href),
      [router],
    );
    const { state: cloudSession } = useDesktopCloudSession();
    const { openFixed } = useExternalLinks();

    // 欢迎区投影本机身份：cached account 存在即显示名字（与顶栏同一事实源，
    // unreachable 时身份同样保留）；无身份且仍在 bootstrap/验证/授权时显示
    // loading，其余（含 signed-out/expired/unreachable 无账号）按匿名渲染。
    const welcome: { state: 'loading' | 'signed-in' | 'anonymous'; name?: string } =
      cloudSession.account !== null
        ? {
            state: 'signed-in',
            name: cloudSession.account.displayName ?? cloudSession.account.username,
          }
        : !cloudSession.bootstrapped ||
            cloudSession.verification === 'checking' ||
            cloudSession.authFlow.kind === 'authenticating'
          ? { state: 'loading' }
          : { state: 'anonymous' };

    return (
      <div data-testid="page-home" className="magic-background-white">
        <div className="container">
          <div className="card flex flex-col gap-6">
            <HomeHero
              assetSource={DESKTOP_ASSET_SOURCE}
              subtitle="欢迎来到魔法国度！选择一个项目开始玩耍吧！"
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
            <div className="mt-8 text-center">
              <p className="text-sm italic text-gray-500">设定来源于小说《下班，然后变成魔法少女》</p>
            </div>
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
          </div>
          <ProductFooter
            assetSource={DESKTOP_ASSET_SOURCE}
            onNavigateInternal={navigate}
            resolveInternalHref={resolveInternalHrefForHashHistory}
            onNavigateExternal={openFixed}
          />
        </div>
      </div>
    );
  },
});

/** 百科代码随导航加载；首页不解析 Markdown 与数学排版引擎。`?q`/`?c` 是可分享的筛选状态。 */
const encyclopediaIndexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/encyclopedia',
  validateSearch: (search: Record<string, unknown>): { q?: string; c?: string } => {
    const validated: { q?: string; c?: string } = {};
    const q = searchParamText(search.q);
    const c = searchParamText(search.c);
    if (q !== undefined) validated.q = q;
    if (c !== undefined) validated.c = c;
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

/** Provider 与运行时信息只在进入设置时加载。`?section=` 是与 Web `/settings` 共用的分组深链。 */
const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  validateSearch: (search: Record<string, unknown>): { section?: string } => {
    const section = searchParamText(search.section);
    return section === undefined ? {} : { section };
  },
  component: lazyRouteComponent(() => import('./settings-page'), 'DesktopSettings'),
});

/** 消息中心：控制器代码随导航加载（列表取数走 cloud_messages_request 窄通道）。 */
const messagesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/messages',
  component: lazyRouteComponent(() => import('./messages-page'), 'DesktopMessages'),
});

/** 最小个人页：账号投影 + 登录/退出操作面（复用设置页 AccountPanel）。 */
const meRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/me',
  component: lazyRouteComponent(() => import('./me-page'), 'DesktopMe'),
});

/** 本地角色编辑；`?card=<id>` 打开一条本地库记录，其余查询参数一律丢弃。 */
const characterManagerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/character-manager',
  validateSearch: (search: Record<string, unknown>): { card?: string } => {
    const card = searchParamText(search.card);
    return card === undefined ? {} : { card };
  },
  component: lazyRouteComponent(() => import('./character-manager-page'), 'DesktopCharacterManager'),
});

const detailsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/details',
  component: lazyRouteComponent(() => import('./details-page'), 'DesktopDetails'),
});

const canshouRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/canshou',
  component: lazyRouteComponent(() => import('./canshou-page'), 'DesktopCanshou'),
});

const freeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/free',
  component: lazyRouteComponent(() => import('./free-page'), 'DesktopFree'),
});

export const routeTree = rootRoute.addChildren([
  indexRoute,
  detailsRoute,
  canshouRoute,
  freeRoute,
  characterManagerRoute,
  encyclopediaIndexRoute,
  encyclopediaEntryRoute,
  localLibraryRoute,
  meRoute,
  messagesRoute,
  settingsRoute,
]);
