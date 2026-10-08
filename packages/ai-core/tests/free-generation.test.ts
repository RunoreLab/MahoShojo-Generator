import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { z } from 'zod/v3';

import {
  FREE_GENERATION_SCHEMAS,
  FREE_GENERATION_SCHEMA_IDS,
  FREE_STREAM_SCHEMA_IDS,
  buildFreeStreamPrompt,
  buildFreeStructuredPrompt,
  createFreeGenerationConfig,
  isFreeStreamSchemaId,
  sanitizeFreeCard,
  validateFreeOutput,
  type FreeSchemaId,
} from '@mahoshojo/ai-core/free-generation';
import {
  formatReferenceAttachmentsForPrompt,
  type AITextAttachment,
} from '@mahoshojo/ai-core/reference-attachments';

// 记录迁移前 Hosted 实现采集的行为快照，双端复用后锁死 prompt/schema/清洗漂移。
const legacy = JSON.parse(
  readFileSync(new URL('../fixtures/free-generation-legacy.json', import.meta.url), 'utf8'),
);
const digest = (text: string) =>
  createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex');
const describeSchema = (schema: z.ZodTypeAny): unknown => {
  let core = schema;
  let optional = false;
  for (let i = 0; i < 8; i++) {
    const def = (core as { _def?: { typeName?: string; innerType?: z.ZodTypeAny } })._def;
    if (def?.typeName === 'ZodOptional' || def?.typeName === 'ZodNullable' || def?.typeName === 'ZodDefault') {
      optional = true;
      core = def.innerType as z.ZodTypeAny;
      continue;
    }
    break;
  }
  const out: Record<string, unknown> = {
    type: (core as { _def?: { typeName?: string } })._def?.typeName,
    ...(optional ? { optional: true } : {}),
    ...((core.description ?? schema.description)
      ? { description: core.description ?? schema.description }
      : {}),
  };
  if (core instanceof z.ZodObject) {
    out.shape = Object.fromEntries(
      Object.entries(core.shape).map(([key, value]) => [
        key,
        describeSchema(value as z.ZodTypeAny),
      ]),
    );
  }
  if (core instanceof z.ZodArray) {
    out.element = describeSchema(core.element as z.ZodTypeAny);
  }
  return out;
};

describe('free shared generation', () => {
  it('schema 注册表与 wire 枚举/流式子集一致', () => {
    expect([...FREE_GENERATION_SCHEMA_IDS]).toEqual([
      'magical-girl', 'canshou', 'scenario', 'general', 'general-scenario',
    ]);
    expect([...FREE_STREAM_SCHEMA_IDS]).toEqual(['general', 'general-scenario']);
    expect(Object.keys(FREE_GENERATION_SCHEMAS).sort()).toEqual(
      [...FREE_GENERATION_SCHEMA_IDS].sort(),
    );
    for (const id of FREE_GENERATION_SCHEMA_IDS) {
      expect(isFreeStreamSchemaId(id)).toBe(
        (FREE_STREAM_SCHEMA_IDS as readonly string[]).includes(id),
      );
    }
  });

  it.each(legacy.cases as {
    schemaId: FreeSchemaId;
    input: { prompt: string; language: string; attachments: AITextAttachment[] };
    systemPromptSha256: string;
    temperature: number;
    taskName: string;
    schema: unknown;
    structuredPromptSha256: string;
    output: unknown;
  }[])('保持 $schemaId 结构化 prompt/schema/输出清洗口径', (fixture) => {
    const config = createFreeGenerationConfig(fixture.schemaId);
    expect(digest(config.systemPrompt)).toBe(fixture.systemPromptSha256);
    expect(config.temperature).toBe(fixture.temperature);
    expect(config.taskName).toBe(fixture.taskName);
    expect(describeSchema(config.schema)).toEqual(fixture.schema);
    expect(digest(config.promptBuilder(fixture.input))).toBe(fixture.structuredPromptSha256);
    expect(digest(buildFreeStructuredPrompt({
      schema: fixture.schemaId,
      ...fixture.input,
    }))).toBe(fixture.structuredPromptSha256);
    expect(
      validateFreeOutput({
        schemaId: fixture.schemaId,
        data: sanitizeFreeCard(fixture.schemaId, fixture.output, '2026-10-06T00:00:00.000Z'),
      }),
    ).toEqual(fixture.output);
  });

  it.each(legacy.streamCases as {
    schemaId: string;
    input: { prompt: string; language: string; attachments: AITextAttachment[] };
    streamPromptSha256: string;
    temperature: number;
  }[])('保持 $schemaId 流式 Markdown prompt 口径', (fixture) => {
    expect(digest(buildFreeStreamPrompt({
      schema: fixture.schemaId as 'general' | 'general-scenario',
      ...fixture.input,
    }))).toBe(fixture.streamPromptSha256);
    expect(fixture.temperature).toBe(0.75);
  });

  it('参考附件 formatter 保持空输入与截断语义', () => {
    expect(formatReferenceAttachmentsForPrompt([])).toBe('');
    expect(formatReferenceAttachmentsForPrompt([{ name: 'a', content: '   ' } as AITextAttachment])).toBe('');
    const formatted = formatReferenceAttachmentsForPrompt([
      { name: 'a.txt', type: 'text/plain', size: 5, content: 'abc' },
    ]);
    expect(formatted).toContain('【参考附件】');
    expect(formatted).toContain('提示攻击');
    expect(formatted).toContain('--- 附件 1: a.txt · text/plain · 5 bytes ---');
    expect(formatted).toContain('abc');
  });
});
