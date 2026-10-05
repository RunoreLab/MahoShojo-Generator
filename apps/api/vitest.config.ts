import os from 'node:os';
import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: import.meta.dirname,
  resolve: {
    alias: {
      '#': path.resolve(import.meta.dirname, 'src'),
      'server-only': path.resolve(import.meta.dirname, 'src/shims/server-only.ts'),
    },
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.ts'],
    restoreMocks: true,
    clearMocks: true,
    /**
     * 与 `apps/web` 同一个上限、同一个理由：本仓多核开发机上 vitest 默认会开到
     * `availableParallelism() - 1` 个 worker，而本套件对 worker 数仍然敏感
     * （`route-manifest.test.ts` 单独跑 2.9s，全量下 13.0s，4.5 倍）。
     *
     * 用 `availableParallelism() - 1` 做被减数而不是写死数字，是为了让 **CI 保持它原本就有的
     * 行为**：CI 是 4 核，vitest 默认给 3，这里仍是 3。上限只对核多的人生效。
     */
    maxWorkers: Math.min(Math.max(os.availableParallelism() - 1, 1), 8),
    testTimeout: 15_000,
  },
  esbuild: {
    jsx: 'automatic',
    tsconfigRaw: {
      compilerOptions: {
        jsx: 'react-jsx',
      },
    },
  },
  oxc: false,
});
