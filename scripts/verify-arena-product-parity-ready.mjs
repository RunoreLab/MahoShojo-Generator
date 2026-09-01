import { spawnSync } from 'node:child_process';
import path from 'node:path';

const repositoryRoot = path.resolve(import.meta.dirname, '..');
const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

const steps = [
  {
    label: 'manifest gate',
    command: process.execPath,
    args: ['scripts/check-arena-product-parity.mjs', '--require-ready'],
  },
  {
    label: 'workspace/package/repository CI',
    args: ['run', 'ci:verify'],
  },
  {
    label: 'loopback Redis room/generation/recovery evidence',
    command: process.execPath,
    args: ['scripts/verify-arena-product-parity-redis.mjs'],
  },
  {
    label: 'working tree whitespace validation',
    command: 'git',
    args: ['diff', '--check'],
  },
  {
    label: 'reviewed source digest recheck',
    command: process.execPath,
    args: ['scripts/check-arena-product-parity.mjs', '--require-ready'],
  },
];

for (const step of steps) {
  console.log(`[arena-product-parity-ready] ${step.label}`);
  const result = spawnSync(
    step.command ?? pnpmCommand,
    step.args,
    { cwd: repositoryRoot, stdio: 'inherit' },
  );
  if (result.error) {
    console.error(`[arena-product-parity-ready] ${step.label} failed: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`[arena-product-parity-ready] ${step.label} exited with ${result.status ?? 'signal'}`);
    process.exit(result.status ?? 1);
  }
}

console.log('[arena-product-parity-ready] PASS');
