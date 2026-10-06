import type { QuestionnaireDefinition } from '@mahoshojo/domain/questionnaire-definition';
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
 * /canshou 问卷绑定（D5.1-G1）：流程语义与 /details 完全一致，家族差异只有
 * 缺省 kind、内置预设身份与静态路径。数据卡/上传/预设入口的归一化、
 * 条件题与答案键隔离口径见 `features/questionnaire/flow`。
 */
export type CanshouQuestionnaire = QuestionnaireDefinition;
export type CanshouFlowItem = QuestionnaireFlowItem;

export type { QuestionnaireSource };

export { builtinQuestionnaireSource, builtinSelectionId, buildSelectionFlowItems, toQuestionnaireSelection };

/** canshou 家族参数：缺省 kind、内置预设身份与静态路径。 */
const CANSHOU_FLOW_FAMILY: QuestionnaireFlowFamily = {
  fallbackKind: 'canshou',
  builtinQuestionnaireId: 'canshou-default',
  builtinPresetPath: '/questionnaires/presets/canshou-default.json',
};

/** 默认内置问卷的 canonical id——`loadDefaultCanshouQuestionnaire` 强校验、草稿残余判定共用。 */
export const CANSHOU_DEFAULT_QUESTIONNAIRE_ID = CANSHOU_FLOW_FAMILY.builtinQuestionnaireId;

export const buildCanshouFlowItems = buildQuestionnaireFlowItems;

/** 数据卡选择载荷 → 问卷定义；非法正文返回错误文案而不是静默回退。 */
export const parseCanshouQuestionnaireSelection = (
  payload: BattleSelectionPayload,
  context?: CardLibrarySelectionContext,
) => parseQuestionnaireCardSelection(CANSHOU_FLOW_FAMILY, payload, context);

export const loadDefaultCanshouQuestionnaire = (signal: AbortSignal): Promise<CanshouQuestionnaire> =>
  loadBuiltinQuestionnaire(CANSHOU_FLOW_FAMILY, signal);

/** Desktop 选择来源 → wire `source` 语义（builtin→preset / cloud→database / local→upload）。 */
export const canshouSelectionSource = questionnaireSelectionSourceFor;

/** 从流程条目与按键回答收集生成载荷（与 /details 同一投影）。 */
export const buildCanshouAnswers = (
  flow: readonly CanshouFlowItem[],
  answersByKey: Record<string, string>,
): QuestionnaireAnswerItem[] => buildQuestionnaireAnswers(flow, answersByKey);
