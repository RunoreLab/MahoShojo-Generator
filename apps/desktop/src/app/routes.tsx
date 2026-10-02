import { useEffect, useMemo, useState } from 'react';
import { Outlet, createRootRoute, createRoute, useRouter } from '@tanstack/react-router';
import { LocalArchiveSection } from '@mahoshojo/ui-web/local-archive';
import { AppShell, ProductNav } from '@mahoshojo/ui-web/shell';

import { loadDesktopRuntimeInfo, type DesktopRuntimeInfo } from '../platform';
import { ProviderProfilesPanel } from '../features/providers/ProviderProfilesPanel';
import { buildCapabilitySnapshot } from './capabilities';
import {
  DESKTOP_LIBRARY_ARCHIVE_LIMITS,
  createDesktopArchiveHost,
} from '../platform/desktop-archive-host';

/**
 * Desktop 的产品路由树（code-based）。
 *
 * ## 为什么是 code-based 而不是文件路由
 *
 * D2.5 的目标不是预建完整 UI 框架。文件路由生成器会引入一个构建期插件与一套约定，而当前只有三条
 * 路由。`ADR-desktop-shared-product` §6 明确「无实际需要不引入生成插件/Start」，因此这里手写路由树
 * ——它能被直接读、被直接测，也不需要在计划里记一个「将来迁到文件路由」的债。
 *
 * ## 路由只承载已交付的东西
 *
 * 每条路由对应一个真实可操作的面。`DESK-PROD-001` 要求功能未落地时隐藏入口或说明原因，因此这里
 * 不注册「问卷」「竞技场」这类尚无实现的路径：由 `buildCapabilitySnapshot` 把它们标成不可用，
 * 而不是留下一条会白屏的路由。
 *
 * 离开保护同样不在这里预建。当前没有任何页面持有未保存内容或在途任务，因此**没有**需要阻止的离开；
 * 按 feature 切片各自决定（`DESK-PROD-008`）。路由原语本身是否可用由
 * `tests/desktop-router-history.test.tsx` 断言，不靠注释成立。
 */

interface RuntimeState {
  status: 'loading' | 'ready' | 'failed';
  info?: DesktopRuntimeInfo;
  message?: string;
}

/**
 * 运行时自述。
 *
 * 它曾经是 D0 的**首页**，而 `DESK-PROD-001` 明确禁止运行时/Provider 面板作为最终首页。因此它现在
 * 只出现在设置页：产品入口必须是产品首页，调试信息归设置。
 *
 * 读取失败仍然要显示失败而不是静默降级——`DESK-PROD-007` 要求初始化失败必须报告。
 */
const RuntimeInfoPanel = () => {
  const [state, setState] = useState<RuntimeState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;

    loadDesktopRuntimeInfo()
      .then((info) => {
        if (!cancelled) setState({ status: 'ready', info });
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setState({
          status: 'failed',
          message: cause instanceof Error ? cause.message : 'unknown desktop bridge failure',
        });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="rounded-lg border border-(--app-border) bg-(--app-surface) p-4">
      <h2 className="mb-2 text-sm font-medium text-(--app-text-muted)">本地运行时</h2>
      {state.status === 'loading' && <p className="text-sm">正在读取本地运行时信息…</p>}
      {state.status === 'failed' && (
        <p className="text-sm text-(--app-accent-strong)">读取失败：{state.message}</p>
      )}
      {state.status === 'ready' && state.info && (
        <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-(--app-text-muted)">应用版本</dt>
          <dd>{state.info.appVersion}</dd>
          <dt className="text-(--app-text-muted)">Tauri 版本</dt>
          <dd>{state.info.tauriVersion}</dd>
          <dt className="text-(--app-text-muted)">平台</dt>
          <dd>
            {state.info.os} / {state.info.arch}
          </dd>
          <dt className="text-(--app-text-muted)">打包产物</dt>
          <dd>{state.info.packaged ? '是' : '否（开发构建）'}</dd>
        </dl>
      )}
    </section>
  );
};

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
  // 快照由已交付路由推导，因此是常量；放在组件外算一次即可，不必每次渲染重建对象。
  const capabilities = buildCapabilitySnapshot();

  return (
    <AppShell
      navigation={
        <ProductNav
          pathname={router.state.location.pathname}
          capabilities={capabilities}
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

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: () => (
    <section data-testid="page-home">
      <h1 className="text-lg font-semibold">MahoShojo Generator · Desktop</h1>
      <p className="mt-2 text-sm text-(--app-text-muted)">
        本地运行时。本地浏览、编辑、导入与导出不需要账号，也不访问项目服务器。
      </p>
      <ul className="mt-4 flex flex-col gap-2 text-sm">
        <li>
          <a href="#/local-library" className="text-(--app-accent-strong) underline">
            本地库
          </a>
          ：本机数据卡与 Web 包的管理、导入导出。
        </li>
        <li>
          <a href="#/settings" className="text-(--app-accent-strong) underline">
            设置
          </a>
          ：AI Provider、凭据与运行时信息。
        </li>
      </ul>
    </section>
  ),
});

/**
 * 设备级本地库页面。
 *
 * 路径 `/local-library` 与 Web 共用同一个产品路径（`DESK-059`）：它是设备级页面而不是账号级页面，
 * 因为本地库不要求登录。两个 app 的路径一致，用户在两者之间得到的是同一份心智模型。
 *
 * 归档区块是共享实现（`@mahoshojo/ui-web/local-archive`），本文件只提供 Desktop 侧 adapter。导出
 * 结果只以 native 的最终确认判成功，因此共享区块在 Desktop 上呈现确定的字节进度，而 Web 呈现不确定
 * 态——这个差异由共享契约的可辨识 union 表达，而不是由两端各写一套界面。
 */
const localLibraryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/local-library',
  component: () => {
    // host 必须在渲染之间保持稳定：控制器用它做 useMemo 的依赖，重建会让已预检的字节与 plan 丢失。
    const host = useMemo(() => createDesktopArchiveHost(), []);

    return (
      <section data-testid="page-local-library" className="flex flex-col gap-4">
        <header className="flex flex-col gap-1">
          <h1 className="text-lg font-semibold">本地库</h1>
          <p className="text-sm text-(--app-text-muted)">
            本机保存的数据卡与 Web 包，只存在于这台设备。不需要账号，也不会访问项目服务器。
          </p>
        </header>
        <LocalArchiveSection host={host} maxArchiveBytes={DESKTOP_LIBRARY_ARCHIVE_LIMITS.fileBytes} />
        <section className="rounded-lg border border-(--app-border) bg-(--app-surface) p-4">
          <h2 className="mb-1 text-sm font-medium text-(--app-text-muted)">还没有的</h2>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-(--app-text-muted)">
            <li>
              <strong className="font-medium">整库备份与灾难恢复</strong>：上面的导出是 portable archive，
              用于换设备；它不是设备状态的完整快照。恢复流程尚未交付。
            </li>
            <li>
              <strong className="font-medium">回收站</strong>：删除的记录目前没有界面上的恢复入口。
            </li>
          </ul>
        </section>
      </section>
    );
  },
});

/** 设置承载 Provider 面板与运行时信息；调试信息不占首页（`DESK-PROD-001`）。 */
const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: () => (
    <section data-testid="page-settings" className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">设置</h1>
      <ProviderProfilesPanel />
      <RuntimeInfoPanel />
    </section>
  ),
});

export const routeTree = rootRoute.addChildren([indexRoute, localLibraryRoute, settingsRoute]);

/**
 * 本运行时已交付的产品路径。
 *
 * 它是导航能力快照的**唯一**来源：`@mahoshojo/ui-web/navigation` 里的入口中，只有列在这里的路径会
 * 在 Desktop 呈现为可点击。缺项不会自动渲染成可点链接——`ProductNav` 对未声明项按 `unknown` 处理，
 * 因此往这份清单里加一行是「交付了一个页面」这个决定的显式记录。
 */
export const DELIVERED_ROUTES: readonly string[] = ['/', '/local-library', '/settings'];