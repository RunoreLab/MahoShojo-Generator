const DEFAULT_NATIVE_MAX_ANSWER_CHARS = 2000;

const parsePositiveInt = (value?: string | null) => {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
};

const envLimit =
  parsePositiveInt(process.env.NEXT_PUBLIC_QUESTIONNAIRE_NATIVE_MAX_ANSWER_CHARS)
  ?? parsePositiveInt(process.env.QUESTIONNAIRE_NATIVE_MAX_ANSWER_CHARS);

export const QUESTIONNAIRE_NATIVE_MAX_ANSWER_CHARS = envLimit ?? DEFAULT_NATIVE_MAX_ANSWER_CHARS;

export type AnswerLimitSource = 'question' | 'global' | 'none';

export const getAnswerLimitInfo = (questionMaxLength?: number | null) => {
  const questionLimit = typeof questionMaxLength === 'number' && Number.isFinite(questionMaxLength) && questionMaxLength > 0
    ? Math.floor(questionMaxLength)
    : null;
  const globalLimit = QUESTIONNAIRE_NATIVE_MAX_ANSWER_CHARS;

  if (!globalLimit || globalLimit <= 0) {
    return questionLimit
      ? { limit: questionLimit, source: 'question' as const }
      : { limit: null, source: 'none' as const };
  }

  if (questionLimit) {
    const limit = Math.min(questionLimit, globalLimit);
    const source: AnswerLimitSource = questionLimit <= globalLimit ? 'question' : 'global';
    return { limit, source };
  }

  return { limit: globalLimit, source: 'global' as const };
};

export const isAnswerOverLimit = (answer: string, questionMaxLength?: number | null) => {
  const normalized = typeof answer === 'string' ? answer.trim() : '';
  if (!normalized) return false;
  const { limit } = getAnswerLimitInfo(questionMaxLength);
  if (!limit || limit <= 0) return false;
  return normalized.length > limit;
};
