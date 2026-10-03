import { useCallback, useEffect, useRef, useState } from 'react';
import type { DesktopBackupList, DesktopBackupSummary } from '@mahoshojo/contracts/desktop-ipc';
import {
  createLocalBackup,
  exitAfterLocalRestore,
  listLocalBackups,
  LocalBackupError,
  LocalRestoreError,
  prepareLocalRestore,
} from '../../platform/local-backup-bridge';

interface LocalBackupsPanelProps {
  readonly enabled: boolean;
  readonly acquireOperation: () => boolean;
  readonly releaseOperation: () => void;
}

interface BackupListState {
  readonly backups: readonly DesktopBackupSummary[];
  readonly invalidCount: number;
}

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KiB', 'MiB', 'GiB', 'TiB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
};

const describeBackupError = (cause: unknown): string =>
  cause instanceof LocalBackupError ? cause.message : '本地备份操作失败，请重试。';

/** Native 专属整库备份入口。Portable archive 仍由上方共享区块负责。 */
export const LocalBackupsPanel = ({ enabled, acquireOperation, releaseOperation }: LocalBackupsPanelProps) => {
  const [list, setList] = useState<BackupListState>({ backups: [], invalidCount: 0 });
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedBackup, setSelectedBackup] = useState<DesktopBackupSummary | null>(null);
  const [restorePending, setRestorePending] = useState(false);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [restoreExitBusy, setRestoreExitBusy] = useState(false);
  const [restoreReceipt, setRestoreReceipt] = useState<{ restoreId: string; backupId: string; preRestoreBackupId: string } | null>(null);
  const [restoreDiagnostic, setRestoreDiagnostic] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [exitAccepted, setExitAccepted] = useState(false);
  const lockHeldRef = useRef(false);
  const restoreTriggerRef = useRef<HTMLButtonElement | null>(null);
  const cancelRestoreRef = useRef<HTMLButtonElement | null>(null);
  const restoreStatusRef = useRef<HTMLHeadingElement | null>(null);
  const hadRestoreConfirmationRef = useRef(false);

  useEffect(() => {
    if (selectedBackup) {
      hadRestoreConfirmationRef.current = true;
      cancelRestoreRef.current?.focus();
      return;
    }
    if (!hadRestoreConfirmationRef.current) return;
    hadRestoreConfirmationRef.current = false;
    if (!restorePending) restoreTriggerRef.current?.focus();
  }, [restorePending, selectedBackup]);
  useEffect(() => {
    if (restorePending) restoreStatusRef.current?.focus();
  }, [restorePending]);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const result: DesktopBackupList = await listLocalBackups();
      setList(result);
      setError(null);
    } catch (cause) {
      setError(describeBackupError(cause));
    }
  }, []);

  const run = useCallback(async (operation: 'refresh' | 'create'): Promise<void> => {
    if (!enabled || restorePending || !acquireOperation()) return;
    setBusy(true);
    setLoading(operation === 'refresh');
    setError(null);
    setNotice(null);
    try {
      if (operation === 'create') {
        const created = await createLocalBackup();
        setNotice(`备份已创建：${created.absolutePath}`);
        await refresh();
      } else {
        await refresh();
      }
    } catch (cause) {
      setError(describeBackupError(cause));
    } finally {
      setLoading(false);
      setBusy(false);
      releaseOperation();
    }
  }, [acquireOperation, enabled, refresh, releaseOperation, restorePending]);

  const requestRestoreExit = useCallback(async (): Promise<void> => {
    if (!lockHeldRef.current) return;
    setRestoreExitBusy(true);
    setRestoreError(null);
    setExitAccepted(false);
    try {
      await exitAfterLocalRestore();
      // A successful native call normally exits the process before this renderer resumes.
      // Keep the safety lock if it does return, so a delayed/failed close cannot reopen edits.
      setExitAccepted(true);
    } catch (cause) {
      setRestoreError(cause instanceof LocalRestoreError
        ? `无法退出应用：${cause.message}`
        : '退出应用以继续恢复失败，请重试。');
    } finally {
      setRestoreExitBusy(false);
    }
  }, []);

  const confirmRestore = useCallback(async (): Promise<void> => {
    if (!selectedBackup || !enabled || restorePending || !acquireOperation()) return;
    lockHeldRef.current = true;
    setRestorePending(true);
    setRestoreBusy(true);
    setRestoreError(null);
    setRestoreReceipt(null);
    setRestoreDiagnostic(false);
    setExitAccepted(false);
    const requestedBackupId = selectedBackup.backupId;
    setSelectedBackup(null);

    try {
      const receipt = await prepareLocalRestore(requestedBackupId);
      setRestoreReceipt(receipt);
      setNotice(null);
    } catch (cause) {
      if (cause instanceof LocalRestoreError && cause.pendingMayExist) {
        setRestoreDiagnostic(true);
      } else {
        setRestorePending(false);
        lockHeldRef.current = false;
        releaseOperation();
        setRestoreError(cause instanceof LocalRestoreError
          ? cause.message
          : '恢复准备失败，请重试。');
        setRestoreBusy(false);
        return;
      }
    }

    setRestoreBusy(false);
    // The intent is durable before the application exits. If exit fails, keep all library
    // controls locked and let the user retry this command without preparing a second intent.
    await requestRestoreExit();
  }, [acquireOperation, enabled, releaseOperation, requestRestoreExit, restorePending, selectedBackup]);

  useEffect(() => {
    void run('refresh');
  }, [run]);

  return (
    <section className="rounded-lg border border-(--app-border) bg-(--app-surface) p-4" aria-labelledby="local-backups-heading">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="local-backups-heading" className="text-sm font-medium">本地整库备份</h2>
          <p className="mt-1 text-sm text-(--app-text-muted)">
            备份包含本地卡、Web 包、回收站记录，以及 Provider 配置与凭据引用；不包含系统凭据、未迁移的草稿与历史。
            恢复后如凭据缺失，请到设置重新录入。
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" className="rounded border border-(--app-border) px-3 py-2 text-sm" disabled={!enabled || busy || restorePending || selectedBackup !== null} onClick={() => void run('refresh')}>
            刷新列表
          </button>
          <button type="button" className="rounded bg-(--app-accent-strong) px-3 py-2 text-sm text-white" disabled={!enabled || busy || restorePending || selectedBackup !== null} onClick={() => void run('create')}>
            创建备份
          </button>
        </div>
      </header>

      {busy && <p role="status" className="mt-3 text-sm">{loading ? '正在读取本机备份…' : '正在创建本机备份…'}</p>}
      {error && <p role="alert" className="mt-3 text-sm text-(--app-accent-strong)">{error}</p>}
      {restoreError && !restorePending && <p role="alert" className="mt-3 text-sm text-(--app-accent-strong)">{restoreError}</p>}
      {notice && <p role="status" className="mt-3 break-all text-sm">{notice}</p>}
      {list.invalidCount > 0 && <p className="mt-3 text-sm text-(--app-text-muted)">已忽略 {list.invalidCount} 个不完整或无效的备份目录。</p>}

      {!busy && !error && list.backups.length === 0 && <p className="mt-3 text-sm text-(--app-text-muted)">尚无可用的本机备份。</p>}
      {list.backups.length > 0 && (
        <ul className="mt-4 flex flex-col gap-3">
          {list.backups.map((backup) => (
            <li key={backup.backupId} className="min-w-0 rounded border border-(--app-border) p-3 text-sm">
              <p className="font-medium">{new Date(backup.createdAt).toLocaleString()}</p>
              <dl className="mt-2 grid grid-cols-[auto,1fr] gap-x-3 gap-y-1">
                <dt className="text-(--app-text-muted)">数据库</dt><dd>{formatBytes(backup.databaseBytes)}</dd>
                <dt className="text-(--app-text-muted)">Blob</dt><dd>{backup.blobCount} 个，共 {formatBytes(backup.blobBytes)}</dd>
                <dt className="text-(--app-text-muted)">备份根目录</dt><dd className="break-all">{backup.directory}</dd>
                <dt className="text-(--app-text-muted)">本次备份路径</dt><dd className="break-all">{backup.absolutePath}</dd>
              </dl>
              <button
                type="button"
                className="mt-3 rounded border border-(--app-border) px-3 py-2 text-sm"
                disabled={!enabled || busy || restorePending || selectedBackup !== null}
                onClick={(event) => {
                  restoreTriggerRef.current = event.currentTarget;
                  setSelectedBackup(backup);
                }}
              >
                使用此备份整体替换本地库…
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-(--app-text-muted)">备份文件由你管理；应用不会自动清理旧备份。</p>

      {selectedBackup && !restorePending && (
        <section role="region" aria-labelledby="restore-confirm-title" className="rounded-lg border border-(--app-accent-strong) bg-(--app-surface) p-4">
            <h3 id="restore-confirm-title" className="text-base font-semibold">确认整体替换本地库</h3>
            <p className="mt-3 text-sm">
              将使用备份 <strong>{selectedBackup.backupId}</strong> 整体替换当前本地库。开始前应用会自动创建一份恢复前备份，
              随后退出；请重新打开应用以应用恢复。
            </p>
            <p className="mt-2 text-sm text-(--app-text-muted)">
              系统凭据不会随备份恢复。若 Provider 凭据缺失，请重新打开应用后到设置重新录入。
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                ref={cancelRestoreRef}
                type="button"
                className="rounded border border-(--app-border) px-3 py-2 text-sm"
                onClick={() => {
                  setSelectedBackup(null);
                }}
              >
                取消
              </button>
              <button type="button" className="rounded bg-(--app-accent-strong) px-3 py-2 text-sm text-white" onClick={() => void confirmRestore()}>
                确认整体替换并退出
              </button>
            </div>
        </section>
      )}

      {restorePending && (
        <section className="rounded border border-(--app-accent-strong) p-4" role="alert" aria-live="assertive">
          <h3 ref={restoreStatusRef} tabIndex={-1} className="font-medium">本地库已锁定，正在等待恢复</h3>
          {restoreBusy && <p className="mt-2 text-sm">正在校验备份并准备整体替换…</p>}
          {restoreReceipt && (
            <p className="mt-2 text-sm break-all">
              恢复计划 {restoreReceipt.restoreId} 已准备，恢复前备份为 {restoreReceipt.preRestoreBackupId}。请在应用退出后重新打开以继续恢复。
            </p>
          )}
          {restoreDiagnostic && (
            <p className="mt-2 text-sm">
              恢复状态无法从请求结果中确认，可能已有恢复计划等待下次启动。为避免写入，本地库保持锁定；请退出并重新打开应用以检查恢复状态。
            </p>
          )}
          {restoreError && <p className="mt-2 text-sm">{restoreError}</p>}
          {exitAccepted && <p className="mt-2 text-sm">退出请求已提交。本地库仍保持锁定；如应用窗口没有关闭，可再次请求退出。</p>}
          <button
            type="button"
            className="mt-3 rounded bg-(--app-accent-strong) px-3 py-2 text-sm text-white"
            disabled={restoreBusy || restoreExitBusy}
            onClick={() => void requestRestoreExit()}
          >
            {restoreExitBusy ? '正在请求退出…' : '退出应用并继续恢复'}
          </button>
        </section>
      )}
    </section>
  );
};
