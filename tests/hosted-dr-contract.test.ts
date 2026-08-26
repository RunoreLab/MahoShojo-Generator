import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

type RouteInventory = {
  exitedRouteIds: string[];
  legacyRouteIds: string[];
  sharedRouteIds: string[];
};

type HostedDrManifest = {
  schemaVersion: number;
  contractVersion: string;
  controlPlane: {
    stableOrigin: string;
    primaryOrigin: string;
    drOrigin: string;
    mode: string;
    provisioning: string;
    corsOriginsEnvironment: string;
  };
  capabilities: Array<{
    id: string;
    route: string;
    operations: Array<{
      method: string;
      requestClass: string;
      drMode: string;
      replayPolicy: string;
    }>;
    requiredSecrets: Array<{ name: string; minLength?: number }>;
    requiredBindings: string[];
    contractTests: string[];
  }>;
};

const repositoryRoot = process.cwd();
const readJson = <T>(relativePath: string): T => JSON.parse(readFileSync(
  path.join(repositoryRoot, relativePath),
  'utf8',
)) as T;

describe('Hosted DR machine contract', () => {
  it('由 manifest 双向覆盖 shared route，并与 exited/legacy 严格隔离', () => {
    const inventory = readJson<RouteInventory>('config/hono-api-routes.json');
    const manifest = readJson<HostedDrManifest>('config/hosted-dr-capabilities.json');
    const capabilityIds = manifest.capabilities.map(({ id }) => id);

    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.contractVersion).toMatch(/^g25e1-v\d+$/u);
    expect(capabilityIds).toEqual([...capabilityIds].sort());
    expect(capabilityIds).toEqual([...inventory.sharedRouteIds].sort());
    expect(inventory.legacyRouteIds).toEqual([]);
    for (const routeId of inventory.exitedRouteIds) {
      expect(capabilityIds).not.toContain(routeId);
    }
  });

  it('分离稳定与物理 HTTPS origin，且不伪报 production provisioning', () => {
    const manifest = readJson<HostedDrManifest>('config/hosted-dr-capabilities.json');
    const { stableOrigin, primaryOrigin, drOrigin, mode, provisioning } = manifest.controlPlane;

    expect(mode).toBe('active-passive');
    expect(provisioning).toBe('not-provisioned');
    expect(manifest.controlPlane.corsOriginsEnvironment).toBe('HONO_CORS_ORIGINS');
    expect(new Set([stableOrigin, primaryOrigin, drOrigin])).toHaveLength(3);
    for (const origin of [stableOrigin, primaryOrigin, drOrigin]) {
      const parsed = new URL(origin);
      expect(parsed.protocol).toBe('https:');
      expect(parsed.pathname).toBe('/');
      expect(parsed.search).toBe('');
      expect(parsed.hash).toBe('');
    }
  });

  it('每项 capability 都有双 adapter、contract tests 且不保存 secret 值', () => {
    const manifest = readJson<HostedDrManifest>('config/hosted-dr-capabilities.json');

    for (const capability of manifest.capabilities) {
      expect(capability.route).toBe(`/api/${capability.id}`);
      expect(existsSync(path.join(
        repositoryRoot,
        'apps/api/src/adapters',
        `${capability.id}.ts`,
      )), capability.id).toBe(true);
      expect(existsSync(path.join(
        repositoryRoot,
        'apps/web/app/api',
        capability.id,
        'route.ts',
      )), capability.id).toBe(true);
      expect(capability.contractTests.length, capability.id).toBeGreaterThan(0);
      for (const testPath of capability.contractTests) {
        expect(existsSync(path.join(repositoryRoot, testPath)), `${capability.id}:${testPath}`).toBe(true);
      }
      for (const secret of capability.requiredSecrets) {
        expect(Object.keys(secret).sort()).toEqual(
          secret.minLength === undefined ? ['name'] : ['minLength', 'name'],
        );
        expect(secret.name).toMatch(/^[A-Z][A-Z0-9_]+$/u);
      }
    }
  });

  it('声明 structured scenario 签名与 Arena terminal R2 logical binding', () => {
    const manifest = readJson<HostedDrManifest>('config/hosted-dr-capabilities.json');
    const scenario = manifest.capabilities.find(({ id }) => id === 'generate-scenario');
    const arenaStream = manifest.capabilities.find(
      ({ id }) => id === 'arena/generations/[generationId]/stream',
    );

    expect(scenario?.requiredSecrets).toContainEqual({
      name: 'SIGNATURE_SECRET_KEY',
      minLength: 32,
    });
    expect(arenaStream?.requiredBindings).toContain('R2_OBJECT_STORE');
  });

  it('禁止把非幂等 operation 配成 safe replay', () => {
    const manifest = readJson<HostedDrManifest>('config/hosted-dr-capabilities.json');

    for (const capability of manifest.capabilities) {
      const methods = capability.operations.map(({ method }) => method);
      expect(new Set(methods).size, capability.id).toBe(methods.length);
      for (const operation of capability.operations) {
        if (operation.requestClass === 'non-idempotent-operation') {
          expect(operation.replayPolicy, capability.id).toBe('never-after-dispatch');
          expect(operation.drMode, capability.id).not.toBe('safe-read');
        }
      }
    }
  });

  it('把 validator 纳入 workspace gate', () => {
    const rootPackage = readJson<{ scripts: Record<string, string> }>('package.json');
    const webPackage = readJson<{ scripts: Record<string, string> }>('apps/web/package.json');

    expect(existsSync(path.join(repositoryRoot, 'scripts/check-hosted-dr-contract.mjs'))).toBe(true);
    expect(rootPackage.scripts['check:hosted-dr']).toBe('node scripts/check-hosted-dr-contract.mjs');
    expect(rootPackage.scripts['workspace:verify']).toContain('pnpm run check:hosted-dr');
    expect(webPackage.scripts.build).toContain('pnpm run check:hosted-dr');
    expect(webPackage.scripts['build:cf']).toContain('pnpm run check:hosted-dr');
  });

  it('validator 对 generated Hono route registry drift fail closed', () => {
    const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), 'hosted-dr-routes-'));
    try {
      const source = readFileSync(
        path.join(repositoryRoot, 'apps/api/src/generated/routes.ts'),
        'utf8',
      ).replace('id: "arena/generate",', 'id: "registry-drift",');
      const generatedRoutesPath = path.join(temporaryRoot, 'routes.ts');
      writeFileSync(generatedRoutesPath, source, 'utf8');
      const result = spawnSync(process.execPath, [
        path.join(repositoryRoot, 'scripts/check-hosted-dr-contract.mjs'),
        '--generated-routes',
        generatedRoutesPath,
      ], {
        cwd: repositoryRoot,
        encoding: 'utf8',
      });

      expect(result.status).toBe(1);
      expect(`${result.stdout}\n${result.stderr}`).toContain('generated Hono route registry');
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it.each([
    {
      label: 'application contract version drift',
      mutate: (manifest: HostedDrManifest) => {
        manifest.contractVersion = 'g25e1-v2';
      },
      expected: 'application contractVersion',
    },
    {
      label: 'route drift',
      mutate: (manifest: HostedDrManifest) => {
        manifest.capabilities.pop();
      },
      expected: '双向完全覆盖',
    },
    {
      label: 'unsafe non-idempotent replay',
      mutate: (manifest: HostedDrManifest) => {
        const operation = manifest.capabilities.find(({ id }) => id === 'generate-free')
          ?.operations[0];
        if (operation) operation.replayPolicy = 'safe-read-only';
      },
      expected: '非幂等 operation 不得配置 safe replay',
    },
    {
      label: 'embedded secret value',
      mutate: (manifest: HostedDrManifest) => {
        const secret = manifest.capabilities.find(({ requiredSecrets }) => (
          requiredSecrets.length > 0
        ))?.requiredSecrets[0] as { name: string; minLength?: number; value?: string } | undefined;
        if (secret) secret.value = 'manifest-secret-canary';
      },
      expected: 'requiredSecrets 只能保存 name/minLength',
    },
    {
      label: 'false production provisioning',
      mutate: (manifest: HostedDrManifest) => {
        manifest.controlPlane.provisioning = 'production';
      },
      expected: '缺少显式生产证据文件',
    },
    {
      label: 'missing contract test',
      mutate: (manifest: HostedDrManifest) => {
        manifest.capabilities[0]!.contractTests = ['tests/not-present.test.ts'];
      },
      expected: 'contract test 不存在',
    },
  ])('validator 对 $label fail closed', ({ mutate, expected }) => {
    const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), 'hosted-dr-contract-'));
    try {
      const manifest = readJson<HostedDrManifest>('config/hosted-dr-capabilities.json');
      mutate(manifest);
      const manifestPath = path.join(temporaryRoot, 'manifest.json');
      writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`, 'utf8');

      const result = spawnSync(process.execPath, [
        path.join(repositoryRoot, 'scripts/check-hosted-dr-contract.mjs'),
        '--manifest',
        manifestPath,
      ], {
        cwd: repositoryRoot,
        encoding: 'utf8',
      });
      const output = `${result.stdout}\n${result.stderr}`;

      expect(result.status).toBe(1);
      expect(output).toContain(expected);
      expect(output).not.toContain('manifest-secret-canary');
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });
});
