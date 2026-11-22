import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, '.wrangler/review-public-control.mjs');
await build({ entryPoints: [path.join(root, 'scripts/review-public-control.ts')], bundle: true,
  platform: 'node', format: 'esm', outfile: output });
const result = spawnSync(process.execPath, [output, ...process.argv.slice(2)], { cwd: process.cwd(), stdio: 'inherit' });
process.exitCode = result.status ?? 1;
