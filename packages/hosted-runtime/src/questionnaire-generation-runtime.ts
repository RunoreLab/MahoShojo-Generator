import {
  buildQuestionnaireAnswerLookup,
  getAnswerLimitInfo,
  isAnswerOverLimit,
  normalizeUserAnswers,
  resolveQuestionnaireAnswerTarget,
  type QuestionnaireAnswerItem,
} from '@mahoshojo/domain/questionnaire';

export type RequestQuestion = {
  id: string;
  question: string;
  required: boolean;
  maxLength: number | null;
};

export type RequestQuestionnaire = {
  id: string;
  title: string;
  kind: 'magical-girl' | 'canshou';
  questions: RequestQuestion[];
  loreMarkdown?: string;
};

export type QuestionnaireSelectionSource = 'preset' | 'upload' | 'database';

export type RequestQuestionnaireSelection = {
  source: QuestionnaireSelectionSource;
  kind: 'magical-girl' | 'canshou';
  presetId?: string;
  dataCardId?: string;
  useLore?: boolean;
};

export type QuestionnairePresetIndexEntry = {
  id: string;
  kind: 'magical-girl' | 'canshou';
  path: string;
};

export type QuestionnaireDataCard = {
  type?: unknown;
  data?: unknown;
} | null;

export const normalizePresetEntries = (raw: unknown): QuestionnairePresetIndexEntry[] => {
  const entries = raw && typeof raw === 'object'
    ? (raw as { presets?: unknown }).presets
    : null;
  if (!Array.isArray(entries)) return [];
  return entries.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const record = item as Record<string, unknown>;
    const id = typeof record.id === 'string' ? record.id.trim() : '';
    const kind = record.kind === 'magical-girl' || record.kind === 'canshou'
      ? record.kind
      : null;
    const path = typeof record.path === 'string' ? record.path.trim() : '';
    return id && kind && path ? [{ id, kind, path }] : [];
  });
};

export const normalizeQuestionnaireSelections = (
  raw: unknown,
): RequestQuestionnaireSelection[] => {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const record = item as Record<string, unknown>;
    const source = record.source === 'preset'
      || record.source === 'upload'
      || record.source === 'database'
      ? record.source
      : null;
    const kind = record.kind === 'magical-girl' || record.kind === 'canshou'
      ? record.kind
      : null;
    if (!source || !kind) return [];

    const presetId = typeof record.presetId === 'string' ? record.presetId.trim() : '';
    const dataCardId = typeof record.dataCardId === 'string' ? record.dataCardId.trim() : '';
    const useLore = typeof record.useLore === 'boolean' ? record.useLore : undefined;
    return [{
      source,
      kind,
      ...(presetId ? { presetId } : {}),
      ...(dataCardId ? { dataCardId } : {}),
      ...(typeof useLore === 'boolean' ? { useLore } : {}),
    }];
  });
};

export const normalizeQuestionnaires = (raw: unknown): RequestQuestionnaire[] => {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const record = item as Record<string, unknown>;
    const kind = record.kind === 'magical-girl' || record.kind === 'canshou'
      ? record.kind
      : null;
    const id = typeof record.id === 'string' ? record.id.trim() : '';
    const title = typeof record.title === 'string' ? record.title.trim() : '';
    if (!kind || !id || !title) return [];

    const useLore = typeof record.useLore === 'boolean' ? record.useLore : true;
    const loreMarkdown = useLore
      && typeof record.loreMarkdown === 'string'
      && record.loreMarkdown.trim()
      ? record.loreMarkdown
      : undefined;
    const rawQuestions = Array.isArray(record.questions) ? record.questions : [];
    const questions = rawQuestions.map((question, index): RequestQuestion => {
      if (!question || typeof question !== 'object') {
        return {
          id: `Q-${index + 1}`,
          question: `问题 ${index + 1}`,
          required: false,
          maxLength: null,
        };
      }
      const questionRecord = question as Record<string, unknown>;
      const questionId = typeof questionRecord.id === 'string' && questionRecord.id.trim()
        ? questionRecord.id.trim()
        : `Q-${index + 1}`;
      const questionText = typeof questionRecord.question === 'string' && questionRecord.question.trim()
        ? questionRecord.question.trim()
        : `问题 ${index + 1}`;
      const required = typeof questionRecord.required === 'boolean'
        ? questionRecord.required
        : false;
      const maxLength = typeof questionRecord.maxLength === 'number'
        && Number.isFinite(questionRecord.maxLength)
        ? Math.max(0, Math.floor(questionRecord.maxLength))
        : null;
      return { id: questionId, question: questionText, required, maxLength };
    });

    return [{
      id,
      title,
      kind,
      questions,
      ...(loreMarkdown ? { loreMarkdown } : {}),
    }];
  });
};

export const buildQuestionnaireLoreText = (
  questionnaires: RequestQuestionnaire[],
): string => questionnaires
  .flatMap((questionnaire) => {
    const lore = questionnaire.loreMarkdown?.trim() ?? '';
    return lore ? [`【设定来源：${questionnaire.title}】\n${lore}`] : [];
  })
  .join('\n\n');

export const extractAnswerQuestionnaireIds = (rawAnswers: unknown): Set<string> => {
  const ids = new Set<string>();
  normalizeUserAnswers(rawAnswers, []).forEach((item) => {
    const id = item.questionnaireId?.trim() ?? '';
    if (id) ids.add(id);
  });
  return ids;
};

type QuestionLookupItem = RequestQuestion & {
  key: string;
  index: number;
  questionId: string;
  questionnaireId: string;
  questionnaireTitle: string;
};

const buildQuestionLookup = (questionnaires: RequestQuestionnaire[]) => {
  const ordered: QuestionLookupItem[] = [];
  questionnaires.forEach((questionnaire) => {
    questionnaire.questions.forEach((question) => {
      ordered.push({
        ...question,
        key: `${questionnaire.id}::${question.id}`,
        index: ordered.length,
        questionId: question.id,
        questionnaireId: questionnaire.id,
        questionnaireTitle: questionnaire.title,
      });
    });
  });
  return buildQuestionnaireAnswerLookup(ordered);
};

const resolveLookupQuestion = (
  lookup: ReturnType<typeof buildQuestionLookup>,
  item: QuestionnaireAnswerItem,
  index: number,
) => resolveQuestionnaireAnswerTarget(
  lookup,
  {
    question: item.question,
    questionId: item.questionId,
    questionnaireId: item.questionnaireId,
    questionnaireTitle: item.questionnaireTitle,
    index,
  },
  { allowIndexFallback: true },
);

type LegacyQuestionLookupItem = RequestQuestion & {
  questionnaireId: string;
  questionnaireTitle: string;
};

const buildLegacyQuestionLookup = (questionnaires: RequestQuestionnaire[]) => {
  const byId = new Map<string, LegacyQuestionLookupItem>();
  const byCompositeId = new Map<string, LegacyQuestionLookupItem>();
  const byQuestion = new Map<string, LegacyQuestionLookupItem>();
  const ordered: LegacyQuestionLookupItem[] = [];
  questionnaires.forEach((questionnaire) => {
    questionnaire.questions.forEach((question) => {
      const payload = {
        ...question,
        questionnaireId: questionnaire.id,
        questionnaireTitle: questionnaire.title,
      };
      ordered.push(payload);
      byCompositeId.set(`${questionnaire.id}::${question.id}`, payload);
      if (!byId.has(question.id)) byId.set(question.id, payload);
      const textKey = question.question.trim();
      if (textKey && !byQuestion.has(textKey)) byQuestion.set(textKey, payload);
    });
  });
  return { byId, byCompositeId, byQuestion, ordered };
};

const resolveLegacyLookupQuestion = (
  lookup: ReturnType<typeof buildLegacyQuestionLookup>,
  item: QuestionnaireAnswerItem,
  index: number,
) => {
  if (item.questionnaireId && item.questionId) {
    const composite = lookup.byCompositeId.get(
      `${item.questionnaireId}::${item.questionId}`,
    );
    if (composite) return composite;
  }
  if (item.questionId) {
    const byId = lookup.byId.get(item.questionId);
    if (byId) return byId;
  }
  if (item.question) {
    const byQuestion = lookup.byQuestion.get(item.question.trim());
    if (byQuestion) return byQuestion;
  }
  return lookup.ordered[index] ?? null;
};

export const resolveAnswerItems = (
  rawAnswers: unknown,
  questionnaires: RequestQuestionnaire[],
  options: {
    preferResolvedQuestionText?: boolean;
    lookupMode?: 'stable' | 'legacy-first-match';
  } = {},
): QuestionnaireAnswerItem[] => {
  const fallbackQuestions = questionnaires.flatMap((questionnaire) => (
    questionnaire.questions.map((question) => question.question)
  ));
  const normalized = normalizeUserAnswers(rawAnswers, fallbackQuestions);
  if (normalized.length === 0) return [];
  const preferResolved = options.preferResolvedQuestionText === true;
  const lookup = buildQuestionLookup(questionnaires);
  const legacyLookup = options.lookupMode === 'legacy-first-match'
    ? buildLegacyQuestionLookup(questionnaires)
    : null;
  return normalized.flatMap((item, index) => {
    const answer = item.answer?.trim() ?? '';
    if (!answer) return [];
    const resolved = legacyLookup
      ? resolveLegacyLookupQuestion(legacyLookup, item, index)
      : resolveLookupQuestion(lookup, item, index);
    if (preferResolved && !resolved) return [];
    const resolvedQuestionId = resolved
      ? 'questionId' in resolved
        ? (resolved as QuestionLookupItem).questionId
        : resolved.id
      : undefined;
    return [{
      question: preferResolved
        ? resolved!.question
        : item.question?.trim() || resolved?.question || `问题 ${index + 1}`,
      answer,
      questionId: preferResolved ? resolvedQuestionId : item.questionId ?? resolvedQuestionId,
      questionnaireId: preferResolved
        ? resolved!.questionnaireId
        : item.questionnaireId ?? resolved?.questionnaireId,
      questionnaireTitle: preferResolved
        ? resolved!.questionnaireTitle
        : item.questionnaireTitle ?? resolved?.questionnaireTitle,
    }];
  });
};

export const findOverLimitAnswer = (
  items: QuestionnaireAnswerItem[],
  questionnaires: RequestQuestionnaire[],
) => {
  if (items.length === 0) return null;
  const lookup = buildQuestionLookup(questionnaires);
  for (const [index, item] of items.entries()) {
    if (!item.answer) continue;
    const resolved = resolveLookupQuestion(lookup, item, index);
    if (!isAnswerOverLimit(item.answer, resolved?.maxLength ?? null)) continue;
    const limitInfo = getAnswerLimitInfo(resolved?.maxLength ?? null);
    return {
      questionLabel: resolved?.question || item.question || `问题 ${index + 1}`,
      limit: limitInfo.limit ?? 0,
      length: item.answer.length,
      source: limitInfo.source,
    };
  }
  return null;
};

const isSafePresetPath = (path: string): boolean => {
  const normalized = path.trim();
  return normalized.startsWith('/questionnaires/presets/')
    && normalized.endsWith('.json')
    && !normalized.includes('..');
};

type ResolveNativeQuestionnairesOptions = {
  requestUrl: string;
  selections: RequestQuestionnaireSelection[];
  requiredQuestionnaireIds: Set<string>;
  presetEntries: QuestionnairePresetIndexEntry[];
  loadPreset(_requestUrl: string, _path: string): Promise<unknown>;
  loadDataCard(_id: string): Promise<QuestionnaireDataCard>;
};

const deniedNativeQuestionnaires = () => ({
  allowed: false as const,
  questionnaires: [] as RequestQuestionnaire[],
});

export const resolveNativeQuestionnaires = async ({
  requestUrl,
  selections,
  requiredQuestionnaireIds,
  presetEntries,
  loadPreset,
  loadDataCard,
}: ResolveNativeQuestionnairesOptions): Promise<{
  allowed: boolean;
  questionnaires: RequestQuestionnaire[];
}> => {
  if (selections.length === 0) return deniedNativeQuestionnaires();

  const canIgnoreUntrusted = requiredQuestionnaireIds.size > 0;
  const payloads: unknown[] = [];
  const metas: Array<{ useLore?: boolean }> = [];
  for (const selection of selections) {
    const useLore = selection.useLore;
    if (selection.source === 'preset') {
      const presetId = selection.presetId?.trim() ?? '';
      const presetEntry = presetEntries.find((entry) => (
        entry.kind === selection.kind && entry.id === presetId
      ));
      if (!presetEntry || !isSafePresetPath(presetEntry.path)) {
        return deniedNativeQuestionnaires();
      }
      const presetPayload = await loadPreset(requestUrl, presetEntry.path);
      const presetRecord = presetPayload && typeof presetPayload === 'object'
        ? presetPayload as Record<string, unknown>
        : null;
      const questionnaireId = typeof presetRecord?.id === 'string'
        ? presetRecord.id.trim()
        : '';
      if (presetRecord?.nativeAllowed === false) {
        if (
          canIgnoreUntrusted
          && useLore === false
          && questionnaireId
          && !requiredQuestionnaireIds.has(questionnaireId)
        ) {
          continue;
        }
        return deniedNativeQuestionnaires();
      }
      payloads.push(presetPayload);
      metas.push({ useLore });
      continue;
    }

    if (selection.source === 'database') {
      const dataCardId = selection.dataCardId?.trim() ?? '';
      if (!dataCardId) return deniedNativeQuestionnaires();
      const card = await loadDataCard(dataCardId);
      if (card?.type !== 'questionnaire' || typeof card.data !== 'string') {
        return deniedNativeQuestionnaires();
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(card.data);
      } catch {
        return deniedNativeQuestionnaires();
      }
      const record = parsed && typeof parsed === 'object'
        ? parsed as Record<string, unknown>
        : null;
      const questionnaireId = typeof record?.id === 'string' ? record.id.trim() : '';
      if (!questionnaireId) return deniedNativeQuestionnaires();
      if (record?.nativeAllowed !== true) {
        if (
          canIgnoreUntrusted
          && useLore === false
          && !requiredQuestionnaireIds.has(questionnaireId)
        ) {
          continue;
        }
        return deniedNativeQuestionnaires();
      }
      payloads.push(parsed);
      metas.push({ useLore });
      continue;
    }

    if (canIgnoreUntrusted && useLore === false) continue;
    return deniedNativeQuestionnaires();
  }

  if (payloads.length === 0) return deniedNativeQuestionnaires();
  const normalized = normalizeQuestionnaires(payloads);
  if (normalized.length !== payloads.length) return deniedNativeQuestionnaires();

  if (canIgnoreUntrusted) {
    const loadedIds = new Set(normalized.map((questionnaire) => questionnaire.id));
    for (const requiredId of requiredQuestionnaireIds) {
      if (!loadedIds.has(requiredId)) return deniedNativeQuestionnaires();
    }
  }

  return {
    allowed: true,
    questionnaires: normalized.map((questionnaire, index) => (
      metas[index]?.useLore === false
        ? { ...questionnaire, loreMarkdown: undefined }
        : questionnaire
    )),
  };
};
