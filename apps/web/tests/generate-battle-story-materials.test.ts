import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const readSharedRuntimeSource = (file: string) => readFileSync(
  join(process.cwd(), '../../packages/hosted-runtime/src/arena-generation', file),
  'utf8',
);

const readSharedPromptAssembly = () => readFileSync(
  join(process.cwd(), '../../packages/ai-core/src/arena-generation/prompt-assembly.ts'),
  'utf8',
);

describe('generate-battle-story context wiring', () => {
  test('companion endpoint 复用 shared Arena materials/prompt pipeline', () => {
    const executor = readSharedRuntimeSource('node-executor.ts');
    const prompt = readSharedRuntimeSource('prompt.ts');

    expect(executor).toContain('normalizeNodeArenaMaterials(rawMaterials)');
    expect(executor).toContain('payload.materialSourceTypes');
    expect(prompt).toContain("from '@mahoshojo/ai-core/arena-generation'");
    expect(prompt).toContain('return assembleArenaGenerationPrompt({');
    expect(prompt).toContain('payload: { ...payload, userGuidance }');
    const assembly = readSharedPromptAssembly();
    expect(assembly).toContain('materials,');
    expect(assembly).toContain('!strictRankedMatch');
  });

  test('companion endpoint 复用 shared Arena 聚合引用预算', () => {
    const runtime = readSharedRuntimeSource('runtime.ts');
    const prompt = readSharedRuntimeSource('prompt.ts');

    expect(runtime).toContain('countArenaReferenceItems(payload)');
    expect(runtime).toContain("'ARENA_REFERENCE_ITEMS_LIMIT'");
    expect(prompt).toContain('return assembleArenaGenerationPrompt({');
    expect(readSharedPromptAssembly()).toContain('Array.isArray(payload.auxScenarios)');
  });
});
