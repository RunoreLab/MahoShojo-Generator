// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPagePreferencesAdapter } from '@mahoshojo/ui-web/settings';
import { createScenarioPagePreferenceAdapter, WEB_SCENARIO_PREFERENCES, WEB_SUBLIMATION_PREFERENCES, WEB_SUBLIMATION_STATE_PREFERENCES, WEB_DETAILS_PREFERENCES, WEB_PAGE_PREFERENCE_SOURCES } from '@/lib/settings/page-preferences';
import { SCENARIO_PAGE_DRAFT_KEY, SCENARIO_PREFERENCE_KEY, createEmptyScenarioPageDraftDocument, migrateScenarioAdvancedPreference, parseScenarioPageDraftDocument, readScenarioPageDraftState, writeScenarioPageDraft, clearScenarioPageDraft } from '@/lib/scenario-page-draft';
import { DEFAULT_SUBLIMATION_STATE_PREFERENCES, SUBLIMATION_PREFERENCE_KEY, SUBLIMATION_STATE_PREF_KEY, readSublimationStatePreferences, writeSublimationPreferences, writeSublimationStatePreferences } from '@/lib/sublimation/preferences';

const memoryStorage = (initial: Record<string, string> = {}) => {
  const map = new Map(Object.entries(initial));
  return { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, raw: string) => { map.set(key, raw); }, removeItem: (key: string) => { map.delete(key); }, dump: () => Object.fromEntries(map) };
};
beforeEach(() => localStorage.clear());

describe('Scenario canonical advanced preference', () => {
  it('creates a legal canonical first-write document and reads it through page owner', () => {
    const adapter = createScenarioPagePreferenceAdapter(localStorage);
    expect(adapter.writeField('isAdvancedVisible', true)).toBe(true);
    expect(readScenarioPageDraftState().stored?.payload.isAdvancedVisible).toBe(true);
    expect(WEB_SCENARIO_PREFERENCES.fieldsContainer).toBe('payload');
    expect(adapter.reset()).toBe(true);
    expect(readScenarioPageDraftState().stored?.payload.isAdvancedVisible).toBe(false);
  });

  it('migrates only a missing advanced field, retaining all existing draft and legacy content', () => {
    const base = createEmptyScenarioPageDraftDocument();
    const { isAdvancedVisible: _advanced, ...payload } = base.payload;
    const original = { ...base, extension: { a: 2 }, payload: { ...payload, scenarioTitleHint: '保留', answers: { question: '答案' }, result: { text: '结果扩展' }, extension: [3] } };
    const legacy = { isAdvancedVisible: true, scenarioTitleHint: '旧标题', selectedLanguage: 'en', fieldsToKeepEmpty: [], unknown: [1, 2] };
    const storage = memoryStorage({ [SCENARIO_PAGE_DRAFT_KEY]: JSON.stringify(original), [SCENARIO_PREFERENCE_KEY]: JSON.stringify(legacy) });
    expect(migrateScenarioAdvancedPreference(storage)).toEqual({ value: true, failed: false });
    expect(JSON.parse(storage.getItem(SCENARIO_PAGE_DRAFT_KEY)!)).toEqual({ ...original, payload: { ...original.payload, isAdvancedVisible: true } });
    const { isAdvancedVisible: _old, ...remaining } = legacy;
    expect(JSON.parse(storage.getItem(SCENARIO_PREFERENCE_KEY)!)).toEqual(remaining);
    const after = storage.dump(); expect(migrateScenarioAdvancedPreference(storage)).toEqual({ value: true, failed: false }); expect(storage.dump()).toEqual(after);
  });

  it('seeds first-write from the existing legacy page initial values without losing unrelated preferences', () => {
    const legacy = { generationMode: 'stream', scenarioTitleHint: '旧标题', selectedLanguage: 'en', fieldsToKeepEmpty: ['elements.roles', 'unknown'], isAdvancedVisible: true, extension: 1 };
    const storage = memoryStorage({ [SCENARIO_PREFERENCE_KEY]: JSON.stringify(legacy) });
    expect(migrateScenarioAdvancedPreference(storage).failed).toBe(false);
    expect(readScenarioPageDraftState(storage).stored?.payload).toMatchObject({ generationMode: 'stream', scenarioTitleHint: '旧标题', selectedLanguage: 'en', fieldsToKeepEmpty: ['elements.roles'], isAdvancedVisible: true });
    expect(JSON.parse(storage.getItem(SCENARIO_PREFERENCE_KEY)!)).toMatchObject({ extension: 1, scenarioTitleHint: '旧标题' });
  });

  it('canonical false wins conflicts and survives reset, empty page autosave, cleanup failure and re-entry', () => {
    const storage = memoryStorage({ [SCENARIO_PREFERENCE_KEY]: JSON.stringify({ isAdvancedVisible: true }) });
    storage.removeItem = () => { throw new Error('blocked cleanup'); };
    const adapter = createScenarioPagePreferenceAdapter(storage);
    expect(adapter.read()).toEqual({ status: 'ready', values: { isAdvancedVisible: true } });
    expect(adapter.reset()).toBe(true);
    expect(JSON.parse(storage.getItem(SCENARIO_PREFERENCE_KEY)!)).toEqual({ isAdvancedVisible: true });
    for (let i = 0; i < 3; i++) {
      expect(migrateScenarioAdvancedPreference(storage)).toEqual({ value: false, failed: false });
      const restored = readScenarioPageDraftState(storage); expect(restored.stored?.payload.isAdvancedVisible).toBe(false);
      expect(writeScenarioPageDraft(restored.stored!.payload, storage)).not.toBeNull();
      expect(adapter.read()).toEqual({ status: 'ready', values: { isAdvancedVisible: false } });
    }
  });

  it('failed canonical migration preserves both raw sources and keeps the remembered value available', () => {
    const legacy = JSON.stringify({ isAdvancedVisible: true, extension: '保留' });
    const base = createEmptyScenarioPageDraftDocument(); const { isAdvancedVisible: _advanced, ...payload } = base.payload;
    const canonical = JSON.stringify({ ...base, payload });
    const storage = memoryStorage({ [SCENARIO_PREFERENCE_KEY]: legacy, [SCENARIO_PAGE_DRAFT_KEY]: canonical });
    storage.setItem = () => { throw new Error('quota'); };
    expect(migrateScenarioAdvancedPreference(storage)).toEqual({ value: true, failed: true });
    const adapter = createScenarioPagePreferenceAdapter(storage);
    expect(adapter.read()).toEqual({ status: 'ready', values: { isAdvancedVisible: true } });
    expect(adapter.reset()).toBe(false); expect(adapter.writeField('isAdvancedVisible', false)).toBe(false);
    expect(storage.getItem(SCENARIO_PREFERENCE_KEY)).toBe(legacy); expect(storage.getItem(SCENARIO_PAGE_DRAFT_KEY)).toBe(canonical);
  });

  it('page persistence retains canonical unknown extensions and explicit clearing cannot resurrect legacy', () => {
    const original = { ...createEmptyScenarioPageDraftDocument(), extension: 3, payload: { ...createEmptyScenarioPageDraftDocument().payload, answers: { q: '答案' }, extension: { result: '保留' } } };
    localStorage.setItem(SCENARIO_PAGE_DRAFT_KEY, JSON.stringify(original));
    localStorage.setItem(SCENARIO_PREFERENCE_KEY, JSON.stringify({ isAdvancedVisible: true }));
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(clearScenarioPageDraft()).toBe(true);
    expect(migrateScenarioAdvancedPreference()).toEqual({ value: false, failed: false });
    const stored = parseScenarioPageDraftDocument(localStorage.getItem(SCENARIO_PAGE_DRAFT_KEY)!);
    expect(stored).toMatchObject({ extension: 3, payload: { extension: { result: '保留' }, answers: {}, isAdvancedVisible: false } });
  });

  it.each(['{broken', '[]', '{}', JSON.stringify({ ...createEmptyScenarioPageDraftDocument(), version: 2 }), JSON.stringify({ ...createEmptyScenarioPageDraftDocument(), payload: { isAdvancedVisible: true } }), JSON.stringify({ ...createEmptyScenarioPageDraftDocument(), extension: 'x'.repeat(4 * 1024 * 1024) })])('never rewrites invalid/unsupported canonical source', (raw) => {
    const storage = memoryStorage({ [SCENARIO_PAGE_DRAFT_KEY]: raw, [SCENARIO_PREFERENCE_KEY]: '{"isAdvancedVisible":true}' });
    const adapter = createScenarioPagePreferenceAdapter(storage);
    expect(adapter.read()).toEqual({ status: 'corrupted' }); expect(adapter.writeField('isAdvancedVisible', false)).toBe(false); expect(adapter.reset()).toBe(false);
    expect(storage.getItem(SCENARIO_PAGE_DRAFT_KEY)).toBe(raw); expect(storage.getItem(SCENARIO_PREFERENCE_KEY)).toBe('{"isAdvancedVisible":true}');
  });
});

describe('Sublimation existing independent preference owners', () => {
  it('registers existing owners and does not create a second Web Creator owner', () => {
    expect(WEB_PAGE_PREFERENCE_SOURCES).toContain(WEB_SUBLIMATION_PREFERENCES); expect(WEB_PAGE_PREFERENCE_SOURCES).toContain(WEB_SUBLIMATION_STATE_PREFERENCES);
    expect(WEB_PAGE_PREFERENCE_SOURCES.some((source) => source.pageId === 'creator')).toBe(false);
    expect(WEB_DETAILS_PREFERENCES.description).toContain('/creator');
  });

  it('only resets advanced visibility in the content-bearing general owner', () => {
    const base = { isAdvancedVisible: true, userGuidance: '指导语', questionnaireSelections: [{ source: 'preset', presetId: '保留' }], fieldsToPreserve: ['name'], version: 99, extension: { result: '不变' } };
    const storage = memoryStorage({ [SUBLIMATION_PREFERENCE_KEY]: JSON.stringify(base) });
    const adapter = createPagePreferencesAdapter(WEB_SUBLIMATION_PREFERENCES, storage);
    expect(adapter.writeField('isAdvancedVisible', false)).toBe(true); expect(adapter.reset()).toBe(true);
    const { isAdvancedVisible: _advanced, ...expected } = base;
    expect(JSON.parse(storage.getItem(SUBLIMATION_PREFERENCE_KEY)!)).toEqual(expected);
    expect(writeSublimationPreferences(storage, { isAdvancedVisible: true })).toBe(true);
    expect(JSON.parse(storage.getItem(SUBLIMATION_PREFERENCE_KEY)!)).toEqual(base);
  });

  it('resets the five existing strategies to actual page defaults while retaining extensions', () => {
    const storage = memoryStorage({ [SUBLIMATION_STATE_PREF_KEY]: JSON.stringify({ readArenaHistory: false, writeArenaHistory: false, readCurrentState: false, writeCurrentState: false, arenaHistoryRetentionStrategy: 'reset-all', version: 99, extension: [1] }) });
    const adapter = createPagePreferencesAdapter(WEB_SUBLIMATION_STATE_PREFERENCES, storage);
    expect(adapter.reset()).toBe(true); expect(JSON.parse(storage.getItem(SUBLIMATION_STATE_PREF_KEY)!)).toEqual({ version: 99, extension: [1] });
    expect(readSublimationStatePreferences(storage, SUBLIMATION_STATE_PREF_KEY)).toEqual(DEFAULT_SUBLIMATION_STATE_PREFERENCES);
    expect(writeSublimationStatePreferences(storage, SUBLIMATION_STATE_PREF_KEY, DEFAULT_SUBLIMATION_STATE_PREFERENCES)).toBe(true);
    expect(JSON.parse(storage.getItem(SUBLIMATION_STATE_PREF_KEY)!)).toEqual({ ...DEFAULT_SUBLIMATION_STATE_PREFERENCES, version: 99, extension: [1] });
  });

  it.each([WEB_SUBLIMATION_PREFERENCES, WEB_SUBLIMATION_STATE_PREFERENCES])('handles first write, malformed data and storage failures at $pageId', (source) => {
    const field = source.fields[0].key; const storage = memoryStorage(); const adapter = createPagePreferencesAdapter(source, storage);
    expect(adapter.writeField(field, true)).toBe(true); expect(adapter.read()).toEqual({ status: 'ready', values: { [field]: true } });
    for (const raw of ['{broken', '[]', JSON.stringify({ [field]: 'yes' }), JSON.stringify({ extension: 'x'.repeat(4 * 1024 * 1024) })]) {
      storage.setItem(source.storageKey, raw); expect(adapter.read()).toEqual({ status: 'corrupted' }); expect(adapter.writeField(field, false)).toBe(false); expect(adapter.reset()).toBe(false); expect(storage.getItem(source.storageKey)).toBe(raw);
    }
    storage.setItem(source.storageKey, '{}'); storage.setItem = () => { throw new Error('quota'); };
    expect(adapter.writeField(field, true)).toBe(false); expect(adapter.reset()).toBe(false); expect(storage.getItem(source.storageKey)).toBe('{}');
  });
});
