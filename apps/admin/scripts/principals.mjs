import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await build({ entryPoints: [path.join(root, 'scripts/principals.ts')], bundle: true, platform: 'node', format: 'esm', external: ['miniflare'], banner: {js: "import { createRequire as nodeCreateRequire } from 'node:module'; const require = nodeCreateRequire(import.meta.url);"}, outfile: path.join(root, '.wrangler/principals.mjs') });
const result = spawnSync(process.execPath, [path.join(root, '.wrangler/principals.mjs'), ...process.argv.slice(2)], { cwd: root, stdio: 'inherit' });
process.exitCode = result.status ?? 1;
