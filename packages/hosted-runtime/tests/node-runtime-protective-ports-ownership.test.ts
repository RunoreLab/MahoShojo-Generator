import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { build } from 'esbuild';

const ROOT_DIRECTORY = path.resolve(import.meta.dirname, '../../..');
const PACKAGE_DIRECTORY = path.join(ROOT_DIRECTORY, 'packages/hosted-runtime');

const read = (relativePath: string): string =>
  readFileSync(path.join(ROOT_DIRECTORY, relativePath), 'utf8');

describe('protective Node ports ownership', () => {
  const expectedEntries = {
    './node-runtime/activity-token': './src/node-runtime/activity-token.ts',
    './node-runtime/content-safety': './src/node-runtime/content-safety.ts',
    './node-runtime/d1-client': './src/node-runtime/d1-client.ts',
    './node-runtime/data-ports': './src/node-runtime/data-ports.ts',
    './node-runtime/env-signature': './src/node-runtime/env-signature.ts',
    './node-runtime/provider-catalog': './src/node-runtime/provider-catalog.ts',
    './node-runtime/public-rate-limit': './src/node-runtime/public-rate-limit.ts',
    './node-runtime/sensitive-word-filter': './src/node-runtime/sensitive-word-filter.ts',
    './node-runtime/shield-word-filter': './src/node-runtime/shield-word-filter.ts',
    './node-runtime/game-card-content-safety': './src/node-runtime/game-card-content-safety.ts',
  } as const;

  test('manifest 只通过显式 subpath 暴露保护性实现', () => {
    const manifest = JSON.parse(
      readFileSync(path.join(PACKAGE_DIRECTORY, 'package.json'), 'utf8'),
    ) as { exports: Record<string, unknown> };

    for (const [subpath, source] of Object.entries(expectedEntries)) {
      expect(manifest.exports[subpath]).toEqual({
        types: source,
        import: source,
        default: source,
      });
      expect(existsSync(path.join(PACKAGE_DIRECTORY, source))).toBe(true);
    }
  });

  test('protective ports 的完整生产闭包不反向依赖 app 或 root', async () => {
    const result = await build({
      absWorkingDir: ROOT_DIRECTORY,
      entryPoints: Object.values(expectedEntries).map((source) =>
        path.join(PACKAGE_DIRECTORY, source)),
      bundle: true,
      write: false,
      metafile: true,
      packages: 'external',
      logLevel: 'silent',
      platform: 'node',
      tsconfig: path.join(PACKAGE_DIRECTORY, 'tsconfig.json'),
      outdir: path.join(ROOT_DIRECTORY, '.tmp/protective-ports-ownership'),
    });
    const localInputs = Object.keys(result.metafile?.inputs ?? {})
      .map((candidate) => path.isAbsolute(candidate)
        ? candidate
        : path.resolve(ROOT_DIRECTORY, candidate))
      .filter(existsSync)
      .map((candidate) => path.relative(ROOT_DIRECTORY, candidate).split(path.sep).join('/'));

    expect(localInputs).not.toEqual([]);
    expect(localInputs.every((candidate) => candidate.startsWith('packages/'))).toBe(true);
    expect(localInputs).not.toEqual(expect.arrayContaining([
      expect.stringMatching(/^(?:app|components|lib|pages|server|types)\//),
    ]));
  });

  test('公开 provider catalog 不读取或承载 secret-bearing provider config', () => {
    const relativePath = 'packages/hosted-runtime/src/node-runtime/provider-catalog.ts';
    expect(existsSync(path.join(ROOT_DIRECTORY, relativePath))).toBe(true);
    if (!existsSync(path.join(ROOT_DIRECTORY, relativePath))) return;

    const source = read(relativePath);
    expect(source).not.toMatch(/process\.env|AI_PROVIDERS_CONFIG|AI_API_KEY|apiKey\s*:/);
  });
});
