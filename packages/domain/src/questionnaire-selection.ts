// 问卷选择（QuestionnaireSelection）的纯状态机。
//
// 这段语义此前在 DetailsPage / CreatorPage / CanshouPage / SublimationPage 各自
// 手抄了一份（selectionId 去重、多选追加/替换、单选收敛、Lore 开关、问卷变更后
// 的答案键重映射）。抽出后各页面只持有一份实现，Desktop 也消费同一模块。

import {
  buildQuestionKey,
  collectStoredQuestionnaireAnswerItems,
  type QuestionnaireDefinition,
  type QuestionnaireQuestion,
} from './questionnaire-definition';
import {
  resolveQuestionnaireAnswerTarget,
  type QuestionnaireAnswerLookup,
  type QuestionnaireAnswerMatchTarget,
} from './questionnaire';

export type QuestionnaireSelectionSource = 'preset' | 'upload' | 'database';

export interface QuestionnaireSelection {
  source: QuestionnaireSelectionSource;
  questionnaire: QuestionnaireDefinition;
  dataCardId?: string;
  dataCardName?: string;
  dataCardAuthor?: string;
  selectionId?: string;
  useLore?: boolean;
}

/** 多问卷扁平化后的一道题的最小上下文。 */
export interface QuestionnaireContextItem {
  key: string;
  questionnaireId: string;
  questionnaireScopeId: string;
  questionnaireTitle: string;
  indexInQuestionnaire: number;
  question: QuestionnaireQuestion;
}

/** selectionId 撞名时的后缀工厂。由宿主注入以保持本包不触达 crypto/DOM。 */
export type QuestionnaireSelectionIdFactory = () => string;

export const questionnaireSelectionScopeId = (selection: QuestionnaireSelection): string =>
  selection.selectionId ?? selection.questionnaire.id;

export const ensureQuestionnaireSelectionId = (
  selection: QuestionnaireSelection,
  used: Set<string>,
  createSuffix: QuestionnaireSelectionIdFactory,
): QuestionnaireSelection => {
  const base = selection.questionnaire.id || 'questionnaire';
  let nextId = typeof selection.selectionId === 'string' ? selection.selectionId.trim() : '';
  if (!nextId) {
    nextId = used.has(base) ? `${base}::${createSuffix()}` : base;
  } else if (used.has(nextId)) {
    nextId = `${base}::${createSuffix()}`;
  }
  used.add(nextId);
  return { ...selection, selectionId: nextId };
};

export const collectUsedQuestionnaireSelectionIds = (
  selections: readonly QuestionnaireSelection[],
): Set<string> => {
  const used = new Set<string>();
  selections.forEach((item) => {
    const existingId = item.selectionId || item.questionnaire.id;
    if (existingId) used.add(existingId);
  });
  return used;
};

/**
 * 追加一份问卷选择。
 * - `allowMultiple === true`：直接追加（selectionId 已由调用方 ensure 过或在此 ensure）；
 * - 单选模式：有题目的新问卷替换既有可作答问卷、保留纯 Lore 卡；
 *   纯 Lore 新问卷附加到现有选择之后；两者皆空则替换整个列表。
 */
export const applyQuestionnaireSelection = (
  selections: readonly QuestionnaireSelection[],
  selection: QuestionnaireSelection,
  options: {
    allowMultiple: boolean;
    used?: Set<string>;
    createSuffix?: QuestionnaireSelectionIdFactory;
  },
): QuestionnaireSelection[] => {
  const used = options.used ?? collectUsedQuestionnaireSelectionIds(selections);
  const normalizedSelection = ensureQuestionnaireSelectionId(
    selection,
    used,
    options.createSuffix ?? (() => String(used.size)),
  );

  if (options.allowMultiple) {
    return [...selections, normalizedSelection];
  }

  const hasQuestions = normalizedSelection.questionnaire.questions.length > 0;
  const hasLore = Boolean(normalizedSelection.questionnaire.loreMarkdown?.trim());
  const isLoreOnly = !hasQuestions && hasLore;

  if (hasQuestions) {
    const preservedLoreOnly = selections.filter((item) => item.questionnaire.questions.length === 0);
    return [normalizedSelection, ...preservedLoreOnly];
  }
  if (isLoreOnly && selections.length > 0) {
    return [...selections, normalizedSelection];
  }
  return [normalizedSelection];
};

export const removeQuestionnaireSelection = (
  selections: readonly QuestionnaireSelection[],
  selectionId: string,
): QuestionnaireSelection[] =>
  selections.filter((item) => (item.selectionId ?? item.questionnaire.id) !== selectionId);

export const setQuestionnaireSelectionLore = (
  selections: readonly QuestionnaireSelection[],
  selectionId: string,
  enabled: boolean,
): QuestionnaireSelection[] =>
  selections.map((item) => {
    const id = item.selectionId ?? item.questionnaire.id;
    if (id !== selectionId) return item;
    return { ...item, useLore: enabled };
  });

/**
 * 单选模式收敛：当 `allowMultiple` 关闭时，只保留第一份可作答问卷与全部纯 Lore 卡。
 * 返回 `null` 表示无需调整；否则返回收敛后的新列表。
 */
export const reconcileQuestionnaireSelectionsForSingleMode = (
  selections: readonly QuestionnaireSelection[],
): QuestionnaireSelection[] | null => {
  if (selections.length <= 1) return null;
  const firstAnswerableIndex = selections.findIndex(
    (selection) => selection.questionnaire.questions.length > 0,
  );
  if (firstAnswerableIndex < 0) return null;
  const hasExtraAnswerable = selections.some(
    (selection, index) => index !== firstAnswerableIndex && selection.questionnaire.questions.length > 0,
  );
  if (!hasExtraAnswerable) return null;
  return selections.filter(
    (selection, index) => selection.questionnaire.questions.length === 0 || index === firstAnswerableIndex,
  );
};

/** 问卷集合变化后的答案重映射：旧 key 无法直接复用时按元数据匹配到新 key。 */
export const remapAnswersToQuestionnaireChange = <T extends QuestionnaireAnswerMatchTarget>(input: {
  previousTargets: readonly T[];
  answersByKey: Readonly<Record<string, string>>;
  lookup: QuestionnaireAnswerLookup<T>;
}): Record<string, string> => {
  const previousEntries = collectStoredQuestionnaireAnswerItems(
    [...input.previousTargets],
    input.answersByKey as Record<string, string>,
  );
  if (previousEntries.length === 0) return {};

  const nextAnswers: Record<string, string> = {};
  previousEntries.forEach((entry, index) => {
    const target = resolveQuestionnaireAnswerTarget(
      input.lookup,
      { ...entry, index },
      { allowIndexFallback: false },
    );
    if (!target) return;
    nextAnswers[target.key] = entry.answer;
  });
  return nextAnswers;
};

/** `selectedQuestionnaires.flatMap(selection => questions.map(...))` 的统一实现。 */
export const buildQuestionnaireContextItems = (
  selections: readonly QuestionnaireSelection[],
): QuestionnaireContextItem[] =>
  selections.flatMap((selection) =>
    selection.questionnaire.questions.map((question, index) => {
      const questionnaireScopeId = questionnaireSelectionScopeId(selection);
      return {
        key: buildQuestionKey(questionnaireScopeId, question.id, index),
        questionnaireId: selection.questionnaire.id,
        questionnaireScopeId,
        questionnaireTitle: selection.questionnaire.title,
        indexInQuestionnaire: index,
        question,
      };
    }),
  );

/** 所有可作答/被引用的问卷都声明 `nativeAllowed === true` 时才允许原生签名路径。 */
export const isQuestionnaireSelectionNativeAllowed = (
  selections: readonly QuestionnaireSelection[],
): boolean => {
  if (selections.length === 0) return false;
  return selections.every((selection) => {
    const hasQuestions = selection.questionnaire.questions.length > 0;
    const hasLore = Boolean(selection.questionnaire.loreMarkdown?.trim());
    const usesLore = hasLore && selection.useLore !== false;
    if (!hasQuestions && !usesLore) return true;
    return selection.questionnaire.nativeAllowed === true;
  });
};

/** 选择级 Lore 拼接：「使用设定」为 false 的卡不进入提示词。 */
export const buildQuestionnaireSelectionLoreText = (
  selections: readonly QuestionnaireSelection[],
): string =>
  buildQuestionnaireLoreText(
    selections
      .filter((selection) => selection.useLore !== false)
      .map((selection) => ({
        title: selection.questionnaire.title,
        loreMarkdown: selection.questionnaire.loreMarkdown,
      })),
  );

/**
 * Lore 文本拼接的通用实现：`【设定来源：title】\nlore` 块以空行连接。
 * hosted-runtime 的请求级实现与本函数共享同一语义。
 */
export const buildQuestionnaireLoreText = (
  questionnaires: ReadonlyArray<{ title: string; loreMarkdown?: string | null }>,
): string =>
  questionnaires
    .flatMap((questionnaire) => {
      const lore = questionnaire.loreMarkdown?.trim() ?? '';
      return lore ? [`【设定来源：${questionnaire.title}】\n${lore}`] : [];
    })
    .join('\n\n');

export type StoredQuestionnaireSelectionFallback = {
  fallbackKind: QuestionnaireDefinition['kind'];
  fallbackId: string;
  fallbackTitle: string;
  nativeAllowed: boolean;
};

export interface StoredQuestionnaireSelectionFallbackResolver {
  (
    rawQuestionnaire: unknown,
    source: QuestionnaireSelectionSource,
  ): StoredQuestionnaireSelectionFallback;
}

export interface QuestionnaireDefinitionNormalizer {
  (
    value: unknown,
    fallback: StoredQuestionnaireSelectionFallback,
  ): QuestionnaireDefinition | null;
}

/**
 * 反序列化偏好里的问卷选择条目。任何字段不合法都返回 `null` 由调用方丢弃，
 * 与页面端“损坏的偏好不得静默带病恢复”一致。
 *
 * - `nativeAllowed` 缺省按来源推导：preset 默认 true、upload 默认 false、
 *   database 取问卷自身声明（无声明归 false 由本函数兜底）；
 * - `resolveFallback` 由调用方决定 kind/id/title 的兜底（如按 raw.kind 区分
 *   magical-girl 与 canshou 页面）。
 */
export const normalizeStoredQuestionnaireSelection = (
  raw: unknown,
  options: {
    resolveFallback: StoredQuestionnaireSelectionFallbackResolver;
    normalize: QuestionnaireDefinitionNormalizer;
  },
): QuestionnaireSelection | null => {
  if (!raw || typeof raw !== 'object') return null;
  const rawRecord = raw as Record<string, unknown>;
  const source: QuestionnaireSelectionSource =
    rawRecord.source === 'upload' || rawRecord.source === 'database' || rawRecord.source === 'preset'
      ? rawRecord.source
      : 'preset';
  const fallback = options.resolveFallback(rawRecord.questionnaire, source);
  const normalized = options.normalize(rawRecord.questionnaire, fallback);
  if (!normalized) return null;
  if (source === 'database' && normalized.nativeAllowed == null) normalized.nativeAllowed = false;
  return {
    source,
    questionnaire: normalized,
    dataCardId: typeof rawRecord.dataCardId === 'string' ? rawRecord.dataCardId : undefined,
    dataCardName: typeof rawRecord.dataCardName === 'string' ? rawRecord.dataCardName : undefined,
    dataCardAuthor: typeof rawRecord.dataCardAuthor === 'string' ? rawRecord.dataCardAuthor : undefined,
    selectionId: typeof rawRecord.selectionId === 'string' ? rawRecord.selectionId : undefined,
    useLore: typeof rawRecord.useLore === 'boolean' ? rawRecord.useLore : undefined,
  };
};

/**
 * 按来源推导 `nativeAllowed` 缺省值的工具：preset 默认 true、upload 默认 false、
 * database 以问卷自身声明为准（无声明 false）。配合
 * `createStoredQuestionnaireSelectionNormalizer` 使用。
 */
export const resolveQuestionnaireSelectionNativeAllowedFallback = (
  source: QuestionnaireSelectionSource,
  rawQuestionnaire: unknown,
): boolean => {
  const declared = rawQuestionnaire && typeof rawQuestionnaire === 'object'
    ? (rawQuestionnaire as { nativeAllowed?: unknown }).nativeAllowed
    : undefined;
  if (source === 'preset') {
    return typeof declared === 'boolean' ? declared : true;
  }
  if (source === 'upload') return false;
  return typeof declared === 'boolean' ? declared : false;
};

/** 默认预设挑选：优先 `isDefault`，否则第一个；可选 `kind` 过滤。 */
export const pickDefaultQuestionnairePresetEntry = <T extends { kind: string; isDefault?: boolean }>(
  entries: readonly T[],
  kind?: string,
): T | null => {
  const candidates = kind ? entries.filter((entry) => entry.kind === kind) : [...entries];
  if (candidates.length === 0) return null;
  return candidates.find((entry) => entry.isDefault) ?? candidates[0];
};

/** `fallbackKind` 可为常量或按 raw 问卷动态判定（如升华页按 raw.kind 区分模板）。 */
export interface QuestionnaireSelectionFallbackKindResolver {
  (rawQuestionnaire: unknown): QuestionnaireDefinition['kind'];
}

/**
 * 为页面/会话层生成偏好恢复用的 selection 归一化器。
 */
export const createStoredQuestionnaireSelectionNormalizer = (config: {
  fallbackKind:
    | QuestionnaireDefinition['kind']
    | QuestionnaireSelectionFallbackKindResolver;
  fallbackIdSuffix?: string;
  normalize: QuestionnaireDefinitionNormalizer;
}) => {
  const suffix = config.fallbackIdSuffix ?? 'custom';
  return (raw: unknown): QuestionnaireSelection | null =>
    normalizeStoredQuestionnaireSelection(raw, {
      resolveFallback: (rawQuestionnaire, source) => {
        const rec = rawQuestionnaire && typeof rawQuestionnaire === 'object'
          ? (rawQuestionnaire as { id?: unknown; title?: unknown })
          : null;
        const kind = typeof config.fallbackKind === 'function'
          ? config.fallbackKind(rawQuestionnaire)
          : config.fallbackKind;
        return {
          fallbackKind: kind,
          fallbackId: typeof rec?.id === 'string' ? rec.id : `${kind}-${suffix}`,
          fallbackTitle: typeof rec?.title === 'string' ? rec.title : '未命名问卷',
          nativeAllowed: resolveQuestionnaireSelectionNativeAllowedFallback(source, rawQuestionnaire),
        };
      },
      normalize: config.normalize,
    });
};
