import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

const repositoryRoot = process.cwd();
const manifestPath = resolve(repositoryRoot, 'config/arena-product-parity-gate.json');
const scriptPath = resolve(repositoryRoot, 'scripts/check-arena-product-parity.mjs');
const packagePath = resolve(repositoryRoot, 'package.json');
const workflowPath = resolve(repositoryRoot, '.github/workflows/hono-deploy.yml');
const enginePath = resolve(repositoryRoot, 'apps/web/components/arena/hooks/useBattleEngine.ts');

const runGate = (args: readonly string[] = []) => {
  return spawnSync(
    process.execPath,
    [scriptPath, ...args],
    {
      cwd: repositoryRoot,
      encoding: 'utf8',
      env: { PATH: process.env.PATH },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
};

describe('GMR-10Q product parity gate', () => {
  it('提供 machine-readable manifest，普通仓库验证接受完成后的 READY 状态', () => {
    expect(existsSync(manifestPath), '缺少 product parity gate manifest').toBe(true);
    expect(existsSync(scriptPath), '缺少 product parity gate checker').toBe(true);

    const verified = runGate();
    expect(verified.error).toBeUndefined();
    expect(verified.status, `${verified.stdout}\n${verified.stderr}`).toBe(0);
  });

  it('require-ready 只在 GMR-10Q-G 与退出证据完成后开放', () => {
    const readiness = runGate(['--', '--require-ready']);
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      productionReadiness?: string;
    };

    expect(readiness.error).toBeUndefined();
    if (manifest.productionReadiness === 'READY') {
      expect(readiness.status, `${readiness.stdout}\n${readiness.stderr}`).toBe(0);
    } else {
      expect(readiness.status).not.toBe(0);
      expect(readiness.stderr).toContain('production readiness 必须 fail closed');
    }
  });

  it('普通 ci:verify 校验完成后的 manifest 与全部切片状态', () => {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      schemaVersion?: number;
      blockedReason?: string;
      overallStatus?: string;
      productionReadiness?: string;
      slices?: Record<string, string>;
      exitEvidence?: {
        sourceDigest?: string;
        auditLog?: string;
        independentReview?: { status?: string; critical?: number; important?: number };
      };
    };
    const packageManifest = JSON.parse(readFileSync(packagePath, 'utf8')) as {
      scripts?: Record<string, string>;
    };

    expect(manifest).toMatchObject({
      schemaVersion: 3,
      goal: 'GMR-10Q',
      acceptedSpec: 'SPEC-arena-multiplayer-gate-minimization-parity-v1',
      prerequisiteGoals: { 'GMR-10P': 'DONE' },
      exitEvidence: {
        auditLog: 'docs/logs/2026-09-01_092555_Arena多人GMR-10Q门禁最小化与一致性实施与退出审计.md',
      },
    });
    if (manifest.productionReadiness === 'READY') {
      expect(manifest).toMatchObject({
        blockedReason: 'none',
        overallStatus: 'DONE',
        slices: Object.fromEntries(
          Array.from({ length: 7 }, (_, index) => [
            `GMR-10Q-${String.fromCharCode('A'.charCodeAt(0) + index)}`,
            'DONE',
          ]),
        ),
        exitEvidence: {
          independentReview: { status: 'PASS', critical: 0, important: 0 },
        },
      });
      expect(manifest.exitEvidence?.sourceDigest).toMatch(/^[a-f0-9]{64}$/u);
    } else {
      expect(manifest).toMatchObject({
        overallStatus: 'IN_PROGRESS',
        productionReadiness: 'BLOCKED',
        exitEvidence: {
          sourceDigest: null,
          independentReview: { status: 'PENDING', critical: null, important: null },
        },
      });
    }
    expect(packageManifest.scripts?.['check:arena-product-parity']).toBe(
      'node scripts/check-arena-product-parity.mjs',
    );
    expect(packageManifest.scripts?.['workspace:verify']).toContain(
      'pnpm run check:arena-product-parity',
    );
    expect(packageManifest.scripts?.['workspace:verify']).not.toContain('--require-ready');
  });

  it('production Hono pipeline 在任何 deploy 前强制 require-ready', () => {
    const workflow = readFileSync(workflowPath, 'utf8');
    const gateStep = workflow.indexOf('- name: Require Arena product parity for production');
    const deployJob = workflow.indexOf('\n  deploy:');

    expect(gateStep).toBeGreaterThan(-1);
    expect(workflow).toContain('pnpm run verify:arena-product-parity-ready');
    expect(workflow).toContain('ARENA_PRODUCT_PARITY_REDIS_URL: redis://127.0.0.1:6379');
    expect(workflow).not.toMatch(
      /- name: Require Arena product parity for production[\s\S]*?continue-on-error:/u,
    );
    expect(gateStep).toBeLessThan(deployJob);
  });

  it('READY 绑定被复审源码摘要，任何后续源码变化都会 fail closed', () => {
    const temporaryDirectory = mkdtempSync(resolve(tmpdir(), 'arena-parity-gate-'));
    const temporaryManifest = resolve(temporaryDirectory, 'gate.json');
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
        blockedReason: string;
        overallStatus: string;
        productionReadiness: string;
        slices: Record<string, string>;
        exitEvidence: {
          sourceDigest: string | null;
          independentReview: { status: string; critical: number | null; important: number | null };
        };
      };
      manifest.blockedReason = 'none';
      manifest.overallStatus = 'DONE';
      manifest.productionReadiness = 'READY';
      for (const sliceId of Object.keys(manifest.slices)) manifest.slices[sliceId] = 'DONE';
      manifest.exitEvidence.independentReview = { status: 'PASS', critical: 0, important: 0 };
      manifest.exitEvidence.sourceDigest = '0'.repeat(64);
      writeFileSync(temporaryManifest, JSON.stringify(manifest));

      const rejected = runGate(['--manifest', temporaryManifest, '--require-ready']);
      expect(rejected.status).not.toBe(0);
      expect(rejected.stderr).toContain('READY sourceDigest 已失效');
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it('useBattleEngine generation request 通过 coverage helper 精确绑定 matrix 字段', () => {
    const source = readFileSync(enginePath, 'utf8');

    expect(source).toContain('defineArenaGenerationRequest');
    expect(source).toMatch(
      /const requestBody = roomAction\.inRoom \? null : defineArenaGenerationRequest\(\{[\s\S]*?generationRequestId,[\s\S]*?customProvider:/u,
    );
  });
});
