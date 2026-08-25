import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const readEndpointSource = () =>
  readFileSync(join(process.cwd(), 'app/api/generate-battle-story/handler.ts'), 'utf8');

describe('generate-battle-story context wiring', () => {
  test('非流式默认 endpoint 会解析 materials、注入 prompt builder，并排除 strict 轻量模型路径', () => {
    const source = readEndpointSource();

    expect(source).toContain("import { MAX_ARENA_MATERIALS, normalizeArenaMaterialsForRequest } from '@/lib/arena/materials';");
    expect(source).toMatch(/const\s+\{[\s\S]*\bmaterials\b[\s\S]*\}\s*=\s*body/);
    expect(source).toContain('const normalizedMaterials = normalizeArenaMaterialsForRequest(materials);');
    expect(source).toContain('&& materialCount === 0');
    expect(source).toMatch(/createPromptBuilder\([\s\S]*includeQuestionnaireAnswersInPrompt,\s*normalizedMaterials\s*\)/);
    expect(source).toContain('materials: normalizedMaterials');
    expect(source).toContain('materialCount: materialCount > 0 ? materialCount : null');
    expect(source).toContain('materialSourceTypes: materialSourceTypes.length > 0 ? materialSourceTypes : null');
  });

  test('非流式默认 endpoint 会把辅助情景注入 prompt builder', () => {
    const source = readEndpointSource();

    expect(source).toContain('const normalizedAuxScenarios = Array.isArray(auxScenarios)');
    expect(source).toContain("message: '辅助情景最多 10 个'");
    expect(source).toMatch(/createPromptBuilder\([\s\S]*mode,\s*scenario,\s*normalizedAuxScenarios,\s*teams/);
  });
});
