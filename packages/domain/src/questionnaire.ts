import { z } from 'zod/v3';

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

export const extractQuestionTextsFromUserAnswers = (userAnswers: unknown): string[] => {
  if (!userAnswers) return [];
  const add = (items: string[], value: unknown): void => {
    if (typeof value === 'string' && value.trim()) items.push(value.trim());
  };
  if (Array.isArray(userAnswers)) {
    const questions: string[] = [];
    for (const item of userAnswers) {
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        add(questions, (item as Record<string, unknown>).question);
      }
    }
    return questions;
  }
  if (typeof userAnswers === 'object') {
    const questions: string[] = [];
    for (const [key, value] of Object.entries(userAnswers as Record<string, unknown>)) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const question = (value as Record<string, unknown>).question;
        if (typeof question === 'string' && question.trim()) {
          questions.push(question.trim());
          continue;
        }
      }
      add(questions, key);
    }
    return questions;
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

/**
 * 提交前超限判定：可见流程条目（displayIf/jump 已按回答求值）中任一回答
 * 超限即为 true。Web 与 Desktop 同口径——只用于关闭原生签名资格，
 * 不阻止生成（`DESK-ONLINE-009`）。
 */
export const hasOverLimitQuestionnaireAnswers = (
  items: readonly { key: string; question: { maxLength?: number | null } }[],
  answersByKey: Readonly<Record<string, unknown>>,
): boolean =>
  items.some((item) => {
    const raw = answersByKey[item.key];
    return isAnswerOverLimit(typeof raw === 'string' ? raw : '', item.question.maxLength ?? null);
  });

export const formatQuestionnaireAnswers = (
  answers: QuestionnaireAnswerItem[],
): string => {
  if (answers.length === 0) return '';
  const grouped = new Map<string, QuestionnaireAnswerItem[]>();
  for (const item of answers) {
    const groupKey = item.questionnaireTitle?.trim() || '';
    if (!grouped.has(groupKey)) grouped.set(groupKey, []);
    grouped.get(groupKey)!.push(item);
  }

  const blocks: string[] = [];
  for (const [groupTitle, items] of grouped.entries()) {
    if (groupTitle) blocks.push(`【${groupTitle}】`);
    items.forEach((item, index) => {
      const label = item.question?.trim() || `问题 ${index + 1}`;
      blocks.push(`Q: ${label}`, `A: ${item.answer}`);
    });
  }
  return blocks.join('\n');
};

export const compactQuestionnaireAnswerItems = (
  answers: QuestionnaireAnswerItem[],
): QuestionnaireAnswerItem[] => answers.map((item) => {
  const compacted = { ...item };
  delete compacted.questionnaireId;
  delete compacted.questionnaireTitle;
  return compacted;
});

/* ── 问卷数据卡 payload schema（D5.0e 自 apps/web/lib/schemas 迁入） ────
 *
 * 这是数据卡 `data` 正文的领域形状，跨 runtime 共用（Web 校验、Desktop
 * 旧卡归一化）。保持与 Web 原 schema 逐字等价；schema 变更等同协议变更。
 */

const QuestionnaireOptionSchema = z.union([
  z.string(),
  z.object({
    value: z.string(),
    label: z.string(),
    disabled: z.boolean().optional(),
  }),
]);

const QuestionnaireQuestionSchema = z.object({
  id: z.string(),
  question: z.string(),
  type: z.string().optional(),
  options: z.array(QuestionnaireOptionSchema).optional(),
  optionsFrom: z.union([
    z.string(),
    z.object({
      key: z.string().optional(),
      questionId: z.string().optional(),
      questionnaireId: z.string().optional(),
    }),
  ]).optional(),
  placeholder: z.string().optional(),
  suggestions: z.array(z.string()).optional(),
  suggestionsFrom: z.union([
    z.string(),
    z.object({
      key: z.string().optional(),
      questionId: z.string().optional(),
      questionnaireId: z.string().optional(),
    }),
  ]).optional(),
  allowCustom: z.boolean().optional(),
  helperText: z.string().optional(),
  maxLength: z.union([z.number().int().nonnegative(), z.null()]).optional(),
  required: z.boolean().optional(),
  displayIf: z.union([
    z.object({
      any: z.array(z.any()).optional(),
      all: z.array(z.any()).optional(),
      not: z.any().optional(),
      key: z.string().optional(),
      questionId: z.string().optional(),
      questionnaireId: z.string().optional(),
      operator: z.string().optional(),
      value: z.union([z.string(), z.array(z.string())]).optional(),
    }),
    z.array(z.any()),
  ]).optional(),
  jump: z.union([
    z.object({
      when: z.any(),
      to: z.union([
        z.string(),
        z.object({
          key: z.string().optional(),
          questionId: z.string().optional(),
          questionnaireId: z.string().optional(),
        }),
      ]).optional(),
      toEnd: z.boolean().optional(),
    }),
    z.array(z.any()),
  ]).optional(),
});

export const QuestionnaireSchema = z.object({
  templateId: z.string().optional(),
  kind: z.enum(['magical-girl', 'canshou']),
  title: z.string(),
  description: z.string().optional(),
  loreMarkdown: z.string().optional(),
  logoUrl: z.string().optional(),
  version: z.string().optional(),
  nativeAllowed: z.boolean().optional(),
  questions: z.array(QuestionnaireQuestionSchema),
})
  .catchall(z.unknown())
  .superRefine((data, ctx) => {
    const hasQuestions = Array.isArray(data.questions) && data.questions.length > 0;
    const hasLore = typeof data.loreMarkdown === 'string' && data.loreMarkdown.trim().length > 0;
    if (!hasQuestions && !hasLore) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['questions'],
        message: '问卷至少需要 1 个题目，或提供 loreMarkdown 设定内容',
      });
    }
  });

export type QuestionnaireData = z.infer<typeof QuestionnaireSchema>;
