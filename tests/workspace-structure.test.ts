import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'comment-json';

const rootDirectory = process.cwd();

describe('phase 1 workspace structure', () => {
  it('declares native pnpm apps and packages globs while preserving install policy', () => {
    const workspaceManifest = readFileSync(path.join(rootDirectory, 'pnpm-workspace.yaml'), 'utf8');

    expect(workspaceManifest).toContain('  - apps/*');
    expect(workspaceManifest).toContain('  - packages/*');
    expect(workspaceManifest).toContain('allowBuilds:');
    expect(workspaceManifest).toContain('peerDependencyRules:');
  });

  it('exposes only workspace orchestration scripts from the root package', () => {
    const packageJson = JSON.parse(readFileSync(path.join(rootDirectory, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts['workspace:test']).toContain('--filter "./packages/*"');
    expect(packageJson.scripts['workspace:test']).toContain('--filter "./apps/*"');
    expect(packageJson.scripts['workspace:lint']).toContain('--filter "./packages/*"');
    expect(packageJson.scripts['workspace:build']).toContain('--filter "./apps/*"');
    expect(packageJson.scripts['workspace:verify']).toContain('check:workspace:boundaries');
    expect(packageJson.scripts['workspace:verify']).toContain('check:naming:workspace');
    expect(packageJson.scripts['workspace:verify']).not.toContain('pnpm test');
  });

  it('provides one CI entrypoint that verifies workspaces and the legacy root', () => {
    const packageJson = JSON.parse(readFileSync(path.join(rootDirectory, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts['ci:verify']).toBe(
      'pnpm run workspace:verify && pnpm test && pnpm lint',
    );
  });

  it('copies every workspace manifest before the Hono container installs dependencies', () => {
    const dockerfile = readFileSync(path.join(rootDirectory, 'Dockerfile.hono'), 'utf8');
    const installIndex = dockerfile.indexOf('RUN pnpm install --frozen-lockfile');
    expect(installIndex).toBeGreaterThan(-1);

    const workspaceDirectories = ['apps', 'packages'].flatMap((workspaceRoot) =>
      readdirSync(path.join(rootDirectory, workspaceRoot), { withFileTypes: true })
        .filter(
          (entry) =>
            entry.isDirectory() &&
            existsSync(path.join(rootDirectory, workspaceRoot, entry.name, 'package.json')),
        )
        .map((entry) => `${workspaceRoot}/${entry.name}`),
    );

    expect(workspaceDirectories.length).toBeGreaterThan(0);
    for (const workspaceDirectory of workspaceDirectories) {
      const copyInstruction =
        `COPY ${workspaceDirectory}/package.json ./${workspaceDirectory}/package.json`;
      const copyIndex = dockerfile.indexOf(copyInstruction);
      expect(copyIndex, `Dockerfile.hono must copy ${workspaceDirectory}/package.json`).toBeGreaterThan(-1);
      expect(copyIndex, `${workspaceDirectory}/package.json must be copied before pnpm install`).toBeLessThan(
        installIndex,
      );
    }
  });

  it('ignores workspace-local generated artifacts with exact glob rules', () => {
    const gitignore = readFileSync(path.join(rootDirectory, '.gitignore'), 'utf8');

    for (const rule of [
      'apps/*/coverage/',
      'apps/*/build/',
      'apps/*/out/',
      'apps/*/.open-next/',
      'packages/*/coverage/',
      'packages/*/build/',
      'packages/*/out/',
      'packages/*/.open-next/',
    ]) {
      expect(gitignore).toContain(rule);
    }
  });

  it('keeps the config PoC in explicit source-export mode', () => {
    const configPackage = JSON.parse(
      readFileSync(path.join(rootDirectory, 'packages/config/package.json'), 'utf8'),
    ) as {
      type?: string;
      scripts: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const packagesReadme = readFileSync(path.join(rootDirectory, 'packages/README.md'), 'utf8');

    expect(configPackage.type).toBe('module');
    expect(configPackage.scripts.build).toContain('--noEmit');
    expect(configPackage.devDependencies?.esbuild).toBe('^0.28.1');
    expect(existsSync(path.join(rootDirectory, 'packages/config/tsconfig.build.json'))).toBe(false);
    expect(packagesReadme).toContain('source-export');
    expect(packagesReadme).toContain('esbuild');
  });
});

describe('phase 2.5A D1 Gateway workspace app', () => {
  const appDirectory = path.join(rootDirectory, 'apps/d1-gateway');
  const appManifestPath = path.join(appDirectory, 'package.json');
  const appWranglerPath = path.join(appDirectory, 'wrangler.jsonc');

  it('moves the Worker deployment unit out of the legacy server directory', () => {
    expect(existsSync(path.join(appDirectory, 'index.ts'))).toBe(true);
    expect(existsSync(appWranglerPath)).toBe(true);
    expect(existsSync(path.join(appDirectory, 'README.md'))).toBe(true);
    expect(existsSync(path.join(rootDirectory, 'server/d1-gateway/index.ts'))).toBe(false);
    expect(existsSync(path.join(rootDirectory, 'server/d1-gateway/wrangler.jsonc'))).toBe(false);
  });

  it('declares an independently testable and deployable app lifecycle', () => {
    expect(existsSync(appManifestPath)).toBe(true);
    if (!existsSync(appManifestPath)) return;

    const appManifest = JSON.parse(readFileSync(appManifestPath, 'utf8')) as {
      name?: string;
      private?: boolean;
      type?: string;
      scripts?: Record<string, string>;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    expect(appManifest).toMatchObject({
      name: '@mahoshojo/d1-gateway',
      private: true,
      type: 'module',
    });
    for (const scriptName of ['dev', 'test', 'lint', 'build', 'deploy']) {
      expect(appManifest.scripts?.[scriptName], `missing scripts.${scriptName}`).toEqual(expect.any(String));
    }
    expect(appManifest.scripts?.build).toContain('tsc --noEmit');
    expect(appManifest.scripts?.build).toContain('wrangler deploy --dry-run');
    expect(appManifest.scripts?.deploy).not.toContain('--dry-run');
    expect(appManifest.dependencies).toBeUndefined();
    for (const dependencyName of [
      '@typescript-eslint/parser',
      'esbuild',
      'eslint',
      'typescript',
      'vitest',
      'wrangler',
    ]) {
      expect(appManifest.devDependencies?.[dependencyName], `missing devDependency ${dependencyName}`).toEqual(
        expect.any(String),
      );
    }
  });

  it('keeps root lifecycle commands as workspace-filtered compatibility entrypoints', () => {
    const rootManifest = JSON.parse(readFileSync(path.join(rootDirectory, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };

    expect(rootManifest.scripts['dev:d1-gateway']).toBe(
      'pnpm --filter @mahoshojo/d1-gateway run dev',
    );
    expect(rootManifest.scripts['deploy:d1-gateway']).toBe(
      'pnpm --filter @mahoshojo/d1-gateway run deploy',
    );
  });

  it('preserves the Worker route, observability, and D1 binding contract', () => {
    expect(existsSync(appWranglerPath)).toBe(true);
    if (!existsSync(appWranglerPath)) return;

    const wrangler = parse(readFileSync(appWranglerPath, 'utf8'), undefined, true) as {
      name?: string;
      main?: string;
      compatibility_date?: string;
      workers_dev?: boolean;
      routes?: unknown[];
      observability?: Record<string, unknown>;
      d1_databases?: unknown[];
    };

    expect(wrangler).toMatchObject({
      name: 'mahoshojo-d1-gateway',
      main: 'index.ts',
      compatibility_date: '2025-04-01',
      workers_dev: false,
      routes: [
        {
          pattern: 'mahoshojo-d1-gateway.colanns.me',
          custom_domain: true,
        },
      ],
      observability: {
        enabled: true,
        head_sampling_rate: 0.1,
      },
      d1_databases: [
        {
          binding: 'DB',
          database_name: 'mahoshojo',
          database_id: '8eb9b25c-5a00-4feb-b5cb-c5dd25cda1d3',
          migrations_dir: '../../drizzle',
        },
      ],
    });
  });
});

describe('phase 2.5C Hono API workspace app ownership', () => {
  const appDirectory = path.join(rootDirectory, 'apps/api');
  const appManifestPath = path.join(appDirectory, 'package.json');

  it('由 apps/api 独占 Hono source、测试、容器和部署生命周期', () => {
    for (const relativePath of [
      'package.json',
      'README.md',
      'env.example',
      'Dockerfile',
      'src/index.ts',
      'tests/route-manifest.test.ts',
      'scripts/build.mjs',
      'scripts/generate-route-manifest.mjs',
      'scripts/verify-runtime.mjs',
      'deploy/compose.yml',
      'deploy/deploy-bundle.sh',
    ]) {
      expect(
        existsSync(path.join(appDirectory, relativePath)),
        `apps/api/${relativePath} must exist`,
      ).toBe(true);
    }

    expect(existsSync(path.join(rootDirectory, 'server/index.ts'))).toBe(false);
    expect(existsSync(path.join(rootDirectory, 'Dockerfile.hono'))).toBe(false);
    expect(existsSync(path.join(rootDirectory, 'deploy/hono'))).toBe(false);
  });

  it('声明独立 app 生命周期，并由 root scripts 只做代理入口', () => {
    expect(existsSync(appManifestPath)).toBe(true);
    if (!existsSync(appManifestPath)) return;

    const appManifest = JSON.parse(readFileSync(appManifestPath, 'utf8')) as {
      name?: string;
      private?: boolean;
      type?: string;
      scripts?: Record<string, string>;
    };
    expect(appManifest).toMatchObject({
      name: '@mahoshojo/api',
      private: true,
      type: 'module',
    });
    for (const scriptName of [
      'dev',
      'start',
      'test',
      'lint',
      'build',
      'build:bundle',
      'routes',
      'verify:runtime',
      'deploy:prepare',
    ]) {
      expect(appManifest.scripts?.[scriptName], `missing scripts.${scriptName}`).toEqual(expect.any(String));
    }

    const rootManifest = JSON.parse(readFileSync(path.join(rootDirectory, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(rootManifest.scripts['dev:server']).toBe('pnpm --filter @mahoshojo/api run dev');
    expect(rootManifest.scripts['start:server']).toBe('pnpm --filter @mahoshojo/api run start');
    expect(rootManifest.scripts['build:server']).toBe('pnpm --filter @mahoshojo/api run build:bundle');
    expect(rootManifest.scripts['server:routes']).toBe('pnpm --filter @mahoshojo/api run routes');
    expect(rootManifest.scripts['verify:server:runtime']).toBe('pnpm --filter @mahoshojo/api run verify:runtime');
    expect(rootManifest.scripts['test:server']).toBe('pnpm --filter @mahoshojo/api run test');
  });

  it('Docker install layer 只复制 apps/api 及其 workspace 依赖闭包', () => {
    const dockerfilePath = path.join(appDirectory, 'Dockerfile');
    expect(existsSync(dockerfilePath)).toBe(true);
    if (!existsSync(dockerfilePath)) return;

    const dockerfile = readFileSync(dockerfilePath, 'utf8');
    const installIndex = dockerfile.indexOf('RUN pnpm install --frozen-lockfile');
    expect(installIndex).toBeGreaterThan(-1);
    for (const manifestPath of [
      'apps/api/package.json',
      'packages/hosted-api/package.json',
      'packages/hosted-runtime/package.json',
    ]) {
      const copyIndex = dockerfile.indexOf(`COPY ${manifestPath} ./${manifestPath}`);
      expect(copyIndex, `${manifestPath} must be copied before install`).toBeGreaterThan(-1);
      expect(copyIndex).toBeLessThan(installIndex);
    }
    expect(dockerfile).not.toContain('apps/d1-gateway/package.json');
  });
});
