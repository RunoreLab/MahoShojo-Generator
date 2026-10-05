import { mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { spawnSync } = createRequire(import.meta.url)('node:child_process');

function runsCleanly(command: string, args: readonly string[]): boolean {
  const result = spawnSync(command, args, { stdio: 'ignore' });
  return result?.error === undefined && result?.status === 0;
}

export const hasSh = runsCleanly('sh', ['-c', 'exit 0']);
export const hasBash = runsCleanly('bash', ['-c', 'exit 0']);

export const hasSymlink = (() => {
  const directory = mkdtempSync(join(tmpdir(), 'maho-symlink-probe-'));
  try {
    writeFileSync(join(directory, 'target'), '');
    symlinkSync(join(directory, 'target'), join(directory, 'link'));
    return true;
  } catch {
    return false;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
})();

export const hasCaseSensitiveFs = (() => {
  const directory = mkdtempSync(join(tmpdir(), 'maho-case-probe-'));
  try {
    writeFileSync(join(directory, 'lower'), '');
    writeFileSync(join(directory, 'LOWER'), '');
    return readdirSync(directory).length === 2;
  } catch {
    return false;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
})();

const pythonCandidates =
  process.platform === 'win32' ? ['python', 'python3'] : ['python3', 'python'];

export const posixPython = pythonCandidates.find((candidate) =>
  runsCleanly(candidate, ['-c', 'import fcntl']),
);