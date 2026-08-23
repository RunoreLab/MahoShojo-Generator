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
      const outputFile = result.outputFiles?.[0];
      if (!outputFile) {
        throw new Error('esbuild output not found');
      }
      const output = outputFile.text;
      expect(output).not.toMatch(/process\.env|userProviderConfig/iu);
      expect(Object.keys(result.metafile?.inputs ?? {}).some((input) => /cloudflare|react|node_modules\/react/iu.test(input))).toBe(false);
    }
  });

  it.each(['@mahoshojo/contracts', '@mahoshojo/contracts/ai-execution', '@mahoshojo/contracts/api'] as const)('bundles shared AI/API symbols from %s for every target', async (entrypoint) => {
    for (const platform of ['node', 'browser', 'neutral'] as const) {
      const contents = entrypoint.includes('api')
        ? "import { ApiResponseSchema, ApiResponseSuccessSchema, ApiResponseErrorSchema, ApiVersionSchema } from '" + entrypoint + "'; export { ApiResponseSchema, ApiResponseSuccessSchema, ApiResponseErrorSchema, ApiVersionSchema };"
        : "import { AiExecutionRequestSchema, AiExecutionResultSchema, AiExecutionErrorCodeSchema, AiExecutionContractVersionSchema } from '" + entrypoint + "'; export { AiExecutionRequestSchema, AiExecutionResultSchema, AiExecutionErrorCodeSchema, AiExecutionContractVersionSchema };";
      const normalizedEntry = entrypoint === '@mahoshojo/contracts'
        ? "import { AiExecutionRequestSchema, AiExecutionResultSchema, AiExecutionErrorCodeSchema, ApiResponseSchema, ApiVersionSchema } from '" + entrypoint + "'; export { AiExecutionRequestSchema, AiExecutionResultSchema, AiExecutionErrorCodeSchema, ApiResponseSchema, ApiVersionSchema };"
        : null;

      const finalContents = entrypoint === '@mahoshojo/contracts'
        ? normalizedEntry
        : contents;
      if (!finalContents) continue;

      const result = await build({
        absWorkingDir: process.cwd(),
        bundle: true,
        write: false,
        metafile: true,
        platform,
        format: 'esm',
        stdin: {
          contents: finalContents,
          loader: 'ts',
          resolveDir: process.cwd(),
          sourcefile: `contracts-shared-${platform}-${entrypoint.replace(/[^a-z-]/g, '-')}.ts`,
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
