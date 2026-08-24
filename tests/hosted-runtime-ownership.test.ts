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
  './generate-game-card-runtime',
];

const ROOT_DIRECTORY = process.cwd();
const PACKAGE_DIRECTORY = path.join(ROOT_DIRECTORY, 'packages', 'hosted-runtime');
const PACKAGE_MANIFEST_PATH = path.join(PACKAGE_DIRECTORY, 'package.json');

const ADAPTER_SOURCE_FILES = [
  'server/adapters/generate-free.ts',
  'server/adapters/generate-free-stream.ts',
  'server/adapters/generate-scenario.ts',
  'server/adapters/generate-scenario-stream.ts',
  'server/adapters/generate-canshou.ts',
  'server/adapters/generate-canshou-stream.ts',
  'server/adapters/generate-magical-girl.ts',
  'server/adapters/generate-game-card.ts',
  'server/adapters/creator/generate.ts',
  'server/adapters/creator/generate-stream.ts',
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
    tsconfig: path.join(ROOT_DIRECTORY, 'tsconfig.server.json'),
  });

  return Object.keys(result.metafile?.inputs ?? {})
    .map(resolveWorkspacePath)
    .filter(existsSync)
    .sort();
};

const isForbiddenLegacyLocalDependency = (sourceFile: string) => {
  const relative = toPosixPath(path.relative(ROOT_DIRECTORY, sourceFile));
  if (!relative || relative.startsWith('../') || path.isAbsolute(relative)) return false;

  if (relative.startsWith('server/adapters/')) return false;
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

  test('server/adapters 生产闭包依赖不允许依赖 legacy root 或动态模块加载', async () => {
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
});
