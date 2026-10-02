import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // 默认 `node`：绝大多数测试是纯函数（桥的编码、错误映射、流事件归一）。
    // 需要 DOM 的少数测试用文件头的 `// @vitest-environment jsdom` 单独声明，例如路由历史验证
    // （jsdom 提供 `location.hash` 与 history API）。
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
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