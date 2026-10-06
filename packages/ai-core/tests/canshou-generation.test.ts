import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { z } from 'zod/v3';

import { CANSHOU_LORE } from '@mahoshojo/domain/canshou-lore';
import {
  CANSHOU_GENERATION_SCHEMA,
  buildCanshouStreamPrompt,
  buildUnsignedCanshouCard,
  createCanshouGenerationConfig,
  type CanshouGenerationInput,
} from '@mahoshojo/ai-core/canshou-generation';

// 记录迁移前 Hosted 实现采集的行为快照，同时双端复用后锁死 Prompt/schema 漂移。
const legacy = JSON.parse(
  readFileSync(new URL('../fixtures/canshou-generation-legacy.json', import.meta.url), 'utf8'),
);
const digest = (text: string) =>
  createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex');
const describeSchema = (schema: z.ZodTypeAny): unknown => ({
  type: schema._def.typeName,
  ...(schema.description ? { description: schema.description } : {}),
  ...(schema instanceof z.ZodObject
    ? {
        shape: Object.fromEntries(
          Object.entries(schema.shape).map(([key, value]) => [
            key,
            describeSchema(value as z.ZodTypeAny),
          ]),
        ),
      }
    : {}),
  ...(schema instanceof z.ZodArray ? { element: describeSchema(schema.element) } : {}),
});

describe('canshou shared generation', () => {
  it('保持既有 Hosted 结构化与 Markdown Prompt 以及 schema 字段口径', () => {
    expect(digest(CANSHOU_LORE)).toBe(legacy.canshouLoreSha256);
    expect(describeSchema(CANSHOU_GENERATION_SCHEMA)).toEqual(legacy.schema);
    for (const fixture of legacy.cases as {
      input: CanshouGenerationInput;
      structuredPromptSha256: string;
      streamPromptSha256: string;
    }[]) {
      const config = createCanshouGenerationConfig(legacy.fixtureLore);
      expect(digest(config.systemPrompt)).toBe(legacy.systemPromptSha256);
      expect(digest(config.promptBuilder(fixture.input))).toBe(fixture.structuredPromptSha256);
      expect(
        digest(
          buildCanshouStreamPrompt({
            answers: fixture.input.answers,
            questionnairesLore: fixture.input.loreText,
            canshouLore: legacy.fixtureLore,
            language: fixture.input.language,
          }),
        ),
      ).toBe(fixture.streamPromptSha256);
      expect(config).toMatchObject({ temperature: 0.8, taskName: '生成残兽档案' });
      expect(config).not.toHaveProperty('modelOverride');
      expect(config).not.toHaveProperty('generationSettingsContext');
    }
  });

  it('还原 schema 拒绝未知字段的卡对象，并组装不签名的结果卡', () => {
    const details = CANSHOU_GENERATION_SCHEMA.parse({
      name: '溶腔残兽',
      coreConcept: '消化',
      coreEmotion: '饥饿',
      evolutionStage: '卵',
      appearance: '',
      materialAndSkin: '',
      featuresAndAppendages: '',
      attackMethod: '',
      specialAbility: '',
      origin: '',
      birthEnvironment: '',
      researcherNotes: '',
    });
    const answer = {
      question: '残兽的捕食对象是什么？',
      answer: '深夜加班的人',
      questionId: 'q1',
      questionnaireId: 'a',
      questionnaireTitle: '残兽调查报告',
    };
    const card = buildUnsignedCanshouCard(details, [answer]);
    expect(card).toEqual({
      ...details,
      templateId: '魔法少女/心之花/残兽（问卷生成）',
      userAnswers: [{ question: '残兽的捕食对象是什么？', answer: '深夜加班的人', questionId: 'q1' }],
    });
    expect(card).not.toHaveProperty('signature');
    expect(answer.questionnaireId).toBe('a');
    expect(details).not.toHaveProperty('templateId');
    expect(CANSHOU_GENERATION_SCHEMA.safeParse({ ...details, researcherNotes: null }).success).toBe(
      false,
    );
  });
});
