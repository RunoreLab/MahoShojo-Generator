import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const APP = path.join(ROOT, 'apps/api');

const collectFiles = (directory: string): string[] => {
  if (!existsSync(directory)) return [];
  return readdirSync(directory).flatMap((entry) => {
    if (entry === 'dist' || entry === 'node_modules') return [];
    const candidate = path.join(directory, entry);
    return statSync(candidate).isDirectory() ? collectFiles(candidate) : [candidate];
  });
};

describe('apps/api source ownership', () => {
  it('持有完整 Hono source、scripts 与 tests，root 不再保留双重 owner', () => {
    for (const relativePath of [
      'src/index.ts',
      'src/main.ts',
      'src/app.ts',
      'src/generated/routes.ts',
      'src/routes/dispatcher.ts',
      'src/runtime/execution-context.ts',
      'scripts/build.mjs',
      'scripts/generate-route-manifest.mjs',
      'scripts/verify-runtime.mjs',
      'tests/hono-app.test.ts',
      'tests/route-manifest.test.ts',
      'tests/shutdown-signals.test.ts',
    ]) {
      expect(existsSync(path.join(APP, relativePath)), relativePath).toBe(true);
    }

    expect(existsSync(path.join(ROOT, 'server'))).toBe(false);
    expect(existsSync(path.join(ROOT, 'tests/server'))).toBe(false);
    expect(existsSync(path.join(ROOT, 'scripts/build-hono-server.mjs'))).toBe(false);
    expect(existsSync(path.join(ROOT, 'scripts/generate-hono-route-manifest.mjs'))).toBe(false);
    expect(existsSync(path.join(ROOT, 'scripts/verify-hono-runtime.mjs'))).toBe(false);
  });

  it('声明最小生产 closure、独立工具链与 package-local alias', () => {
    const manifestPath = path.join(APP, 'package.json');
    expect(existsSync(manifestPath)).toBe(true);
    if (!existsSync(manifestPath)) return;

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      imports?: Record<string, string>;
    };
    expect(Object.keys(manifest.dependencies ?? {}).sort()).toEqual([
      '@hono/node-server',
      '@mahoshojo/hosted-api',
      '@mahoshojo/hosted-runtime',
      '@mahoshojo/multiplayer-core',
      'dotenv',
      'hono',
      'redis',
    ]);
    expect(manifest.imports).toEqual({ '#/*': './src/*.ts' });
    expect(Object.keys(manifest.devDependencies ?? {})).toEqual(expect.arrayContaining([
      '@types/node',
      'esbuild',
      'eslint',
      'tsx',
      'typescript',
      'vitest',
    ]));

    const rootTypeScriptConfig = JSON.parse(
      readFileSync(path.join(ROOT, 'tsconfig.json'), 'utf8'),
    ) as { include?: string[] };
    expect(rootTypeScriptConfig.include).toContain('tests/**/*');
    expect(rootTypeScriptConfig.include).not.toEqual(expect.arrayContaining(['apps/**/*', '**/*.ts']));
  });

  it('app-owned TypeScript/JavaScript 不导入 legacy root alias 或源码', () => {
    const sourceFiles = collectFiles(APP).filter((file) => /\.[cm]?[jt]sx?$/u.test(file));
    expect(sourceFiles).not.toEqual([]);
    for (const file of sourceFiles) {
      const source = readFileSync(file, 'utf8');
      expect(source, path.relative(ROOT, file)).not.toMatch(/(?:from\s+|import\s*\()['"]@\//u);
      expect(source, path.relative(ROOT, file)).not.toMatch(
        /(?:from\s+|import\s*\()['"](?:\.\.\/)+(?:app|components|lib|pages|server|types)\//u,
      );
    }
  });
});
