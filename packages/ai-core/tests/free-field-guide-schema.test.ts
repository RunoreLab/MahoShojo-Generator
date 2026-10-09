import { describe, expect, it } from 'vitest';
import { z } from 'zod/v3';

import { createCreatorStructuredGeneralConfig } from '@mahoshojo/ai-core/creator-generation';
import {
  buildFreeFieldGuide,
  createFreeGenerationConfig,
  FREE_GENERATION_SCHEMAS,
  FREE_GENERATION_SCHEMA_IDS,
  sanitizeFreeCard,
  validateFreeOutput,
  type FreeSchemaId,
} from '@mahoshojo/ai-core/free-generation';

const modelFieldNames = (prompt: string): string[] =>
  [...prompt.matchAll(/^- ([a-zA-Z_][a-zA-Z0-9_]*)：/gm)].map((match) => match[1]!);

const generalCases = [
  { schemaId: 'general' as const, modelData: { name: '拾光', content: '修理旧物的魔法少女。' }, templateId: '通用角色' },
  { schemaId: 'general-scenario' as const, modelData: { title: '旧书店的午后', content: '寻找会唱歌的绘本。' }, templateId: '通用情景' },
];

describe('structured field guides match the model schema', () => {
  it.each(FREE_GENERATION_SCHEMA_IDS)('%s only lists top-level fields present in its generation schema', (schemaId) => {
    const schema = FREE_GENERATION_SCHEMAS[schemaId] as z.ZodObject<z.ZodRawShape>;
    const guide = buildFreeFieldGuide(schemaId);
    expect(modelFieldNames(guide)).toEqual(Object.keys(schema.shape));
    if (schemaId === 'magical-girl' || schemaId === 'canshou' || schemaId === 'scenario') {
      expect(guide).toContain('自由生成禁止输出原生签名');
    }
  });

  it.each(generalCases)('$schemaId only explains model-output fields and leaves template metadata to the host', ({ schemaId, modelData, templateId }) => {
    const schema = FREE_GENERATION_SCHEMAS[schemaId] as z.ZodObject<z.ZodRawShape>;
    const guide = buildFreeFieldGuide(schemaId);
    expect(modelFieldNames(guide)).toEqual(Object.keys(schema.shape));
    expect(guide).not.toContain('固定为');
    expect(guide).not.toContain('current_state');
    expect(guide).toContain('模板标识由应用在生成后补充');

    const freePrompt = createFreeGenerationConfig(schemaId).promptBuilder({
      prompt: '按角色或情景设定生成。', language: '简体中文', attachments: [],
    });
    const creatorPrompt = createCreatorStructuredGeneralConfig(schemaId).promptBuilder({
      language: '简体中文', creatorPromptText: '创作约束', answers: [], loreText: '',
    });
    for (const prompt of [freePrompt, creatorPrompt]) {
      expect(prompt).toContain(guide);
      expect(modelFieldNames(prompt)).toEqual(Object.keys(schema.shape));
    }

    // 模型 schema 和宿主模板归属没有因 prompt 修正而扩张；错误模板仍由宿主覆盖。
    expect(schema.parse(modelData)).toEqual(modelData);
    expect(validateFreeOutput({
      schemaId,
      data: sanitizeFreeCard(schemaId, { ...modelData, templateId: 'untrusted-template' }, '2026-10-09T00:00:00.000Z'),
    })).toEqual({ ...modelData, templateId });
  });

  it('does not reinterpret an unknown schema as a general character or scenario', () => {
    const unknownGuide = buildFreeFieldGuide('unknown-schema' as FreeSchemaId);
    expect(unknownGuide).not.toBe(buildFreeFieldGuide('general'));
    expect(unknownGuide).not.toBe(buildFreeFieldGuide('general-scenario'));
  });
});
