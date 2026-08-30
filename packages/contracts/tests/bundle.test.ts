import { readFileSync } from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const testFileDir = path.dirname(fileURLToPath(import.meta.url));
const contractsManifest = JSON.parse(readFileSync(path.resolve(testFileDir, '../package.json'), 'utf8'));
const exportsMap = contractsManifest?.exports;
const packageName = contractsManifest?.name ?? '@mahoshojo/contracts';
const publicEntrypoints = Object.keys(typeof exportsMap === 'object' && exportsMap ? exportsMap : {}).map((exportKey) =>
  exportKey === '.' ? packageName : `${packageName}${exportKey.slice(1)}`,
);
const forbiddenBundleInputs = [
  /(^|[\\\/])react($|[\\\/])/i,
  /(^|[\\\/])react-dom($|[\\\/])/i,
  /(^|[\\\/])next($|[\\\/])/i,
  /(^|[\\\/])hono($|[\\\/])/i,
  /(^|[\\\/])drizzle-orm($|[\\\/])/i,
  /(^|[\\\/])better-sqlite3($|[\\\/])/i,
  /(^|[\\\/])redis($|[\\\/])/i,
  /cloudflare/i,
];

describe('public contracts entrypoint portability', () => {
  it('has exported subpaths', () => {
    expect(publicEntrypoints.length).toBeGreaterThan(0);
  });

  it.each(publicEntrypoints)('bundles %s for every target without environment imports', async (entrypoint) => {
    const runtimeNamespace = await import(entrypoint);
    const expectedKeys = [...Object.keys(runtimeNamespace)].sort();

    for (const platform of ['node', 'browser', 'neutral'] as const) {
      const result = await build({
        absWorkingDir: process.cwd(),
        bundle: true,
        write: false,
        metafile: true,
        platform,
        format: 'esm',
        stdin: {
          contents: `import * as publicApi from '${entrypoint}'; export { publicApi }; export const publicKeys = Object.keys(publicApi);`,
          loader: 'ts',
          resolveDir: process.cwd(),
          sourcefile: `contracts-entry-${platform}.ts`,
        },
      });

      const outputFile = result.outputFiles?.[0];
      if (!outputFile) {
        throw new Error('esbuild output not found');
      }

      const output = outputFile.text;
      expect(output).not.toMatch(/process\.env|userProviderConfig/iu);
      expect(Object.keys(result.metafile?.inputs ?? {}).some((input) =>
        forbiddenBundleInputs.some((rule) => rule.test(input)),
      )).toBe(false);

      const moduleUrl = `data:application/javascript;base64,${Buffer.from(output).toString('base64')}`;
      const importFailureMessage = `entrypoint ${entrypoint} should be importable as data URL for ${platform} bundle`;
      let imported;
      try {
        imported = await import(moduleUrl);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`${importFailureMessage}: ${reason}`);
      }

      const sortedRuntimeKeys = [...(imported.publicKeys ?? [])].sort();
      const sortedNamespaceKeys = [...Object.keys(imported.publicApi ?? {})].sort();

      expect(imported.publicApi).toBeTypeOf('object');
      expect(imported.publicKeys).toBeInstanceOf(Array);
      expect(imported.publicKeys).toHaveLength(sortedNamespaceKeys.length);
      expect(sortedRuntimeKeys).toEqual(sortedNamespaceKeys);
      expect(sortedRuntimeKeys).toEqual(expectedKeys);
    }
  }, 30_000);
});
