import { describe, expect, it, vi } from 'vitest';
import type { CardRepository } from '@mahoshojo/local-library/repository';
import { createPagePreferencesAdapter, SETTINGS_FIELD_REGISTRY } from '@mahoshojo/ui-web/settings';
import { DESKTOP_FREE_PREFERENCES, DESKTOP_PAGE_PREFERENCE_SOURCES, DESKTOP_DETAILS_PREFERENCES, DESKTOP_CANSHOU_PREFERENCES } from '../src/app/settings-page-preferences';
import { createEmptyFreeDraftDocument, FREE_DRAFT_KEY, FreeSession } from '../src/features/free/session';

const makeStorage = (raw: string | null = null) => {
  let value = raw;
  return { getItem: () => value, setItem: (_key: string, next: string) => { value = next; }, removeItem: () => { value = null; } };
};
const base = createEmptyFreeDraftDocument();
const document = {
  ...base, prompt: '用户原提示', selectedLanguage: 'en', showFieldGuide: true, showLanguageSection: true,
  savedAt: 123, extension: { nested: ['未知', 7] },
  output: { mode: 'direct-local', cardKind: 'general', card: { name: '保留', content: '正文', signature: '不可借校验改写' }, rawText: '原始输出', phase: 'completed', extension: '输出扩展' },
};

describe('Free preferences use the existing draft owner', () => {
  it('registers only the two booleans and matches the actual Desktop owner', () => {
    expect(DESKTOP_PAGE_PREFERENCE_SOURCES).toContain(DESKTOP_FREE_PREFERENCES);
    expect(DESKTOP_FREE_PREFERENCES.fields.map((field) => [field.key, field.defaultValue])).toEqual([['showFieldGuide', false], ['showLanguageSection', false]]);
    const owner = SETTINGS_FIELD_REGISTRY.find((record) => record.id === 'generation.freePreferences')!.owner;
    expect(owner.kind === 'page-preferences' && owner.byHost.desktop).toEqual({ storageKey: FREE_DRAFT_KEY, scope: 'fields' });
  });

  it.each(['showFieldGuide', 'showLanguageSection'])('first write %s restores a legal residue without generation', (field) => {
    const storage = makeStorage(); const execute = vi.fn();
    const adapter = createPagePreferencesAdapter(DESKTOP_FREE_PREFERENCES, storage);
    expect(adapter.writeField(field, true)).toBe(true);
    expect(JSON.parse(storage.getItem()!)).toEqual({ ...base, [field]: true });
    const session = new FreeSession({ storage, execute, repository: {} as CardRepository, initialDraft: createEmptyFreeDraftDocument() });
    expect(session.isDraftBlocked()).toBe(false);
    expect(session.getSnapshot()).toMatchObject({ pendingRestore: false, phase: 'idle', draft: { [field]: true }, card: null });
    expect(execute).not.toHaveBeenCalled(); session.dispose();
  });

  it.each(['direct-local', 'direct-remote', 'hosted-stream', 'hosted-json'])('patch/reset preserves all non-preferences and raw result for %s', (mode) => {
    for (const generationMode of ['stream', 'non-stream']) {
      const original = { ...document, generationMode, output: { ...document.output, mode } };
      const storage = makeStorage(JSON.stringify(original));
      const adapter = createPagePreferencesAdapter(DESKTOP_FREE_PREFERENCES, storage);
      expect(adapter.read()).toEqual({ status: 'ready', values: { showFieldGuide: true, showLanguageSection: true } });
      expect(adapter.writeField('showFieldGuide', false)).toBe(true);
      expect(JSON.parse(storage.getItem()!)).toEqual({ ...original, showFieldGuide: false });
      expect(adapter.reset()).toBe(true);
      const { showFieldGuide: _guide, showLanguageSection: _language, ...preserved } = original;
      expect(JSON.parse(storage.getItem()!)).toEqual(preserved);
      const session = new FreeSession({ storage, repository: {} as CardRepository, initialDraft: base });
      expect(session.isDraftBlocked()).toBe(false); session.restoreDraft(false);
      expect(session.getSnapshot().draft).toMatchObject({ generationMode, prompt: original.prompt, selectedLanguage: 'en' });
      expect(session.getSnapshot().draft.showFieldGuide).toBeUndefined(); session.dispose();
    }
  });

  it.each([
    '{broken', '[]', JSON.stringify({ ...base, version: 2 }), JSON.stringify({ ...base, schemaId: 'future' }),
    JSON.stringify({ ...base, prompt: 5 }), JSON.stringify({ ...base, output: { mode: 'unknown' } }),
    JSON.stringify({ ...document, output: { ...document.output, phase: 'idle' } }),
  ])('rejects invalid or unsupported source without changing its bytes (%s)', (raw) => {
    const storage = makeStorage(raw); const adapter = createPagePreferencesAdapter(DESKTOP_FREE_PREFERENCES, storage);
    expect(adapter.read()).toEqual({ status: 'corrupted' });
    expect(adapter.writeField('showFieldGuide', true)).toBe(false); expect(adapter.reset()).toBe(false);
    expect(storage.getItem()).toBe(raw);
  });

  it('preserves bytes on write failure and rejects an invalid owner factory', () => {
    const raw = JSON.stringify(document); const storage = makeStorage(raw);
    storage.setItem = () => { throw new Error('quota'); };
    const adapter = createPagePreferencesAdapter(DESKTOP_FREE_PREFERENCES, storage);
    expect(adapter.writeField('showLanguageSection', false)).toBe(false); expect(adapter.reset()).toBe(false);
    expect(storage.getItem()).toBe(raw);
    const empty = makeStorage();
    const invalid = createPagePreferencesAdapter({ ...DESKTOP_FREE_PREFERENCES, createDocumentForFirstWrite: () => ({ version: 2 }) }, empty);
    expect(invalid.writeField('showFieldGuide', true)).toBe(false); expect(empty.getItem()).toBeNull();
  });
});


it('keeps both questionnaire preference field registrations unchanged', () => {
  for (const source of [DESKTOP_DETAILS_PREFERENCES, DESKTOP_CANSHOU_PREFERENCES]) {
    expect(source.fields.map((field) => field.key)).toEqual(['language', 'imageSaveMode', 'jsonSaveMode', 'showDetails', 'allowMultipleQuestionnaires', 'questionnaireSelections']);
  }
});
