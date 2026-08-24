import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { build } from 'esbuild';

const ROOT_DIRECTORY = path.resolve(import.meta.dirname, '../../..');
const PACKAGE_DIRECTORY = path.join(ROOT_DIRECTORY, 'packages/hosted-runtime');

const expectedEntries = {
  './creator/build-rule-projection': './src/creator/build-rule-projection.ts',
  './creator/build-rule-request': './src/creator/build-rule-request.ts',
  './creator/build-rule-runtime': './src/creator/build-rule-runtime.ts',
  './creator/build-rules': './src/creator/build-rules.ts',
  './creator/card-metadata': './src/creator/card-metadata.ts',
  './creator/prompt': './src/creator/prompt.ts',
  './creator/server': './src/creator/server.ts',
  './creator/templates': './src/creator/templates.ts',
  './creator/types': './src/creator/types.ts',
  './node-runtime/static-assets': './src/node-runtime/static-assets.ts',
} as const;

const assetMirrors = [
  ['public/build-rules/presets/index.json', 'packages/hosted-runtime/src/assets/build-rules/presets/index.json'],
  ['public/build-rules/presets/arena-trpg-lite.json', 'packages/hosted-runtime/src/assets/build-rules/presets/arena-trpg-lite.json'],
  ['public/build-rules/presets/dnd-5e-lite.json', 'packages/hosted-runtime/src/assets/build-rules/presets/dnd-5e-lite.json'],
  ['public/build-rules/presets/coc-7e-lite.json', 'packages/hosted-runtime/src/assets/build-rules/presets/coc-7e-lite.json'],
  ['public/build-rules/presets/terrorinfinity-fx-v137.json', 'packages/hosted-runtime/src/assets/build-rules/presets/terrorinfinity-fx-v137.json'],
  ['public/questionnaires/presets/index.json', 'packages/hosted-runtime/src/assets/questionnaires/presets/index.json'],
  ['public/flowers.json', 'packages/hosted-runtime/src/assets/flowers.json'],
] as const;

const read = (relativePath: string): string => readFileSync(
  path.join(ROOT_DIRECTORY, relativePath),
  'utf8',
);

describe('Creator/static asset ownership', () => {
  test('manifest 暴露 package-owned Creator runtime 与静态资产入口', () => {
    const manifest = JSON.parse(read('packages/hosted-runtime/package.json')) as {
      exports: Record<string, unknown>;
    };
    for (const [subpath, source] of Object.entries(expectedEntries)) {
      expect(manifest.exports[subpath]).toEqual({
        types: source,
        import: source,
        default: source,
      });
      expect(existsSync(path.join(PACKAGE_DIRECTORY, source))).toBe(true);
    }
  });

  test('root Creator/lore/flower 入口仅保留 package compatibility wrapper', () => {
    for (const wrapper of [
      'lib/creator/build-rule-projection.ts',
      'lib/creator/build-rule-request.ts',
      'lib/creator/build-rule-runtime.ts',
      'lib/creator/build-rules.ts',
      'lib/creator/card-metadata.ts',
      'lib/creator/prompt.ts',
      'lib/creator/server.ts',
      'lib/creator/templates.ts',
      'lib/creator/types.ts',
      'lib/canshou-lore.ts',
      'lib/random-choose-hana-name.ts',
    ]) {
      const source = read(wrapper);
      expect(source).toContain('@mahoshojo/hosted-runtime/');
      expect(source.split(/\r?\n/).length).toBeLessThanOrEqual(10);
    }
  });

  test('server 与 public 使用逐字一致的受审静态资产镜像', () => {
    for (const [publicAsset, packageAsset] of assetMirrors) {
      expect(existsSync(path.join(ROOT_DIRECTORY, packageAsset))).toBe(true);
      if (!existsSync(path.join(ROOT_DIRECTORY, packageAsset))) continue;
      expect(read(packageAsset)).toBe(read(publicAsset));
    }
  });

  test('Creator/static asset 完整生产闭包不反向依赖 legacy root', async () => {
    const result = await build({
      absWorkingDir: ROOT_DIRECTORY,
      entryPoints: Object.values(expectedEntries).map((source) => path.join(PACKAGE_DIRECTORY, source)),
      bundle: true,
      write: false,
      metafile: true,
      packages: 'external',
      logLevel: 'silent',
      platform: 'node',
      tsconfig: path.join(PACKAGE_DIRECTORY, 'tsconfig.json'),
      outdir: path.join(ROOT_DIRECTORY, '.tmp/creator-assets-ownership'),
    });
    const localInputs = Object.keys(result.metafile?.inputs ?? {})
      .map((candidate) => path.isAbsolute(candidate)
        ? candidate
        : path.resolve(ROOT_DIRECTORY, candidate))
      .filter(existsSync)
      .map((candidate) => path.relative(ROOT_DIRECTORY, candidate).split(path.sep).join('/'));

    expect(localInputs).not.toEqual([]);
    expect(localInputs.every((candidate) => candidate.startsWith('packages/'))).toBe(true);
  });
});
