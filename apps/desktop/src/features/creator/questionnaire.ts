import type { BattleSelectionPayload, CardLibrarySelectionContext } from '@mahoshojo/ui-web/card-library';
import type { QuestionnaireKind } from '@mahoshojo/domain/questionnaire-definition';
import {
  parseQuestionnaireCardSelection,
  toQuestionnaireSelection,
  type QuestionnaireFlowFamily,
  type QuestionnaireSource,
} from '../questionnaire/flow';

/**
 * /creator 问卷绑定（D5.1-G3）：流程语义与 /details、/canshou 完全一致，
 * 唯一的家族差异是「缺省 kind 随创作模板走」——canshou 模板下未声明 kind
 * 的数据卡按残兽族解析，其余模板按 magical-girl（与 Web
 * `questionnaireFallbackKind` 推导一致）。因此这里不是固定家族薄绑定，
 * 而是把 fallbackKind 作为显式入参的适配器；builtin 字段仅为满足家族
 * 结构，creator 的默认问卷经预设索引 `pickDefaultCreatorQuestionnairePresetEntry`
 * 注入，不走 `loadBuiltinQuestionnaire`。
 */
export type { QuestionnaireSource };
export { toQuestionnaireSelection };

export const creatorFlowFamilyFor = (fallbackKind: QuestionnaireKind): QuestionnaireFlowFamily => ({
  fallbackKind,
  builtinQuestionnaireId: fallbackKind === 'canshou' ? 'canshou-default' : 'magical-girl-default',
  builtinPresetPath: fallbackKind === 'canshou'
    ? '/questionnaires/presets/canshou-default.json'
    : '/questionnaires/presets/magical-girl-default.json',
});

/** 数据卡选择载荷 → 问卷定义；非法正文返回错误文案而不是静默回退。 */
export const parseCreatorQuestionnaireCardSelection = (
  fallbackKind: QuestionnaireKind,
  payload: BattleSelectionPayload,
  context?: CardLibrarySelectionContext,
) => parseQuestionnaireCardSelection(creatorFlowFamilyFor(fallbackKind), payload, context);
