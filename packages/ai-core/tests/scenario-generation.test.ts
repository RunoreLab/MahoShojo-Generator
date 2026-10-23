import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { z } from 'zod/v3';
import { parseStructuredJsonWithSchema } from '@mahoshojo/ai-core/structured-json';

import {
  SCENARIO_GENERATION_SCHEMA,
  SCENARIO_STREAM_TEMPERATURE,
  buildScenarioStreamPrompt,
  createScenarioGenerationConfig,
  type ScenarioGenerationInput,
  type ScenarioStreamPromptInput,
} from '@mahoshojo/ai-core/scenario-generation';

const legacy = JSON.parse(
  readFileSync(new URL('../fixtures/scenario-generation-legacy.json', import.meta.url), 'utf8'),
);
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
    temperature: number;
    taskName: string;
    schema: unknown;
  }[])('保留结构化 schema，并传入语言、回答与指定留空字段', (fixture) => {
    const config = createScenarioGenerationConfig(fixture.input);
    expect(config.temperature).toBe(fixture.temperature);
    expect(config.taskName).toBe(fixture.taskName);
    expect(describeSchema(config.schema)).toEqual(fixture.schema);
    expect(describeSchema(SCENARIO_GENERATION_SCHEMA)).toEqual(fixture.schema);
    const prompt = config.promptBuilder();
    expect(prompt).toContain(fixture.input.language);
    for (const [question, answer] of Object.entries(fixture.input.answers)) {
      expect(prompt).toContain(question);
      expect(prompt).toContain(answer);
    }
    for (const field of fixture.input.fieldsToKeepEmpty) expect(prompt).toContain(field);
  });

  it.each(legacy.streamCases as {
    input: ScenarioStreamPromptInput;
  }[])('向流式生成传入语言、回答、留空字段与标题提示', ({ input }) => {
    const prompt = buildScenarioStreamPrompt(input);
    expect(prompt).toContain(input.language);
    for (const [question, answer] of Object.entries(input.answers)) {
      expect(prompt).toContain(question);
      expect(prompt).toContain(answer);
    }
    for (const field of input.fieldsToKeepEmpty as string[]) expect(prompt).toContain(field);
    if (input.titleHint) expect(prompt).toContain(input.titleHint);
    expect(SCENARIO_STREAM_TEMPERATURE).toBe(0.75);
  });

  it('结构化生成忽略空白回答', () => {
    const prompt = createScenarioGenerationConfig({
      answers: { skippedQuestion: ' \n\t ', keptQuestion: '场景输入' },
      language: '中文', fieldsToKeepEmpty: [],
    }).promptBuilder();
    expect(prompt).toContain('keptQuestion');
    expect(prompt).toContain('场景输入');
    expect(prompt).not.toContain('skippedQuestion');
  });

  it('流式生成过滤无效输入，并限制留空字段数量与标题长度', () => {
    const fields = Array.from({ length: 33 }, (_, index) => `field_${index}_end`);
    const title = 'T'.repeat(60);
    const prompt = buildScenarioStreamPrompt({
      answers: {
        keptQuestion: '  场景输入  ', skippedQuestion: ' \n ',
        invalidNumber: 123, invalidObject: { text: '不可用回答' },
      },
      language: '中文',
      fieldsToKeepEmpty: [null, '', '   ', ...fields],
      titleHint: `  ${title}不可用标题后缀  `,
    });
    expect(prompt).toContain('场景输入');
    expect(prompt).not.toContain('  场景输入  ');
    for (const key of ['skippedQuestion', 'invalidNumber', 'invalidObject', '不可用回答']) {
      expect(prompt).not.toContain(key);
    }
    for (const field of fields.slice(0, 32)) expect(prompt).toContain(field);
    expect(prompt).not.toContain(fields[32]);
    expect(prompt).toContain(title);
    expect(prompt).not.toContain('不可用标题后缀');

    const invalidOptions = buildScenarioStreamPrompt({
      answers: {}, language: '中文',
      fieldsToKeepEmpty: 'invalidFields', titleHint: { text: 'invalidTitle' },
    });
    expect(invalidOptions).not.toContain('invalidFields');
    expect(invalidOptions).not.toContain('invalidTitle');
  });
});

describe('scenario Markdown JSON boundary', () => {
  const scenario = (description: string) => ({
    title: '天文台', scenario_type: '调查', description,
    elements: { scene: {}, events: '观察', atmosphere: '安静', development: [] },
  });

  it.each([
    '# 简报\n\n## 任务\n观察',
    '# 简报\r\n\r\n## 任务\r\n观察',
    '# 简报\\n\\n## 任务\\n观察',
    '路径 `C:\\notes\\new`；JSON `{"line":"a\\nb"}`',
  ])('decodes the JSON transport once and preserves the actual field value', (description) => {
    const wire = JSON.stringify(scenario(description));
    const parsed = parseStructuredJsonWithSchema(wire, SCENARIO_GENERATION_SCHEMA);
    expect(parsed.data.description).toBe(description);
    expect(parsed.telemetry.usedJsonRepair).toBe(false);
    expect(JSON.parse(JSON.stringify(parsed.data)).description).toBe(description);
  });

  it('repairs invalid JSON containing a real unescaped line break without adding literal escapes to the field', () => {
    const description = '# 简报\n\n## 任务\n观察';
    const wire = JSON.stringify(scenario(description)).replace(/\\n/g, '\n');
    const parsed = parseStructuredJsonWithSchema(wire, SCENARIO_GENERATION_SCHEMA);
    expect(parsed.telemetry.usedJsonRepair).toBe(true);
    expect(parsed.data.description).toBe(description);
  });
});
