import os from 'node:os';
import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    {
      name: 'vitest-style-stub',
      enforce: 'pre',
      resolveId(source) {
        if (source.endsWith('.css')) return '\0vitest-style-stub';
        return null;
      },
      load(id) {
        if (id === '\0vitest-style-stub') return 'export default {};';
        return null;
      },
    },
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname),
      'server-only': path.resolve(__dirname, 'tests/helpers/server-only.ts'),
    },
  },
  test: {
    environment: 'node',
    env: {
      NEXT_PUBLIC_HOSTED_API_ENVIRONMENT: 'test',
    },
    globals: true,
    include: ['tests/**/*.test.{ts,tsx,js}'],
    setupFiles: ['tests/setup.ts'],
    restoreMocks: true,
    clearMocks: true,
    /**
     * 429 个测试文件共享一台机器，默认 worker 数（`availableParallelism() - 1`）在多核开发机上
     * 会开到十几个。本套件实测的最坏用例耗时对 worker 数仍然敏感，因此把上限压到 **8**：
     *
     * | worker 数 | 墙钟 | 最慢用例 | 峰值常驻 |
     * | --- | --- | --- | --- |
     * | 15（本机默认） | 74.3s | 6.79s | 3448MB |
     * | 8 | 82.4s | 5.22s | 2295MB |
     * | 4 | 124s | 8.0s | 1489MB |
     *
     * 取 8 而不是更小：它换掉约 11% 墙钟，换来 33% 更低的峰值内存和更好的尾延迟；
     * 再往下（4）墙钟要涨 41%，性价比反转。
     *
     * 用 `availableParallelism() - 1` 做被减数而不是写死数字，是为了让 **CI 保持它原本就有的
     * 行为**：CI 是 4 核，vitest 默认给 3，这里仍是 3。上限只对核多的人生效，
     * 于是「本地 16 核跑得动、CI 4 核跑不动」这类差异不会来自并发度。
     */
    maxWorkers: Math.min(Math.max(os.availableParallelism() - 1, 1), 8),
    /**
     * 20s 由实测反推，不再由「加超时」反推。
     *
     * 上一轮把这里从 15s 抬到 60s，理由是三个用例在全量下越界。那三个数字里有两个是真的
     * （`no-server-d1-transaction-usage` 全树 AST 解析、`web-package-import-library` 构造
     * 256MiB 压缩包），但归因是错的：它们被读成「并发超订的放大效应」，而放大效应的来源
     * 是 `arena-room-proposal-workspace` 那条渲染 256 参考项的用例——它在同一个 jsdom 环境里
     * 逐条累积堆，越靠后越贵（同一测试体：单独跑 357ms、文件首位 2.5s、文件末位 6.1s、
     * 全量 49s）。把那条用例拆成独立文件后（见
     * `tests/arena-room-proposal-workspace-reference-budget.test.tsx`），全量最慢用例降到
     * **6.79s**，其余用例都在 4s 以内。
     *
     * 所以 60s → 20s：**比原来紧 3 倍**，门禁重新拿回敏感度，同时仍留约 3 倍余量给比本机慢约
     * 2.5 倍的机器（CI 与老笔记本）。真挂起的用例仍在 20s 判红，只是整套最坏耗时不再翻倍。
     */
    testTimeout: 20_000,
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
