import {
  buildQuestionKey,
  collectQuestionnaireFlowAnswerItems,
  normalizeQuestionnaireDefinition,
  type QuestionnaireDefinition,
  type QuestionnaireKind,
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
 * 通用问卷流程层（D5.1-G1）。
 *
 * `/details` 与 `/canshou` 共用同一套问卷语义：内置预设与数据卡问卷都走
 * `@mahoshojo/domain/questionnaire-definition` 的 `normalizeQuestionnaireDefinition`，
 * 条件题/跳题/选项引用与 Web 既有产品一致——不另起 Desktop 问卷体系。
 * 家族差异（内置预设 id/路径、未声明 kind 的归一化兜底）由
 * `QuestionnaireFlowFamily` 注入；`/details` 的既有导出形态见
 * `features/details/questionnaire.ts` 薄绑定。
 */
export type QuestionnaireFlowDefinition = QuestionnaireDefinition;
export type QuestionnaireFlowQuestion = QuestionnaireQuestion;

/**
 * 逐题流条目：key 由 `buildQuestionKey` 产出（`questionnaireScopeId::questionId`）。
 * scopeId 是「这一次选中」的实例标识（`CardLibrarySelectionContext.selectionId`），
 * 与 Web `DetailsPage`/`CreatorPage`/`CanshouPage` 的 `questionnaireScopeId` 同一口径——
 * 同一 canonical 问卷的云端卡与本地副本、或重复选中，各产各的答案键，
 * 草稿回答、条件判定与最终答案收集都按实例隔离（D5.0e-r1）。
 */
export interface QuestionnaireFlowItem {
  key: string;
  questionnaireId: string;
  questionnaireScopeId: string;
  questionnaireTitle: string;
  question: QuestionnaireQuestion;
}

export const buildQuestionnaireFlowItems = (
  questionnaire: QuestionnaireDefinition,
  questionnaireScopeId?: string,
): QuestionnaireFlowItem[] => {
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
 * `cache:<id>` / `builtin:<questionnaireId>`），决定答案键的隔离边界。
 * 公开缓存快照（`cache:`）在选择载荷里折叠到 `_storageLocation:'local'`
 * 一侧——冻结输入、无服务器身份，kind 因此是 `local`，wire 走 `upload`
 * 非信任嵌入路径（DESK-CACHE-007）。
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

/** 问卷家族：产品差异集中在缺省 kind 与内置预设身份。 */
export interface QuestionnaireFlowFamily {
  /** 数据卡未声明 `kind` 时的归一化兜底。 */
  fallbackKind: QuestionnaireKind;
  /** 内置问卷的 canonical id——加载强校验与草稿残余判定共用。 */
  builtinQuestionnaireId: string;
  /** 内置问卷预设的静态资源路径。 */
  builtinPresetPath: string;
}

/** 数据卡选择载荷 → 问卷定义；非法正文返回错误文案而不是静默回退。 */
export const parseQuestionnaireCardSelection = (
  family: QuestionnaireFlowFamily,
  payload: BattleSelectionPayload,
  context?: CardLibrarySelectionContext,
): { questionnaire: QuestionnaireDefinition; source: QuestionnaireSource } | { error: string } => {
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
    fallbackKind: family.fallbackKind,
    fallbackTitle: cardName,
    nativeAllowed: resolveQuestionnaireSelectionNativeAllowedFallback(
      isLocal ? 'upload' : 'database',
      payload,
    ),
  });
  // 纯 Lore 问卷（questions 为空但有 loreMarkdown）是合法形态：共享面板按
  // 「只有设定没有题目」处理，与上传/粘贴/预设入口的归一化口径一致（D5.1-P2-r1）。
  if (!questionnaire || (questionnaire.questions.length === 0 && !questionnaire.loreMarkdown?.trim())) {
    return { error: '这张数据卡不包含可识别的问卷内容。' };
  }
  // `normalizeQuestionnaireDefinition` 优先采纳卡片声明的 nativeAllowed；
  // 本地副本没有服务器可以背书，upload 语义下恒为非原生——归一化后强制回 false。
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

export const loadBuiltinQuestionnaire = async (
  family: QuestionnaireFlowFamily,
  signal: AbortSignal,
): Promise<QuestionnaireDefinition> => {
  const response = await fetch(family.builtinPresetPath, { signal, credentials: 'omit', redirect: 'error' });
  if (!response.ok) throw new Error('内置问卷加载失败，请重试。');
  const raw: unknown = await response.json();
  const questionnaire = normalizeQuestionnaireDefinition(raw, {
    fallbackId: family.builtinQuestionnaireId,
    fallbackKind: family.fallbackKind,
    // 内置预设与 Web preset 同源口径：未声明 nativeAllowed 按原生许可计。
    nativeAllowed: resolveQuestionnaireSelectionNativeAllowedFallback('preset', raw),
  });
  if (!questionnaire || questionnaire.id !== family.builtinQuestionnaireId) {
    throw new Error('内置问卷无法读取，请重新安装或更新客户端。');
  }
  return questionnaire;
};

export const builtinQuestionnaireSource = (questionnaire: QuestionnaireDefinition): QuestionnaireSource => ({
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
export const questionnaireSelectionSourceFor = (source: QuestionnaireSource): QuestionnaireSelectionSource =>
  source.kind === 'builtin' ? 'preset' : source.kind === 'cloud' ? 'database' : 'upload';

/**
 * Desktop 选择来源 → 共源 `QuestionnaireSelection`（D5.1a）。
 * hosted 请求字段经 `buildQuestionnaireGenerationRequestFields` 投影，
 * 与 Web 各问卷页同一构造器。
 */
export const toQuestionnaireSelection = (
  source: QuestionnaireSource,
  questionnaire: QuestionnaireDefinition,
  useLore?: boolean,
): QuestionnaireSelection => ({
  source: questionnaireSelectionSourceFor(source),
  questionnaire,
  ...(source.kind === 'cloud' && source.cardId ? { dataCardId: source.cardId } : {}),
  ...(source.kind !== 'builtin' ? { dataCardName: source.title } : {}),
  selectionId: source.selectionId,
  ...(useLore !== undefined ? { useLore } : {}),
});

/** 多问卷展平后的逐题流条目：各 selection 用自己的实例作用域产 key。 */
export const buildSelectionFlowItems = (
  entries: ReadonlyArray<{ source: QuestionnaireSource; questionnaire: QuestionnaireDefinition }>,
): QuestionnaireFlowItem[] =>
  entries.flatMap(({ source, questionnaire }) =>
    buildQuestionnaireFlowItems(questionnaire, source.selectionId));

/**
 * 从流程条目与按键回答收集生成载荷。
 *
 * 只收集当前可见流程内的题目（displayIf/jump 已按回答求值），答案投影与
 * Web 共用 `collectQuestionnaireFlowAnswerItems`（D5.1a-r1 对拍口径）；
 * `allowCustom === false` 封闭题的选项外取值由该共源投影拒绝（D5.1a-r1 复审），
 * 批量导入等旁路写入的非法答案在两宿主同样无法进入提交载荷。
 */
export const buildQuestionnaireAnswers = (
  flow: readonly QuestionnaireFlowItem[],
  answersByKey: Record<string, string>,
): QuestionnaireAnswerItem[] => {
  const items = collectQuestionnaireFlowAnswerItems(flow, answersByKey);
  if (!items.length) throw new Error('请至少填写一题后再生成。');
  return items;
};
