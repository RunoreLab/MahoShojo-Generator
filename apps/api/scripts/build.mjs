import { rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(scriptDirectory, '..');
const outputDirectory = path.join(appRoot, 'dist');

await rm(outputDirectory, { recursive: true, force: true });
await build({
  absWorkingDir: appRoot,
  entryPoints: [path.join(appRoot, 'src', 'index.ts')],
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
    'server-only': path.join(appRoot, 'src', 'shims', 'server-only.ts'),
  },
});
