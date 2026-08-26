import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { build } from 'esbuild';

import { checkWorkspaceBoundaries } from '../scripts/check-workspace-boundaries.mjs';

const RUNTIME_SUBPATHS = [
  './generate-free-runtime',
  './generate-free-stream-runtime',
  './generate-scenario-runtime',
  './generate-scenario-stream-runtime',
  './generate-creator-runtime',
  './generate-creator-stream-runtime',
  './generate-canshou-runtime',
  './generate-canshou-stream-runtime',
  './generate-magical-girl-runtime',
  './generate-magical-girl-details-runtime',
  './generate-magical-girl-details-stream-runtime',
  './generate-sublimation-runtime',
  './generate-sublimation-stream-runtime',
  './generate-game-card-runtime',
  './generation-lifecycle',
];

const ROOT_DIRECTORY = process.cwd();
const PACKAGE_DIRECTORY = path.join(ROOT_DIRECTORY, 'packages', 'hosted-runtime');
const PACKAGE_MANIFEST_PATH = path.join(PACKAGE_DIRECTORY, 'package.json');

const ADAPTER_SOURCE_FILES = [
  'apps/api/src/adapters/generate-free.ts',
  'apps/api/src/adapters/generate-free-stream.ts',
  'apps/api/src/adapters/generate-scenario.ts',
  'apps/api/src/adapters/generate-scenario-stream.ts',
  'apps/api/src/adapters/generate-canshou.ts',
  'apps/api/src/adapters/generate-canshou-stream.ts',
  'apps/api/src/adapters/generate-magical-girl.ts',
  'apps/api/src/adapters/generate-magical-girl-details.ts',
  'apps/api/src/adapters/generate-magical-girl-details-stream.ts',
  'apps/api/src/adapters/generate-sublimation.ts',
  'apps/api/src/adapters/generate-sublimation-stream.ts',
  'apps/api/src/adapters/generate-game-card.ts',
  'apps/api/src/adapters/creator/generate.ts',
  'apps/api/src/adapters/creator/generate-stream.ts',
];

const FORBIDDEN_ADAPTER_LEGACY_ROOTS = ['app', 'components', 'lib', 'pages', 'types', 'server'];

const toPosixPath = (value: string): string => value.split(path.sep).join('/');
const resolveWorkspacePath = (candidateInput: string) => path.isAbsolute(candidateInput)
  ? candidateInput
  : path.resolve(ROOT_DIRECTORY, candidateInput);

const collectAdapterClosureInputs = async (entryFile: string) => {
  const result = await build({
    absWorkingDir: ROOT_DIRECTORY,
    entryPoints: [path.resolve(ROOT_DIRECTORY, entryFile)],
    bundle: true,
    write: false,
    metafile: true,
    packages: 'external',
    logLevel: 'silent',
    platform: 'node',
    tsconfig: path.join(ROOT_DIRECTORY, 'apps', 'api', 'tsconfig.json'),
  });

  return Object.keys(result.metafile?.inputs ?? {})
    .map(resolveWorkspacePath)
    .filter(existsSync)
    .sort();
};

const isForbiddenLegacyLocalDependency = (sourceFile: string) => {
  const relative = toPosixPath(path.relative(ROOT_DIRECTORY, sourceFile));
  if (!relative || relative.startsWith('../') || path.isAbsolute(relative)) return false;

  if (relative.startsWith('apps/api/src/adapters/')) return false;
  const topLevelDirectory = relative.split('/')[0] ?? '';
  return FORBIDDEN_ADAPTER_LEGACY_ROOTS.includes(topLevelDirectory);
};

const expectRuntimeManifestPath = (candidate: string) => {
  const candidatePath = path.resolve(PACKAGE_DIRECTORY, candidate);
  expect(existsSync(candidatePath)).toBe(true);
};

const readPackageManifest = () => JSON.parse(readFileSync(PACKAGE_MANIFEST_PATH, 'utf8'));

describe('hosted-runtime ownership boundary', () => {
  test('hosted-runtime 持有全部新旧 composition runtime 子路径', () => {
    const manifest = readPackageManifest();

    expect(manifest?.exports).toBeTypeOf('object');
    for (const runtimeSubpath of RUNTIME_SUBPATHS) {
      expect(manifest.exports).toHaveProperty(runtimeSubpath);

      const runtimeEntry = manifest.exports[runtimeSubpath];
      const expectedEntry = `./src/${runtimeSubpath.substring(2)}.ts`;
      expect(runtimeEntry).toMatchObject({
        types: expectedEntry,
        import: expectedEntry,
        default: expectedEntry,
      });

      expectRuntimeManifestPath(expectedEntry);
    }
  });

  test('apps/api adapters 生产闭包依赖不允许依赖 legacy root 或动态模块加载', async () => {
    const boundaryViolations = checkWorkspaceBoundaries(ROOT_DIRECTORY);
    const adapterClosures = await Promise.all(ADAPTER_SOURCE_FILES.map((adapter) => collectAdapterClosureInputs(adapter)));
    const allClosureInputs = new Set(adapterClosures.flat());
    const forbiddenClosureInputs = [...allClosureInputs].filter(isForbiddenLegacyLocalDependency);

    expect(
      boundaryViolations.filter((violation) => violation.rule === 'MONO-009-HONO-ADAPTER-DYNAMIC' && allClosureInputs.has(violation.file)),
    ).toEqual([]);

    expect(
      forbiddenClosureInputs.map((filePath) => toPosixPath(path.relative(ROOT_DIRECTORY, filePath))),
    ).toEqual([]);
  });

  test('hosted-runtime 包源码在现有边界检查下无新增违规', () => {
    const violations = checkWorkspaceBoundaries(process.cwd()).filter((violation) => {
      const relativePath = toPosixPath(path.relative(ROOT_DIRECTORY, violation.file));
      return relativePath !== ''
        && !relativePath.startsWith('../')
        && relativePath.startsWith('packages/hosted-runtime/src/');
    });

    expect(violations).toEqual([]);
  });

  test('G25H-2 preset 与 AI runtime 不经公开 Web URL self-hop', () => {
    const defaultServices = readFileSync(
      path.join(PACKAGE_DIRECTORY, 'src/node-runtime/default-services.ts'),
      'utf8',
    );
    expect(defaultServices).toContain('requireQuestionnairePresetAsset(path)');
    expect(defaultServices).not.toContain('new URL(path, requestUrl)');
    for (const runtime of [
      'generate-magical-girl-details-runtime.ts',
      'generate-magical-girl-details-stream-runtime.ts',
      'generate-sublimation-runtime.ts',
      'generate-sublimation-stream-runtime.ts',
    ]) {
      const source = readFileSync(path.join(PACKAGE_DIRECTORY, 'src', runtime), 'utf8');
      expect(source, runtime).not.toMatch(/fetch\(|apps\/web|app\/api/u);
    }
  });
});
