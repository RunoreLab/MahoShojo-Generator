import { isAllowedExternalMediaUrl } from '@/lib/markdown/externalMedia';

export type QuestionnaireKind = 'magical-girl' | 'canshou';

export type QuestionnaireLogoPreset = {
  id: string;
  label: string;
  url: string;
  kind: QuestionnaireKind | 'common';
};

export const DEFAULT_QUESTIONNAIRE_LOGO_BY_KIND: Record<QuestionnaireKind, string> = {
  'magical-girl': '/questionnaire-logo.svg',
  'canshou': '/beast-logo.svg',
};

export const QUESTIONNAIRE_LOGO_PRESETS: QuestionnaireLogoPreset[] = [
  {
    id: 'magical-girl-default',
    label: '魔法少女预设问卷（默认）',
    url: '/questionnaire-logo.svg',
    kind: 'magical-girl',
  },
  {
    id: 'magical-girl-title',
    label: '魔法少女问卷标题',
    url: '/questionnaire-title.svg',
    kind: 'magical-girl',
  },
  {
    id: 'canshou-default',
    label: '残兽预设问卷',
    url: '/beast-logo.svg',
    kind: 'canshou',
  },
  {
    id: 'canshou-title',
    label: '残兽问卷标题',
    url: '/beast-title.svg',
    kind: 'canshou',
  },
  {
    id: 'project-logo',
    label: '项目 Logo',
    url: '/logo.svg',
    kind: 'common',
  },
  {
    id: 'project-logo-white',
    label: '项目 Logo（白色）',
    url: '/logo-white.svg',
    kind: 'common',
  },
];

export const sanitizeQuestionnaireLogoUrl = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (!isAllowedExternalMediaUrl(trimmed, 'image')) return undefined;
  return trimmed;
};

export type QuestionnaireOption = string | { value: string; label: string; disabled?: boolean };

export type QuestionnaireQuestionRef = string | {
  key?: string;
  questionId?: string;
  questionnaireId?: string;
};

export type QuestionnaireConditionOperator =
  | 'equals'
  | 'eq'
  | 'notEquals'
  | 'neq'
  | 'includes'
  | 'contains'
  | 'notIncludes'
  | 'notContains'
  | 'empty'
  | 'notEmpty';

export interface QuestionnaireCondition {
  any?: QuestionnaireCondition[];
  all?: QuestionnaireCondition[];
  not?: QuestionnaireCondition;
  key?: string;
  questionId?: string;
  questionnaireId?: string;
  operator?: QuestionnaireConditionOperator;
  value?: string | string[];
}

export interface QuestionnaireJumpRule {
  when: QuestionnaireCondition;
  to?: QuestionnaireQuestionRef;
  toEnd?: boolean;
}

export interface QuestionnaireQuestion {
  id: string;
  question: string;
  type?: 'text' | 'select';
  options?: QuestionnaireOption[];
  optionsFrom?: QuestionnaireQuestionRef;
  placeholder?: string;
  suggestions?: string[];
  suggestionsFrom?: QuestionnaireQuestionRef;
  allowCustom?: boolean;
  helperText?: string;
  maxLength?: number | null;
  required?: boolean;
  displayIf?: QuestionnaireCondition | QuestionnaireCondition[];
  jump?: QuestionnaireJumpRule | QuestionnaireJumpRule[];
}

export interface QuestionnaireDefinition {
  id: string;
  kind: QuestionnaireKind;
  title: string;
  description?: string;
  logoUrl?: string;
  version?: string;
  nativeAllowed?: boolean | null;
  questions: QuestionnaireQuestion[];
}

export interface QuestionnairePresetEntry {
  id: string;
  kind: QuestionnaireKind;
  title: string;
  description?: string;
  path: string;
  isDefault?: boolean;
}

export interface QuestionnaireAnswerItem {
  question: string;
  answer: string;
  questionId?: string;
  questionnaireId?: string;
  questionnaireTitle?: string;
}

export const buildQuestionKey = (questionnaireId: string | undefined, questionId: string | undefined, index: number) => {
  const base = (questionId ?? '').trim() || `Q${index + 1}`;
  const prefix = (questionnaireId ?? '').trim();
  return prefix ? `${prefix}::${base}` : base;
};

type QuestionFlowItem = {
  key: string;
  questionnaireId: string;
  question: QuestionnaireQuestion;
};

type QuestionLookup = {
  keyByCompositeId: Map<string, string>;
  keysByQuestionId: Map<string, string[]>;
  indexByKey: Map<string, number>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isJumpRule = (value: unknown): value is QuestionnaireJumpRule =>
  isRecord(value) && 'when' in value;

const buildQuestionLookup = <T extends QuestionFlowItem>(items: T[]): QuestionLookup => {
  const keyByCompositeId = new Map<string, string>();
  const keysByQuestionId = new Map<string, string[]>();
  const indexByKey = new Map<string, number>();

  items.forEach((item, index) => {
    indexByKey.set(item.key, index);
    const questionId = item.question.id?.trim();
    if (!questionId) return;
    const composite = `${item.questionnaireId}::${questionId}`;
    if (!keyByCompositeId.has(composite)) {
      keyByCompositeId.set(composite, item.key);
    }
    const existing = keysByQuestionId.get(questionId) ?? [];
    existing.push(item.key);
    keysByQuestionId.set(questionId, existing);
  });

  return { keyByCompositeId, keysByQuestionId, indexByKey };
};

const resolveKeyFromRef = (ref: QuestionnaireQuestionRef | undefined, lookup: QuestionLookup): string | null => {
  if (!ref) return null;

  if (typeof ref === 'string') {
    if (lookup.indexByKey.has(ref)) return ref;
    if (lookup.keyByCompositeId.has(ref)) return lookup.keyByCompositeId.get(ref) ?? null;
    const keys = lookup.keysByQuestionId.get(ref);
    if (keys && keys.length === 1) return keys[0];
    return null;
  }

  if (ref.key && lookup.indexByKey.has(ref.key)) {
    return ref.key;
  }

  if (ref.questionnaireId && ref.questionId) {
    const composite = `${ref.questionnaireId}::${ref.questionId}`;
    if (lookup.keyByCompositeId.has(composite)) return lookup.keyByCompositeId.get(composite) ?? null;
  }

  if (ref.questionId) {
    const keys = lookup.keysByQuestionId.get(ref.questionId);
    if (keys && keys.length === 1) return keys[0];
  }

  return null;
};

const normalizeConditionValue = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.map((item) => String(item));
  }
  if (value === null || value === undefined) return [];
  return [String(value)];
};

const evaluateCondition = (
  raw: QuestionnaireCondition | QuestionnaireCondition[] | undefined,
  answersByKey: Record<string, string>,
  lookup: QuestionLookup,
  fallbackResult: boolean
): boolean => {
  if (!raw) return true;
  const condition = Array.isArray(raw) ? { all: raw } : raw;
  if (!condition || typeof condition !== 'object') return fallbackResult;

  if (condition.not) {
    return !evaluateCondition(condition.not, answersByKey, lookup, fallbackResult);
  }

  if (Array.isArray(condition.all) && condition.all.length > 0) {
    return condition.all.every((item) => evaluateCondition(item, answersByKey, lookup, fallbackResult));
  }

  if (Array.isArray(condition.any) && condition.any.length > 0) {
    return condition.any.some((item) => evaluateCondition(item, answersByKey, lookup, fallbackResult));
  }

  const key = resolveKeyFromRef(condition, lookup);
  if (!key) return fallbackResult;
  const answer = String(answersByKey[key] ?? '');
  const values = normalizeConditionValue(condition.value);
  const operator = condition.operator ?? (values.length > 0 ? 'equals' : 'notEmpty');

  switch (operator) {
    case 'empty':
      return answer.trim().length === 0;
    case 'notEmpty':
      return answer.trim().length > 0;
    case 'includes':
    case 'contains':
      return values.length === 0
        ? answer.trim().length > 0
        : values.some((value) => answer.includes(value));
    case 'notIncludes':
    case 'notContains':
      return values.length === 0
        ? answer.trim().length === 0
        : values.every((value) => !answer.includes(value));
    case 'notEquals':
    case 'neq':
      return values.length === 0
        ? answer.trim().length === 0
        : values.every((value) => answer !== value);
    case 'equals':
    case 'eq':
    default:
      return values.length === 0
        ? answer.trim().length > 0
        : values.some((value) => answer === value);
  }
};

const normalizeJumpRules = (raw: QuestionnaireJumpRule | QuestionnaireJumpRule[] | undefined): QuestionnaireJumpRule[] => {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter((item) => item && typeof item === 'object');
  return [raw];
};

const resolveJumpTargetKey = (
  raw: QuestionnaireJumpRule | QuestionnaireJumpRule[] | undefined,
  answersByKey: Record<string, string>,
  lookup: QuestionLookup
): string | 'END' | null => {
  const rules = normalizeJumpRules(raw);
  for (const rule of rules) {
    if (!rule || !rule.when) continue;
    const matched = evaluateCondition(rule.when, answersByKey, lookup, false);
    if (!matched) continue;
    if (rule.toEnd) return 'END';
    const targetKey = resolveKeyFromRef(rule.to, lookup);
    if (targetKey) return targetKey;
  }
  return null;
};

export const resolveQuestionnaireReferences = <T extends QuestionFlowItem>(items: T[]): T[] => {
  if (items.length === 0) return items;
  const lookup = buildQuestionLookup(items);
  return items.map((item) => {
    const sourceRef = item.question.optionsFrom;
    const suggestionsRef = item.question.suggestionsFrom;
    const nextOptionsKey = resolveKeyFromRef(sourceRef, lookup);
    const nextSuggestionsKey = resolveKeyFromRef(suggestionsRef, lookup);
    if (!nextOptionsKey && !nextSuggestionsKey) return item;

    const sourceOptions = nextOptionsKey ? items[lookup.indexByKey.get(nextOptionsKey) ?? -1]?.question.options : undefined;
    const sourceSuggestions = nextSuggestionsKey ? items[lookup.indexByKey.get(nextSuggestionsKey) ?? -1]?.question.suggestions : undefined;
    const hasOptions = Array.isArray(item.question.options) && item.question.options.length > 0;
    const hasSuggestions = Array.isArray(item.question.suggestions) && item.question.suggestions.length > 0;
    const nextQuestion: QuestionnaireQuestion = {
      ...item.question,
      options: hasOptions ? item.question.options : sourceOptions ?? item.question.options,
      suggestions: hasSuggestions ? item.question.suggestions : sourceSuggestions ?? item.question.suggestions,
    };
    if (nextQuestion === item.question) return item;
    return { ...item, question: nextQuestion };
  });
};

export const buildQuestionnaireFlow = <T extends QuestionFlowItem>(
  items: T[],
  answersByKey: Record<string, string>
): { flow: T[]; visibleKeys: Set<string>; indexByKey: Map<string, number> } => {
  if (items.length === 0) {
    return { flow: [], visibleKeys: new Set(), indexByKey: new Map() };
  }

  const lookup = buildQuestionLookup(items);

  const computeFlow = (activeAnswers: Record<string, string>) => {
    const visibleFlags = items.map((item) => evaluateCondition(item.question.displayIf, activeAnswers, lookup, true));
    const findNextVisibleIndex = (startIndex: number) => {
      for (let i = startIndex + 1; i < items.length; i += 1) {
        if (visibleFlags[i]) return i;
      }
      return null;
    };
    const findVisibleFromIndex = (startIndex: number) => {
      for (let i = startIndex; i < items.length; i += 1) {
        if (visibleFlags[i]) return i;
      }
      return null;
    };

    const firstIndex = findVisibleFromIndex(0);
    if (firstIndex === null) {
      const fallbackKeys = new Set(items.map((item) => item.key));
      const indexByKey = new Map(items.map((item, index) => [item.key, index]));
      return { flow: items, visibleKeys: fallbackKeys, indexByKey };
    }

    const visited = new Set<number>();
    const flow: T[] = [];
    let index: number | null = firstIndex;
    let guard = 0;

    while (index !== null && index >= 0 && index < items.length && guard < items.length + 5) {
      guard += 1;
      if (visited.has(index)) break;
      visited.add(index);
      const item = items[index];
      if (visibleFlags[index]) {
        flow.push(item);
      }

      const jumpTargetKey = resolveJumpTargetKey(item.question.jump, activeAnswers, lookup);
      if (jumpTargetKey === 'END') break;

      let nextIndex: number | null = null;
      if (jumpTargetKey) {
        const targetIndex = lookup.indexByKey.get(jumpTargetKey);
        if (typeof targetIndex === 'number' && targetIndex > index) {
          nextIndex = findVisibleFromIndex(targetIndex);
        }
      }

      if (nextIndex === null) {
        nextIndex = findNextVisibleIndex(index);
      }

      if (nextIndex === null) break;
      index = nextIndex;
    }

    const visibleKeys = new Set(flow.map((item) => item.key));
    const indexByKey = new Map(flow.map((item, idx) => [item.key, idx]));
    return { flow, visibleKeys, indexByKey };
  };

  let activeAnswers = answersByKey;
  let result = computeFlow(activeAnswers);
  for (let i = 0; i < 3; i += 1) {
    const hiddenKeys = Object.keys(activeAnswers).filter((key) => !result.visibleKeys.has(key));
    if (hiddenKeys.length === 0) break;
    const nextAnswers: Record<string, string> = {};
    Object.entries(activeAnswers).forEach(([key, value]) => {
      if (result.visibleKeys.has(key)) nextAnswers[key] = value;
    });
    activeAnswers = nextAnswers;
    result = computeFlow(activeAnswers);
  }

  return result;
};

export const normalizeQuestionnaireDefinition = (
  raw: unknown,
  options: {
    fallbackId?: string;
    fallbackKind?: QuestionnaireKind;
    fallbackTitle?: string;
    nativeAllowed?: boolean | null;
  } = {}
): QuestionnaireDefinition | null => {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const rawQuestions = record.questions;
  if (!Array.isArray(rawQuestions) || rawQuestions.length === 0) return null;

  const resolvedKind = (record.kind as QuestionnaireKind) || options.fallbackKind;
  if (resolvedKind !== 'magical-girl' && resolvedKind !== 'canshou') return null;

  const resolvedId = typeof record.id === 'string' && record.id.trim()
    ? record.id.trim()
    : (options.fallbackId?.trim() || `${resolvedKind}-custom`);
  const resolvedTitle = typeof record.title === 'string' && record.title.trim()
    ? record.title.trim()
    : (options.fallbackTitle?.trim() || '未命名问卷');

  const baseQuestions: QuestionnaireQuestion[] = rawQuestions.map((item, index) => {
    if (typeof item === 'string') {
      return {
        id: `${resolvedKind === 'magical-girl' ? 'MG' : 'Q'}-${index + 1}`,
        question: item,
        required: true,
      };
    }
    if (!item || typeof item !== 'object') {
      return {
        id: `${resolvedKind === 'magical-girl' ? 'MG' : 'Q'}-${index + 1}`,
        question: `问题 ${index + 1}`,
        required: true,
      };
    }
    const q = item as Record<string, unknown>;
    const id = typeof q.id === 'string' && q.id.trim() ? q.id.trim() : `${resolvedKind === 'magical-girl' ? 'MG' : 'Q'}-${index + 1}`;
    const question = typeof q.question === 'string' && q.question.trim() ? q.question.trim() : `问题 ${index + 1}`;
    const required = typeof q.required === 'boolean' ? q.required : true;
    const maxLength = typeof q.maxLength === 'number' && Number.isFinite(q.maxLength)
      ? Math.max(0, Math.floor(q.maxLength))
      : q.maxLength === null
        ? null
        : undefined;

    const optionsFrom = typeof q.optionsFrom === 'string'
      ? q.optionsFrom
      : (isRecord(q.optionsFrom) ? {
        key: typeof q.optionsFrom.key === 'string' ? q.optionsFrom.key : undefined,
        questionId: typeof q.optionsFrom.questionId === 'string' ? q.optionsFrom.questionId : undefined,
        questionnaireId: typeof q.optionsFrom.questionnaireId === 'string' ? q.optionsFrom.questionnaireId : undefined,
      } : undefined);
    const suggestionsFrom = typeof q.suggestionsFrom === 'string'
      ? q.suggestionsFrom
      : (isRecord(q.suggestionsFrom) ? {
        key: typeof q.suggestionsFrom.key === 'string' ? q.suggestionsFrom.key : undefined,
        questionId: typeof q.suggestionsFrom.questionId === 'string' ? q.suggestionsFrom.questionId : undefined,
        questionnaireId: typeof q.suggestionsFrom.questionnaireId === 'string' ? q.suggestionsFrom.questionnaireId : undefined,
      } : undefined);
    const displayIf = Array.isArray(q.displayIf)
      ? (q.displayIf.filter((entry) => isRecord(entry)) as QuestionnaireCondition[])
      : (isRecord(q.displayIf) ? (q.displayIf as QuestionnaireCondition) : undefined);
    const jump = Array.isArray(q.jump)
      ? q.jump.filter((entry) => isJumpRule(entry))
      : (isJumpRule(q.jump) ? q.jump : undefined);

    return {
      id,
      question,
      type: typeof q.type === 'string' ? (q.type as 'text' | 'select') : undefined,
      options: Array.isArray(q.options) ? (q.options as QuestionnaireOption[]) : undefined,
      optionsFrom: optionsFrom as QuestionnaireQuestionRef | undefined,
      placeholder: typeof q.placeholder === 'string' ? q.placeholder : undefined,
      suggestions: Array.isArray(q.suggestions) ? (q.suggestions as string[]) : undefined,
      suggestionsFrom: suggestionsFrom as QuestionnaireQuestionRef | undefined,
      allowCustom: typeof q.allowCustom === 'boolean' ? q.allowCustom : undefined,
      helperText: typeof q.helperText === 'string' ? q.helperText : undefined,
      maxLength: maxLength === undefined ? undefined : maxLength,
      required,
      displayIf,
      jump,
    };
  });

  const questions = baseQuestions.map((question) => ({
    ...question,
    maxLength: question.maxLength === undefined ? null : question.maxLength,
  }));

  return {
    id: resolvedId,
    kind: resolvedKind,
    title: resolvedTitle,
    description: typeof record.description === 'string' ? record.description.trim() : undefined,
    logoUrl: sanitizeQuestionnaireLogoUrl(record.logoUrl),
    version: typeof record.version === 'string' ? record.version.trim() : undefined,
    nativeAllowed: typeof record.nativeAllowed === 'boolean' ? record.nativeAllowed : options.nativeAllowed ?? null,
    questions,
  };
};

export const normalizeUserAnswers = (userAnswers: unknown, fallbackQuestions: string[] = []): QuestionnaireAnswerItem[] => {
  if (!userAnswers) return [];

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

  if (Array.isArray(userAnswers)) {
    const normalizedArray = userAnswers.map((item, index) => {
      if (typeof item === 'string') {
        const question = fallbackQuestions[index] || `问题 ${index + 1}`;
        return { question, answer: item };
      }
      if (item && typeof item === 'object') {
        const record = item as Record<string, unknown>;
        const answer = coerceAnswerText(record.answer ?? record.value ?? '');
        const question = typeof record.question === 'string'
          ? record.question
          : fallbackQuestions[index] || `问题 ${index + 1}`;
        return {
          question,
          answer,
          questionId: typeof record.questionId === 'string' ? record.questionId : undefined,
          questionnaireId: typeof record.questionnaireId === 'string' ? record.questionnaireId : undefined,
          questionnaireTitle: typeof record.questionnaireTitle === 'string' ? record.questionnaireTitle : undefined,
        };
      }
      const question = fallbackQuestions[index] || `问题 ${index + 1}`;
      return { question, answer: '' };
    });
    return normalizedArray.filter((item) => item.answer.trim().length > 0);
  }

  if (typeof userAnswers === 'object') {
    const entries = Object.entries(userAnswers as Record<string, unknown>);
    return entries
      .map(([key, value]) => {
        if (value && typeof value === 'object') {
          const record = value as Record<string, unknown>;
          const answer = coerceAnswerText(record.answer ?? record.value ?? '');
          const question = typeof record.question === 'string' ? record.question : key;
          return {
            question,
            answer,
            questionId: typeof record.questionId === 'string' ? record.questionId : undefined,
            questionnaireId: typeof record.questionnaireId === 'string' ? record.questionnaireId : undefined,
            questionnaireTitle: typeof record.questionnaireTitle === 'string' ? record.questionnaireTitle : undefined,
          };
        }
        const answerText = coerceAnswerText(value);
        return { question: key, answer: answerText };
      })
      .filter((item) => item.answer.trim().length > 0);
  }

  return [];
};

export const formatQuestionnaireAnswers = (answers: QuestionnaireAnswerItem[]): string => {
  if (!answers.length) return '';
  const grouped = new Map<string, QuestionnaireAnswerItem[]>();
  for (const item of answers) {
    const groupKey = item.questionnaireTitle?.trim() || '';
    if (!grouped.has(groupKey)) grouped.set(groupKey, []);
    grouped.get(groupKey)!.push(item);
  }

  const blocks: string[] = [];
  for (const [groupTitle, items] of grouped.entries()) {
    if (groupTitle) {
      blocks.push(`【${groupTitle}】`);
    }
    items.forEach((item, index) => {
      const qLabel = item.question?.trim() ? item.question.trim() : `问题 ${index + 1}`;
      blocks.push(`Q: ${qLabel}`);
      blocks.push(`A: ${item.answer}`);
    });
  }
  return blocks.join('\n');
};
