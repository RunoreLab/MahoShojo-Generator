import { formatQuestionnaireAnswers, type QuestionnaireAnswerItem } from '@mahoshojo/domain/questionnaire';
import { buildCreatorContextSections } from '@mahoshojo/domain/creator/stream-prompt';
import type { CreatorStreamTemplateId } from '@mahoshojo/domain/creator/templates';

import {
  buildFreeFieldGuide,
  FREE_GENERATION_SCHEMAS,
  FREE_GENERATION_SYSTEM_PROMPT,
} from './free-generation';

/**
 * 创作工房「流式模板」的 direct 通路结构化生成配置（D5.1-G3）。
 *
 * Desktop direct（本机/远端 Provider）非流式兼容通路对
 * `general`/`general-scenario` 模板使用与自由生成同一组
 * `{name|title, content}` schema——`content` 即 Markdown 正文，
 * 产出卡形与流式卡一致（`templateId=通用角色/通用情景`）。
 * direct 流式则直接复用 domain `buildCreatorStreamPrompt` 输出裸 Markdown。
 *
 * 业务上下文与 hosted/stream prompt 完全同源：`buildCreatorContextSections`
 * 产出【创作约束】→【参考设定】→【问卷回答】三节，规则事实经同一投影进入
 * 模型视野，不被改写。
 */
export type CreatorStructuredGeneralInput = {
  template: CreatorStreamTemplateId;
  language: string;
  creatorPromptText: string;
  answers: QuestionnaireAnswerItem[];
  loreText: string;
};

export const CREATOR_STRUCTURED_GENERAL_TASK_NAME = '生成创作工房通用卡';

export const buildCreatorStructuredGeneralPrompt = (
  input: CreatorStructuredGeneralInput,
): string => `
请严格按照我指定的 Schema 输出一个 JSON 对象（只输出 JSON，不要输出解释）。
你必须遵守 Schema 的字段名与数据类型；不要创建 Schema 中不存在的字段。
你必须输出 Schema 中的【全部字段】（包含嵌套对象中的字段）。如果用户没有提供信息，请使用空字符串 "" 或空数组 [] 作为占位，不要省略对象结构。
内容语言：请使用【${input.language}】撰写所有自然语言字段。

${buildFreeFieldGuide(input.template)}

${buildCreatorContextSections({
  creatorPromptText: input.creatorPromptText,
  questionnaireAnswerText: formatQuestionnaireAnswers(input.answers),
  loreText: input.loreText,
})}
`.trim();

export const createCreatorStructuredGeneralConfig = (template: CreatorStreamTemplateId) => ({
  systemPrompt: FREE_GENERATION_SYSTEM_PROMPT,
  temperature: 0.8,
  promptBuilder: (input: Omit<CreatorStructuredGeneralInput, 'template'>): string =>
    buildCreatorStructuredGeneralPrompt({ ...input, template }),
  schema: FREE_GENERATION_SCHEMAS[template],
  taskName: CREATOR_STRUCTURED_GENERAL_TASK_NAME,
});

export type CreatorStructuredGeneralConfig = ReturnType<typeof createCreatorStructuredGeneralConfig>;
