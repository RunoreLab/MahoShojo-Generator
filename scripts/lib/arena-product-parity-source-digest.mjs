import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const excludedPaths = new Set([
  'config/arena-product-parity-gate.json',
]);

export const computeArenaProductParitySourceDigest = (repositoryRoot) => {
  const listed = spawnSync('git', ['ls-files', '-z'], {
    cwd: repositoryRoot,
    encoding: 'buffer',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (listed.error) throw listed.error;
  if (listed.status !== 0) {
    throw new Error(`git ls-files 失败：${listed.stderr.toString('utf8').trim()}`);
  }

  const files = listed.stdout.toString('utf8').split('\0')
    .filter(Boolean)
    .filter((relativePath) => !excludedPaths.has(relativePath))
    .filter((relativePath) => !relativePath.startsWith('docs/logs/'))
    .sort();
  const digest = createHash('sha256');
  for (const relativePath of files) {
    digest.update(relativePath);
    digest.update('\0');
    digest.update(readFileSync(path.resolve(repositoryRoot, relativePath)));
    digest.update('\0');
  }
  return digest.digest('hex');
};
