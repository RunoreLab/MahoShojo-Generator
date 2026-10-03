import { describe, expect, it, vi } from 'vitest';
import fixture from '../../../fixtures/desktop-backup.json';
import {
  CREATE_LOCAL_BACKUP_COMMAND,
  EXIT_AFTER_LOCAL_RESTORE_COMMAND,
  LIST_LOCAL_BACKUPS_COMMAND,
  PREPARE_LOCAL_RESTORE_COMMAND,
  LocalBackupError,
  LocalRestoreError,
  createLocalBackup,
  listLocalBackups,
  prepareLocalRestore,
  exitAfterLocalRestore,
} from '../src/platform/local-backup-bridge';

describe('local backup bridge', () => {
  it('calls create and list with no renderer-selected path, then validates native results', async () => {
    const invoke = vi.fn()
      .mockResolvedValueOnce(fixture.summary)
      .mockResolvedValueOnce({ backups: [fixture.summary], invalidCount: 1 });

    await expect(createLocalBackup(invoke)).resolves.toEqual(fixture.summary);
    await expect(listLocalBackups(invoke)).resolves.toEqual({ backups: [fixture.summary], invalidCount: 1 });
    expect(invoke).toHaveBeenNthCalledWith(1, CREATE_LOCAL_BACKUP_COMMAND);
    expect(invoke).toHaveBeenNthCalledWith(2, LIST_LOCAL_BACKUPS_COMMAND);
  });

  it('fails closed for invalid responses and projects only canonical backend errors', async () => {
    const invalidResponse = await createLocalBackup(vi.fn().mockResolvedValue({
      ...fixture.summary,
      absolutePath: '',
    })).catch((cause: unknown) => cause);
    expect(invalidResponse).toBeInstanceOf(LocalBackupError);
    expect(invalidResponse).toMatchObject({ code: 'backup-failed' });

    await expect(listLocalBackups(vi.fn().mockRejectedValue({
      code: 'backup-source-unavailable',
      message: 'local backup source is unavailable',
    }))).rejects.toMatchObject({
      name: 'LocalBackupError',
      code: 'backup-source-unavailable',
      message: '本地备份目录当前不可读取。',
    });

    const unsafe = await createLocalBackup(vi.fn().mockRejectedValue({ code: 'unknown', message: 'private detail' }))
      .catch((cause: unknown) => cause);
    expect(unsafe).toMatchObject({ code: 'backup-failed' });
    expect((unsafe as Error).message).not.toContain('private detail');
  });

  it('validates the backup selector before IPC and validates the prepared restore response', async () => {
    const invoke = vi.fn().mockResolvedValue({
      restoreId: 'restore-1-2-3',
      backupId: fixture.summary.backupId,
      preRestoreBackupId: 'local-library-20261002T040000Z',
    });
    await expect(prepareLocalRestore(fixture.summary.backupId, invoke)).resolves.toMatchObject({
      restoreId: 'restore-1-2-3',
      backupId: fixture.summary.backupId,
    });
    expect(invoke).toHaveBeenCalledWith(PREPARE_LOCAL_RESTORE_COMMAND, { request: { backupId: fixture.summary.backupId } });

    const invalidInvoke = vi.fn();
    await expect(prepareLocalRestore('../escape', invalidInvoke)).rejects.toMatchObject({ code: 'invalid-backup-id' });
    expect(invalidInvoke).not.toHaveBeenCalled();
  });

  it('marks an invalid or mismatched successful prepare response as possibly pending', async () => {
    for (const response of [
      { malformed: true },
      {
        restoreId: 'restore-1-2-3',
        backupId: 'local-library-20261002T040000Z',
        preRestoreBackupId: 'local-library-20261001T040000Z',
      },
    ]) {
      const cause = await prepareLocalRestore(fixture.summary.backupId, vi.fn().mockResolvedValue(response))
        .catch((error: unknown) => error);
      expect(cause).toBeInstanceOf(LocalRestoreError);
      expect(cause).toMatchObject({ code: 'restore-failed', pendingMayExist: true });
    }
  });

  it('uses the dedicated exit command and keeps error codes without exposing backend text', async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    await expect(exitAfterLocalRestore(invoke)).resolves.toBeUndefined();
    expect(invoke).toHaveBeenCalledWith(EXIT_AFTER_LOCAL_RESTORE_COMMAND);

    const error = await exitAfterLocalRestore(vi.fn().mockRejectedValue({
      code: 'restore-failed',
      message: 'native detail',
    })).catch((cause: unknown) => cause);
    expect(error).toMatchObject({ code: 'restore-failed' });
    expect((error as Error).message).not.toContain('native detail');
  });
});
