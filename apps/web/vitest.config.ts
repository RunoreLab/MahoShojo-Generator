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
     * 15s 是按一个小得多的套件定的；本套件已有 **428** 个测试文件，共享一台机器的 CPU，放大效应让
     * 它不再成立。三个互相独立的用例都实测越界，且都不是自身变慢：
     *
     * | 用例 | 单独运行 | 428 文件全量下 |
     * | --- | --- | --- |
     * | `no-server-d1-transaction-usage`（遍历 app/components/lib/pages/scripts 全树） | 562ms | >15s（超时） |
     * | `arena-room-proposal-workspace` 的预算用尽用例（渲染 256 个参考项） | 344ms | >30s（超时） |
     * | `web-package-import-library` | 4.0s | 偶发超时 |
     *
     * 60s ≈ 已证明不足的 15s 的 4 倍，且仍远小于无限等待：真挂起的用例 60s 后必然判红，整套最坏耗时
     * 约翻倍，可以接受。放宽的是**超时**而不是断言——这三条要守的性质一点没动。
     *
     * 逐个给用例调预算不是办法：那只是把同一个问题推到下一个文件上，而门禁偶发变红比门禁偏紧更贵。
     * 真正想消除放大效应要限制并发（`poolOptions` / `fileParallelism`），那会改变整套的墙钟时间，
     * 需要连同 CI 机器规格一起判断，因此不在此处改动。
     *
     * 个别确实更重的用例可以带自己的行内超时（见 `arena-room-proposal-workspace.test.tsx`），
     * 行内值仍然优先。
     */
    testTimeout: 60_000,
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
