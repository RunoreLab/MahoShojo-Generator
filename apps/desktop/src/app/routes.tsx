import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Outlet, createRootRoute, createRoute, useRouter } from '@tanstack/react-router';
import { LocalArchivePanel, createLocalArchiveController } from '@mahoshojo/ui-web/local-archive';
import { useArchiveLeaveGuard } from './useArchiveLeaveGuard';
import { AppShell, ProductNav } from '@mahoshojo/ui-web/shell';

import { loadDesktopRuntimeInfo, type DesktopRuntimeInfo } from '../platform';
import { ProviderProfilesPanel } from '../features/providers/ProviderProfilesPanel';
import { LocalBackupsPanel } from '../features/backups/LocalBackupsPanel';
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
 * 归档页面以真实控制器的在途状态保护导航、刷新及 native close；
 * 其他 feature 按各自任务 owner 决定（`DESK-PROD-008`）。路由原语本身是否可用由
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
    const controller = useMemo(() => createLocalArchiveController(host), [host]);
    const model = useSyncExternalStore(controller.subscribe, () => controller.model);
    const [maintenanceBusy, setMaintenanceBusy] = useState(false);
    const maintenanceBusyRef = useRef(false);
    const acquireOperation = useCallback((): boolean => {
      if (maintenanceBusyRef.current) return false;
      maintenanceBusyRef.current = true;
      setMaintenanceBusy(true);
      return true;
    }, []);
    const releaseOperation = useCallback((): void => {
      maintenanceBusyRef.current = false;
      setMaintenanceBusy(false);
    }, []);
    const archiveBusy = () => {
      const current = controller.model;
      return current.exporting || current.inspecting || current.applying;
    };
    const runArchiveAction = (action: () => void): void => {
      if (!acquireOperation()) return;
      action();
      if (!archiveBusy()) {
        releaseOperation();
        return;
      }
      let unsubscribe = (): void => {};
      unsubscribe = controller.subscribe(() => {
        if (!archiveBusy()) {
          unsubscribe();
          releaseOperation();
        }
      });
    };
    useEffect(() => { controller.actions.probeStorage(); }, [controller]);
    const guard = useArchiveLeaveGuard(
      () => maintenanceBusyRef.current || archiveBusy(),
      '本地库维护操作仍在进行，请等待完成后再离开或关闭窗口。',
    );
    const archiveActions = {
      ...controller.actions,
      startExport: () => runArchiveAction(controller.actions.startExport),
      pickImportFile: () => runArchiveAction(controller.actions.pickImportFile),
      confirmImport: () => runArchiveAction(controller.actions.confirmImport),
    };

    return (
      <section data-testid="page-local-library" className="flex flex-col gap-4">
        <header className="flex flex-col gap-1">
          <h1 className="text-lg font-semibold">本地库</h1>
          <p className="text-sm text-(--app-text-muted)">
            本机保存的数据卡与 Web 包，只存在于这台设备。不需要账号，也不会访问项目服务器。
          </p>
        </header>
        <fieldset disabled={!guard.ready || maintenanceBusy} className="min-w-0">
          {!guard.ready && !guard.message && <p role="status">正在初始化窗口关闭保护…</p>}
          {guard.message && <p role="alert">{guard.message}</p>}
          <LocalArchivePanel model={model} actions={archiveActions} limits={{ maxArchiveBytes: DESKTOP_LIBRARY_ARCHIVE_LIMITS.fileBytes }} />
        </fieldset>
        <LocalBackupsPanel enabled={guard.ready} acquireOperation={acquireOperation} releaseOperation={releaseOperation} />
        <section className="rounded-lg border border-(--app-border) bg-(--app-surface) p-4">
          <h2 className="mb-1 text-sm font-medium text-(--app-text-muted)">还没有的</h2>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-(--app-text-muted)">
            <li>
              <strong className="font-medium">整体替换恢复</strong>：本机整库备份创建与列表已开放；选择备份、二次确认并在下次启动前恢复仍待交付。
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
