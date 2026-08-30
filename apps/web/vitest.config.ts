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
