import type { QuestionnaireDefinition, QuestionnaireQuestion } from '@mahoshojo/domain/questionnaire-definition';
import type { QuestionnaireAnswerItem } from '@mahoshojo/domain/questionnaire';
import type { BattleSelectionPayload, CardLibrarySelectionContext } from '@mahoshojo/ui-web/card-library';
import {
  buildQuestionnaireAnswers,
  buildQuestionnaireFlowItems,
  buildSelectionFlowItems,
  builtinQuestionnaireSource,
  builtinSelectionId,
  loadBuiltinQuestionnaire,
  parseQuestionnaireCardSelection,
  questionnaireSelectionSourceFor,
  toQuestionnaireSelection,
  type QuestionnaireFlowFamily,
  type QuestionnaireFlowItem,
  type QuestionnaireSource,
} from '../questionnaire/flow';

/**
 * /details 问卷定义（D5.0e）。
 *
 * 与 Web 共用 `@mahoshojo/domain/questionnaire-definition`：内置预设与数据卡
 * 问卷走同一个 `normalizeQuestionnaireDefinition`，条件题/跳题/选项引用的语义
 * 与 Web 既有产品一致——不另起 Desktop 问卷体系。
 *
 * D5.1-G1 起流程层泛化到 `features/questionnaire/flow`：本模块是
 * magical-girl 家族的薄绑定，导出面保持兼容。
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
export type DetailsFlowItem = QuestionnaireFlowItem;

export type { QuestionnaireSource };

export { builtinQuestionnaireSource, builtinSelectionId, buildSelectionFlowItems, toQuestionnaireSelection };

/** magical-girl 家族参数：缺省 kind、内置预设身份与静态路径。 */
const DETAILS_FLOW_FAMILY: QuestionnaireFlowFamily = {
  fallbackKind: 'magical-girl',
  builtinQuestionnaireId: 'magical-girl-default',
  builtinPresetPath: '/questionnaires/presets/magical-girl-default.json',
};

/** 默认内置问卷的 canonical id——`loadDefaultQuestionnaire` 强校验、草稿残余判定共用。 */
export const BUILTIN_DEFAULT_QUESTIONNAIRE_ID = DETAILS_FLOW_FAMILY.builtinQuestionnaireId;

export const buildDetailsFlowItems = buildQuestionnaireFlowItems;

/** 数据卡选择载荷 → 问卷定义；非法正文返回错误文案而不是静默回退。 */
export const parseQuestionnaireSelection = (
  payload: BattleSelectionPayload,
  context?: CardLibrarySelectionContext,
) => parseQuestionnaireCardSelection(DETAILS_FLOW_FAMILY, payload, context);

export const loadDefaultQuestionnaire = (signal: AbortSignal): Promise<DetailsQuestionnaire> =>
  loadBuiltinQuestionnaire(DETAILS_FLOW_FAMILY, signal);

/**
 * Desktop 选择来源 → wire `source` 语义。
 * - `builtin` → `preset`（内置即官方预设，服务端按 presetId 回读核对）；
 * - `cloud` → `database`（携带 `dataCardId`，服务器可回读核对 nativeAllowed）；
 * - `local` → `upload`（本地库卡没有服务器身份，走 untrusted 嵌入路径）。
 */
export const detailsSelectionSource = questionnaireSelectionSourceFor;

/**
 * 从流程条目与按键回答收集生成载荷。
 *
 * 只收集当前可见流程内的题目（displayIf/jump 已按回答求值），答案投影与
 * Web 共用 `collectQuestionnaireFlowAnswerItems`（D5.1a-r1 对拍口径）；
 * `allowCustom === false` 封闭题的选项外取值由该共源投影拒绝（D5.1a-r1 复审），
 * 批量导入等旁路写入的非法答案在两宿主同样无法进入提交载荷。
 */
export const buildDetailsAnswers = (
  flow: readonly DetailsFlowItem[],
  answersByKey: Record<string, string>,
): QuestionnaireAnswerItem[] => buildQuestionnaireAnswers(flow, answersByKey);
