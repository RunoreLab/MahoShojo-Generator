import path from 'node:path';
import { defineConfig } from 'vitest/config';

/** 与快速 jsdom 测试分离；使用真实 Chromium 验证 opaque origin、CSP、ESM 与命中测试。 */
export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname) } },
  test: {
    environment: 'node',
    include: ['tests/web-package-renderer.browser.ts', 'tests/web-package-card-grid.browser.tsx'],
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
  // 卡片网格回归要渲染真实组件，因此与主配置一致地走 esbuild 的 automatic JSX。
  esbuild: {
    jsx: 'automatic',
    tsconfigRaw: { compilerOptions: { jsx: 'react-jsx' } },
  },
  oxc: false,
});
