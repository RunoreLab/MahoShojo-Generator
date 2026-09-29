import path from 'node:path';
import { defineConfig } from 'vitest/config';

/** 与快速 jsdom 测试分离；使用真实 Chromium 验证 opaque origin、CSP 与 ESM。 */
export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname) } },
  test: { environment: 'node', include: ['tests/web-package-renderer.browser.ts'], testTimeout: 30_000, hookTimeout: 60_000 },
});
