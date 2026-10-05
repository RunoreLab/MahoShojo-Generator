import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod/v3';

import {
  MAGICAL_GIRL_DETAILS_SCHEMA,
  MAGICAL_GIRL_DETAILS_SYSTEM_PROMPT,
  buildMagicalGirlDetailsStreamPrompt,
  buildUnsignedMagicalGirlDetailsCard,
  createMagicalGirlDetailsGenerationConfig,
  type MagicalGirlDetailsGenerationInput,
} from '@mahoshojo/ai-core/magical-girl-details-generation';

// 从迁移前 Hosted 实现采集，防止两端同时回用后掩盖 Prompt/schema 漂移。
const legacy = JSON.parse(readFileSync(new URL('../fixtures/magical-girl-details-legacy.json', import.meta.url), 'utf8'));
const digest = (text: string) => createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex');
const describeSchema = (schema: z.ZodTypeAny): unknown => ({
  type: schema._def.typeName,
  ...(schema.description ? { description: schema.description } : {}),
  ...(schema instanceof z.ZodObject
    ? { shape: Object.fromEntries(Object.entries(schema.shape).map(([key, value]) => [key, describeSchema(value as z.ZodTypeAny)])) }
    : {}),
  ...(schema instanceof z.ZodArray ? { element: describeSchema(schema.element) } : {}),
});

describe('magical girl details shared generation', () => {
  it('逐字保留 Hosted 结构化与 Markdown Prompt 以及 schema 字段描述', () => {
    expect(digest(MAGICAL_GIRL_DETAILS_SYSTEM_PROMPT)).toBe(legacy.systemPromptSha256);
    expect(describeSchema(MAGICAL_GIRL_DETAILS_SCHEMA)).toEqual(legacy.schema);
    for (const fixture of legacy.cases as {
      input: MagicalGirlDetailsGenerationInput & { flowers: string };
      structuredPromptSha256: string;
      streamPromptSha256: string;
    }[]) {
      const config = createMagicalGirlDetailsGenerationConfig(() => fixture.input.flowers);
      expect(digest(config.promptBuilder(fixture.input))).toBe(fixture.structuredPromptSha256);
      expect(digest(buildMagicalGirlDetailsStreamPrompt({
        ...fixture.input, questionnaireLore: fixture.input.loreText,
      }))).toBe(fixture.streamPromptSha256);
      expect(config).toMatchObject({ temperature: 0.8, taskName: '生成魔法少女详细信息' });
      expect(config).not.toHaveProperty('modelOverride');
      expect(config).not.toHaveProperty('generationSettingsContext');
    }
  });

  it('在构建 Prompt 时取花名，保留重复调用的抽样时机', () => {
    const flowers = vi.fn().mockReturnValueOnce('海棠').mockReturnValueOnce('百合');
    const config = createMagicalGirlDetailsGenerationConfig(flowers);
    expect(flowers).not.toHaveBeenCalled();
    const input = { answers: [], language: '中文', loreText: '' };
    expect(config.promptBuilder(input)).toContain('花语：海棠');
    expect(config.promptBuilder(input)).toContain('花语：百合');
  });

  it('按原 schema 接受未解锁的空字段，并构造不带签名的角色卡', () => {
    const details = MAGICAL_GIRL_DETAILS_SCHEMA.parse({
      codename: '海棠',
      appearance: { outfit: '', accessories: '', colorScheme: '', overallLook: '' },
      magicConstruct: { name: '', form: '', basicAbilities: [], description: '' },
      wonderlandRule: { name: '', description: '', tendency: '', activation: '' },
      blooming: { name: '', evolvedAbilities: [], evolvedForm: '', evolvedOutfit: '', powerLevel: '' },
      analysis: { personalityAnalysis: '', abilityReasoning: '', coreTraits: [], predictionBasis: '', background: { belief: '', bonds: '' } },
    });
    const answer = { question: '愿望？', answer: '守护', questionId: 'q1', questionnaireId: 'a', questionnaireTitle: '起点' };
    const card = buildUnsignedMagicalGirlDetailsCard(details, [answer]);
    expect(card).toEqual({
      ...details, templateId: '魔法少女/心之花/魔法少女（问卷生成）',
      userAnswers: [{ question: '愿望？', answer: '守护', questionId: 'q1' }],
    });
    expect(card).not.toHaveProperty('signature');
    expect(answer.questionnaireId).toBe('a');
    expect(details).not.toHaveProperty('templateId');
    expect(MAGICAL_GIRL_DETAILS_SCHEMA.safeParse({ ...details, blooming: null }).success).toBe(false);
  });
});
