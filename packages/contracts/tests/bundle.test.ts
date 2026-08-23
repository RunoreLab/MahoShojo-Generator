import { build } from 'esbuild';

describe('public contracts entrypoint portability', () => {
  it.each(['@mahoshojo/contracts', '@mahoshojo/contracts/arena-room'] as const)('bundles %s for every target without environment imports', async (entrypoint) => {
    for (const platform of ['node', 'browser', 'neutral'] as const) {
      const result = await build({
        absWorkingDir: process.cwd(),
        bundle: true,
        write: false,
        metafile: true,
        platform,
        format: 'esm',
        stdin: {
          contents: `import { ArenaRoomSnapshotSchema, parseRoomEventFrame, parseGenerationBridgeBatchFrame } from '${entrypoint}'; export { ArenaRoomSnapshotSchema, parseRoomEventFrame, parseGenerationBridgeBatchFrame };`,
          loader: 'ts',
          resolveDir: process.cwd(),
          sourcefile: `contracts-entry-${platform}.ts`,
        },
      });
      const output = result.outputFiles[0]?.text ?? '';
      expect(output).not.toMatch(/process\.env|userProviderConfig/iu);
      expect(Object.keys(result.metafile?.inputs ?? {}).some((input) => /cloudflare|react|node_modules\/react/iu.test(input))).toBe(false);
    }
  });

  it.each(['@mahoshojo/contracts', '@mahoshojo/contracts/data-cards'] as const)('bundles data-card metadata from %s for every target', async (entrypoint) => {
    for (const platform of ['node', 'browser', 'neutral'] as const) {
      const result = await build({
        absWorkingDir: process.cwd(),
        bundle: true,
        write: false,
        metafile: true,
        platform,
        format: 'esm',
        stdin: {
          contents: `import { OnlineDataCardTypeSchema, DataCardReviewStatusSchema, OnlineDataCardVisibilitySchema } from '${entrypoint}'; export { OnlineDataCardTypeSchema, DataCardReviewStatusSchema, OnlineDataCardVisibilitySchema };`,
          loader: 'ts',
          resolveDir: process.cwd(),
          sourcefile: `data-card-contracts-entry-${platform}.ts`,
        },
      });
      const output = result.outputFiles[0]?.text ?? '';
      expect(output).not.toMatch(/process\.env|userProviderConfig/iu);
      expect(Object.keys(result.metafile?.inputs ?? {}).some((input) => /cloudflare|react|node_modules\/react/iu.test(input))).toBe(false);
    }
  });
});
