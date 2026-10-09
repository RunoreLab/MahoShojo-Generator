import { expect, it } from 'vitest';
import { createPagePreferencesAdapter, SETTINGS_FIELD_REGISTRY } from '@mahoshojo/ui-web/settings';
import { WEB_FREE_PREFERENCES, WEB_PAGE_PREFERENCE_SOURCES, WEB_DETAILS_PREFERENCES, WEB_CANSHOU_PREFERENCES } from '@/lib/settings/page-preferences';
import { createEmptyFreeDraftDocument, FREE_DRAFT_KEY, parseFreeDraftDocument } from '@/lib/free/draft';
const makeStorage = (raw: string | null = null) => {
  let value = raw;
  return { getItem: () => value, setItem: (_key: string, next: string) => { value = next; }, removeItem: () => { value = null; } };
};
const base = createEmptyFreeDraftDocument();
it('registers only the existing booleans at the existing Web draft owner', () => {
  expect(WEB_PAGE_PREFERENCE_SOURCES).toContain(WEB_FREE_PREFERENCES);
  expect(WEB_FREE_PREFERENCES.fields.map((field) => [field.key, field.defaultValue])).toEqual([['showFieldGuide', false], ['showLanguageSection', false]]);
  const owner = SETTINGS_FIELD_REGISTRY.find((record) => record.id === 'generation.freePreferences')!.owner;
  expect(owner.kind === 'page-preferences' && owner.byHost.web).toEqual({ storageKey: FREE_DRAFT_KEY, scope: 'fields' });
});
it.each(['showFieldGuide', 'showLanguageSection'])('first write %s creates the owner legal empty document', (field) => {
  const storage = makeStorage(); const adapter = createPagePreferencesAdapter(WEB_FREE_PREFERENCES, storage);
  expect(adapter.writeField(field, true)).toBe(true);
  expect(parseFreeDraftDocument(storage.getItem()!)).toEqual({ ...base, [field]: true });
});
it.each(['stream', 'non-stream'])('patch/reset preserves required fields and unknown extensions in %s', (generationMode) => {
  const original = { ...base, generationMode, schemaId: 'general-scenario', prompt: '用户内容', selectedLanguage: 'en', version: 99, output: { rawText: '扩展结果' }, extension: [1, 2] };
  const storage = makeStorage(JSON.stringify(original)); const adapter = createPagePreferencesAdapter(WEB_FREE_PREFERENCES, storage);
  expect(adapter.writeField('showFieldGuide', true)).toBe(true);
  expect(JSON.parse(storage.getItem()!)).toEqual({ ...original, showFieldGuide: true });
  expect(adapter.reset()).toBe(true);
  const { showFieldGuide: _guide, showLanguageSection: _language, ...preserved } = original;
  expect(JSON.parse(storage.getItem()!)).toEqual(preserved);
  expect(parseFreeDraftDocument(storage.getItem()!)).toEqual(preserved);
});
it.each(['{broken', '[]', '{}', JSON.stringify({ ...base, schemaId: 'future' }), JSON.stringify({ ...base, showFieldGuide: 'yes' })])('protects malformed Web source %s', (raw) => {
  const storage = makeStorage(raw); const adapter = createPagePreferencesAdapter(WEB_FREE_PREFERENCES, storage);
  expect(adapter.read()).toEqual({ status: 'corrupted' }); expect(adapter.writeField('showFieldGuide', true)).toBe(false); expect(adapter.reset()).toBe(false);
  expect(storage.getItem()).toBe(raw);
});
it('keeps the old raw document when storage refuses writing', () => {
  const raw = JSON.stringify(base); const storage = makeStorage(raw); storage.setItem = () => { throw new Error('quota'); };
  const adapter = createPagePreferencesAdapter(WEB_FREE_PREFERENCES, storage);
  expect(adapter.writeField('showFieldGuide', true)).toBe(false); expect(adapter.reset()).toBe(false); expect(storage.getItem()).toBe(raw);
});


it('keeps both questionnaire preference field registrations unchanged', () => {
  const common = ['generationMode', 'selectedLanguage', 'imageSaveMode', 'jsonSaveMode', 'showLanguageSection', 'showBulkFillSection', 'showAnswerReview'];
  const tail = ['allowMultipleQuestionnaires', 'showQuestionnaireSettings', 'questionnaireSelections'];
  expect(WEB_DETAILS_PREFERENCES.fields.map((field) => field.key)).toEqual([...common, 'showDetails', ...tail]);
  expect(WEB_CANSHOU_PREFERENCES.fields.map((field) => field.key)).toEqual([...common, ...tail]);
});
