import {
  buildQuestionKey,
  normalizeQuestionnaireDefinition,
  type QuestionnaireDefinition,
  type QuestionnaireQuestion,
} from '@mahoshojo/domain/questionnaire-definition';
import type { QuestionnaireAnswerItem } from '@mahoshojo/domain/questionnaire';
import {
  resolveQuestionnaireSelectionNativeAllowedFallback,
  type QuestionnaireSelection,
  type QuestionnaireSelectionSource,
} from '@mahoshojo/domain/questionnaire-selection';
import type { BattleSelectionPayload, CardLibrarySelectionContext } from '@mahoshojo/ui-web/card-library';

/**
 * /details 问卷定义（D5.0e）。
 *
 * 与 Web 共用 `@mahoshojo/domain/questionnaire-definition`：内置预设与数据卡
 * 问卷走同一个 `normalizeQuestionnaireDefinition`，条件题/跳题/选项引用的语义
 * 与 Web 既有产品一致——不另起 Desktop 问卷体系。
 */
export type DetailsQuestionnaire = QuestionnaireDefinition;
export type DetailsQuestion = QuestionnaireQuestion;

/**
 * 逐题流条目：key 由 `buildQuestionKey` 产出（`questionnaireScopeId::questionId`）。
 * scopeId 是「这一次选中」的实例标识（`CardLibrarySelectionContext.selectionId`），
 * 与 Web `DetailsPage`/`CreatorPage`/`CanshouPage` 的 `questionnaireScopeId` 同一口径——
 * 同一 canonical 问卷的云端卡与本地副本、或重复选中，各产各的答案键，
 * 草稿回答、条件判定与最终答案收集都按实例隔离（D5.0e-r1）。
 */
export interface DetailsFlowItem {
  key: string;
  questionnaireId: string;
  questionnaireScopeId: string;
  questionnaireTitle: string;
  question: QuestionnaireQuestion;
}

export const buildDetailsFlowItems = (
  questionnaire: DetailsQuestionnaire,
  questionnaireScopeId?: string,
): DetailsFlowItem[] => {
  const scopeId = questionnaireScopeId?.trim() || questionnaire.id;
  return questionnaire.questions.map((question, index) => ({
    key: buildQuestionKey(scopeId, question.id, index),
    questionnaireId: questionnaire.id,
    questionnaireScopeId: scopeId,
    questionnaireTitle: questionnaire.title,
    question,
  }));
};

/**
 * 问卷数据卡的当前选择来源；`cardId` 只存在于云端卡——本地卡没有服务器身份。
 * `selectionId` 是选中实例的作用域标识（`cloud:<id>` / `local:<recordId>` /
 * `builtin:<questionnaireId>`），决定答案键的隔离边界。
 */
export interface QuestionnaireSource {
  kind: 'builtin' | 'local' | 'cloud';
  title: string;
  cardId?: string;
  selectionId: string;
}

/** 内置问卷的选中作用域：与云/本地副本的稳定 key 形态一致（`builtin:<id>`）。 */
export const builtinSelectionId = (questionnaireId: string): string => `builtin:${questionnaireId}`;

const DEFAULT_SOURCE: Omit<QuestionnaireSource, 'selectionId'> = { kind: 'builtin', title: '' };

/** 数据卡选择载荷 → 问卷定义；非法正文返回错误文案而不是静默回退。 */
export const parseQuestionnaireSelection = (
  payload: BattleSelectionPayload,
  context?: CardLibrarySelectionContext,
): { questionnaire: DetailsQuestionnaire; source: QuestionnaireSource } | { error: string } => {
  if (payload._cardType !== 'questionnaire') {
    return { error: '这张数据卡不是问卷。' };
  }
  const cardName = typeof payload._cardName === 'string' && payload._cardName.trim()
    ? payload._cardName.trim()
    : '未命名问卷';
  const isLocal = payload._storageLocation === 'local';
  // `nativeAllowed` 只决定签名资格、不决定可用性：本地副本按 upload 语义恒 false，
  // 云端卡按 database 语义取声明值（未声明 false），与 Web/hosted-runtime 同一口径。
  const questionnaire = normalizeQuestionnaireDefinition(payload, {
    fallbackId: typeof payload._cardId === 'string' && payload._cardId ? `card-${payload._cardId}` : 'custom-questionnaire',
    fallbackKind: 'magical-girl',
    fallbackTitle: cardName,
    nativeAllowed: resolveQuestionnaireSelectionNativeAllowedFallback(
      isLocal ? 'upload' : 'database',
      payload,
    ),
  });
  if (!questionnaire || questionnaire.questions.length === 0) {
    return { error: '这张问卷数据卡没有可用题目。' };
  }
  // `normalizeQuestionnaireDefinition` dá precedência ao valor declarado no registro;
  // uma cópia local não tem servidor para atestar, então o upload é SEMPRE não-nativo —
  // reforço pós-normalize contra card editado declarando nativeAllowed:true.
  if (isLocal) questionnaire.nativeAllowed = false;
  // selectionId 是宿主给的权威实例作用域（`local:<recordId>`/`cloud:<cardId>`）；
  // 缺上下文时按来源种类 + canonical id 兜底，仍保证云/本地副本互不错投。
  const fallbackScopeId = isLocal
    ? `local:${questionnaire.id}`
    : `cloud:${String(payload._cardId ?? '') || questionnaire.id}`;
  const selectionId = (typeof context?.selectionId === 'string' && context.selectionId.trim())
    ? context.selectionId.trim()
    : fallbackScopeId;
  return {
    questionnaire,
    source: {
      kind: isLocal ? 'local' : 'cloud',
      title: cardName,
      // 本地选择绝不携带服务器身份（DESK-ONLINE-010）。
      ...(isLocal ? {} : { cardId: String(payload._cardId ?? '') }),
      selectionId,
    },
  };
};

export const loadDefaultQuestionnaire = async (signal: AbortSignal): Promise<DetailsQuestionnaire> => {
  const response = await fetch('/questionnaires/presets/magical-girl-default.json', { signal, credentials: 'omit', redirect: 'error' });
  if (!response.ok) throw new Error('内置问卷加载失败，请重试。');
  const raw: unknown = await response.json();
  const questionnaire = normalizeQuestionnaireDefinition(raw, {
    fallbackId: 'magical-girl-default',
    fallbackKind: 'magical-girl',
    // 内置预设与 Web preset 同源口径：未声明 nativeAllowed 按原生许可计。
    nativeAllowed: resolveQuestionnaireSelectionNativeAllowedFallback('preset', raw),
  });
  if (!questionnaire || questionnaire.id !== 'magical-girl-default') {
    throw new Error('内置问卷无法读取，请重新安装或更新客户端。');
  }
  return questionnaire;
};

export const builtinQuestionnaireSource = (questionnaire: DetailsQuestionnaire): QuestionnaireSource => ({
  ...DEFAULT_SOURCE,
  title: questionnaire.title,
  selectionId: builtinSelectionId(questionnaire.id),
});

/**
 * Desktop 选择来源 → wire `source` 语义。
 * - `builtin` → `preset`（内置即官方预设，服务端按 presetId 回读核对）；
 * - `cloud` → `database`（携带 `dataCardId`，服务器可回读核对 nativeAllowed）；
 * - `local` → `upload`（本地库卡没有服务器身份，走 untrusted 嵌入路径）。
 */
export const detailsSelectionSource = (source: QuestionnaireSource): QuestionnaireSelectionSource =>
  source.kind === 'builtin' ? 'preset' : source.kind === 'cloud' ? 'database' : 'upload';

/**
 * Desktop 选择来源 → 共源 `QuestionnaireSelection`（D5.1a）。
 * hosted 请求字段经 `buildQuestionnaireGenerationRequestFields` 投影，
 * 与 Web `DetailsPage` 同一构造器。
 */
export const toQuestionnaireSelection = (
  source: QuestionnaireSource,
  questionnaire: DetailsQuestionnaire,
  useLore?: boolean,
): QuestionnaireSelection => ({
  source: detailsSelectionSource(source),
  questionnaire,
  ...(source.kind === 'cloud' && source.cardId ? { dataCardId: source.cardId } : {}),
  ...(source.kind !== 'builtin' ? { dataCardName: source.title } : {}),
  selectionId: source.selectionId,
  ...(useLore !== undefined ? { useLore } : {}),
});

/** 多问卷展平后的逐题流条目：各 selection 用自己的实例作用域产 key。 */
export const buildSelectionFlowItems = (
  entries: ReadonlyArray<{ source: QuestionnaireSource; questionnaire: DetailsQuestionnaire }>,
): DetailsFlowItem[] =>
  entries.flatMap(({ source, questionnaire }) =>
    buildDetailsFlowItems(questionnaire, source.selectionId));

const isOptionAllowed = (question: QuestionnaireQuestion, answer: string): boolean =>
  question.options?.some((option) =>
    typeof option === 'string' ? option === answer : !option.disabled && option.value === answer) ?? false;

/**
 * 从流程条目与按键回答收集生成载荷。
 *
 * 只收集当前可见流程内的题目（displayIf/jump 已按回答求值），与 Web
 * `collectStoredQuestionnaireAnswerItems` 同一口径；`allowCustom === false`
 * 的题只接受可用选项，避免把键盘输入混进封闭题。
 */
export const buildDetailsAnswers = (
  flow: readonly DetailsFlowItem[],
  answersByKey: Record<string, string>,
): QuestionnaireAnswerItem[] => {
  const items = flow.flatMap((item) => {
    const answer = answersByKey[item.key]?.trim() ?? '';
    if (!answer) return [];
    if (item.question.allowCustom === false && !isOptionAllowed(item.question, answer)) {
      throw new Error(`“${item.question.question}”请选择一个可用选项。`);
    }
    return [{
      question: item.question.question,
      answer,
      questionId: item.question.id,
      questionnaireId: item.questionnaireId,
      questionnaireTitle: item.questionnaireTitle,
    }];
  });
  if (!items.length) throw new Error('请至少填写一题后再生成。');
  return items;
};
