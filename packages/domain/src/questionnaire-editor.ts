import { SafeJsonValueSchema } from '@mahoshojo/contracts/json-value';
import { normalizeQuestionnaireDefinition, sanitizeQuestionnaireLogoUrl, MAX_QUESTIONNAIRE_IMPORT_BYTES, type QuestionnaireConditionOperator, type QuestionnaireCondition, type QuestionnaireDefinition, type QuestionnaireJumpRule, type QuestionnaireOption, type QuestionnaireQuestion, type QuestionnaireQuestionRef } from './questionnaire-definition';
import { exceedsUtf8ByteLimit } from './data-card-size';

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const omitKeys = (record: Record<string, unknown>, keys: readonly string[]) => Object.fromEntries(Object.entries(record).filter(([key]) => !keys.includes(key)));
// Editing a questionnaire never confers verified origin or native eligibility.
const safeExtensions = (record: Record<string, unknown>) => omitKeys(record, ['signature', 'isPreset', '_native', '_isNative', 'isNative', 'nativeAllowed']);
const TOP_KEYS = ['id', 'kind', 'title', 'description', 'loreMarkdown', 'logoUrl', 'version', 'nativeAllowed', 'questions'];
const QUESTION_KEYS = ['id', 'question', 'type', 'placeholder', 'suggestions', 'options', 'optionsFrom', 'suggestionsFrom', 'allowCustom', 'helperText', 'maxLength', 'required', 'displayIf', 'jump'];

export type EditableSuggestionItem = {
  uid: string;
  text: string;
};

export type EditableOptionItem = {
  uid: string;
  label: string;
  value: string;
  disabled: boolean;
  extensions?: Record<string, unknown>;
};

export type EditableQuestion = {
  uid: string;
  id: string;
  question: string;
  type?: 'text' | 'select';
  placeholder?: string;
  suggestions: EditableSuggestionItem[];
  options: EditableOptionItem[];
  optionsFromId: string;
  suggestionsFromId: string;
  allowCustom?: boolean;
  helperText?: string;
  maxLengthText: string;
  required?: boolean;
  displayIfEnabled: boolean;
  displayIfQuestionId: string;
  displayIfOperator: string;
  displayIfValue: string;
  jumpEnabled: boolean;
  jumpQuestionId: string;
  jumpOperator: string;
  jumpValue: string;
  jumpTargetId: string;
  jumpToEnd: boolean;
  extraJson: string;
};

let questionUidCounter = 0;
let suggestionUidCounter = 0;
let optionUidCounter = 0;

export const createQuestionUid = (seed?: string) => {
  if (seed) return `question-${seed}`;
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `question-${crypto.randomUUID()}`;
  }
  questionUidCounter += 1;
  return `question-${Date.now()}-${questionUidCounter}`;
};

export const createSuggestionUid = (seed?: string) => {
  if (seed) return `suggestion-${seed}`;
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `suggestion-${crypto.randomUUID()}`;
  }
  suggestionUidCounter += 1;
  return `suggestion-${Date.now()}-${suggestionUidCounter}`;
};

export const createOptionUid = (seed?: string) => {
  if (seed) return `option-${seed}`;
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `option-${crypto.randomUUID()}`;
  }
  optionUidCounter += 1;
  return `option-${Date.now()}-${optionUidCounter}`;
};

export const createEmptyQuestion = (
  index: number,
  kind: 'magical-girl' | 'canshou',
  uidSeed?: string
): EditableQuestion => ({
  uid: createQuestionUid(uidSeed),
  id: kind === 'magical-girl' ? `MG-${index + 1}` : `CS-${index + 1}`,
  question: '',
  type: 'text',
  placeholder: '',
  suggestions: [],
  options: [],
  optionsFromId: '',
  suggestionsFromId: '',
  allowCustom: true,
  helperText: '',
  maxLengthText: '',
  required: false,
  displayIfEnabled: false,
  displayIfQuestionId: '',
  displayIfOperator: 'equals',
  displayIfValue: '',
  jumpEnabled: false,
  jumpQuestionId: '',
  jumpOperator: 'equals',
  jumpValue: '',
  jumpTargetId: '',
  jumpToEnd: false,
  extraJson: '',
});

const buildSuggestionsPayload = (items: EditableSuggestionItem[]): string[] | undefined => {
  const normalized = items
    .map((item) => item.text.trim())
    .filter(Boolean);
  return normalized.length > 0 ? normalized : undefined;
};

const buildOptionsPayload = (items: EditableOptionItem[]): QuestionnaireOption[] | undefined => {
  const normalized = items
    .map((item) => {
      const label = item.label.trim();
      const value = item.value.trim();
      const resolvedLabel = label || value;
      const resolvedValue = value || label;
      if (!resolvedLabel || !resolvedValue) return null;
      if (!item.disabled && resolvedLabel === resolvedValue && !Object.keys(item.extensions ?? {}).length) return resolvedValue;
      return {
        ...item.extensions,
        label: resolvedLabel,
        value: resolvedValue,
        ...(item.disabled ? { disabled: true } : {}),
      };
    })
    .filter((item): item is QuestionnaireOption => item !== null);
  return normalized.length > 0 ? normalized : undefined;
};

export const CONDITION_OPERATORS = [
  { value: 'equals', label: '等于' },
  { value: 'notEquals', label: '不等于' },
  { value: 'includes', label: '包含' },
  { value: 'notIncludes', label: '不包含' },
  { value: 'empty', label: '为空' },
  { value: 'notEmpty', label: '不为空' },
];

export const operatorNeedsValue = (operator: string) => !['empty', 'notEmpty'].includes(operator);

const toQuestionRefId = (ref: QuestionnaireQuestionRef | undefined): string => {
  if (!ref) return '';
  if (typeof ref === 'string') return ref;
  if (typeof ref.questionId === 'string') return ref.questionId;
  if (typeof ref.key === 'string') return ref.key;
  return '';
};

const parseConditionValue = (value: unknown): string => {
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).join('|');
  }
  if (typeof value === 'string') return value;
  return '';
};

const parseSimpleCondition = (
  condition: QuestionnaireCondition | QuestionnaireCondition[] | undefined
): { questionId: string; operator: string; value: string } | null => {
  if (!condition || Array.isArray(condition)) return null;
  if (Object.keys(condition).some((key) => !['questionId', 'operator', 'value'].includes(key))) return null;
  if (Array.isArray(condition.value) || (typeof condition.value === 'string' && (condition.value.includes('|') || condition.value !== condition.value.trim()))) return null;
  if (condition.operator && !CONDITION_OPERATORS.some((item) => item.value === condition.operator)) return null;
  const target = Array.isArray(condition) ? (condition.length === 1 ? condition[0] : null) : condition;
  if (!target || typeof target !== 'object') return null;
  if ('any' in target || 'all' in target || 'not' in target) return null;
  const questionId = typeof target.questionId === 'string'
    ? target.questionId
    : (typeof target.key === 'string' ? target.key : '');
  if (!questionId || questionId !== questionId.trim()) return null;
  const operator = typeof target.operator === 'string' ? target.operator : 'equals';
  const value = parseConditionValue(target.value);
  return { questionId, operator, value };
};

const parseSimpleJump = (
  jump: QuestionnaireJumpRule | QuestionnaireJumpRule[] | undefined
): {
  questionId: string;
  operator: string;
  value: string;
  targetId: string;
  toEnd: boolean;
} | null => {
  if (!jump || Array.isArray(jump)) return null;
  if (Object.keys(jump).some((key) => !['when', 'to', 'toEnd'].includes(key))) return null;
  if (jump.to && (typeof jump.to !== 'object' || Object.keys(jump.to).some((key) => key !== 'questionId'))) return null;
  const rule = Array.isArray(jump) ? (jump.length === 1 ? jump[0] : null) : jump;
  if (!rule || typeof rule !== 'object' || !rule.when) return null;
  const condition = parseSimpleCondition(rule.when);
  if (!condition || Array.isArray(condition)) return null;
  if (Object.keys(condition).some((key) => !['questionId', 'operator', 'value'].includes(key))) return null;
  if (Array.isArray(condition.value) || (typeof condition.value === 'string' && (condition.value.includes('|') || condition.value !== condition.value.trim()))) return null;
  if (condition.operator && !CONDITION_OPERATORS.some((item) => item.value === condition.operator)) return null;
  const targetId = toQuestionRefId(rule.to);
  const toEnd = Boolean(rule.toEnd);
  return {
    questionId: condition.questionId,
    operator: condition.operator,
    value: condition.value,
    targetId,
    toEnd,
  };
};


export type EditableQuestionnaire = {
 kind: 'magical-girl' | 'canshou'; questionnaireId: string; title: string; description: string;
 loreMarkdown: string; logoUrl: string; version: string; questions: EditableQuestion[];
 extensions: Record<string, unknown>;
};
export function buildEditableQuestionnaire({ questions, questionnaireId, kind, title, description, loreMarkdown, logoUrl, version, extensions }: EditableQuestionnaire) {
    const errors: string[] = [];
    const cleanedQuestions: QuestionnaireQuestion[] = questions.map((q, index) => {
      let extra: Record<string, unknown> = {};
      if (q.extraJson.trim()) {
        try {
          if (exceedsUtf8ByteLimit(q.extraJson, MAX_QUESTIONNAIRE_IMPORT_BYTES)) throw new Error();
          const parsed: unknown = JSON.parse(q.extraJson);
          if (!SafeJsonValueSchema.safeParse(parsed).success || !isRecord(parsed)) throw new Error();
          extra = parsed;
        } catch {
          errors.push(`第 ${index + 1} 题的“额外字段 JSON”无法解析`);
        }
      }

      const maxLength = q.maxLengthText.trim() ? Number(q.maxLengthText) : null;
      if (q.maxLengthText.trim() && !Number.isFinite(maxLength)) {
        errors.push(`第 ${index + 1} 题的最大字数不是有效数字`);
      }

      let displayIf: QuestionnaireCondition | undefined = undefined;
      if (q.displayIfEnabled) {
        const questionId = q.displayIfQuestionId.trim();
        if (!questionId) {
          errors.push(`第 ${index + 1} 题已启用条件显示，但未选择引用题目`);
        } else {
          const operator = (q.displayIfOperator || 'equals') as QuestionnaireConditionOperator;
          const rawValue = q.displayIfValue.trim();
          const value = operatorNeedsValue(operator)
            ? (rawValue.includes('|') ? rawValue.split('|').map((item) => item.trim()).filter(Boolean) : rawValue)
            : undefined;
          displayIf = {
            questionId,
            operator,
            ...(value === undefined || (Array.isArray(value) && value.length === 0) ? {} : { value }),
          };
        }
      }

      let jump: QuestionnaireJumpRule | undefined = undefined;
      if (q.jumpEnabled) {
        const jumpQuestionId = q.jumpQuestionId.trim() || q.id.trim();
        const jumpTargetId = q.jumpTargetId.trim();
        const toEnd = q.jumpToEnd;
        if (!jumpQuestionId) {
          errors.push(`第 ${index + 1} 题已启用跳题，但条件题目为空`);
        } else if (!toEnd && !jumpTargetId) {
          errors.push(`第 ${index + 1} 题已启用跳题，但未设置跳转目标`);
        } else {
          const operator = (q.jumpOperator || 'equals') as QuestionnaireConditionOperator;
          const rawValue = q.jumpValue.trim();
          const value = operatorNeedsValue(operator)
            ? (rawValue.includes('|') ? rawValue.split('|').map((item) => item.trim()).filter(Boolean) : rawValue)
            : undefined;
          jump = {
            when: {
              questionId: jumpQuestionId,
              operator,
              ...(value === undefined || (Array.isArray(value) && value.length === 0) ? {} : { value }),
            },
            ...(toEnd ? { toEnd: true } : { to: { questionId: jumpTargetId } }),
          };
        }
      }

      return {
        ...extra,
        id: q.id.trim() || (kind === 'magical-girl' ? `MG-${index + 1}` : `CS-${index + 1}`),
        question: q.question.trim() || `问题 ${index + 1}`,
        type: q.type,
        placeholder: q.placeholder?.trim() || undefined,
        suggestions: buildSuggestionsPayload(q.suggestions),
        options: buildOptionsPayload(q.options),
        ...(q.optionsFromId.trim() ? { optionsFrom: { questionId: q.optionsFromId.trim() } } : {}),
        ...(q.suggestionsFromId.trim() ? { suggestionsFrom: { questionId: q.suggestionsFromId.trim() } } : {}),
        allowCustom: typeof q.allowCustom === 'boolean' ? q.allowCustom : undefined,
        helperText: q.helperText?.trim() || undefined,
        maxLength: Number.isFinite(maxLength) ? maxLength : null,
        required: typeof q.required === 'boolean' ? q.required : undefined,
        ...(displayIf ? { displayIf } : {}),
        ...(jump ? { jump } : {}),
      } satisfies QuestionnaireQuestion;
    });

    const trimmedLore = loreMarkdown.trim();
    if (cleanedQuestions.length === 0 && !trimmedLore) {
      errors.push('问卷至少需要 1 个题目，或填写设定内容（loreMarkdown）');
    }

    const payload: QuestionnaireDefinition = {
      ...safeExtensions(extensions),
      id: questionnaireId.trim() || `${kind}-custom`,
      kind,
      title: title.trim() || '未命名问卷',
      description: description.trim() || undefined,
      loreMarkdown: trimmedLore ? loreMarkdown : undefined,
      logoUrl: sanitizeQuestionnaireLogoUrl(logoUrl) || undefined,
      version: version.trim() || undefined,
      nativeAllowed: false,
      questions: cleanedQuestions,
    };

    const serialized = JSON.stringify(payload, null, 2);
    if (exceedsUtf8ByteLimit(serialized, MAX_QUESTIONNAIRE_IMPORT_BYTES)) errors.push('编辑结果超过 1 MiB，请精简后再导出或保存。');
    if (!SafeJsonValueSchema.safeParse(JSON.parse(serialized)).success) errors.push('编辑结果包含不安全键、过深结构或过多节点。');
    return {
      questionnaireData: payload,
      jsonError: errors.length > 0 ? errors[0] : null,
    };
}

export function importEditableQuestionnaire(sourceText: string, kind: 'magical-girl' | 'canshou' = 'magical-girl'): EditableQuestionnaire {
  if (exceedsUtf8ByteLimit(sourceText, MAX_QUESTIONNAIRE_IMPORT_BYTES)) throw new Error('问卷 JSON 超过大小上限（1 MiB）。');
  const raw: unknown = JSON.parse(sourceText.startsWith('\uFEFF') ? sourceText.slice(1) : sourceText);
  if (!SafeJsonValueSchema.safeParse(raw).success) throw new Error('JSON 包含不安全键、过深结构或过多节点。');
  if (!isRecord(raw)) throw new Error('问卷 JSON 无法识别，请检查格式');
  const normalized = normalizeQuestionnaireDefinition(raw, { fallbackKind: kind, nativeAllowed: false });
  if (!normalized) throw new Error('问卷 JSON 无法识别，请检查格式');
  // Reject malformed editable lists rather than crash or silently discard them.
  if (Array.isArray(raw.questions)) for (const q of raw.questions) {
    if (!isRecord(q) && typeof q !== 'string') throw new Error('题目必须为对象或文字');
    if (!isRecord(q)) continue;
    if (q.suggestions !== undefined && (!Array.isArray(q.suggestions) || q.suggestions.some((item) => typeof item !== 'string'))) throw new Error('灵感列表必须为文字数组');
    if (q.options !== undefined && (!Array.isArray(q.options) || q.options.some((item) => typeof item !== 'string' && (!isRecord(item) || typeof item.label !== 'string' || typeof item.value !== 'string')))) throw new Error('选项必须为文字或带 label/value 的对象');
  }
  return {
    kind: normalized.kind, questionnaireId: normalized.id, title: normalized.title,
    description: normalized.description || '', loreMarkdown: normalized.loreMarkdown || '',
    logoUrl: normalized.logoUrl || '', version: normalized.version || '',
    extensions: safeExtensions(omitKeys(raw, TOP_KEYS)),
    questions: normalized.questions.map((q, index) => {
        const candidate: unknown = Array.isArray(raw.questions) ? raw.questions[index] : undefined;
        const original = isRecord(candidate) ? candidate : {};
        const displayIfParsed = parseSimpleCondition(q.displayIf);
        const jumpParsed = parseSimpleJump(q.jump);
        const extraPayload: Record<string, unknown> = omitKeys(original, QUESTION_KEYS);
        if (!displayIfParsed && original.displayIf !== undefined) extraPayload.displayIf = original.displayIf;
        if (!jumpParsed && original.jump !== undefined) extraPayload.jump = original.jump;
        const simpleRef = (value: unknown) => isRecord(value) && Object.keys(value).every((key) => key === 'questionId');
        if (original.optionsFrom !== undefined && !simpleRef(original.optionsFrom)) extraPayload.optionsFrom = original.optionsFrom;
        if (original.suggestionsFrom !== undefined && !simpleRef(original.suggestionsFrom)) extraPayload.suggestionsFrom = original.suggestionsFrom;

        return {
          uid: createQuestionUid(),
          id: q.id,
          question: q.question,
          type: q.type || 'text',
          placeholder: q.placeholder || '',
          suggestions: (q.suggestions || []).map((text) => ({ uid: createSuggestionUid(), text })),
          options: (q.options || []).map((option) => {
            if (typeof option === 'string') {
              return { uid: createOptionUid(), label: option, value: option, disabled: false };
            }
            return {
              uid: createOptionUid(),
              label: option.label,
              value: option.value,
              disabled: Boolean(option.disabled),
              extensions: omitKeys(option as Record<string, unknown>, ['label', 'value', 'disabled']),
            };
          }),
          optionsFromId: simpleRef(original.optionsFrom) ? toQuestionRefId(q.optionsFrom) : '',
          suggestionsFromId: simpleRef(original.suggestionsFrom) ? toQuestionRefId(q.suggestionsFrom) : '',
          allowCustom: q.allowCustom ?? true,
          helperText: q.helperText || '',
          maxLengthText: q.maxLength == null ? '' : String(q.maxLength),
          required: q.required === true,
          displayIfEnabled: Boolean(displayIfParsed),
          displayIfQuestionId: displayIfParsed?.questionId || '',
          displayIfOperator: displayIfParsed?.operator || 'equals',
          displayIfValue: displayIfParsed?.value || '',
          jumpEnabled: Boolean(jumpParsed),
          jumpQuestionId: jumpParsed?.questionId || '',
          jumpOperator: jumpParsed?.operator || 'equals',
          jumpValue: jumpParsed?.value || '',
          jumpTargetId: jumpParsed?.targetId || '',
          jumpToEnd: jumpParsed?.toEnd || false,
          extraJson: Object.keys(extraPayload).length > 0 ? JSON.stringify(extraPayload, null, 2) : '',
        };
      })
  };
}
