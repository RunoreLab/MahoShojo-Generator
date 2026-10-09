import { describe, expect, it, vi } from 'vitest';
import type { QuestionnaireSelection } from '@mahoshojo/domain/questionnaire-selection';
import { buildQuestionnaireGenerationRequestFields } from '@mahoshojo/domain/questionnaire-selection';
import { importSublimationLore, parseSublimationLoreSelections, sublimationLoreSelections, sublimationLoreText } from '../src/features/sublimation/lore-selection';
import { parseQuestionnaireCardSelection, toQuestionnaireSelection } from '../src/features/questionnaire/flow';
import { executeSublimationGeneration } from '../src/features/sublimation/generation';
import { buildSublimationInput, createInitialSublimationDraft, SublimationSession } from '../src/features/sublimation/session';
import type { CardRepository } from '@mahoshojo/local-library/repository';

const q = { id: 'lore-world', kind: 'magical-girl' as const, title: '世界', questions: [], loreMarkdown: '完整世界设定', nativeAllowed: true, future: { retain: ['extra'] } };
const preset: QuestionnaireSelection = { source: 'preset', questionnaire: q };
const database: QuestionnaireSelection = { source: 'database', dataCardId: 'public-id', questionnaire: q };
const base = () => buildSublimationInput({ ...createInitialSublimationDraft(), originalData: { templateId: '通用角色', name: '雨灯', content: '原文' } });
describe('sublimation typed Lore identity and compatibility', () => {
  it('preserves preset/database identities in shared hosted wire; copied local data never upgrades', () => {
    const local = parseQuestionnaireCardSelection({ fallbackKind: 'magical-girl', builtinQuestionnaireId: '', builtinPresetPath: '' }, { ...q, _cardType: 'questionnaire', _storageLocation: 'local', _cardId: 'public-id' } as never, { selectionId: 'cache:public-id' } as never);
    if ('error' in local) throw new Error(local.error);
    const localSelection = toQuestionnaireSelection(local.source, local.questionnaire);
    const wire = buildQuestionnaireGenerationRequestFields(parseSublimationLoreSelections([preset, database, localSelection]));
    expect(wire.questionnaireSelections).toEqual([{ source: 'preset', kind: 'magical-girl', presetId: 'lore-world' }, { source: 'database', kind: 'magical-girl', dataCardId: 'public-id' }, { source: 'upload', kind: 'magical-girl' }]);
    expect(localSelection.questionnaire.nativeAllowed).toBe(false);
    expect(localSelection).not.toHaveProperty('dataCardId');
  });
  it('upload/paste strips native declaration and preserves complete Lore', () => {
    const imported = importSublimationLore(JSON.stringify(q));
    expect(imported.questionnaire).toMatchObject({ nativeAllowed: false, loreMarkdown: q.loreMarkdown, future: q.future });
    expect(imported).toHaveProperty('sourceSnapshot', q);
    expect(parseSublimationLoreSelections([{ ...imported, dataCardId: 'forged', questionnaire: q }])[0]).not.toHaveProperty('dataCardId');
  });
  it.each([null, {}, [{ source: 'unknown', questionnaire: q }], [{ source: 'database', questionnaire: q }], [{ source: 'preset', questionnaire: { ...q, loreMarkdown: 5 } }], [preset, preset], [{ source: ['upload'], questionnaire: q }], [{ source: ['database'], questionnaire: q }], [{ source: 'upload', questionnaire: { ...q, title: ' ' } }]])('rejects malformed source instead of silently gaining preset identity: %j', (bad) => {
    expect(() => parseSublimationLoreSelections(bad)).toThrow();
  });
  it('keeps legacy text prompt unchanged and combines typed sources once with toggles', () => {
    const input = { ...base(), loreText: ' 旧补充 ', selectedQuestionnaires: [preset, { ...database, useLore: false }] };
    expect(sublimationLoreText({ ...input, selectedQuestionnaires: undefined })).toBe(' 旧补充 ');
    expect(sublimationLoreText(input)).toBe('【设定来源：世界】\n完整世界设定\n\n【设定来源：补充设定】\n旧补充');
    expect(sublimationLoreSelections(input)).toHaveLength(3);
  });
  it('draft roundtrip preserves selected payload extension and does not restore-generate', () => {
    const map = new Map<string, string>(); const storage = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v); }, removeItem: (k: string) => { map.delete(k); } };
    const execute = vi.fn(); const repository = {} as CardRepository;
    const session = new SublimationSession({ storage, repository, initialDraft: createInitialSublimationDraft(), execute });
    session.updateDraft({ ...createInitialSublimationDraft(), selectedQuestionnaires: [preset] });
    const restored = new SublimationSession({ storage, repository, initialDraft: createInitialSublimationDraft(), execute });
    restored.restoreDraft();
    expect(restored.getSnapshot().draft.selectedQuestionnaires?.[0].questionnaire).toEqual(q);
    expect(execute).not.toHaveBeenCalled();
  });
  it.each(['hosted-json', 'hosted-stream'] as const)('actual %s executor sends typed selection wire', async (mode) => {
    const invoke = vi.fn(async (_command, args) => {
      expect(args.request.body.questionnaireSelections).toEqual([{ source: 'preset', kind: 'magical-girl', presetId: q.id }, { source: 'database', kind: 'magical-girl', dataCardId: 'public-id' }]);
      throw new Error('stop after request capture');
    });
    await executeSublimationGeneration({ invoke, profileId: '', createChannel: () => ({}) }, { ...base(), selectedQuestionnaires: [preset, database] }, { mode, requestId: 'lore-wire' }, new AbortController().signal).catch(() => undefined);
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
