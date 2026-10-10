import { buildQuestionnaireSelectionLoreText, type QuestionnaireSelection } from '@mahoshojo/domain/questionnaire-selection';
import { parseDesktopLoreSelections as parseSublimationLoreSelections, retainDesktopLoreSource as retainSublimationLoreSource, importDesktopLore } from '../questionnaire/lore-source';
export { parseSublimationLoreSelections, retainSublimationLoreSource };
export const importSublimationLore = (text: string): QuestionnaireSelection => importDesktopLore(text, { fallbackId: 'sublimation-upload' });

export function sublimationLoreSelections(input: { selectedQuestionnaires?: QuestionnaireSelection[]; loreText: string; targetTemplate: string }): QuestionnaireSelection[] {
  const selections = parseSublimationLoreSelections(input.selectedQuestionnaires);
  if (input.loreText.trim()) selections.push({ source: 'upload', questionnaire: { id: 'desktop-sublimation-lore', kind: input.targetTemplate === 'canshou' ? 'canshou' : 'magical-girl', title: '补充设定', questions: [], loreMarkdown: input.loreText, nativeAllowed: false }, useLore: true });
  return selections;
}
export const sublimationLoreText = (input: { selectedQuestionnaires?: QuestionnaireSelection[]; loreText: string; targetTemplate: string }): string =>
  // Keep existing free-text prompt byte-for-byte when no new typed selections are present.
  input.selectedQuestionnaires?.length ? buildQuestionnaireSelectionLoreText(sublimationLoreSelections(input)) : input.loreText;
export const sublimationLoreMetadata = (input: { selectedQuestionnaires?: QuestionnaireSelection[]; loreText: string; targetTemplate: string }) => {
  const selections = sublimationLoreSelections(input);
  return { hasQuestionnaireLore: Boolean(sublimationLoreText(input).trim()), hasNonNativeQuestionnaireLore: selections.some((s) => s.useLore !== false && !!s.questionnaire.loreMarkdown?.trim() && (s.source === 'upload' || s.questionnaire.nativeAllowed !== true)), questionnaireSelectionCount: selections.length };
};
