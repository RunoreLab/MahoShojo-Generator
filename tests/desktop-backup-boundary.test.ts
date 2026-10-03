import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const native = readFileSync(new URL('../apps/desktop/src-tauri/src/lib.rs', import.meta.url), 'utf8');

describe('Desktop native backup boundary', () => {
  it('runs creation and verification away from the IPC executor', () => {
    for (const command of ['create_local_backup', 'list_local_backups']) {
      const declaration = new RegExp(`async fn ${command}\\([\\s\\S]*?\\n\\}`, 'u').exec(native)?.[0];
      expect(declaration, command).toBeDefined();
      expect(declaration).toContain('spawn_blocking');
      expect(native).toMatch(new RegExp(`\\n\\s+${command},`, 'u'));
    }
  });
  it('does not give the backup mechanism access to OS credentials', () => {
    const backup = readFileSync(new URL('../apps/desktop/src-tauri/src/backup.rs', import.meta.url), 'utf8');
    expect(backup).not.toMatch(/(?:crate::secret|SharedSecretStore|keyring::)/u);
  });
});
