import type { QuestionnairePresetEntry } from '../questionnaire-definition';
import { pickDefaultQuestionnairePresetEntry } from '../questionnaire-selection';

import { tryLoadBuildRulePresetById } from './build-rules';
import type { CreatorTemplateId } from './templates';

/**
 * 模板切换时的规则选择对账（D5.1-G3 上移共源）。
 *
 * 与 Web `reconcileCreatorBuildRuleSelection` 一致：剔除不支持当前模板的规则，
 * 主规则失效时回退到剩余选中项的第一个（无则 null），保持
 * 「主规则 ∈ 已选且兼容」不变量。
 */
export function reconcileCreatorBuildRuleSelection({
  template,
  selectedRuleIds,
  primaryRuleId,
}: {
  template: CreatorTemplateId;
  selectedRuleIds: string[];
  primaryRuleId: string | null;
}): {
  selectedRuleIds: string[];
  primaryRuleId: string | null;
} {
  const compatibleRuleIds = selectedRuleIds.filter((ruleId) => {
    const preset = tryLoadBuildRulePresetById(ruleId);
    return Boolean(preset?.supportedTemplates.includes(template));
  });

  return {
    selectedRuleIds: compatibleRuleIds,
    primaryRuleId:
      primaryRuleId && compatibleRuleIds.includes(primaryRuleId)
        ? primaryRuleId
        : compatibleRuleIds[0] ?? null,
  };
}

type QuestionnaireSelectionLike = {
  questionnaire: {
    questions: unknown[];
  };
};

const usesAllQuestionnairePresets = (template: CreatorTemplateId): boolean =>
  template === 'general' || template === 'general-scenario';

/**
 * 按模板过滤问卷预设条目：通用模板收全部，魔法少女/残兽模板只收同 kind。
 * 与 Web CreatorPage 的 `visiblePresetEntries` 口径一致。
 */
export function filterCreatorQuestionnairePresetEntries(
  template: CreatorTemplateId,
  presetEntries: QuestionnairePresetEntry[]
): QuestionnairePresetEntry[] {
  if (usesAllQuestionnairePresets(template)) {
    return [...presetEntries];
  }

  const expectedKind = template === 'canshou' ? 'canshou' : 'magical-girl';
  return presetEntries.filter((entry) => entry.kind === expectedKind);
}

/** 模板化默认问卷预设挑选（过滤后的 isDefault 优先、否则首个）。 */
export function pickDefaultCreatorQuestionnairePresetEntry(
  template: CreatorTemplateId,
  presetEntries: QuestionnairePresetEntry[]
): QuestionnairePresetEntry | null {
  return pickDefaultQuestionnairePresetEntry(
    filterCreatorQuestionnairePresetEntries(template, presetEntries),
  );
}

/**
 * 切换到残兽模板时的问卷选择对账：以残兽默认问卷替换答题问卷，
 * 但保留「仅设定（无题目）」选择项作为 lore 叠加。与 Web 同源语义。
 */
export function reconcileQuestionnaireSelectionsForTemplate<T extends QuestionnaireSelectionLike>({
  template,
  selections,
  replacementSelection,
}: {
  template: CreatorTemplateId;
  selections: T[];
  replacementSelection: T | null;
}): T[] {
  if (template !== 'canshou' || !replacementSelection) {
    return selections;
  }

  const loreOnlySelections = selections.filter(
    (selection) => selection.questionnaire.questions.length === 0
  );
  return [replacementSelection, ...loreOnlySelections];
}
