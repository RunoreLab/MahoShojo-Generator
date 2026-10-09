import { SafeJsonValueSchema } from '@mahoshojo/contracts/json-value';
import type { QuestionnaireDefinition } from '@mahoshojo/domain/questionnaire-definition';
import { normalizeQuestionnaireDefinition, parseQuestionnaireDataCardPayload } from '@mahoshojo/domain/questionnaire-definition';
import { buildQuestionnaireSelectionLoreText, type QuestionnaireSelection } from '@mahoshojo/domain/questionnaire-selection';

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
/** Stored input is not an authority for license. Preserve payload extensions, reject broken identities. */
export function parseSublimationLoreSelections(value: unknown): QuestionnaireSelection[] {
  if (value === undefined) return []; // v1 drafts before typed selections
  if (!Array.isArray(value)) throw new Error('设定来源草稿损坏');
  // Domain normalizers include optional undefined properties; persisted JSON omits these.
  const jsonValue: unknown = JSON.parse(JSON.stringify(value));
  if (!SafeJsonValueSchema.safeParse(jsonValue).success) throw new Error('设定来源草稿损坏');
  const ids = new Set<string>();
  return (jsonValue as unknown[]).map((raw) => {
    if (!record(raw) || typeof raw.source !== 'string' || !['preset', 'upload', 'database'].includes(raw.source) || !record(raw.questionnaire)
      || typeof raw.questionnaire.id !== 'string' || !raw.questionnaire.id.trim()
      || typeof raw.questionnaire.kind !== 'string' || !['magical-girl', 'canshou'].includes(raw.questionnaire.kind)
      || typeof raw.questionnaire.title !== 'string' || !raw.questionnaire.title.trim() || !Array.isArray(raw.questionnaire.questions)
      || (raw.questionnaire.loreMarkdown !== undefined && typeof raw.questionnaire.loreMarkdown !== 'string')
      || (raw.questionnaire.nativeAllowed !== undefined && raw.questionnaire.nativeAllowed !== null && typeof raw.questionnaire.nativeAllowed !== 'boolean')
      || raw.questionnaire.questions.some((q) => !record(q) || typeof q.id !== 'string' || !q.id.trim() || typeof q.question !== 'string' || !q.question.trim())
      || (raw.useLore !== undefined && typeof raw.useLore !== 'boolean')
      || (raw.selectionId !== undefined && (typeof raw.selectionId !== 'string' || !raw.selectionId.trim()))
      || (raw.source === 'database' && (typeof raw.dataCardId !== 'string' || !raw.dataCardId.trim()))) throw new Error('设定来源草稿损坏');
    const normalized = normalizeQuestionnaireDefinition(raw.questionnaire, { fallbackKind: raw.questionnaire.kind as 'magical-girl' | 'canshou', fallbackId: raw.questionnaire.id, fallbackTitle: raw.questionnaire.title, nativeAllowed: false });
    if (!normalized) throw new Error('设定来源草稿损坏');
    const result = structuredClone(raw) as unknown as QuestionnaireSelection;
    // Uploaded and cached copies can never inherit the source card's native license.
    if (result.source === 'upload') { result.questionnaire.nativeAllowed = false; delete result.dataCardId; }
    const id = result.selectionId ?? `${result.source}:${result.dataCardId ?? result.questionnaire.id}`;
    if (ids.has(id)) throw new Error('设定来源重复');
    ids.add(id);
    return { ...result, selectionId: id };
  });
}
/** Keep the unmodified source beside normalized executable fields; no source snapshot grants trust. */
export function retainSublimationLoreSource(selection: QuestionnaireSelection, source: unknown): QuestionnaireSelection {
  const raw = parseQuestionnaireDataCardPayload(source);
  const rawQuestions = Array.isArray(raw.questions) ? raw.questions : [];
  const questionnaire = { ...raw, ...selection.questionnaire, questions: selection.questionnaire.questions.map((question) => {
    const original = rawQuestions.find((candidate) => record(candidate) && candidate.id === question.id);
    return { ...(record(original) ? original : {}), ...question };
  }) } as QuestionnaireDefinition;
  return { ...selection, questionnaire, sourceSnapshot: JSON.parse(JSON.stringify(raw)) } as QuestionnaireSelection;
}
export function importSublimationLore(text: string): QuestionnaireSelection {
  const raw = parseQuestionnaireDataCardPayload(text);
  const q = normalizeQuestionnaireDefinition(raw, { fallbackKind: record(raw) && raw.kind === 'canshou' ? 'canshou' : 'magical-girl', fallbackId: 'sublimation-upload', fallbackTitle: '补充设定', nativeAllowed: false });
  if (!q) throw new Error('问卷 JSON 无法识别，请检查格式');
  q.nativeAllowed = false;
  return retainSublimationLoreSource({ source: 'upload', questionnaire: q }, raw);
}
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
