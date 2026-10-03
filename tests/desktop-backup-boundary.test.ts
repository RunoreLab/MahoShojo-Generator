import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const native = readFileSync(new URL('../apps/desktop/src-tauri/src/lib.rs', import.meta.url), 'utf8');

describe('Desktop native backup boundary', () => {
  it('runs creation and verification away from the IPC executor', () => {
    for (const command of ['create_local_backup', 'list_local_backups', 'prepare_local_restore']) {
      const declaration = new RegExp(`async fn ${command}\\([\\s\\S]*?\\n\\}`, 'u').exec(native)?.[0];
      expect(declaration, command).toBeDefined();
      expect(declaration).toContain('spawn_blocking');
      expect(native).toMatch(new RegExp(`\\n\\s+${command},`, 'u'));
    }
  });
  it('recovers only after the instance lock and before database opening', () => {
    const locked = native.indexOf('let instance = maintenance::InstanceGuard::acquire');
    const recovery = native.indexOf('restore::recover_pending(&data_root)');
    const opened = native.indexOf('let library = LocalLibrary::open(&data_root)');
    expect(locked).toBeGreaterThan(-1);
    expect(recovery).toBeGreaterThan(locked);
    expect(opened).toBeGreaterThan(recovery);
    const exit = /fn exit_after_local_restore\([\s\S]*?\n\}/u.exec(native)?.[0];
    expect(exit).toContain('slot.is_none()');
    expect(exit).toContain('app.exit(0)');
  });
  it('does not give the backup mechanism access to OS credentials', () => {
    const backup = readFileSync(new URL('../apps/desktop/src-tauri/src/backup.rs', import.meta.url), 'utf8');
    expect(backup).not.toMatch(/(?:crate::secret|SharedSecretStore|keyring::)/u);
  });
});
