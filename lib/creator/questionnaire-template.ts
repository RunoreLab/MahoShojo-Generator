import type { QuestionnairePresetEntry } from '@/lib/questionnaires';

import type { CreatorTemplateId } from './templates';

type QuestionnaireSelectionLike = {
  questionnaire: {
    questions: unknown[];
  };
};

const usesAllQuestionnairePresets = (template: CreatorTemplateId): boolean =>
  template === 'general' || template === 'general-scenario';

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

export function pickDefaultCreatorQuestionnairePresetEntry(
  template: CreatorTemplateId,
  presetEntries: QuestionnairePresetEntry[]
): QuestionnairePresetEntry | null {
  const filtered = filterCreatorQuestionnairePresetEntries(template, presetEntries);
  return filtered.find((entry) => entry.isDefault) ?? filtered[0] ?? null;
}

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

  const loreOnlySelections = selections.filter((selection) => selection.questionnaire.questions.length === 0);
  return [replacementSelection, ...loreOnlySelections];
}
