import { build } from 'esbuild';

describe('ai-core public entrypoint portability', () => {
  it.each([
    '@mahoshojo/ai-core',
    '@mahoshojo/ai-core/stream-events',
    '@mahoshojo/ai-core/structured-json',
    '@mahoshojo/ai-core/provider-catalog',
    '@mahoshojo/ai-core/ai-connections',
    '@mahoshojo/ai-core/generation-settings',
    '@mahoshojo/ai-core/reference-attachments',
    '@mahoshojo/ai-core/free-generation',
    '@mahoshojo/ai-core/scenario-generation',
  ] as const)('bundles %s for every target without runtime imports', async (entrypoint) => {
    for (const platform of ['node', 'browser', 'neutral'] as const) {
      const contents = entrypoint.endsWith('/stream-events')
        ? `import { AiStreamEventSchema, collectAiStreamResult } from '${entrypoint}'; export { AiStreamEventSchema, collectAiStreamResult };`
        : entrypoint.endsWith('/structured-json')
          ? `import { parseStructuredJsonWithSchema, buildStructuredJsonInstructionFromZodSchema } from '${entrypoint}'; export { parseStructuredJsonWithSchema, buildStructuredJsonInstructionFromZodSchema };`
          : entrypoint.endsWith('/provider-catalog')
            ? `import { AI_PROVIDER_CATALOG, resolveAIProviderModel } from '${entrypoint}'; export { AI_PROVIDER_CATALOG, resolveAIProviderModel };`
          : entrypoint.endsWith('/ai-connections')
            ? `import { describeProviderProfileConnection } from '${entrypoint}'; export { describeProviderProfileConnection };`
            : entrypoint.endsWith('/generation-settings')
              ? `import { getModelGenerationCapabilities, UserGenerationOverridesSchema } from '${entrypoint}'; export { getModelGenerationCapabilities, UserGenerationOverridesSchema };`
            : entrypoint.endsWith('/reference-attachments')
              ? `import { FREE_GENERATION_ATTACHMENT_LIMITS, formatReferenceAttachmentsForPrompt } from '${entrypoint}'; export { FREE_GENERATION_ATTACHMENT_LIMITS, formatReferenceAttachmentsForPrompt };`
            : entrypoint.endsWith('/free-generation')
              ? `import { FREE_GENERATION_SCHEMAS, buildFreeStreamPrompt } from '${entrypoint}'; export { FREE_GENERATION_SCHEMAS, buildFreeStreamPrompt };`
            : entrypoint.endsWith('/scenario-generation')
              ? `import { SCENARIO_GENERATION_SCHEMA, buildScenarioStreamPrompt } from '${entrypoint}'; export { SCENARIO_GENERATION_SCHEMA, buildScenarioStreamPrompt };`
              : `import { AiStreamEventSchema, parseStructuredJsonWithSchema } from '${entrypoint}'; export { AiStreamEventSchema, parseStructuredJsonWithSchema };`;
      const result = await build({
        absWorkingDir: process.cwd(),
        bundle: true,
        write: false,
        metafile: true,
        platform,
        format: 'esm',
        stdin: {
          contents,
          loader: 'ts',
          resolveDir: process.cwd(),
          sourcefile: `ai-core-entry-${platform}.ts`,
        },
      });
      const output = result.outputFiles[0]?.text ?? '';
      expect(output).not.toMatch(/process\.env|userProviderConfig/iu);
      expect(
        Object.keys(result.metafile?.inputs ?? {}).some((input) => (
          /hosted-runtime|cloudflare|react|node_modules\/react|node:/iu.test(input)
        )),
      ).toBe(false);
    }
  });
});
