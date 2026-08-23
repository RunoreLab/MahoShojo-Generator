import { build } from 'esbuild';

describe('ai-core public entrypoint portability', () => {
  it.each([
    '@mahoshojo/ai-core',
    '@mahoshojo/ai-core/stream-events',
    '@mahoshojo/ai-core/structured-json',
  ] as const)('bundles %s for every target without runtime imports', async (entrypoint) => {
    for (const platform of ['node', 'browser', 'neutral'] as const) {
      const contents = entrypoint.endsWith('/stream-events')
        ? `import { AiStreamEventSchema, collectAiStreamResult } from '${entrypoint}'; export { AiStreamEventSchema, collectAiStreamResult };`
        : entrypoint.endsWith('/structured-json')
          ? `import { parseStructuredJsonWithSchema, buildStructuredJsonInstructionFromZodSchema } from '${entrypoint}'; export { parseStructuredJsonWithSchema, buildStructuredJsonInstructionFromZodSchema };`
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
          /cloudflare|react|node_modules\/react|node:/iu.test(input)
        )),
      ).toBe(false);
    }
  });
});
