import { useCallback, useEffect, useState } from 'react';
import type { DesktopBackupList, DesktopBackupSummary } from '@mahoshojo/contracts/desktop-ipc';
import { createLocalBackup, listLocalBackups, LocalBackupError } from '../../platform/local-backup-bridge';

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
    if (!enabled || !acquireOperation()) return;
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
  }, [acquireOperation, enabled, refresh, releaseOperation]);

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
          <button type="button" className="rounded border border-(--app-border) px-3 py-2 text-sm" disabled={!enabled || busy} onClick={() => void run('refresh')}>
            刷新列表
          </button>
          <button type="button" className="rounded bg-(--app-accent-strong) px-3 py-2 text-sm text-white" disabled={!enabled || busy} onClick={() => void run('create')}>
            创建备份
          </button>
        </div>
      </header>

      {busy && <p role="status" className="mt-3 text-sm">{loading ? '正在读取本机备份…' : '正在创建本机备份…'}</p>}
      {error && <p role="alert" className="mt-3 text-sm text-(--app-accent-strong)">{error}</p>}
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
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-(--app-text-muted)">备份文件由你管理；应用不会自动清理旧备份。</p>
    </section>
  );
};
