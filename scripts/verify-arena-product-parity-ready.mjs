import { spawnSync } from 'node:child_process';
import path from 'node:path';

const repositoryRoot = path.resolve(import.meta.dirname, '..');
const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

const steps = [
  {
    label: 'manifest gate',
    command: process.execPath,
    args: ['scripts/check-arena-product-parity.mjs', '--require-ready'],
  },
  {
    label: 'API golden/config/membership',
    args: [
      '--filter', '@mahoshojo/api', 'exec', 'vitest', 'run',
      'tests/room-product-parity-golden-flow.test.ts',
      'tests/room-config-service.test.ts',
      'tests/room-membership-service.test.ts',
      'tests/room-proposal-service.test.ts',
      'tests/room-verifier-membership-composition.test.ts',
    ],
  },
  {
    label: 'Web production wiring/Proposal/BattleResult',
    args: [
      '--filter', '@mahoshojo/web', 'exec', 'vitest', 'run',
      'tests/arena-multiplayer-production-wiring.test.tsx',
      'tests/arena-multiplayer-interaction.test.tsx',
      'tests/arena-room-proposal-workspace.test.tsx',
      'tests/arena-editor-session-isolation.test.tsx',
      'tests/arena-preset-picker-accessibility.test.tsx',
      'tests/arena-proposal-panel.test.tsx',
      'tests/arena-battle-result-presentation.test.tsx',
      'tests/modal-accessibility.test.tsx',
      'tests/arena-multiplayer-panel.test.tsx',
    ],
  },
  {
    label: 'multiplayer-core coverage/proposal',
    args: [
      '--filter', '@mahoshojo/multiplayer-core', 'exec', 'vitest', 'run',
      'tests/product-parity-coverage.test.ts',
      'tests/gmr10p-proposal-contract-expansion.test.ts',
      'tests/core.test.ts',
      'tests/state-machine-proposal-generation.test.ts',
    ],
  },
  {
    label: 'contracts room/proposal/security',
    args: [
      '--filter', '@mahoshojo/contracts', 'exec', 'vitest', 'run',
      'tests/room-http.test.ts',
      'tests/proposal.test.ts',
      'tests/spec-review-b.test.ts',
      'tests/spec-review-r3.test.ts',
      'tests/wire-security.test.ts',
    ],
  },
];

for (const step of steps) {
  console.log(`[arena-product-parity-ready] ${step.label}`);
  const result = spawnSync(
    step.command ?? pnpmCommand,
    step.args,
    { cwd: repositoryRoot, stdio: 'inherit' },
  );
  if (result.error) {
    console.error(`[arena-product-parity-ready] ${step.label} failed: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`[arena-product-parity-ready] ${step.label} exited with ${result.status ?? 'signal'}`);
    process.exit(result.status ?? 1);
  }
}

console.log('[arena-product-parity-ready] PASS');
