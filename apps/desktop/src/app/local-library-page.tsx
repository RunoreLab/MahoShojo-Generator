import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { LocalArchivePanel, createLocalArchiveController } from '@mahoshojo/ui-web/local-archive';
import { LocalCardsPanel, useLocalCardsController, type LocalCardsActions, type LocalCardsHost } from '@mahoshojo/ui-web/local-cards';

import { useLeaveGuard } from './useLeaveGuard';
import { LocalBackupsPanel } from '../features/backups/LocalBackupsPanel';
import {
  DESKTOP_LIBRARY_ARCHIVE_LIMITS,
  createDesktopArchiveHost,
} from '../platform/desktop-archive-host';
import { DesktopLocalCardError, IpcLocalCardRepository, isRetryableLocalLibraryError } from '../platform/local-card-bridge';

const describeLocalCardError = (cause: unknown): string => {
  if (cause instanceof DesktopLocalCardError) {
    return isRetryableLocalLibraryError(cause.code) ? '本地库正在维护，请稍后重试。' : cause.message;
  }
  return '本地库操作失败，请重试。';
};

/**
 * 设备级本地库页面。
 *
 * 路径 `/local-library` 与 Web 共用同一个产品路径（`DESK-059`）：它是设备级页面而不是账号级页面，
 * 因为本地库不要求登录。两个 app 的路径一致，用户在两者之间得到的是同一份心智模型。
 *
 * 数据卡列表/回收站与归档区块是共享实现（`@mahoshojo/ui-web/local-cards`、`/local-archive`），本文件只
 * 提供 Desktop 侧 adapter。导出结果只以 native 的最终确认判成功，因此共享区块在 Desktop 上呈现确定的
 * 字节进度，而 Web 呈现不确定态——这个差异由共享契约的可辨识 union 表达，而不是由两端各写一套界面。
 *
 * 数据卡写操作、归档与备份共用同一把页面级维护互斥：恢复挂起期间备份面板持有它不放，因此回收站的
 * 恢复/彻底删除也随之锁定，不会在“等待整体替换”的库上继续写入。
 */
export function DesktopLocalLibrary() {
  // host 必须在渲染之间保持稳定：控制器用它做 useMemo 的依赖，重建会让已预检的字节与 plan 丢失。
  const host = useMemo(() => createDesktopArchiveHost(), []);
  const controller = useMemo(() => createLocalArchiveController(host), [host]);
  const model = useSyncExternalStore(controller.subscribe, () => controller.model);
  const cardsHost = useMemo<LocalCardsHost>(() => ({
    store: new IpcLocalCardRepository((command, args) => invoke(command, args as never)),
    describeError: describeLocalCardError,
  }), []);
  const cards = useLocalCardsController(cardsHost);
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
  /** 在维护互斥内触发一个同步置位的操作，并在它的控制器回到空闲时释放互斥。 */
  const runExclusive = (
    action: () => void,
    isBusy: () => boolean,
    subscribe: (listener: () => void) => () => void,
  ): void => {
    if (!acquireOperation()) return;
    action();
    if (!isBusy()) {
      releaseOperation();
      return;
    }
    let unsubscribe = (): void => {};
    unsubscribe = subscribe(() => {
      if (!isBusy()) {
        unsubscribe();
        releaseOperation();
      }
    });
  };
  const runArchiveAction = (action: () => void): void => runExclusive(action, archiveBusy, controller.subscribe);
  const runCardAction = (action: () => void): void =>
    runExclusive(action, cards.controller.isBusy, cards.controller.subscribe);
  useEffect(() => { controller.actions.probeStorage(); }, [controller]);
  const { reload: reloadCards } = cards.controller.actions;
  // 归档导入写入的是同一个库：结果一出来就重读，避免列表停在导入前的快照。
  useEffect(() => {
    if (model.report !== null) reloadCards();
  }, [model.report, reloadCards]);
  const guard = useLeaveGuard(
    () => maintenanceBusyRef.current || archiveBusy() || cards.controller.isBusy(),
    '本地库维护操作仍在进行，请等待完成后再离开或关闭窗口。',
    '窗口关闭保护初始化失败，本地库维护操作暂不可用。请重新打开页面后重试。',
  );
  const archiveActions = {
    ...controller.actions,
    startExport: () => runArchiveAction(controller.actions.startExport),
    pickImportFile: () => runArchiveAction(controller.actions.pickImportFile),
    confirmImport: () => runArchiveAction(controller.actions.confirmImport),
  };
  const cardActions: LocalCardsActions = {
    ...cards.controller.actions,
    remove: (id) => runCardAction(() => cards.controller.actions.remove(id)),
    restore: (id) => runCardAction(() => cards.controller.actions.restore(id)),
    purge: (id) => runCardAction(() => cards.controller.actions.purge(id)),
  };

  return (
    <section data-testid="page-local-library" className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">本地库</h1>
        <p className="text-sm text-(--app-text-muted)">
          本机保存的数据卡与 Web 包，只存在于这台设备。不需要账号，也不会访问项目服务器。
        </p>
        <p className="text-sm text-(--app-text-muted)">
          问卷中已保存到本地卡库的角色会参与归档与备份；问卷草稿、未保存结果和部分生成正文不在其中，仅保留在当前应用的草稿存储中。
        </p>
      </header>
      {!guard.ready && !guard.message && <p role="status">正在初始化窗口关闭保护…</p>}
      {guard.message && <p role="alert">{guard.message}</p>}
      <LocalCardsPanel model={cards.model} actions={cardActions} disabled={!guard.ready || maintenanceBusy} />
      <fieldset disabled={!guard.ready || maintenanceBusy} className="min-w-0">
        <LocalArchivePanel model={model} actions={archiveActions} limits={{ maxArchiveBytes: DESKTOP_LIBRARY_ARCHIVE_LIMITS.fileBytes }} />
      </fieldset>
      <LocalBackupsPanel enabled={guard.ready} acquireOperation={acquireOperation} releaseOperation={releaseOperation} />
      <section className="rounded-lg border border-(--app-border) bg-(--app-surface) p-4">
        <h2 className="mb-1 text-sm font-medium text-(--app-text-muted)">还没有的</h2>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-(--app-text-muted)">
          <li>
            <strong className="font-medium">单张数据卡导出、编辑与 Web 包管理</strong>：目前只能通过整库归档与备份携带。
          </li>
        </ul>
      </section>
    </section>
  );
}
