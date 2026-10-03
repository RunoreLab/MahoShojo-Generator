import {
  DesktopBackupErrorSchema,
  DesktopBackupListSchema,
  DesktopBackupSummarySchema,
  DesktopPrepareRestoreRequestSchema,
  DesktopPrepareRestoreResponseSchema,
  DesktopRestoreErrorSchema,
  type DesktopBackupError,
  type DesktopBackupList,
  type DesktopBackupSummary,
  type DesktopPrepareRestoreResponse,
  type DesktopRestoreError,
} from '@mahoshojo/contracts/desktop-ipc';
import { invoke } from '@tauri-apps/api/core';

export const CREATE_LOCAL_BACKUP_COMMAND = 'create_local_backup' as const;
export const LIST_LOCAL_BACKUPS_COMMAND = 'list_local_backups' as const;
export const PREPARE_LOCAL_RESTORE_COMMAND = 'prepare_local_restore' as const;
export const EXIT_AFTER_LOCAL_RESTORE_COMMAND = 'exit_after_local_restore' as const;

const ERROR_MESSAGES: Record<DesktopRestoreError['code'], string> = {
  'invalid-backup-id': '备份标识无效，请刷新备份列表后重试。',
  'backup-incomplete': '所选备份不完整，无法恢复。',
  'backup-unsupported-version': '此备份格式版本不受支持。',
  'backup-corrupt': '备份内容未通过完整性校验，无法恢复。',
  'backup-source-unavailable': '本地备份目录当前不可读取。',
  'backup-failed': '本地备份操作失败，请重试。',
  'maintenance-busy': '本地库正有另一项维护操作，请稍后重试。',
  'restore-pending': '已有恢复正在等待下次启动，请退出并重新打开应用。',
  'restore-invalid-intent': '恢复计划状态无效。请保持应用关闭并联系维护人员检查。',
  'restore-failed': '恢复准备未能完成。请检查本地库状态后重试。',
};

export class LocalBackupError extends Error {
  readonly code: DesktopBackupError['code'];

  constructor(error: DesktopBackupError) {
    super(ERROR_MESSAGES[error.code]);
    this.name = 'LocalBackupError';
    this.code = error.code;
  }
}

export class LocalRestoreError extends Error {
  readonly code: DesktopRestoreError['code'];
  /** The native prepare call resolved, so a durable intent may already exist. */
  readonly pendingMayExist: boolean;

  constructor(code: DesktopRestoreError['code'], pendingMayExist = false) {
    super(ERROR_MESSAGES[code]);
    this.name = 'LocalRestoreError';
    this.code = code;
    this.pendingMayExist = pendingMayExist || code === 'restore-pending' || code === 'restore-invalid-intent';
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

const toRestoreError = (cause: unknown): LocalRestoreError => {
  const parsed = DesktopRestoreErrorSchema.safeParse(cause);
  if (parsed.success) return new LocalRestoreError(parsed.data.code);
  return new LocalRestoreError('restore-failed');
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

export const prepareLocalRestore = async (
  backupId: string,
  call: LocalBackupInvokeFn = (command, args) => invoke(command, args as never),
): Promise<DesktopPrepareRestoreResponse> => {
  let request;
  try {
    request = DesktopPrepareRestoreRequestSchema.parse({ backupId });
  } catch {
    throw new LocalRestoreError('invalid-backup-id');
  }

  let raw: unknown;
  try {
    raw = await call(PREPARE_LOCAL_RESTORE_COMMAND, { request });
  } catch (cause) {
    throw toRestoreError(cause);
  }

  let response: DesktopPrepareRestoreResponse;
  try {
    response = DesktopPrepareRestoreResponseSchema.parse(raw);
  } catch {
    // Native may have durably published restore.intent before a malformed response was
    // observed. Keep the renderer read-only and offer exit/reopen diagnostics.
    throw new LocalRestoreError('restore-failed', true);
  }
  if (response.backupId !== request.backupId || response.preRestoreBackupId === response.backupId) {
    throw new LocalRestoreError('restore-failed', true);
  }
  return response;
};

export const exitAfterLocalRestore = async (
  call: LocalBackupInvokeFn = (command, args) => invoke(command, args as never),
): Promise<void> => {
  try {
    await call(EXIT_AFTER_LOCAL_RESTORE_COMMAND);
  } catch (cause) {
    throw toRestoreError(cause);
  }
};
