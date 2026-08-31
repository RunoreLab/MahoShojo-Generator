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

const runGate = (args: readonly string[] = []) => spawnSync(
  process.execPath,
  [scriptPath, ...args],
  { cwd: repositoryRoot, encoding: 'utf8', env: { PATH: process.env.PATH } },
);

describe('GMR-10P product parity gate', () => {
  it('提供 machine-readable manifest，普通仓库验证接受结构正确的 BLOCKED 状态', () => {
    expect(existsSync(manifestPath), '缺少 product parity gate manifest').toBe(true);
    expect(existsSync(scriptPath), '缺少 product parity gate checker').toBe(true);

    const verified = runGate();
    expect(verified.status, `${verified.stdout}\n${verified.stderr}`).toBe(0);
    expect(JSON.parse(verified.stdout)).toMatchObject({
      gate: 'ARENA_PRODUCT_PARITY_GATE',
      goal: 'GMR-10P',
      status: 'PASS',
      productionReadiness: 'BLOCKED',
    });
  });

  it('production readiness 在 GMR-10P-G 完成前 fail closed', () => {
    const readiness = runGate(['--require-ready']);

    expect(readiness.status).toBe(1);
    expect(readiness.stderr).toMatch(/GMR-10P.*未 DONE.*production/u);
  });

  it('普通 ci:verify 校验 manifest，但不假装 production ready', () => {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      overallStatus?: string;
      productionReadiness?: string;
      slices?: Record<string, string>;
    };
    const packageManifest = JSON.parse(readFileSync(packagePath, 'utf8')) as {
      scripts?: Record<string, string>;
    };

    expect(manifest).toMatchObject({
      overallStatus: 'IN_PROGRESS',
      productionReadiness: 'BLOCKED',
      slices: {
        'GMR-10P-A': 'DONE',
        'GMR-10P-B': 'IN_PROGRESS',
        'GMR-10P-G': 'BLOCKED',
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
    const gateStep = workflow.indexOf('- name: Require Arena product parity for production');
    const deployJob = workflow.indexOf('\n  deploy:');

    expect(gateStep).toBeGreaterThan(-1);
    expect(workflow).toContain('pnpm run check:arena-product-parity -- --require-ready');
    expect(workflow).not.toMatch(
      /- name: Require Arena product parity for production[\s\S]*?continue-on-error:/u,
    );
    expect(gateStep).toBeLessThan(deployJob);
  });

  it('useBattleEngine generation request 通过 coverage helper 精确绑定 matrix 字段', () => {
    const source = readFileSync(enginePath, 'utf8');

    expect(source).toContain('defineArenaGenerationRequest');
    expect(source).toMatch(
      /const requestBody = defineArenaGenerationRequest\(\{[\s\S]*?generationRequestId,[\s\S]*?customProvider:/u,
    );
  });
});
