import { build } from 'esbuild';

describe('local-library public entrypoints', () => {
  it.each([
    '@mahoshojo/local-library',
    '@mahoshojo/local-library/archive',
    '@mahoshojo/local-library/migration',
    '@mahoshojo/local-library/record',
    '@mahoshojo/local-library/repository',
  ] as const)('bundles %s for Node, browser, and neutral targets', async (entrypoint) => {
    for (const platform of ['node', 'browser', 'neutral'] as const) {
      const result = await build({
        absWorkingDir: process.cwd(),
        bundle: true,
        write: false,
        metafile: true,
        platform,
        format: 'esm',
        stdin: {
          contents: `import * as publicApi from '${entrypoint}'; export { publicApi };`,
          loader: 'ts',
          resolveDir: process.cwd(),
          sourcefile: `local-library-${platform}.ts`,
        },
      });

      const inputs = Object.keys(result.metafile?.inputs ?? {});
      expect(inputs.some((input) => /(?:^|\/)(?:react|next|hono|drizzle-orm|better-sqlite3)(?:\/|$)/u.test(input))).toBe(false);
      expect(result.outputFiles[0]?.text ?? '').not.toMatch(/process\.env|indexedDB|localStorage|navigator\./u);
    }
  });
});
