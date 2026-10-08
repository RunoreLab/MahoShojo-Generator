import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { z } from 'zod/v3';

import {
  SCENARIO_GENERATION_SCHEMA,
  buildScenarioStreamPrompt,
  createScenarioGenerationConfig,
  type ScenarioGenerationInput,
} from '@mahoshojo/ai-core/scenario-generation';

// 记录迁移前 Hosted 实现采集的行为快照，双端复用后锁死 prompt/schema 漂移。
const legacy = JSON.parse(
  readFileSync(new URL('../fixtures/scenario-generation-legacy.json', import.meta.url), 'utf8'),
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

describe('scenario shared generation', () => {
  it.each(legacy.cases as {
    input: ScenarioGenerationInput;
    systemPromptSha256: string;
    temperature: number;
    taskName: string;
    schema: unknown;
    structuredPromptSha256: string;
    output: unknown;
  }[])('保持结构化 prompt/schema 口径', (fixture) => {
    const config = createScenarioGenerationConfig(fixture.input);
    expect(digest(config.systemPrompt)).toBe(fixture.systemPromptSha256);
    expect(config.temperature).toBe(fixture.temperature);
    expect(config.taskName).toBe(fixture.taskName);
    expect(describeSchema(config.schema)).toEqual(fixture.schema);
    expect(describeSchema(SCENARIO_GENERATION_SCHEMA)).toEqual(fixture.schema);
    expect(digest(config.promptBuilder())).toBe(fixture.structuredPromptSha256);
  });

  it.each(legacy.streamCases as {
    input: {
      answers: Record<string, unknown>;
      language: string;
      fieldsToKeepEmpty: unknown;
      titleHint: unknown;
    };
    streamPromptSha256: string;
    temperature: number;
  }[])('保持流式 Markdown prompt 口径', (fixture) => {
    expect(digest(buildScenarioStreamPrompt(fixture.input))).toBe(fixture.streamPromptSha256);
    expect(fixture.temperature).toBe(0.75);
  });
});
