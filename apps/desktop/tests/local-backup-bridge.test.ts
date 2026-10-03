import { describe, expect, it, vi } from 'vitest';
import fixture from '../../../fixtures/desktop-backup.json';
import {
  CREATE_LOCAL_BACKUP_COMMAND,
  LIST_LOCAL_BACKUPS_COMMAND,
  LocalBackupError,
  createLocalBackup,
  listLocalBackups,
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
      message: 'local backup source is unavailable',
    });

    const unsafe = await createLocalBackup(vi.fn().mockRejectedValue({ code: 'unknown', message: 'private detail' }))
      .catch((cause: unknown) => cause);
    expect(unsafe).toMatchObject({ code: 'backup-failed' });
    expect((unsafe as Error).message).not.toContain('private detail');
  });
});
