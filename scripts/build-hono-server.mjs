import { rm } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';

const projectRoot = process.cwd();
const outputDirectory = path.join(projectRoot, 'dist', 'server');

await rm(outputDirectory, { recursive: true, force: true });
await build({
  entryPoints: [path.join(projectRoot, 'server', 'index.ts')],
  outfile: path.join(outputDirectory, 'index.mjs'),
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  sourcemap: true,
  minify: false,
  logLevel: 'info',
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
  alias: {
    'server-only': path.join(projectRoot, 'server', 'shims', 'server-only.ts'),
  },
});
