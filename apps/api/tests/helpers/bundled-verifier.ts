import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll } from 'vitest';

/** Compile the real CLI once: the child deadline measures execution, not repeated tsx cold starts. */
export function registerBundledVerifier(entryPoint: string): () => string {
  let directory: string | undefined;
  let output: string | undefined;
  beforeAll(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'mahoshojo-verifier-test-'));
    output = path.join(directory, 'verifier.mjs');
    await build({entryPoints: [entryPoint], outfile: output, bundle: true, format: 'esm', platform: 'node',
      target: 'node20', treeShaking: false, logLevel: 'silent',
      banner: {js: "import { createRequire as testCreateRequire } from 'node:module'; const require = testCreateRequire(import.meta.url);"}});
  }, 30_000);
  afterAll(async () => {
    if (!directory) return;
    if (path.dirname(directory) !== path.resolve(tmpdir()) || !path.basename(directory).startsWith('mahoshojo-verifier-test-')) throw new Error('Unexpected verifier fixture cleanup path');
    await rm(directory, {recursive: true, force: true});
  });
  return () => {
    if (!output) throw new Error('Verifier fixture has not been compiled');
    return output;
  };
}
