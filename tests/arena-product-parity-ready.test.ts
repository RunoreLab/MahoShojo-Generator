import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const repositoryRoot = process.cwd();
const packagePath = resolve(repositoryRoot, 'package.json');
const scriptPath = resolve(repositoryRoot, 'scripts/verify-arena-product-parity-ready.mjs');

describe('GMR-10P repeatable READY verification entrypoint', () => {
  it('binds the required API/Web/coverage/contracts suites without recursive repo verification', () => {
    expect(existsSync(scriptPath), '缺少 GMR-10P READY 可重复验证脚本').toBe(true);
    const packageManifest = JSON.parse(readFileSync(packagePath, 'utf8')) as {
      scripts?: Record<string, string>;
    };
    expect(packageManifest.scripts?.['verify:arena-product-parity-ready']).toBe(
      'node scripts/verify-arena-product-parity-ready.mjs',
    );

    const source = readFileSync(scriptPath, 'utf8');
    for (const requiredPath of [
      'scripts/check-arena-product-parity.mjs',
      'tests/room-product-parity-golden-flow.test.ts',
      'tests/arena-multiplayer-production-wiring.test.tsx',
      'tests/arena-multiplayer-interaction.test.tsx',
      'tests/arena-room-proposal-workspace.test.tsx',
      'tests/arena-proposal-panel.test.tsx',
      'tests/arena-battle-result-presentation.test.tsx',
      'tests/product-parity-coverage.test.ts',
      'tests/gmr10p-proposal-contract-expansion.test.ts',
      'tests/room-http.test.ts',
      'tests/proposal.test.ts',
      'tests/wire-security.test.ts',
    ]) {
      expect(source, `READY verifier 未绑定 ${requiredPath}`).toContain(requiredPath);
    }
    expect(source).toContain('--require-ready');
    expect(source).not.toContain('test:repo');
    expect(source).not.toContain('ci:verify');
    expect(source).not.toContain('tests/arena-product-parity-gate.test.ts');
  });
});
