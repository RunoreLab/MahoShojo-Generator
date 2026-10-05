import type { QuestionnaireAnswerItem } from '@mahoshojo/domain/questionnaire';

export type DetailsQuestion = {
  id: string;
  question: string;
  placeholder?: string;
  helperText?: string;
  suggestions?: string[];
  options?: (string | { value: string; label: string; disabled?: boolean })[];
  allowCustom?: boolean;
  maxLength?: number;
};
export type DetailsQuestionnaire = {
  id: 'magical-girl-default';
  title: string;
  description: string;
  questions: DetailsQuestion[];
};

const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const texts = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === 'string');

/** 首个产品切片只承载内置默认问卷；未来动态题流必须先接入共享规则，不能静默忽略。 */
export const parseDefaultQuestionnaire = (value: unknown): DetailsQuestionnaire => {
  const rootKeys = new Set(['id', 'kind', 'title', 'description', 'logoUrl', 'questions']);
  if (!object(value) || Object.keys(value).some((key) => !rootKeys.has(key))
    || value.id !== 'magical-girl-default' || value.kind !== 'magical-girl'
    || typeof value.title !== 'string' || typeof value.description !== 'string'
    || (value.logoUrl !== undefined && typeof value.logoUrl !== 'string')
    || !Array.isArray(value.questions) || value.questions.length === 0 || value.questions.length > 100) {
    throw new Error('内置问卷无法读取，请重新安装或更新客户端。');
  }
  const ids = new Set<string>();
  const keys = new Set(['id', 'question', 'placeholder', 'helperText', 'suggestions', 'options', 'allowCustom', 'maxLength']);
  const optionKeys = new Set(['value', 'label', 'disabled']);
  for (const question of value.questions) {
    if (!object(question) || Object.keys(question).some((key) => !keys.has(key))
      || typeof question.id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(question.id) || ids.has(question.id)
      || typeof question.question !== 'string' || !question.question.trim()
      || (question.placeholder !== undefined && typeof question.placeholder !== 'string')
      || (question.helperText !== undefined && typeof question.helperText !== 'string')
      || (question.suggestions !== undefined && !texts(question.suggestions))
      || (question.allowCustom !== undefined && typeof question.allowCustom !== 'boolean')
      || (question.maxLength !== undefined && (typeof question.maxLength !== 'number' || !Number.isInteger(question.maxLength) || question.maxLength <= 0))) {
      throw new Error('内置问卷包含当前版本不支持的题目。');
    }
    if (question.options !== undefined && (!Array.isArray(question.options) || question.options.some((option) =>
      typeof option !== 'string' && (!object(option) || Object.keys(option).some((key) => !optionKeys.has(key))
        || typeof option.value !== 'string' || typeof option.label !== 'string'
        || (option.disabled !== undefined && typeof option.disabled !== 'boolean'))))) {
      throw new Error('内置问卷选项无法读取。');
    }
    ids.add(question.id);
  }
  return { id: value.id, title: value.title, description: value.description, questions: value.questions as DetailsQuestion[] };
};

export const loadDefaultQuestionnaire = async (signal: AbortSignal): Promise<DetailsQuestionnaire> => {
  const response = await fetch('/questionnaires/presets/magical-girl-default.json', { signal, credentials: 'omit', redirect: 'error' });
  if (!response.ok) throw new Error('内置问卷加载失败，请重试。');
  return parseDefaultQuestionnaire(await response.json());
};

export const buildDetailsAnswers = (questionnaire: DetailsQuestionnaire, answers: Record<string, string>): QuestionnaireAnswerItem[] => {
  const items = questionnaire.questions.flatMap((question) => {
    const answer = answers[question.id]?.trim() ?? '';
    if (!answer) return [];
    if (question.allowCustom === false && !question.options?.some((option) =>
      typeof option === 'string' ? option === answer : !option.disabled && option.value === answer)) {
      throw new Error(`“${question.question}”请选择一个可用选项。`);
    }
    return [{ question: question.question, answer, questionId: question.id, questionnaireId: questionnaire.id, questionnaireTitle: questionnaire.title }];
  });
  if (!items.length) throw new Error('请至少填写一题后再生成。');
  return items;
};
