import { existsSync, readFileSync } from 'node:fs';
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

  it('production readiness 在 GMR-10Q-G 完成后通过 require-ready', () => {
    const readiness = runGate(['--', '--require-ready']);

    expect(readiness.error).toBeUndefined();
    expect(readiness.status, `${readiness.stdout}\n${readiness.stderr}`).toBe(0);
  });

  it('普通 ci:verify 校验完成后的 manifest 与全部切片状态', () => {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      blockedReason?: string;
      overallStatus?: string;
      productionReadiness?: string;
      slices?: Record<string, string>;
    };
    const packageManifest = JSON.parse(readFileSync(packagePath, 'utf8')) as {
      scripts?: Record<string, string>;
    };

    expect(manifest).toMatchObject({
      goal: 'GMR-10Q',
      acceptedSpec: 'SPEC-arena-multiplayer-gate-minimization-parity-v1',
      prerequisiteGoals: { 'GMR-10P': 'DONE' },
      blockedReason: 'none',
      overallStatus: 'DONE',
      productionReadiness: 'READY',
      slices: {
        'GMR-10Q-A': 'DONE',
        'GMR-10Q-B': 'DONE',
        'GMR-10Q-C': 'DONE',
        'GMR-10Q-D': 'DONE',
        'GMR-10Q-E': 'DONE',
        'GMR-10Q-F': 'DONE',
        'GMR-10Q-G': 'DONE',
      },
    });
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
    const ciStep = workflow.indexOf('pnpm run ci:verify');
    const gateStep = workflow.indexOf('- name: Require Arena product parity for production');
    const deployJob = workflow.indexOf('\n  deploy:');

    expect(ciStep).toBeGreaterThan(-1);
    expect(gateStep).toBeGreaterThan(-1);
    expect(workflow).toContain('pnpm run verify:arena-product-parity-ready');
    expect(workflow).not.toMatch(
      /- name: Require Arena product parity for production[\s\S]*?continue-on-error:/u,
    );
    expect(ciStep).toBeLessThan(gateStep);
    expect(gateStep).toBeLessThan(deployJob);
  });

  it('useBattleEngine generation request 通过 coverage helper 精确绑定 matrix 字段', () => {
    const source = readFileSync(enginePath, 'utf8');

    expect(source).toContain('defineArenaGenerationRequest');
    expect(source).toMatch(
      /const requestBody = roomAction\.inRoom \? null : defineArenaGenerationRequest\(\{[\s\S]*?generationRequestId,[\s\S]*?customProvider:/u,
    );
  });
});
