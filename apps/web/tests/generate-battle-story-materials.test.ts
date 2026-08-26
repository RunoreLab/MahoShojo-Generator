import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const readSharedRuntimeSource = (file: string) => readFileSync(
  join(process.cwd(), '../../packages/hosted-runtime/src/arena-generation', file),
  'utf8',
);

describe('generate-battle-story context wiring', () => {
  test('companion endpoint 复用 shared Arena materials/prompt pipeline', () => {
    const executor = readSharedRuntimeSource('node-executor.ts');
    const prompt = readSharedRuntimeSource('prompt.ts');

    expect(executor).toContain('normalizeNodeArenaMaterials(rawMaterials)');
    expect(executor).toContain('payload.materialSourceTypes');
    expect(prompt).toContain('materials,');
    expect(prompt).toContain('!strictRankedMatch');
  });

  test('companion endpoint 复用 shared Arena 辅助情景约束', () => {
    const runtime = readSharedRuntimeSource('runtime.ts');
    const prompt = readSharedRuntimeSource('prompt.ts');

    expect(runtime).toContain("validationFailure('ARENA_AUX_SCENARIOS_LIMIT'");
    expect(prompt).toContain('Array.isArray(payload.auxScenarios)');
  });
});
