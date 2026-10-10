import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

// Same pure owner as Web; bundle in memory, never maintain a second CSP literal here.
const { outputFiles } = await build({
  absWorkingDir: fileURLToPath(new URL('..', import.meta.url)),
  entryPoints: [fileURLToPath(new URL('../packages/web-package/src/desktop-execution-policy.ts', import.meta.url))],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
});
const { DESKTOP_WEB_EXECUTION_POLICIES, DESKTOP_WEB_RESOURCE_ORIGINS } = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString('base64')}`
);
const manifest = {
  version: 1,
  resourceOrigins: DESKTOP_WEB_RESOURCE_ORIGINS,
  policies: DESKTOP_WEB_EXECUTION_POLICIES,
};
const output = new URL('../apps/desktop/src-tauri/src/generated/web-execution-policies.json', import.meta.url);
const text = `${JSON.stringify(manifest, null, 2)}\n`;
if (process.argv.includes('--check')) {
  if (await readFile(output, 'utf8') !== text) {
    throw new Error('Native Web execution policy drift: run generate:desktop-web-execution-policies');
  }
} else await writeFile(output, text);
