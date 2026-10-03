import {
  DesktopBackupErrorSchema,
  DesktopBackupListSchema,
  DesktopBackupSummarySchema,
  type DesktopBackupError,
  type DesktopBackupList,
  type DesktopBackupSummary,
} from '@mahoshojo/contracts/desktop-ipc';
import { invoke } from '@tauri-apps/api/core';

export const CREATE_LOCAL_BACKUP_COMMAND = 'create_local_backup' as const;
export const LIST_LOCAL_BACKUPS_COMMAND = 'list_local_backups' as const;

export class LocalBackupError extends Error {
  readonly code: DesktopBackupError['code'];

  constructor(error: DesktopBackupError) {
    super(error.message);
    this.name = 'LocalBackupError';
    this.code = error.code;
  }
}

export interface LocalBackupInvokeFn {
  (command: string, args?: Record<string, unknown>): Promise<unknown>;
}

const toBackupError = (cause: unknown): LocalBackupError => {
  const parsed = DesktopBackupErrorSchema.safeParse(cause);
  if (parsed.success) return new LocalBackupError(parsed.data);
  return new LocalBackupError({ code: 'backup-failed', message: '本地备份操作失败，请重试。' });
};

export const createLocalBackup = async (
  call: LocalBackupInvokeFn = (command, args) => invoke(command, args as never),
): Promise<DesktopBackupSummary> => {
  try {
    return DesktopBackupSummarySchema.parse(await call(CREATE_LOCAL_BACKUP_COMMAND));
  } catch (cause) {
    throw toBackupError(cause);
  }
};

export const listLocalBackups = async (
  call: LocalBackupInvokeFn = (command, args) => invoke(command, args as never),
): Promise<DesktopBackupList> => {
  try {
    return DesktopBackupListSchema.parse(await call(LIST_LOCAL_BACKUPS_COMMAND));
  } catch (cause) {
    throw toBackupError(cause);
  }
};
