import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
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

    expect(existsSync(path.join(repositoryRoot, 'scripts/check-hosted-dr-contract.mjs'))).toBe(true);
    expect(rootPackage.scripts['check:hosted-dr']).toBe('node scripts/check-hosted-dr-contract.mjs');
    expect(rootPackage.scripts['workspace:verify']).toContain('pnpm run check:hosted-dr');
  });
});
