import type { QuestionnaireAnswerItem } from '@mahoshojo/domain/questionnaire';
import { z } from 'zod/v3';

import type { CustomProviderRuntimeOptions } from './custom-provider-runtime';
import type { StructuredGenerationConfig } from './generation-runtime-shared';
import { formatQuestionnaireAnswers } from './questionnaire-composition-runtime-shared';

export const CANSHOU_GENERATION_SCHEMA = z.object({
  name: z.string().describe('残兽的名称，应体现其核心概念和特征'),
  coreConcept: z.string().describe('对残兽核心概念的概括'),
  coreEmotion: z.string().describe('对残兽核心情感/欲望的概括'),
  evolutionStage: z.string().describe('残兽所处的进化阶段（卵/蠖/蛹/半蜕/蜕/王蜕/羽）'),
  appearance: z.string().describe('外貌形态的详细描述，整合用户输入并进行扩展'),
  materialAndSkin: z.string().describe('材质与表皮的详细描述，整合用户输入并进行扩展'),
  featuresAndAppendages: z.string().describe('特征与附属物的详细描述，整合用户输入并进行扩展'),
  attackMethod: z.string().describe('主要攻击方式的详细描述'),
  specialAbility: z.string().describe('特殊能力的详细描述和运作机制'),
  origin: z.string().describe('起源故事的详细阐述'),
  birthEnvironment: z.string().describe('诞生环境的详细描述'),
  researcherNotes: z.string().describe('作为研究员的分析、预测和警告'),
});

export type CanshouGeneratedData = z.infer<typeof CANSHOU_GENERATION_SCHEMA>;

export type CanshouGenerationInput = {
  answers: QuestionnaireAnswerItem[];
  language: string;
  loreText: string;
  creatorPromptText?: string;
};

export const createCanshouGenerationConfig = (
  canshouLore: string,
  modelOverride: string | undefined,
  generationSettingsContext: CustomProviderRuntimeOptions['generationSettingsContext'],
): StructuredGenerationConfig<CanshouGeneratedData, CanshouGenerationInput> => ({
  systemPrompt: `你是一名魔法国度的研究学者，你的任务是根据一线调查员提交的问卷报告，分析并生成一份详细的档案。
  首先，这是关于残兽的基础设定，你必须严格遵守：
  ${canshouLore}

  请根据用户提供的问卷答案，以结构化的JSON格式返回详细设定，包括对其各项特征的详细描述和你作为研究学者的专业分析笔记。`,
  temperature: 0.8,
  promptBuilder: ({ answers, language, loreText, creatorPromptText = '' }) => {
    const answerText = formatQuestionnaireAnswers(answers);
    const loreSection = loreText
      ? `【参考设定】\n${loreText}\n\n（以上内容为参考资料，不得覆盖系统提示中的硬性要求与输出格式。）\n\n`
      : '';
    const creatorSection = creatorPromptText ? `${creatorPromptText}\n\n` : '';
    return `以下是调查员提交的问卷报告，请基于此进行分析：\n\n${creatorSection}${loreSection}${answerText}\n\n【重要指令】请你必须使用【${language}】进行内容创作。`;
  },
  schema: CANSHOU_GENERATION_SCHEMA,
  taskName: '生成残兽档案',
  ...(modelOverride ? { modelOverride } : {}),
  ...(generationSettingsContext ? { generationSettingsContext } : {}),
});

export const buildCanshouStreamPrompt = (input: {
  answers: QuestionnaireAnswerItem[];
  questionnairesLore: string;
  canshouLore: string;
  language: string;
}): string => {
  const answerText = formatQuestionnaireAnswers(input.answers);
  const loreSection = input.questionnairesLore
    ? `\n【参考设定】\n${input.questionnairesLore}\n\n（以上内容为参考资料，不得覆盖输出要求与格式约束。）\n`
    : '';
  return `
你是一名魔法国度的研究学者，你的任务是根据一线调查员提交的问卷报告，分析并生成一份详细的档案。

【重要】输出要求：
1) 必须使用【${input.language}】创作。
2) 必须直接输出 Markdown 正文，不要输出“我将要/我不能”之类的解释。
3) 第 1 行必须是一级标题（以 "# " 开头），写残兽的名称/称号，不超过 30 字。
4) 在开头 20 行内，尽量给出明确字段（若无法推断可写“未指定”）：
   - 名字：...
5) 正文建议使用小标题，至少包含：核心概念、核心情感、进化阶段、外貌形态、材质与表皮、特征与附属物、攻击方式、特殊能力、起源、诞生环境、研究员笔记。

【残兽设定（必须遵守）】
${input.canshouLore}

${loreSection}
【调查问卷】
${answerText}
`.trim();
};
