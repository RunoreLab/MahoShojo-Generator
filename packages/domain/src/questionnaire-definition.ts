import { isAllowedExternalMediaUrl } from './external-media';
import {
  type QuestionnaireAnswerItem,
  type QuestionnaireAnswerMatchTarget,
} from './questionnaire';

/**
 * 问卷定义与流程的领域运行时（D5.0e 自 apps/web/lib/questionnaires 迁入）。
 *
 * 这是「问卷数据卡 payload → 可运行问卷」的全部领域知识：payload 解析、
 * 字段归一化、条件可见（displayIf）、跳转（jump）、选项/建议引用
 * （optionsFrom/suggestionsFrom）。Web 各玩法页与 Desktop /details 共用同一份，
 * 不另起 Desktop 问卷体系（`SPEC-desktop-online-ai-integration-v1`）。
 *
 * 网站专属的问卷 logo 预设常量与站点素材路径仍留在 Web 文件里；
 * `logoUrl` 的站外地址准入走 domain 的媒体白名单（与 Web 原口径一致）。
 */

export type QuestionnaireKind = 'magical-girl' | 'canshou';

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
  loreMarkdown?: string;
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

export type StoredQuestionnaireAnswerItem = QuestionnaireAnswerItem & {
  key?: string;
};

export const sanitizeQuestionnaireLogoUrl = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (!isAllowedExternalMediaUrl(trimmed, 'image')) return undefined;
  return trimmed;
};

export const buildQuestionKey = (questionnaireId: string | undefined, questionId: string | undefined, index: number) => {
  const base = (questionId ?? '').trim() || `Q${index + 1}`;
  const prefix = (questionnaireId ?? '').trim();
  return prefix ? `${prefix}::${base}` : base;
};

export const collectStoredQuestionnaireAnswerItems = <T extends QuestionnaireAnswerMatchTarget>(
  targets: T[],
  answersByKey: Record<string, string>
): StoredQuestionnaireAnswerItem[] => {
  return targets.flatMap((target) => {
    const answer = answersByKey[target.key];
    if (typeof answer !== 'string' || answer.trim().length === 0) return [];
    return [{
      key: target.key,
      question: target.question,
      answer,
      questionId: target.questionId,
      questionnaireId: target.questionnaireId,
      questionnaireTitle: target.questionnaireTitle,
    }];
  });
};

const isQuestionnaireOptionAllowed = (
  options: readonly QuestionnaireOption[] | undefined,
  answer: string,
): boolean =>
  options?.some((option) =>
    typeof option === 'string' ? option === answer : !option.disabled && option.value === answer) ?? false;

/**
 * 可见流程 → 提交用 `QuestionnaireAnswerItem[]`：裁剪空白、跳过未答与
 * displayIf/jump 隐藏题（调用方传入的 flow 已完成条件求值，隐藏题即使
 * 草稿里残留回答也不进入提交载荷）。
 *
 * `allowCustom === false` 的封闭题只接受声明的可用选项（含 disabled 检查）：
 * 正常点选不会产生选项外取值，但批量文本/JSON/角色卡导入等宿主旁路可以
 * 写入任意字符串——投影在收集阶段直接拒绝，而不是把非法答案带进提交
 * 载荷（D5.1a-r1 复审）。
 *
 * 封闭校验只在题目真实声明了非空选项集时生效：`allowCustom === false`
 * 但没有任何选项的问卷形态为 normalizer 所接受，Web 既有 UI 对它回退为
 * 文本输入（`showTextInput = allowCustom || !hasOptions`）——投影沿用同一
 * 口径按文本题收集自由回答，而不是在提交时才报「请选择一个可用选项」
 * （D5.1a-r2 复审）。若未来要求 `allowCustom === false` 必须携带选项，
 * 应在 normalize/schema 阶段拒绝问卷，而不是让 UI 放行后提交报错。
 *
 * Web `/details` 与 Desktop `buildDetailsAnswers` 共用同一投影，保证同源
 * `answersByKey` 在两宿主产出顺序与字段完全一致的 `answers`，且对非法
 * 封闭题答案同样拒绝（D5.1a-r1）。
 */
export const collectQuestionnaireFlowAnswerItems = <T extends {
  key: string;
  question: {
    question: string;
    id?: string;
    allowCustom?: boolean;
    options?: readonly QuestionnaireOption[];
  };
  questionnaireId?: string;
  questionnaireTitle?: string;
}>(
  flow: readonly T[],
  answersByKey: Readonly<Record<string, unknown>>,
): QuestionnaireAnswerItem[] => {
  flow.forEach((item) => {
    const raw = answersByKey[item.key];
    const answer = typeof raw === 'string' ? raw.trim() : '';
    if (
      answer
      && item.question.allowCustom === false
      && (item.question.options?.length ?? 0) > 0
      && !isQuestionnaireOptionAllowed(item.question.options, answer)
    ) {
      throw new Error(`“${item.question.question}”请选择一个可用选项。`);
    }
  });
  return flow.flatMap((item) => {
    const raw = answersByKey[item.key];
    const answer = typeof raw === 'string' ? raw.trim() : '';
    if (!answer) return [];
    return [{
      question: item.question.question,
      answer,
      questionId: item.question.id,
      questionnaireId: item.questionnaireId,
      questionnaireTitle: item.questionnaireTitle,
    }];
  });
};

type QuestionFlowItem = {
  key: string;
  questionnaireId: string;
  questionnaireScopeId?: string;
  question: QuestionnaireQuestion;
};

type QuestionLookup = {
  keyByCompositeId: Map<string, string>;
  keyByScopeCompositeId: Map<string, string>;
  keysByQuestionId: Map<string, string[]>;
  indexByKey: Map<string, number>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const QUESTIONNAIRE_CARD_PAYLOAD_KEYS = ['data', 'dataJson', 'data_json', 'dataJSON'] as const;
const QUESTIONNAIRE_CARD_PAYLOAD_ERROR = '问卷数据卡内容为空或格式不受支持';

const parseQuestionnairePayloadValue = (value: unknown): Record<string, unknown> => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) throw new Error(QUESTIONNAIRE_CARD_PAYLOAD_ERROR);
    const parsed = JSON.parse(trimmed) as unknown;
    if (!isRecord(parsed)) throw new Error(QUESTIONNAIRE_CARD_PAYLOAD_ERROR);
    return parsed;
  }
  if (isRecord(value)) return value;
  throw new Error(QUESTIONNAIRE_CARD_PAYLOAD_ERROR);
};

export const parseQuestionnaireDataCardPayload = (source: unknown): Record<string, unknown> => {
  if (typeof source === 'string') {
    return parseQuestionnairePayloadValue(source);
  }
  if (!isRecord(source)) {
    throw new Error(QUESTIONNAIRE_CARD_PAYLOAD_ERROR);
  }

  for (const key of QUESTIONNAIRE_CARD_PAYLOAD_KEYS) {
    const rawValue = source[key];
    if (rawValue === null || rawValue === undefined) continue;
    return parseQuestionnairePayloadValue(rawValue);
  }

  if (Array.isArray(source.questions)) {
    return source;
  }
  const nestedQuestionnaire = source.questionnaire;
  if (isRecord(nestedQuestionnaire) && Array.isArray(nestedQuestionnaire.questions)) {
    return nestedQuestionnaire;
  }

  throw new Error(QUESTIONNAIRE_CARD_PAYLOAD_ERROR);
};

const isJumpRule = (value: unknown): value is QuestionnaireJumpRule =>
  isRecord(value) && 'when' in value;

const buildQuestionLookup = <T extends QuestionFlowItem>(items: T[]): QuestionLookup => {
  const keyByCompositeId = new Map<string, string>();
  const keyByScopeCompositeId = new Map<string, string>();
  const keysByQuestionId = new Map<string, string[]>();
  const indexByKey = new Map<string, number>();

  items.forEach((item, index) => {
    indexByKey.set(item.key, index);
    const questionId = item.question.id?.trim();
    if (!questionId) return;
    const questionnaireScopeId = item.questionnaireScopeId?.trim() || item.questionnaireId;
    const scopeComposite = `${questionnaireScopeId}::${questionId}`;
    if (!keyByScopeCompositeId.has(scopeComposite)) {
      keyByScopeCompositeId.set(scopeComposite, item.key);
    }
    const composite = `${item.questionnaireId}::${questionId}`;
    if (!keyByCompositeId.has(composite)) {
      keyByCompositeId.set(composite, item.key);
    }
    const existing = keysByQuestionId.get(questionId) ?? [];
    existing.push(item.key);
    keysByQuestionId.set(questionId, existing);
  });

  return { keyByCompositeId, keyByScopeCompositeId, keysByQuestionId, indexByKey };
};

const resolveKeyFromRef = (
  ref: QuestionnaireQuestionRef | undefined,
  lookup: QuestionLookup,
  sourceItem?: Pick<QuestionFlowItem, 'questionnaireId' | 'questionnaireScopeId'>
): string | null => {
  if (!ref) return null;

  const sourceCanonicalId = sourceItem?.questionnaireId?.trim() ?? '';
  const sourceScopeId = sourceItem?.questionnaireScopeId?.trim() || sourceCanonicalId;
  const resolveScopedComposite = (questionnaireId: string, questionId: string): string | null => {
    const trimmedQuestionnaireId = questionnaireId.trim();
    const trimmedQuestionId = questionId.trim();
    if (!trimmedQuestionnaireId || !trimmedQuestionId) return null;

    if (sourceScopeId && sourceCanonicalId && trimmedQuestionnaireId === sourceCanonicalId) {
      const sourceScoped = lookup.keyByScopeCompositeId.get(`${sourceScopeId}::${trimmedQuestionId}`);
      if (sourceScoped) return sourceScoped;
    }

    const directScoped = lookup.keyByScopeCompositeId.get(`${trimmedQuestionnaireId}::${trimmedQuestionId}`);
    if (directScoped) return directScoped;

    return lookup.keyByCompositeId.get(`${trimmedQuestionnaireId}::${trimmedQuestionId}`) ?? null;
  };
  const resolveQuestionIdInScope = (questionId: string): string | null => {
    const trimmedQuestionId = questionId.trim();
    if (!sourceScopeId || !trimmedQuestionId) return null;
    return lookup.keyByScopeCompositeId.get(`${sourceScopeId}::${trimmedQuestionId}`) ?? null;
  };

  if (typeof ref === 'string') {
    if (lookup.indexByKey.has(ref)) return ref;
    const trimmed = ref.trim();
    const separatorIndex = trimmed.indexOf('::');
    if (separatorIndex > 0) {
      const scopedComposite = resolveScopedComposite(trimmed.slice(0, separatorIndex), trimmed.slice(separatorIndex + 2));
      if (scopedComposite) return scopedComposite;
    }
    const scopedQuestion = resolveQuestionIdInScope(trimmed);
    if (scopedQuestion) return scopedQuestion;
    if (lookup.keyByCompositeId.has(trimmed)) return lookup.keyByCompositeId.get(trimmed) ?? null;
    const keys = lookup.keysByQuestionId.get(trimmed);
    if (keys && keys.length === 1) return keys[0];
    return null;
  }

  if (ref.key && lookup.indexByKey.has(ref.key)) {
    return ref.key;
  }

  if (ref.questionnaireId && ref.questionId) {
    const scopedComposite = resolveScopedComposite(ref.questionnaireId, ref.questionId);
    if (scopedComposite) return scopedComposite;
  }

  if (ref.questionId) {
    const scopedQuestion = resolveQuestionIdInScope(ref.questionId);
    if (scopedQuestion) return scopedQuestion;
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
  fallbackResult: boolean,
  sourceItem?: Pick<QuestionFlowItem, 'questionnaireId' | 'questionnaireScopeId'>
): boolean => {
  if (!raw) return true;
  const condition = Array.isArray(raw) ? { all: raw } : raw;
  if (!condition || typeof condition !== 'object') return fallbackResult;

  if (condition.not) {
    return !evaluateCondition(condition.not, answersByKey, lookup, fallbackResult, sourceItem);
  }

  if (Array.isArray(condition.all) && condition.all.length > 0) {
    return condition.all.every((item) => evaluateCondition(item, answersByKey, lookup, fallbackResult, sourceItem));
  }

  if (Array.isArray(condition.any) && condition.any.length > 0) {
    return condition.any.some((item) => evaluateCondition(item, answersByKey, lookup, fallbackResult, sourceItem));
  }

  const key = resolveKeyFromRef(condition, lookup, sourceItem);
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
  lookup: QuestionLookup,
  sourceItem?: Pick<QuestionFlowItem, 'questionnaireId' | 'questionnaireScopeId'>
): string | 'END' | null => {
  const rules = normalizeJumpRules(raw);
  for (const rule of rules) {
    if (!rule || !rule.when) continue;
    const matched = evaluateCondition(rule.when, answersByKey, lookup, false, sourceItem);
    if (!matched) continue;
    if (rule.toEnd) return 'END';
    const targetKey = resolveKeyFromRef(rule.to, lookup, sourceItem);
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
    const nextOptionsKey = resolveKeyFromRef(sourceRef, lookup, item);
    const nextSuggestionsKey = resolveKeyFromRef(suggestionsRef, lookup, item);
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
    const visibleFlags = items.map((item) => evaluateCondition(item.question.displayIf, activeAnswers, lookup, true, item));
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
    const findNextVisibleOutsideScope = (startIndex: number, questionnaireScopeId: string) => {
      for (let i = startIndex + 1; i < items.length; i += 1) {
        const nextScopeId = items[i]?.questionnaireScopeId?.trim() || items[i]?.questionnaireId;
        if (nextScopeId === questionnaireScopeId) continue;
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

      const jumpTargetKey = resolveJumpTargetKey(item.question.jump, activeAnswers, lookup, item);
      if (jumpTargetKey === 'END') {
        const currentScopeId = item.questionnaireScopeId?.trim() || item.questionnaireId;
        const nextIndex = findNextVisibleOutsideScope(index, currentScopeId);
        if (nextIndex === null) break;
        index = nextIndex;
        continue;
      }

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
  const defaultRequired = typeof record.defaultRequired === 'boolean' ? record.defaultRequired : false;
  const loreMarkdown = typeof record.loreMarkdown === 'string'
    ? (record.loreMarkdown.trim() ? record.loreMarkdown : undefined)
    : undefined;
  const hasLore = Boolean(loreMarkdown && loreMarkdown.trim());
  if (!Array.isArray(rawQuestions) || rawQuestions.length === 0) {
    if (!hasLore) return null;
  }

  const resolvedKind = (record.kind as QuestionnaireKind) || options.fallbackKind;
  if (resolvedKind !== 'magical-girl' && resolvedKind !== 'canshou') return null;

  const resolvedId = typeof record.id === 'string' && record.id.trim()
    ? record.id.trim()
    : (options.fallbackId?.trim() || `${resolvedKind}-custom`);
  const resolvedTitle = typeof record.title === 'string' && record.title.trim()
    ? record.title.trim()
    : (options.fallbackTitle?.trim() || '未命名问卷');

  const baseQuestions: QuestionnaireQuestion[] = Array.isArray(rawQuestions)
    ? rawQuestions.map((item, index) => {
    if (typeof item === 'string') {
      return {
        id: `${resolvedKind === 'magical-girl' ? 'MG' : 'Q'}-${index + 1}`,
        question: item,
        required: defaultRequired,
      };
    }
    if (!item || typeof item !== 'object') {
      return {
        id: `${resolvedKind === 'magical-girl' ? 'MG' : 'Q'}-${index + 1}`,
        question: `问题 ${index + 1}`,
        required: defaultRequired,
      };
    }
    const q = item as Record<string, unknown>;
    const id = typeof q.id === 'string' && q.id.trim() ? q.id.trim() : `${resolvedKind === 'magical-girl' ? 'MG' : 'Q'}-${index + 1}`;
    const question = typeof q.question === 'string' && q.question.trim() ? q.question.trim() : `问题 ${index + 1}`;
    const required = typeof q.required === 'boolean' ? q.required : defaultRequired;
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
  })
    : [];

  const questions = baseQuestions.map((question) => ({
    ...question,
    maxLength: question.maxLength === undefined ? null : question.maxLength,
  }));

  return {
    id: resolvedId,
    kind: resolvedKind,
    title: resolvedTitle,
    description: typeof record.description === 'string' ? record.description.trim() : undefined,
    loreMarkdown,
    logoUrl: sanitizeQuestionnaireLogoUrl(record.logoUrl),
    version: typeof record.version === 'string' ? record.version.trim() : undefined,
    nativeAllowed: typeof record.nativeAllowed === 'boolean' ? record.nativeAllowed : options.nativeAllowed ?? null,
    questions,
  };
};
