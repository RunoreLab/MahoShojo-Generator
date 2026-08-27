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
    previewOrigin: string;
    primaryOrigin: string;
    drOrigin: string;
    mode: string;
    provisioning: string;
    corsOriginsEnvironment: string;
    productionFallback: {
      mode: string;
      artifactReadiness: string;
      productionPlacement: string;
    };
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
    drillStatus: string;
    requiredSecrets: Array<{ name: string; minLength?: number }>;
    requiredBindings: string[];
    contractTests: string[];
  }>;
};

type HostedDrDrillManifest = {
  schemaVersion: number;
  drillVersion: string;
  environment: string;
  controlPlaneProvisioning: string;
  productionStatus: string;
  versionGate: {
    maxContractVersionSkew: number;
    stages: string[];
  };
  cases: Array<{
    id: string;
    acceptance: string[];
    status: string;
    scope: string[];
    evidenceTests: string[];
    proofLevel: string;
    evidenceCommand: string;
    evidenceAssertions: string[];
  }>;
  productionDrill: {
    status: string;
    requiredAuthorization: string[];
    runbook: string;
  };
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
    const {
      stableOrigin,
      previewOrigin,
      primaryOrigin,
      drOrigin,
      mode,
      provisioning,
      productionFallback,
    } = manifest.controlPlane;

    expect(mode).toBe('active-passive');
    expect(provisioning).toBe('not-provisioned');
    expect(productionFallback).toEqual({
      mode: 'same-origin-next',
      artifactReadiness: 'deferred',
      productionPlacement: 'not-observed',
    });
    expect(manifest.controlPlane.corsOriginsEnvironment).toBe('HONO_CORS_ORIGINS');
    expect(new Set([stableOrigin, previewOrigin, primaryOrigin, drOrigin])).toHaveLength(4);
    for (const origin of [stableOrigin, previewOrigin, primaryOrigin, drOrigin]) {
      const parsed = new URL(origin);
      expect(parsed.protocol).toBe('https:');
      expect(parsed.pathname).toBe('/');
      expect(parsed.search).toBe('');
      expect(parsed.hash).toBe('');
    }
  });

  it('把已执行的 G25E-2 safe-read drill 记录在 capability manifest', () => {
    const manifest = readJson<HostedDrManifest>('config/hosted-dr-capabilities.json');
    expect(manifest.capabilities.find(({ id }) => id === 'hosted/dr-readiness')?.drillStatus)
      .toBe('verified');
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

  it('G25E-2 fault matrix 覆盖完整 case 且生产演练保持 deferred', () => {
    const drill = readJson<HostedDrDrillManifest>('config/hosted-dr-drills.json');
    const requiredCaseIds = [
      'G25E2-HONO-UNAVAILABLE',
      'G25E2-REDIS-UNAVAILABLE',
      'G25E2-REDIS-EMPTY',
      'G25E2-GATEWAY-UNAVAILABLE',
      'G25E2-MIDFLIGHT-DISCONNECT',
      'G25E2-D1-UNAVAILABLE',
      'G25E2-DR-SECRET-MISSING',
      'G25E2-VERSION-SKEW',
      'G25E2-CUTBACK',
    ];

    expect(drill.schemaVersion).toBe(1);
    expect(drill.drillVersion).toBe('g25e2-v1');
    expect(drill.environment).toBe('local-fault-injection');
    expect(drill.controlPlaneProvisioning).toBe('not-provisioned');
    expect(drill.productionStatus).toBe('deferred');
    expect(drill.cases.map(({ id }) => id)).toEqual(requiredCaseIds);
    for (const entry of drill.cases) {
      expect(entry.acceptance.length, entry.id).toBeGreaterThan(0);
      expect(entry.scope.length, entry.id).toBeGreaterThan(0);
      expect(entry.evidenceTests.length, entry.id).toBeGreaterThan(0);
      expect(entry.proofLevel, entry.id).toMatch(/^isolated-/u);
      expect(entry.evidenceCommand, entry.id).toMatch(/^pnpm run verify:hosted-dr(?::redis)?$/u);
      expect(entry.evidenceAssertions.length, entry.id).toBeGreaterThan(0);
      expect(entry.status, entry.id).toBe('verified');
      for (const evidenceTest of entry.evidenceTests) {
        expect(existsSync(path.join(repositoryRoot, evidenceTest)), `${entry.id}:${evidenceTest}`).toBe(true);
      }
    }
  });

  it.each([
    {
      label: '缺少 fault case',
      mutate: (drill: HostedDrDrillManifest) => drill.cases.pop(),
      expected: '完整 fault matrix',
    },
    {
      label: '非法 case status',
      mutate: (drill: HostedDrDrillManifest) => {
        drill.cases[0]!.status = 'passing';
      },
      expected: 'drill status 非法',
    },
    {
      label: '伪造 evidence path',
      mutate: (drill: HostedDrDrillManifest) => {
        drill.cases[0]!.evidenceTests = ['apps/api/tests/config.test.ts'];
      },
      expected: 'case marker',
    },
    {
      label: '只在规范文档中伪造 case marker',
      mutate: (drill: HostedDrDrillManifest) => {
        drill.cases[0]!.evidenceTests = [
          'docs/specs/2026-08-26_230557_G25E-2_Hosted_DR故障演练与Phase2.5退出审计设计.md',
        ];
      },
      expected: '可执行 evidence',
    },
    {
      label: '伪报 production drill',
      mutate: (drill: HostedDrDrillManifest) => {
        drill.productionStatus = 'verified';
      },
      expected: 'production drill 必须保持 deferred',
    },
  ])('validator 对 G25E-2 $label fail closed', ({ mutate, expected }) => {
    const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), 'hosted-dr-drills-'));
    try {
      const drill = readJson<HostedDrDrillManifest>('config/hosted-dr-drills.json');
      mutate(drill);
      const drillsPath = path.join(temporaryRoot, 'drills.json');
      writeFileSync(drillsPath, `${JSON.stringify(drill)}\n`, 'utf8');

      const result = spawnSync(process.execPath, [
        path.join(repositoryRoot, 'scripts/check-hosted-dr-contract.mjs'),
        '--drills',
        drillsPath,
      ], {
        cwd: repositoryRoot,
        encoding: 'utf8',
      });

      expect(result.status).toBe(1);
      expect(`${result.stdout}\n${result.stderr}`).toContain(expected);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it('把 validator 纳入 workspace gate', () => {
    const rootPackage = readJson<{ scripts: Record<string, string> }>('package.json');
    const webPackage = readJson<{ scripts: Record<string, string> }>('apps/web/package.json');

    expect(existsSync(path.join(repositoryRoot, 'scripts/check-hosted-dr-contract.mjs'))).toBe(true);
    expect(existsSync(path.join(repositoryRoot, 'scripts/verify-hosted-dr.mjs'))).toBe(true);
    const executableVerifier = readFileSync(
      path.join(repositoryRoot, 'scripts/verify-hosted-dr.mjs'),
      'utf8',
    );
    expect(existsSync(path.join(repositoryRoot, 'config/hosted-dr-drills.json'))).toBe(true);
    expect(rootPackage.scripts['check:hosted-dr']).toContain('check:hosted-dr:schema');
    expect(rootPackage.scripts['verify:hosted-dr']).toContain('scripts/verify-hosted-dr.mjs');
    expect(executableVerifier).toContain('G25E2-REDIS-EMPTY');
    expect(executableVerifier).toContain('hosted.dr.evidence.integration.required');
    expect(executableVerifier).not.toContain('drills.cases.length');
    expect(rootPackage.scripts['ci:verify']).toContain('pnpm run verify:hosted-dr');
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
      label: 'unsafe production fallback readiness',
      mutate: (manifest: HostedDrManifest) => {
        manifest.controlPlane.productionFallback = {
          mode: 'same-origin-next',
          artifactReadiness: 'verified',
          productionPlacement: 'not-observed',
        };
      },
      expected: 'production fallback 不得覆盖 fail-closed operation',
    },
    {
      label: 'observed fallback without verified artifact',
      mutate: (manifest: HostedDrManifest) => {
        manifest.controlPlane.productionFallback = {
          mode: 'same-origin-next',
          artifactReadiness: 'deferred',
          productionPlacement: 'observed',
        };
      },
      expected: 'placement observed 必须先有 verified artifact readiness',
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

  it('validator 只接受符合 schema 的 production evidence', () => {
    const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), 'hosted-dr-production-evidence-'));
    try {
      const manifest = readJson<HostedDrManifest>('config/hosted-dr-capabilities.json');
      manifest.controlPlane.provisioning = 'production';
      const manifestPath = path.join(temporaryRoot, 'manifest.json');
      const evidencePath = path.join(temporaryRoot, 'hosted-dr-production-evidence.json');
      const clientProjectionPath = path.join(temporaryRoot, 'hosted-dr-client.generated.ts');
      writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`, 'utf8');
      writeFileSync(
        clientProjectionPath,
        readFileSync(
          path.join(repositoryRoot, 'apps/web/config/hosted-dr-client.generated.ts'),
          'utf8',
        ).replace(
          'hostedDrControlPlaneProvisioning = "not-provisioned"',
          'hostedDrControlPlaneProvisioning = "production"',
        ),
        'utf8',
      );
      writeFileSync(evidencePath, `${JSON.stringify({
        schemaVersion: 1,
        environment: 'production',
        controlPlane: { provisioning: 'production' },
        evidence: [{ kind: 'cloudflare-deployment', reference: 'workflow:12345' }],
        verifiedAt: '2026-08-26T12:00:00Z',
      })}\n`, 'utf8');

      const result = spawnSync(process.execPath, [
        path.join(repositoryRoot, 'scripts/check-hosted-dr-contract.mjs'),
        '--manifest',
        manifestPath,
        '--production-evidence',
        evidencePath,
        '--client-projection',
        clientProjectionPath,
      ], {
        cwd: repositoryRoot,
        encoding: 'utf8',
      });

      expect(result.status).toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).toContain('Hosted DR contract OK');
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it.each([
    { label: '空文件', content: '' },
    { label: '不可解析 JSON', content: '{not-json' },
    { label: '空对象', content: '{}\n' },
    {
      label: '缺少 evidence entry',
      content: `${JSON.stringify({
        schemaVersion: 1,
        environment: 'production',
        controlPlane: { provisioning: 'production' },
        evidence: [],
        verifiedAt: '2026-08-26T12:00:00Z',
      })}\n`,
    },
  ])('validator 拒绝$label的 production evidence', ({ content }) => {
    const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), 'hosted-dr-production-evidence-'));
    try {
      const manifest = readJson<HostedDrManifest>('config/hosted-dr-capabilities.json');
      manifest.controlPlane.provisioning = 'production';
      const manifestPath = path.join(temporaryRoot, 'manifest.json');
      const evidencePath = path.join(temporaryRoot, 'hosted-dr-production-evidence.json');
      writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`, 'utf8');
      writeFileSync(evidencePath, content, 'utf8');

      const result = spawnSync(process.execPath, [
        path.join(repositoryRoot, 'scripts/check-hosted-dr-contract.mjs'),
        '--manifest',
        manifestPath,
        '--production-evidence',
        evidencePath,
      ], {
        cwd: repositoryRoot,
        encoding: 'utf8',
      });

      expect(result.status).toBe(1);
      expect(`${result.stdout}\n${result.stderr}`).toContain('production evidence schema');
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });
});
