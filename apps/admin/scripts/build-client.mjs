import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
const result = await build({ entryPoints: ['src/client/app.tsx'], bundle: true, minify: true, metafile: true,
  platform: 'browser', format: 'esm', jsx: 'automatic', outfile: 'dist/client/assets/app.js', legalComments: 'none' });
for (const input of Object.keys(result.metafile.inputs)) {
  if (/hosted-runtime|src[\\/]security[\\/]|src[\\/]configuration/.test(input)) throw new Error('Server dependency in Admin browser: ' + input);
}
await mkdir('dist', { recursive: true });
await writeFile('dist/client-build.json', JSON.stringify({ inputs: Object.keys(result.metafile.inputs) }, null, 2));
