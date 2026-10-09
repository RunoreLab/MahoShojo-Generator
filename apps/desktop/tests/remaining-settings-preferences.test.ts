import { describe, expect, it, vi } from 'vitest';
import type { CardRepository } from '@mahoshojo/local-library/repository';
import { createPagePreferencesAdapter, type PagePreferenceSource } from '@mahoshojo/ui-web/settings';
import { DESKTOP_CREATOR_PREFERENCES, DESKTOP_SCENARIO_PREFERENCES, DESKTOP_SUBLIMATION_PREFERENCES } from '../src/app/settings-page-preferences';
import { CreatorSession, createInitialCreatorDraft, createEmptyCreatorDraftDocument } from '../src/features/creator/session';
import { ScenarioSession, createInitialScenarioDraft, createEmptyScenarioDraftDocument } from '../src/features/scenario/session';
import { SublimationSession, createInitialSublimationDraft, createEmptySublimationDraftDocument } from '../src/features/sublimation/session';

const makeStorage = (raw: string | null = null) => {
  let value = raw;
  return { getItem: () => value, setItem: (_key: string, next: string) => { value = next; }, removeItem: () => { value = null; } };
};
const cases = [
  { source: DESKTOP_CREATOR_PREFERENCES, factory: createEmptyCreatorDraftDocument, field: 'showDetails' },
  { source: DESKTOP_SCENARIO_PREFERENCES, factory: createEmptyScenarioDraftDocument, field: 'isAdvancedVisible' },
  { source: DESKTOP_SUBLIMATION_PREFERENCES, factory: createEmptySublimationDraftDocument, field: 'isAdvancedVisible' },
];

describe('remaining Desktop page preferences retain their real draft owner', () => {
  it.each(cases)('$source.pageId first write restores via the real page session without generating', ({ source, field }) => {
    const storage = makeStorage(); const execute = vi.fn();
    const adapter = createPagePreferencesAdapter(source, storage);
    expect(adapter.writeField(field, true)).toBe(true);
    const dependencies = { storage, execute, repository: {} as CardRepository };
    const session = source === DESKTOP_CREATOR_PREFERENCES
      ? new CreatorSession({ ...dependencies, initialDraft: createInitialCreatorDraft() })
      : source === DESKTOP_SCENARIO_PREFERENCES
        ? new ScenarioSession({ ...dependencies, initialDraft: createInitialScenarioDraft() })
        : new SublimationSession({ ...dependencies, initialDraft: createInitialSublimationDraft() });
    expect(session.isDraftBlocked()).toBe(false);
    expect(session.getSnapshot()).toMatchObject({ pendingRestore: false, phase: 'idle', draft: { [field]: true }, card: null });
    if (source === DESKTOP_CREATOR_PREFERENCES) expect(session.getSnapshot().draft).toMatchObject({ generationMode: 'stream', template: 'general' });
    expect(execute).not.toHaveBeenCalled(); session.dispose();
  });

  it.each(cases)('$source.pageId patches/resets only declared fields, retaining original output and unknown data', ({ source, factory, field }) => {
    const base = { ...factory(), [field]: true, extension: { nested: [1, '保留'] }, savedAt: 123,
      output: { mode: 'direct-local', cardKind: source === DESKTOP_SCENARIO_PREFERENCES ? 'general-scenario' : 'general', card: { templateId: source === DESKTOP_SCENARIO_PREFERENCES ? '通用情景' : '通用角色', name: '保留', title: '情景', content: '正文', signature: '不借校验剥除' }, rawText: '原文', phase: 'completed', extension: '输出扩展' } };
    const storage = makeStorage(JSON.stringify(base));
    const adapter = createPagePreferencesAdapter(source, storage);
    expect(adapter.writeField(field, false)).toBe(true);
    expect(JSON.parse(storage.getItem()!)).toEqual({ ...base, [field]: false });
    expect(adapter.reset()).toBe(true);
    const expected: Record<string, unknown> = { ...base }; delete expected[field];
    expect(JSON.parse(storage.getItem()!)).toEqual(expected);
    expect(() => source.validateDocument!(storage.getItem()!)).not.toThrow();
  });

  it('Creator never edits or resets language/mode/template/rules/selections', () => {
    const base = { ...createEmptyCreatorDraftDocument(), language: 'en', generationMode: 'non-stream', template: 'magical-girl', freeformBrief: '输入', selectedRuleIds: ['arena-trpg-lite'], questionnaireSelections: [], showDetails: true, imageSaveMode: 'modal', jsonSaveMode: 'text', allowMultipleQuestionnaires: true };
    const storage = makeStorage(JSON.stringify(base)); const adapter = createPagePreferencesAdapter(DESKTOP_CREATOR_PREFERENCES, storage);
    expect(() => adapter.writeField('generationMode', 'stream')).toThrow(); expect(() => adapter.writeField('language', 'ja')).toThrow();
    expect(adapter.reset()).toBe(true);
    const { showDetails: _show, imageSaveMode: _image, jsonSaveMode: _json, allowMultipleQuestionnaires: _multiple, ...expected } = base;
    expect(JSON.parse(storage.getItem()!)).toEqual(expected);
  });

  it('Sublimation restores all required strategy defaults without removing user content', () => {
    const defaults = createInitialSublimationDraft();
    const base = { ...createEmptySublimationDraftDocument(), isAdvancedVisible: true, readArenaHistory: false, writeArenaHistory: false, readCurrentState: false, writeCurrentState: false, arenaHistoryRetentionStrategy: 'reset-all', userGuidance: '指导语', narrativeHistory: '历史', loreText: 'Lore', fieldsToPreserve: ['name'], originalData: { name: '源卡', content: '内容' } };
    const storage = makeStorage(JSON.stringify(base)); const adapter = createPagePreferencesAdapter(DESKTOP_SUBLIMATION_PREFERENCES, storage);
    expect(adapter.reset()).toBe(true);
    const actual = JSON.parse(storage.getItem()!);
    for (const field of DESKTOP_SUBLIMATION_PREFERENCES.fields.slice(1)) expect(actual[field.key]).toEqual(defaults[field.key as keyof typeof defaults]);
    expect(actual).toMatchObject({ userGuidance: base.userGuidance, narrativeHistory: base.narrativeHistory, loreText: base.loreText, fieldsToPreserve: base.fieldsToPreserve, originalData: base.originalData });
    expect(() => DESKTOP_SUBLIMATION_PREFERENCES.validateDocument!(storage.getItem()!)).not.toThrow();
  });

  it.each(cases)('$source.pageId refuses bad/future/oversized owner documents and quota failures byte-for-byte', ({ source, factory, field }) => {
    const base = factory();
    const invalids = ['{broken', '[]', '{}', JSON.stringify({ ...base, version: 2 }), JSON.stringify({ ...base, output: { mode: 'future' } }), JSON.stringify({ ...base, extension: 'x'.repeat(4 * 1024 * 1024) })];
    if (source === DESKTOP_SCENARIO_PREFERENCES || source === DESKTOP_SUBLIMATION_PREFERENCES) invalids.push(JSON.stringify({ ...base, isAdvancedVisible: 'yes' }));
    for (const raw of invalids) {
      const storage = makeStorage(raw); const adapter = createPagePreferencesAdapter(source, storage);
      expect(adapter.read()).toEqual({ status: 'corrupted' }); expect(adapter.writeField(field, true)).toBe(false); expect(adapter.reset()).toBe(false); expect(storage.getItem()).toBe(raw);
    }
    const raw = JSON.stringify(base); const storage = makeStorage(raw); storage.setItem = () => { throw new Error('quota'); };
    const adapter = createPagePreferencesAdapter(source, storage);
    expect(adapter.writeField(field, true)).toBe(false); expect(adapter.reset()).toBe(false); expect(storage.getItem()).toBe(raw);
  });

  it('revalidates on each operation and rejects invalid owner factory or reset defaults', () => {
    const storage = makeStorage();
    const bad: PagePreferenceSource = { ...DESKTOP_SUBLIMATION_PREFERENCES, createDocumentForFirstWrite: () => ({ version: 1 }) };
    expect(createPagePreferencesAdapter(bad, storage).writeField('readArenaHistory', false)).toBe(false); expect(storage.getItem()).toBeNull();
    storage.setItem('', JSON.stringify(createEmptySublimationDraftDocument()));
    const adapter = createPagePreferencesAdapter(DESKTOP_SUBLIMATION_PREFERENCES, storage); expect(adapter.read().status).toBe('ready');
    storage.setItem('', '{new-invalid'); expect(adapter.reset()).toBe(false); expect(storage.getItem()).toBe('{new-invalid');
  });
});


it.each([
  { imageSaveMode: 'bad' }, { jsonSaveMode: 'bad' }, { showDetails: 'yes' }, { allowMultipleQuestionnaires: 1 },
])('Creator page and settings reject the same invalid optional preference without changing raw bytes: %j', (invalid) => {
  const raw = JSON.stringify({ ...createEmptyCreatorDraftDocument(), ...invalid }); const storage = makeStorage(raw);
  const adapter = createPagePreferencesAdapter(DESKTOP_CREATOR_PREFERENCES, storage);
  expect(adapter.read()).toEqual({ status: 'corrupted' }); expect(adapter.writeField('showDetails', false)).toBe(false); expect(adapter.reset()).toBe(false);
  const session = new CreatorSession({ storage, repository: {} as CardRepository, initialDraft: createInitialCreatorDraft() });
  expect(session.isDraftBlocked()).toBe(true); session.dispose(); expect(storage.getItem()).toBe(raw);
});
