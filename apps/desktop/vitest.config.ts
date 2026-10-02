import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // 默认 `node`：绝大多数测试是纯函数（桥的编码、错误映射、流事件归一）。
    // 需要 DOM 的少数测试用文件头的 `// @vitest-environment jsdom` 单独声明，例如路由历史验证
    // （jsdom 提供 `location.hash` 与 history API）。
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    /**
     * 路由历史验证每次 traversal 都要等一次宏任务（jsdom 的 `popstate` 有 100ms 量级延迟，实测取
     * 120ms 余量），单条用例因此天然比纯函数测试慢。默认的 5000ms 在本机够用，但在 CI 的负载下
     * 离边界太近；显式给一个有界预算比让门禁偶发变红好。
     */
    testTimeout: 30_000,
  },
  esbuild: {
    jsx: 'automatic',
    tsconfigRaw: {
      compilerOptions: {
        jsx: 'react-jsx',
      },
    },
  },
});