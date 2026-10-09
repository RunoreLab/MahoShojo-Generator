import { describe, expect, it, vi } from 'vitest';
import { buildUnsignedMagicalGirlDetailsCard } from '@mahoshojo/ai-core/magical-girl-details-generation';
import { buildUnsignedCanshouCard } from '@mahoshojo/ai-core/canshou-generation';
import type { CardRepository } from '@mahoshojo/local-library/repository';
import { createPagePreferencesAdapter, resolvePagePreferenceFieldDefault } from '@mahoshojo/ui-web/settings';
import { DESKTOP_CANSHOU_PREFERENCES, DESKTOP_DETAILS_PREFERENCES } from '../src/app/settings-page-preferences';
import { DetailsSession } from '../src/features/details/session';
import { CanshouSession } from '../src/features/canshou/session';
import { createEmptyQuestionnaireDraftDocument } from '../src/features/questionnaire/session';

const makeStorage = (initial: string | null = null) => {
  let raw = initial;
  return {
    getItem: () => raw,
    setItem: vi.fn((_key: string, value: string) => { raw = value; }),
    removeItem: vi.fn(() => { raw = null; }),
  };
};

const base = createEmptyQuestionnaireDraftDocument();
const initialDraft = { answers: {}, language: 'zh-CN' };
const generalCard = { name: '保留角色', content: '原始正文', userAnswers: [] };
const output = { mode: 'direct-local', cardKind: 'general', card: generalCard, rawText: '原始输出', phase: 'completed' };
const cases = [
  {
    source: DESKTOP_DETAILS_PREFERENCES,
    Session: DetailsSession,
    cardKind: 'magical-girl',
    structuredCard: buildUnsignedMagicalGirlDetailsCard({
      codename: '百合', appearance: { outfit: '', accessories: '', colorScheme: '', overallLook: '' },
      magicConstruct: { name: '', form: '', basicAbilities: [], description: '' },
      wonderlandRule: { name: '', description: '', tendency: '', activation: '' },
      blooming: { name: '', evolvedAbilities: [], evolvedForm: '', evolvedOutfit: '', powerLevel: '' },
      analysis: { personalityAnalysis: '', abilityReasoning: '', coreTraits: [], predictionBasis: '', background: { belief: '', bonds: '' } },
    }, []),
  },
  {
    source: DESKTOP_CANSHOU_PREFERENCES,
    Session: CanshouSession,
    cardKind: 'canshou',
    structuredCard: buildUnsignedCanshouCard({
      name: '巢穴回声', coreConcept: '思念成兽', coreEmotion: '孤独', evolutionStage: '幼年期',
      appearance: '雾状', materialAndSkin: '雾', featuresAndAppendages: '风铃尾',
      attackMethod: '回声震荡', specialAbility: '声音重现', origin: '废弃巢穴',
      birthEnvironment: '地下空洞', researcherNotes: '观察',
    }, []),
  },
];

describe.each(cases)('$source.pageId settings respect the questionnaire draft owner', ({ source, Session, cardKind, structuredCard }) => {
  it.each([
    ['malformed JSON', '{broken'],
    ['non-object', '[]'],
    ['future version', JSON.stringify({ ...base, version: 99, showDetails: true, questionnaireSelections: [{ future: '保留来源' }] })],
    ['missing answers', JSON.stringify({ version: 1, language: 'zh-CN' })],
    ['invalid answer', JSON.stringify({ ...base, answers: { q1: 7 } })],
    ['invalid language', JSON.stringify({ ...base, language: null })],
    ['invalid output mode', JSON.stringify({ ...base, output: { ...output, mode: 'future-mode' } })],
    ['invalid output body', JSON.stringify({ ...base, output: { ...output, rawText: {} } })],
    ['completed without card', JSON.stringify({ ...base, output: { ...output, card: null } })],
    ['idle with card', JSON.stringify({ ...base, output: { ...output, phase: 'idle' } })],
    ['invalid structured card', JSON.stringify({ ...base, output: { ...output, cardKind: undefined, card: {} } })],
    ['oversized raw document', JSON.stringify({ ...base, extension: 'x'.repeat(4 * 1024 * 1024) })],
  ])('rejects %s without modifying any original bytes', (_label, raw) => {
    const storage = makeStorage(raw);
    const execute = vi.fn();
    const session = new Session({ storage, repository: {} as CardRepository, initialDraft, execute });
    expect(session.isDraftBlocked()).toBe(true);

    const adapter = createPagePreferencesAdapter(source, storage);
    expect(adapter.read()).toEqual({ status: 'corrupted' });
    expect(adapter.writeField('showDetails', false)).toBe(false);
    expect(adapter.reset()).toBe(false);
    session.dispose();
    expect(storage.getItem()).toBe(raw);
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it.each(['direct-local', 'direct-remote', 'hosted-stream', 'hosted-json'])('patch/reset preserves original values for %s results without adopting normalized parser output', (mode) => {
    for (const result of [{ cardKind: 'general', card: generalCard }, { cardKind, card: structuredCard }]) {
      const original = {
        ...base,
        answers: { q1: '保留回答' }, language: 'en', savedAt: 123,
        imageSaveMode: 'modal', jsonSaveMode: 'text', showDetails: true, allowMultipleQuestionnaires: false,
        // Owner 恢复时可丢弃无效选择、剥除非 hosted 签名；设置只能校验，不能借机归一化。
        questionnaireSelections: [{ future: '保留来源' }],
        extension: { nested: ['未知', 7, null] },
        output: {
          ...output, mode, ...result,
          card: { ...result.card, signature: '原签名字段', extension: { preserve: true } },
          extension: { raw: ['结果扩展'] },
        },
      };
      const storage = makeStorage(JSON.stringify(original));
      const adapter = createPagePreferencesAdapter(source, storage);
      expect(adapter.read()).toEqual({ status: 'ready', values: {
        language: 'en', imageSaveMode: 'modal', jsonSaveMode: 'text', showDetails: true,
        allowMultipleQuestionnaires: false, questionnaireSelections: original.questionnaireSelections,
      } });
      expect(adapter.writeField('showDetails', false)).toBe(true);
      expect(JSON.parse(storage.getItem()!)).toEqual({ ...original, showDetails: false });
      expect(adapter.reset()).toBe(true);
      const preserved: Record<string, unknown> = { ...original };
      for (const key of ['imageSaveMode', 'jsonSaveMode', 'showDetails', 'allowMultipleQuestionnaires', 'questionnaireSelections']) delete preserved[key];
      expect(JSON.parse(storage.getItem()!)).toEqual(preserved);

      const session = new Session({ storage, repository: {} as CardRepository, initialDraft });
      expect(session.isDraftBlocked()).toBe(false);
      expect(session.getSnapshot().pendingRestore).toBe(true);
      session.dispose();
    }
  });

  it.each([
    ['imageSaveMode', 'modal'], ['jsonSaveMode', 'text'], ['showDetails', true], ['allowMultipleQuestionnaires', true],
  ])('first write of %s still uses the owner factory and restores without a gate', (field, value) => {
    const storage = makeStorage();
    expect(createPagePreferencesAdapter(source, storage).writeField(field as string, value)).toBe(true);
    expect(JSON.parse(storage.getItem()!)).toEqual({ ...base, [field as string]: value });
    const session = new Session({ storage, repository: {} as CardRepository, initialDraft });
    expect(session.isDraftBlocked()).toBe(false);
    expect(session.getSnapshot().pendingRestore).toBe(false);
    expect(session.getSnapshot().draft).toMatchObject({ [field as string]: value });
    session.dispose();
  });

  it('retains exactly the existing fields, defaults and non-resettable language', () => {
    expect(source.fields.map((field) => [field.key, field.kind, resolvePagePreferenceFieldDefault(field), field.notResettable === true])).toEqual([
      ['language', 'readonly', 'zh-CN', true],
      ['imageSaveMode', 'select', 'download', false],
      ['jsonSaveMode', 'select', 'download', false],
      ['showDetails', 'boolean', false, false],
      ['allowMultipleQuestionnaires', 'boolean', false, false],
      ['questionnaireSelections', 'count', undefined, false],
    ]);
  });
});
