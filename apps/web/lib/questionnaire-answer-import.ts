import {
  resolveQuestionnaireAnswerTarget,
  type QuestionnaireAnswerLookup,
  type QuestionnaireAnswerMatchTarget,
} from '@/lib/questionnaires';

export type QuestionnaireAnswerMergeMode = 'fill-empty' | 'overwrite';

export type QuestionnaireAnswerImportSource =
  | 'userAnswers'
  | '_mahoshojo.originalData.userAnswers'
  | 'fields.mahoshojoUserAnswers'
  | '_mahoshojo.originalData.fields.mahoshojoUserAnswers';

export type QuestionnaireAnswerImportEntry = {
  index: number;
  value: string;
  key?: string;
  question?: string;
  questionId?: string;
  questionnaireId?: string;
  questionnaireTitle?: string;
};

export type QuestionnaireCharacterAnswerImportResult =
  | {
      success: true;
      source: QuestionnaireAnswerImportSource;
      sourceLabel: string;
      entries: QuestionnaireAnswerImportEntry[];
      warnings: string[];
    }
  | {
      success: false;
      error: string;
    };

export type ApplyQuestionnaireAnswerImportInput<T extends QuestionnaireAnswerMatchTarget> = {
  currentAnswersByKey: Record<string, string>;
  targets: T[];
  lookup: QuestionnaireAnswerLookup<T>;
  entries: QuestionnaireAnswerImportEntry[];
  mergeMode: QuestionnaireAnswerMergeMode;
};

export type ApplyQuestionnaireAnswerImportResult = {
  answersByKey: Record<string, string>;
  appliedCount: number;
  ignoredCount: number;
  overwrittenCount: number;
};

const SOURCE_LABELS: Record<QuestionnaireAnswerImportSource, string> = {
  userAnswers: '角色卡 userAnswers',
  '_mahoshojo.originalData.userAnswers': '万途往返原始模板 userAnswers',
  'fields.mahoshojoUserAnswers': '万途互通字段 mahoshojoUserAnswers',
  '_mahoshojo.originalData.fields.mahoshojoUserAnswers': '万途往返原始模板互通字段 mahoshojoUserAnswers',
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

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

const readString = (record: Record<string, unknown>, key: string): string | undefined =>
  typeof record[key] === 'string' ? record[key] : undefined;

const normalizeAnswerPayload = (payload: unknown): QuestionnaireAnswerImportEntry[] => {
  if (Array.isArray(payload)) {
    return payload
      .map((item, index): QuestionnaireAnswerImportEntry | null => {
        if (typeof item === 'string') {
          const value = item.trim();
          return value ? { index, value } : null;
        }
        if (!isRecord(item)) {
          const value = coerceAnswerText(item).trim();
          return value ? { index, value } : null;
        }

        const value = coerceAnswerText(item.answer ?? item.value ?? '').trim();
        if (!value) return null;
        return {
          index,
          value,
          key: readString(item, 'key'),
          question: readString(item, 'question'),
          questionId: readString(item, 'questionId'),
          questionnaireId: readString(item, 'questionnaireId'),
          questionnaireTitle: readString(item, 'questionnaireTitle'),
        };
      })
      .filter((item): item is QuestionnaireAnswerImportEntry => Boolean(item));
  }

  if (isRecord(payload)) {
    return Object.entries(payload)
      .map(([entryKey, entryValue], index): QuestionnaireAnswerImportEntry | null => {
        if (isRecord(entryValue)) {
          const value = coerceAnswerText(entryValue.answer ?? entryValue.value ?? '').trim();
          if (!value) return null;
          return {
            index,
            value,
            key: readString(entryValue, 'key') ?? entryKey,
            question: readString(entryValue, 'question') ?? entryKey,
            questionId: readString(entryValue, 'questionId'),
            questionnaireId: readString(entryValue, 'questionnaireId'),
            questionnaireTitle: readString(entryValue, 'questionnaireTitle'),
          };
        }

        const value = coerceAnswerText(entryValue).trim();
        if (!value) return null;
        return {
          index,
          value,
          key: entryKey,
          question: entryKey,
        };
      })
      .filter((item): item is QuestionnaireAnswerImportEntry => Boolean(item));
  }

  return [];
};

export const extractQuestionnaireAnswersFromCharacterCard = (
  input: unknown
): QuestionnaireCharacterAnswerImportResult => {
  if (!isRecord(input)) {
    return { success: false, error: '角色卡 JSON 必须是对象。' };
  }

  const fields = isRecord(input.fields) ? input.fields : undefined;
  const mahoshojo = isRecord(input._mahoshojo) ? input._mahoshojo : undefined;
  const originalData = isRecord(mahoshojo?.originalData) ? mahoshojo.originalData : undefined;
  const originalFields = isRecord(originalData?.fields) ? originalData.fields : undefined;

  const candidates: Array<{ source: QuestionnaireAnswerImportSource; payload: unknown }> = [
    { source: 'userAnswers', payload: input.userAnswers },
    { source: '_mahoshojo.originalData.userAnswers', payload: originalData?.userAnswers },
    { source: 'fields.mahoshojoUserAnswers', payload: fields?.mahoshojoUserAnswers },
    {
      source: '_mahoshojo.originalData.fields.mahoshojoUserAnswers',
      payload: originalFields?.mahoshojoUserAnswers,
    },
  ];

  for (const candidate of candidates) {
    const entries = normalizeAnswerPayload(candidate.payload);
    if (entries.length === 0) continue;
    return {
      success: true,
      source: candidate.source,
      sourceLabel: SOURCE_LABELS[candidate.source],
      entries,
      warnings: [],
    };
  }

  return { success: false, error: '角色卡中没有可导入的问卷答案。' };
};

export const applyQuestionnaireAnswerImportEntries = <T extends QuestionnaireAnswerMatchTarget>({
  currentAnswersByKey,
  targets,
  lookup,
  entries,
  mergeMode,
}: ApplyQuestionnaireAnswerImportInput<T>): ApplyQuestionnaireAnswerImportResult => {
  const answersByKey = { ...currentAnswersByKey };
  let appliedCount = 0;
  let ignoredCount = 0;
  let overwrittenCount = 0;

  for (const entry of entries) {
    const value = entry.value.trim();
    if (!value) {
      ignoredCount += 1;
      continue;
    }

    const hasMetadata = Boolean(
      entry.key || entry.question || entry.questionId || entry.questionnaireId || entry.questionnaireTitle
    );
    const target = hasMetadata
      ? resolveQuestionnaireAnswerTarget(lookup, entry, { allowIndexFallback: false })
      : targets[entry.index] ?? null;

    if (!target) {
      ignoredCount += 1;
      continue;
    }

    const previous = answersByKey[target.key];
    const hasPrevious = typeof previous === 'string' && previous.trim().length > 0;
    if (mergeMode === 'fill-empty' && hasPrevious) {
      continue;
    }

    answersByKey[target.key] = entry.value;
    appliedCount += 1;
    if (hasPrevious) overwrittenCount += 1;
  }

  return {
    answersByKey,
    appliedCount,
    ignoredCount,
    overwrittenCount,
  };
};
