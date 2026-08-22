import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { checkWorkspaceBoundaries, formatBoundaryViolations } from '../scripts/check-workspace-boundaries.mjs';

type FixtureFiles = Record<string, string>;

const temporaryRoots: string[] = [];

async function createWorkspaceFixture(files: FixtureFiles): Promise<string> {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'mahoshojo-workspace-boundary-'));
  temporaryRoots.push(rootDir);

  await Promise.all(
    Object.entries(files).map(async ([relativePath, contents]) => {
      const targetPath = path.join(rootDir, relativePath);
      await fsMkdir(path.dirname(targetPath));
      await writeFile(targetPath, contents, 'utf8');
    }),
  );

  return rootDir;
}

async function fsMkdir(directory: string): Promise<void> {
  const { mkdir } = await import('node:fs/promises');
  await mkdir(directory, { recursive: true });
}

function manifest(
  name: string,
  exports: Record<string, string> = { '.': './src/index.ts' },
  scripts: Record<string, string> = { test: 'echo test', lint: 'echo lint', build: 'echo build' },
): string {
  return JSON.stringify({ name, private: true, exports, scripts }, null, 2);
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((rootDir) => rm(rootDir, { recursive: true, force: true })));
});

describe('workspace dependency boundaries', () => {
  it('ignores the legacy root app while checking future apps and packages', async () => {
    const rootDir = await createWorkspaceFixture({
      'src/legacy.ts': "export { value } from '@/apps/admin/src/index';\n",
      'apps/admin/README.md': '# Future admin app\n',
      'packages/config/package.json': manifest('@mahoshojo/config'),
      'packages/config/src/index.ts': 'export const value = 1;\n',
    });

    expect(checkWorkspaceBoundaries(rootDir)).toEqual([]);
  });

  it('rejects package imports into apps through relative paths and root aliases', async () => {
    const rootDir = await createWorkspaceFixture({
      'apps/web/src/index.ts': 'export const value = 1;\n',
      'packages/shared/package.json': manifest('@mahoshojo/shared'),
      'packages/shared/src/index.ts': [
        "export { value as relativeValue } from '../../../apps/web/src/index';",
        "export { value as aliasValue } from '@/apps/web/src/index';",
      ].join('\n'),
    });

    const violations = checkWorkspaceBoundaries(rootDir);
    expect(violations.filter((violation) => violation.rule === 'MONO-005-PACKAGE-APP')).toHaveLength(2);
    expect(violations.every((violation) => violation.file.endsWith('packages/shared/src/index.ts'))).toBe(true);
  });

  it('rejects app-to-app imports through relative, alias, and workspace package names', async () => {
    const rootDir = await createWorkspaceFixture({
      'apps/web/package.json': manifest('@mahoshojo/web'),
      'apps/web/src/index.ts': [
        "export { value as relativeValue } from '../../admin/src/index';",
        "export { value as aliasValue } from '@/apps/admin/src/index';",
        "export { value as packageValue } from '@mahoshojo/admin';",
      ].join('\n'),
      'apps/admin/package.json': manifest('@mahoshojo/admin'),
      'apps/admin/src/index.ts': 'export const value = 1;\n',
    });

    const violations = checkWorkspaceBoundaries(rootDir);
    expect(violations.filter((violation) => violation.rule === 'MONO-003')).toHaveLength(3);
    expect(violations.map((violation) => violation.module)).toEqual(
      expect.arrayContaining(['../../admin/src/index', '@/apps/admin/src/index', '@mahoshojo/admin']),
    );
  });

  it('rejects framework and runtime imports from the domain package', async () => {
    const rootDir = await createWorkspaceFixture({
      'packages/domain/package.json': manifest('@mahoshojo/domain'),
      'packages/domain/src/index.ts': [
        "import 'next';",
        "import 'react';",
        "import 'hono';",
        "import 'node:fs';",
        "import 'drizzle-orm';",
        "import '@tauri-apps/api';",
        "import 'cloudflare:workers';",
        "import 'zod';",
        "const safeProperty = { document: 'not-a-global', window: 'not-a-global' };",
        'void safeProperty.document; void safeProperty.window;',
      ].join('\n'),
    });

    const violations = checkWorkspaceBoundaries(rootDir);
    expect(violations.filter((violation) => violation.rule === 'MONO-005-DOMAIN-RUNTIME')).toHaveLength(7);
    expect(violations.filter((violation) => violation.rule === 'MONO-005-DOMAIN-DOM')).toHaveLength(0);
    expect(violations.some((violation) => violation.module === 'zod')).toBe(false);
  });

  it('rejects browser DOM globals in domain code without treating property names or strings as globals', async () => {
    const rootDir = await createWorkspaceFixture({
      'packages/domain/package.json': manifest('@mahoshojo/domain'),
      'packages/domain/src/index.ts': [
        'const element = document.createElement(\'div\');',
        'const title = window.document.title;',
        'navigator.language;',
        "const safe = { document: 'property', window: 'property' };",
        "const text = 'document window navigator';",
        'void element; void title; void safe;',
      ].join('\n'),
    });

    const violations = checkWorkspaceBoundaries(rootDir).filter((violation) => violation.rule === 'MONO-005-DOMAIN-DOM');
    expect(violations.map((violation) => violation.module)).toEqual(['document', 'window', 'navigator']);
  });

  it('reports unresolved DOM globals while ignoring parameter, local, destructured, and imported shadows', async () => {
    const rootDir = await createWorkspaceFixture({
      'packages/domain/package.json': manifest('@mahoshojo/domain'),
      'packages/domain/src/imported-document.ts': 'export default { title: "imported" };\n',
      'packages/domain/src/index.ts': [
        "import document from './imported-document';",
        'function shadowed(document: unknown, localStorage: unknown) { return [document, localStorage]; }',
        "function localWindow() { const window = { document: 'shadowed' }; return window.document; }",
        'const { navigator } = runtime;',
        'const importedTitle = document.title;',
        'const viewport = window.innerWidth;',
        'const storage = localStorage.getItem("real");',
        'void shadowed; void localWindow; void importedTitle; void viewport; void storage; void navigator;',
      ].join('\n'),
    });

    const violations = checkWorkspaceBoundaries(rootDir).filter(
      (violation) => violation.rule === 'MONO-005-DOMAIN-DOM',
    );

    expect(violations).toHaveLength(2);
    expect(violations.map((violation) => violation.module)).toEqual(['window', 'localStorage']);
  });

  it('rejects server secret modules imported by client packages', async () => {
    const clientPackages = ['ai-direct', 'local-library', 'cloud-client', 'ui-web'];
    const files: FixtureFiles = {};

    for (const packageName of clientPackages) {
      files[`packages/${packageName}/package.json`] = manifest(`@mahoshojo/${packageName}`);
      files[`packages/${packageName}/src/index.ts`] = [
        "import '@/server/secrets';",
        "import '@/lib/signature';",
        "import '../private/env';",
        "import '@mahoshojo/server/private/config';",
      ].join('\n');
    }

    const rootDir = await createWorkspaceFixture(files);
    const violations = checkWorkspaceBoundaries(rootDir);
    expect(violations.filter((violation) => violation.rule === 'MONO-005-CLIENT-SECRET')).toHaveLength(16);
  });

  it('rejects undeclared workspace package deep imports across import forms', async () => {
    const rootDir = await createWorkspaceFixture({
      'packages/config/package.json': manifest('@mahoshojo/config'),
      'packages/consumer/package.json': manifest('@mahoshojo/consumer'),
      'packages/consumer/src/index.ts': [
        "import '@mahoshojo/config/src/index';",
        "export * from '@mahoshojo/config/internal';",
        "const dynamic = import('@mahoshojo/config/runtime');",
        "const required = require('@mahoshojo/config/node');",
        'void dynamic; void required;',
      ].join('\n'),
    });

    const violations = checkWorkspaceBoundaries(rootDir);
    expect(violations.filter((violation) => violation.rule === 'MONO-004-DEEP-IMPORT')).toHaveLength(4);
    expect(violations.map((violation) => violation.module)).toEqual(
      expect.arrayContaining([
        '@mahoshojo/config/src/index',
        '@mahoshojo/config/internal',
        '@mahoshojo/config/runtime',
        '@mahoshojo/config/node',
      ]),
    );
  });

  it('checks TypeScript import types and import-equals declarations across package and app boundaries', async () => {
    const rootDir = await createWorkspaceFixture({
      'packages/config/package.json': manifest('@mahoshojo/config', {
        '.': './src/index.ts',
        './public': './src/public.ts',
      }),
      'packages/config/src/index.ts': 'export type Value = string;\n',
      'packages/config/src/public.ts': 'export type Value = string;\n',
      'packages/consumer/package.json': manifest('@mahoshojo/consumer'),
      'packages/consumer/src/index.ts': [
        "type HiddenByName = import('@mahoshojo/config/internal').Value;",
        "import relativeConfig = require('../../config/src/index');",
        "type PublicByName = import('@mahoshojo/config/public').Value;",
        "import publicConfig = require('@mahoshojo/config');",
        'void relativeConfig; void publicConfig;',
      ].join('\n'),
      'apps/web/package.json': manifest('@mahoshojo/web'),
      'apps/web/src/index.ts': "type AdminType = import('../../admin/src/index').Value;\n",
      'apps/admin/package.json': manifest('@mahoshojo/admin'),
      'apps/admin/src/index.ts': "import web = require('../../web/src/index');\nvoid web;\n",
    });

    const violations = checkWorkspaceBoundaries(rootDir);

    expect(violations.filter((violation) => violation.rule === 'MONO-004-DEEP-IMPORT')).toHaveLength(2);
    expect(violations.map((violation) => violation.module)).toEqual(
      expect.arrayContaining(['@mahoshojo/config/internal', '../../config/src/index']),
    );
    expect(violations.filter((violation) => violation.rule === 'MONO-003')).toHaveLength(2);
    expect(violations.map((violation) => violation.module)).toEqual(
      expect.arrayContaining(['../../admin/src/index', '../../web/src/index']),
    );
    expect(violations.some((violation) => violation.module === '@mahoshojo/config/public')).toBe(false);
    expect(violations.some((violation) => violation.module === '@mahoshojo/config')).toBe(false);
  });

  it('rejects package-to-package relative paths that bypass the target exports map', async () => {
    const rootDir = await createWorkspaceFixture({
      'packages/config/package.json': manifest('@mahoshojo/config'),
      'packages/config/src/index.ts': "export { value } from './helper';\n",
      'packages/config/src/helper.ts': 'export const value = 1;\n',
      'packages/consumer/package.json': manifest('@mahoshojo/consumer'),
      'packages/consumer/src/index.ts': [
        "export { value as bypassedValue } from '../../config/src/index';",
        "export { value as publicValue } from '@mahoshojo/config';",
        "export { value as localValue } from './helper';",
      ].join('\n'),
      'packages/consumer/src/helper.ts': 'export const value = 2;\n',
    });

    const violations = checkWorkspaceBoundaries(rootDir).filter((violation) => violation.rule === 'MONO-004-DEEP-IMPORT');
    expect(violations).toHaveLength(1);
    expect(violations[0].module).toBe('../../config/src/index');
    expect(violations[0].file).toContain('packages/consumer/src/index.ts');
  });

  it('rejects app-to-package relative paths while allowing package-name and same-app imports', async () => {
    const rootDir = await createWorkspaceFixture({
      'packages/config/package.json': manifest('@mahoshojo/config'),
      'packages/config/src/index.ts': 'export const value = 1;\n',
      'apps/web/package.json': manifest('@mahoshojo/web'),
      'apps/web/src/index.ts': [
        "export { value as bypassedValue } from '../../../packages/config/src/index';",
        "export { value as publicValue } from '@mahoshojo/config';",
        "export { value as localValue } from './helper';",
      ].join('\n'),
      'apps/web/src/helper.ts': 'export const value = 2;\n',
    });

    const violations = checkWorkspaceBoundaries(rootDir).filter((violation) => violation.rule === 'MONO-004-DEEP-IMPORT');
    expect(violations).toHaveLength(1);
    expect(violations[0].module).toBe('../../../packages/config/src/index');
    expect(violations[0].file).toContain('apps/web/src/index.ts');
  });

  it('allows explicitly exported package subpaths and reports packages without exports', async () => {
    const rootDir = await createWorkspaceFixture({
      'packages/contracts/package.json': manifest('@mahoshojo/contracts', {
        '.': './src/index.ts',
        './public': './src/public.ts',
      }),
      'packages/contracts/src/public.ts': 'export const publicValue = 1;\n',
      'packages/consumer/package.json': manifest('@mahoshojo/consumer'),
      'packages/consumer/src/index.ts': "export { publicValue } from '@mahoshojo/contracts/public';\n",
      'packages/no-exports/package.json': JSON.stringify({
        name: '@mahoshojo/no-exports',
        private: true,
        scripts: { test: 'echo test', lint: 'echo lint', build: 'echo build' },
      }),
      'packages/no-exports/src/index.ts': 'export const value = 1;\n',
    });

    const violations = checkWorkspaceBoundaries(rootDir);
    expect(violations.filter((violation) => violation.rule === 'MONO-004-MISSING-EXPORTS')).toHaveLength(1);
    expect(violations.some((violation) => violation.rule === 'MONO-004-DEEP-IMPORT')).toBe(false);
  });

  it('requires test, lint, and build scripts for manifest-backed workspace projects', async () => {
    const rootDir = await createWorkspaceFixture({
      'apps/valid/package.json': manifest('@mahoshojo/valid-app'),
      'apps/valid/src/index.ts': 'export const value = 1;\n',
      'apps/readme-only/README.md': '# README-only placeholder\n',
      'packages/missing/package.json': JSON.stringify({
        name: '@mahoshojo/missing-scripts',
        private: true,
        exports: { '.': './src/index.ts' },
        scripts: { test: 'echo test' },
      }),
      'packages/missing/src/index.ts': 'export const value = 1;\n',
    });

    const violations = checkWorkspaceBoundaries(rootDir).filter(
      (violation) => violation.rule === 'MONO-002-MISSING-SCRIPT',
    );

    expect(violations).toHaveLength(2);
    expect(violations.map((violation) => violation.module)).toEqual([
      '@mahoshojo/missing-scripts:scripts.build',
      '@mahoshojo/missing-scripts:scripts.lint',
    ]);
    expect(violations.every((violation) => violation.file.endsWith('packages/missing/package.json'))).toBe(true);
  });

  it('formats boundary violations with a rule, file, and module for CLI consumption', async () => {
    const rootDir = await createWorkspaceFixture({
      'apps/web/src/index.ts': 'export const value = 1;\n',
      'packages/shared/package.json': manifest('@mahoshojo/shared'),
      'packages/shared/src/index.ts': "export { value } from '../../../apps/web/src/index';\n",
    });

    const violations = checkWorkspaceBoundaries(rootDir);
    const output = formatBoundaryViolations(violations, rootDir);

    expect(output).toContain('MONO-005-PACKAGE-APP');
    expect(output).toContain('packages/shared/src/index.ts');
    expect(output).toContain('../../../apps/web/src/index');
  });
});
