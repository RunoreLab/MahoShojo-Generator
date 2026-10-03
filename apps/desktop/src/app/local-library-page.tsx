import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { LocalArchivePanel, createLocalArchiveController } from '@mahoshojo/ui-web/local-archive';

import { useArchiveLeaveGuard } from './useArchiveLeaveGuard';
import { LocalBackupsPanel } from '../features/backups/LocalBackupsPanel';
import {
  DESKTOP_LIBRARY_ARCHIVE_LIMITS,
  createDesktopArchiveHost,
} from '../platform/desktop-archive-host';

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
export function DesktopLocalLibrary() {
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
            <strong className="font-medium">回收站</strong>：删除的记录目前没有界面上的恢复入口。
          </li>
        </ul>
      </section>
    </section>
  );
}

