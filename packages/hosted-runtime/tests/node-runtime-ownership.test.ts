import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { build } from 'esbuild';

const ROOT_DIRECTORY = path.resolve(import.meta.dirname, '../../..');
const PACKAGE_DIRECTORY = path.join(ROOT_DIRECTORY, 'packages/hosted-runtime');

describe('Node AI runtime ownership', () => {
  test('package exports a Node-only runtime composition entry', () => {
    const manifest = JSON.parse(readFileSync(path.join(PACKAGE_DIRECTORY, 'package.json'), 'utf8'));
    expect(manifest.exports['./node-runtime']).toEqual({
      types: './src/node-runtime/index.ts',
      import: './src/node-runtime/index.ts',
      default: './src/node-runtime/index.ts',
    });
    expect(existsSync(path.join(PACKAGE_DIRECTORY, 'src/node-runtime/index.ts'))).toBe(true);
  });

  test('Node AI runtime production closure is package-owned and portable', async () => {
    const result = await build({
      absWorkingDir: ROOT_DIRECTORY,
      entryPoints: [path.join(PACKAGE_DIRECTORY, 'src/node-runtime/index.ts')],
      bundle: true,
      write: false,
      metafile: true,
      packages: 'external',
      logLevel: 'silent',
      platform: 'node',
      tsconfig: path.join(PACKAGE_DIRECTORY, 'tsconfig.json'),
    });

    const localInputs = Object.keys(result.metafile?.inputs ?? {})
      .map((candidate) => path.isAbsolute(candidate) ? candidate : path.resolve(ROOT_DIRECTORY, candidate))
      .filter(existsSync)
      .map((candidate) => path.relative(ROOT_DIRECTORY, candidate).split(path.sep).join('/'));

    expect(localInputs).not.toEqual([]);
    expect(localInputs.every((candidate) => candidate.startsWith('packages/'))).toBe(true);
    expect(localInputs).not.toEqual(expect.arrayContaining([
      expect.stringMatching(/^(?:app|components|lib|pages|server|types)\//),
    ]));
  });
});
