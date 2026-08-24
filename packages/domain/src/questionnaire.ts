export interface QuestionnaireAnswerItem {
  question: string;
  answer: string;
  questionId?: string;
  questionnaireId?: string;
  questionnaireTitle?: string;
}

export type QuestionnaireAnswerMatchTarget = {
  key: string;
  question: string;
  index: number;
  questionId?: string;
  questionnaireId?: string;
  questionnaireTitle?: string;
};

export type QuestionnaireAnswerMatchInput = {
  key?: string;
  question?: string;
  index?: number;
  questionId?: string;
  questionnaireId?: string;
  questionnaireTitle?: string;
};

export type QuestionnaireAnswerLookup<T extends QuestionnaireAnswerMatchTarget> = {
  byKey: Map<string, T>;
  byCompositeId: Map<string, T>;
  byQuestionId: Map<string, T[]>;
  byQuestionText: Map<string, T[]>;
  ordered: T[];
};

const normalizeQuestionnaireMatchText = (value: string | undefined): string => {
  if (typeof value !== 'string') return '';
  return value
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
};

const appendLookupValue = <T>(map: Map<string, T[]>, key: string, value: T): void => {
  if (!key) return;
  const existing = map.get(key) ?? [];
  existing.push(value);
  map.set(key, existing);
};

export const buildQuestionnaireAnswerLookup = <T extends QuestionnaireAnswerMatchTarget>(
  targets: T[],
): QuestionnaireAnswerLookup<T> => {
  const byKey = new Map<string, T>();
  const byCompositeId = new Map<string, T>();
  const byQuestionId = new Map<string, T[]>();
  const byQuestionText = new Map<string, T[]>();
  const ordered = [...targets];

  ordered.forEach((target) => {
    const key = target.key.trim();
    if (key) byKey.set(key, target);

    const questionId = target.questionId?.trim() ?? '';
    if (questionId) {
      appendLookupValue(byQuestionId, questionId, target);
      const questionnaireId = target.questionnaireId?.trim() ?? '';
      if (questionnaireId) byCompositeId.set(`${questionnaireId}::${questionId}`, target);
    }

    const normalizedQuestion = normalizeQuestionnaireMatchText(target.question);
    if (normalizedQuestion) appendLookupValue(byQuestionText, normalizedQuestion, target);
  });

  return { byKey, byCompositeId, byQuestionId, byQuestionText, ordered };
};

const filterCandidates = <T extends QuestionnaireAnswerMatchTarget>(
  candidates: T[],
  input: QuestionnaireAnswerMatchInput,
): T[] => {
  const questionnaireId = input.questionnaireId?.trim() ?? '';
  const questionnaireTitle = normalizeQuestionnaireMatchText(input.questionnaireTitle);

  let next = candidates;
  if (questionnaireId) {
    const matches = next.filter(
      (candidate) => (candidate.questionnaireId?.trim() ?? '') === questionnaireId,
    );
    if (matches.length > 0) next = matches;
  }
  if (questionnaireTitle) {
    const matches = next.filter(
      (candidate) => normalizeQuestionnaireMatchText(candidate.questionnaireTitle) === questionnaireTitle,
    );
    if (matches.length > 0) next = matches;
  }
  return next;
};

const hasCompatibleQuestionText = <T extends QuestionnaireAnswerMatchTarget>(
  candidate: T,
  input: QuestionnaireAnswerMatchInput,
): boolean => {
  const question = normalizeQuestionnaireMatchText(input.question);
  return !question || normalizeQuestionnaireMatchText(candidate.question) === question;
};

const unique = <T>(candidates: T[]): T | null => (candidates.length === 1 ? candidates[0]! : null);

export const resolveQuestionnaireAnswerTarget = <T extends QuestionnaireAnswerMatchTarget>(
  lookup: QuestionnaireAnswerLookup<T>,
  input: QuestionnaireAnswerMatchInput,
  options: { allowIndexFallback?: boolean } = {},
): T | null => {
  const key = input.key?.trim() ?? '';
  if (key) {
    const direct = lookup.byKey.get(key) ?? null;
    if (direct && hasCompatibleQuestionText(direct, input)) return direct;
  }

  const questionnaireId = input.questionnaireId?.trim() ?? '';
  const questionId = input.questionId?.trim() ?? '';
  if (questionnaireId && questionId) {
    const composite = lookup.byCompositeId.get(`${questionnaireId}::${questionId}`) ?? null;
    if (composite && hasCompatibleQuestionText(composite, input)) return composite;
  }

  if (questionId) {
    const byId = filterCandidates(lookup.byQuestionId.get(questionId) ?? [], input);
    const question = normalizeQuestionnaireMatchText(input.question);
    const matches = question
      ? byId.filter((candidate) => hasCompatibleQuestionText(candidate, input))
      : byId;
    const resolved = unique(matches);
    if (resolved) return resolved;
  }

  const question = normalizeQuestionnaireMatchText(input.question);
  if (question) {
    const resolved = unique(filterCandidates(lookup.byQuestionText.get(question) ?? [], input));
    if (resolved) return resolved;
  }

  if (options.allowIndexFallback === true && typeof input.index === 'number') {
    return lookup.ordered[input.index] ?? null;
  }
  return null;
};

const coerceAnswerText = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

export const normalizeUserAnswers = (
  userAnswers: unknown,
  fallbackQuestions: string[] = [],
): QuestionnaireAnswerItem[] => {
  if (!userAnswers) return [];

  if (Array.isArray(userAnswers)) {
    return userAnswers.map((item, index) => {
      const fallbackQuestion = fallbackQuestions[index] || `问题 ${index + 1}`;
      if (typeof item === 'string') return { question: fallbackQuestion, answer: item };
      if (item && typeof item === 'object') {
        const record = item as Record<string, unknown>;
        return {
          question: typeof record.question === 'string' ? record.question : fallbackQuestion,
          answer: coerceAnswerText(record.answer ?? record.value ?? ''),
          questionId: typeof record.questionId === 'string' ? record.questionId : undefined,
          questionnaireId: typeof record.questionnaireId === 'string' ? record.questionnaireId : undefined,
          questionnaireTitle: typeof record.questionnaireTitle === 'string'
            ? record.questionnaireTitle
            : undefined,
        };
      }
      return { question: fallbackQuestion, answer: '' };
    }).filter((item) => item.answer.trim().length > 0);
  }

  if (typeof userAnswers === 'object') {
    return Object.entries(userAnswers as Record<string, unknown>).map(([key, value]) => {
      if (value && typeof value === 'object') {
        const record = value as Record<string, unknown>;
        return {
          question: typeof record.question === 'string' ? record.question : key,
          answer: coerceAnswerText(record.answer ?? record.value ?? ''),
          questionId: typeof record.questionId === 'string' ? record.questionId : undefined,
          questionnaireId: typeof record.questionnaireId === 'string' ? record.questionnaireId : undefined,
          questionnaireTitle: typeof record.questionnaireTitle === 'string'
            ? record.questionnaireTitle
            : undefined,
        };
      }
      return { question: key, answer: coerceAnswerText(value) };
    }).filter((item) => item.answer.trim().length > 0);
  }

  return [];
};

export const QUESTIONNAIRE_NATIVE_MAX_ANSWER_CHARS = 500;

export type AnswerLimitSource = 'question' | 'global' | 'none';

export const getAnswerLimitInfo = (questionMaxLength?: number | null) => {
  const questionLimit = typeof questionMaxLength === 'number'
    && Number.isFinite(questionMaxLength)
    && questionMaxLength > 0
    ? Math.floor(questionMaxLength)
    : null;
  const globalLimit = QUESTIONNAIRE_NATIVE_MAX_ANSWER_CHARS;

  if (!globalLimit || globalLimit <= 0) {
    return questionLimit
      ? { limit: questionLimit, source: 'question' as const }
      : { limit: null, source: 'none' as const };
  }
  if (questionLimit) {
    return {
      limit: Math.min(questionLimit, globalLimit),
      source: questionLimit <= globalLimit ? 'question' as const : 'global' as const,
    };
  }
  return { limit: globalLimit, source: 'global' as const };
};

export const isAnswerOverLimit = (
  answer: string,
  questionMaxLength?: number | null,
): boolean => {
  const normalized = typeof answer === 'string' ? answer.trim() : '';
  if (!normalized) return false;
  const { limit } = getAnswerLimitInfo(questionMaxLength);
  return Boolean(limit && limit > 0 && normalized.length > limit);
};
