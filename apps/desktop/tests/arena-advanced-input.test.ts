import { describe, expect, it } from 'vitest';
import { addAdvancedAuxScenario, addAdvancedCombatants, addAdvancedLore, importAdvancedHistory, removeAdvancedAuxScenarios, removeAdvancedCombatants, setAdvancedMainScenario } from '../src/features/arena/advanced-input';
import { arenaReferenceCount, buildDesktopArenaInput, createInitialArenaDraft, validateArenaDraft, type ArenaDraft } from '../src/features/arena/session';
const event = (description: string) => ({ id: description, type: 'binary' as const, description, probability: 100 });
const character = (name: string) => ({ type: 'general-character', data: { name, adjudicationEvents: [event(name)] }, isValid: false, isPreset: false, filename: 'same.json' });
describe('advanced Arena source and history host projections', () => {
  it('replaces nonempty same-source imports, preserves editable events at dispatch and globally removes the selected source', () => {
    let draft: ArenaDraft = { ...createInitialArenaDraft(), adjudicationEvents: [event('手动')] };
    draft = addAdvancedCombatants(draft, [character('首卡')]); draft = addAdvancedCombatants(draft, [character('重导')]);
    expect(draft.adjudicationEvents).toMatchObject([{ description: '手动' }, { description: '重导', sourceKey: 'file:same.json' }]);
    draft = { ...draft, adjudicationEvents: [{ ...event('用户编辑'), sourceKey: 'file:same.json' }] };
    expect(buildDesktopArenaInput(draft, 'arena').adjudicationEvents).toEqual(draft.adjudicationEvents);
    draft = removeAdvancedCombatants(draft, [0]); expect(draft.combatants).toHaveLength(1);
    expect(buildDesktopArenaInput(draft, 'arena').adjudicationEvents).toEqual([]);
  });
  it('inherits main/auxiliary events, keeps empty early-return and never promotes Lore events', () => {
    let draft = setAdvancedMainScenario({ ...createInitialArenaDraft(), battleMode: 'scenario' }, { title: '主', adjudicationEvents: [event('主')] }, 'main.json');
    draft = addAdvancedAuxScenario(draft, { title: '辅1', adjudicationEvents: [event('辅1')] }, 'aux.json', 'one');
    draft = addAdvancedAuxScenario(draft, { title: '辅2', adjudicationEvents: [] }, 'aux.json', 'two'); expect(draft.adjudicationEvents).toHaveLength(2);
    draft = addAdvancedAuxScenario(draft, { title: '辅3', adjudicationEvents: [event('辅3')] }, 'aux.json', 'three');
    expect(draft.adjudicationEvents).toMatchObject([{ description: '主' }, { description: '辅3' }]);
    draft = removeAdvancedAuxScenarios(draft, [0]); expect(draft.auxScenarios).toHaveLength(2); expect(draft.adjudicationEvents).toHaveLength(1);
    draft = addAdvancedLore(draft, { source: 'upload', questionnaire: { id: 'lore', title: 'Lore', kind: 'magical-girl', questions: [], loreMarkdown: '设定', nativeAllowed: true } }, () => 'lore-id');
    expect(draft.selectedQuestionnaires?.[0]?.questionnaire.nativeAllowed).toBe(false);
    expect(buildDesktopArenaInput(draft, 'arena').adjudicationEvents).toHaveLength(1);
    draft = setAdvancedMainScenario(draft, { title: '空新主', adjudicationEvents: [] }, 'main.json'); expect(draft.adjudicationEvents).toEqual([]);
  });
  it('retains imported multi-card raw text while canonical ID collision/order projection remains explicit', () => {
    const text = '  [{"entries":[{"id":"x","title":" 标题 ","content":" 正文 ","unknown":{"deep":true}}]},{"entries":[{"id":"x","content":"后记"}]}]\n';
    let draft = importAdvancedHistory(createInitialArenaDraft(), text, 'append', { name: 'raw.json', now: '2026-10-10T00:00:00Z', createId: () => 'raw' });
    expect(draft.narrativeHistoryEntries.map((item) => item.id)).toEqual(['x', 'x::2']); expect(draft.historyOriginals?.[0]?.text).toBe(text);
    expect(draft.narrativeHistoryEntries[0]).not.toHaveProperty('unknown');
    draft = importAdvancedHistory(draft, '{"entries":[{"id":"y","content":"新正文"}]}', 'replace', { name: 'next.json', now: '2026-10-10T01:00:00Z', createId: () => 'next' });
    expect(draft.narrativeHistoryEntries.map((item) => item.id)).toEqual(['y']); expect(draft.historyOriginals).toHaveLength(2);
    expect(validateArenaDraft(draft, 'arena').historyOriginals?.[0]?.text).toBe(text);
  });
  it('includes Lore in 256 references and rejects corrupt editor drafts without widening existing budgets', () => {
    const base = createInitialArenaDraft(); const draft: ArenaDraft = { ...base, materials: Array.from({ length: 255 }, (_, i) => ({ id: `${i}`, name: `${i}`, content: {}, sourceType: 'raw-json', sourceKind: 'raw-json', fileName: null })) };
    const lore = { source: 'upload' as const, questionnaire: { id: 'lore', kind: 'magical-girl' as const, title: 'Lore', questions: [], loreMarkdown: '设定' } };
    const full = addAdvancedLore(draft, lore, () => 'first'); expect(arenaReferenceCount(full)).toBe(256);
    expect(() => addAdvancedLore(full, { ...lore, questionnaire: { ...lore.questionnaire, id: 'second' } }, () => 'second')).toThrow('256');
    expect(() => validateArenaDraft({ ...base, adjudicationEvents: [null] }, 'arena')).toThrow('判定');
    expect(() => validateArenaDraft({ ...base, historyOriginals: [{ id: 'raw', name: 'raw', text: [], importedAt: '' }] }, 'arena')).toThrow('历史');
    expect(() => validateArenaDraft({ ...base, selectedQuestionnaires: [null] }, 'arena')).toThrow('草稿');
  });
  it('text duplicate filtering uses the original roster and budgets accepted roles only', () => {
    const initial = { ...createInitialArenaDraft(), combatants: Array.from({ length: 32 }, (_, index) => ({ ...character(`${index}`), filename: `${index}.json` })) };
    const warning: string[] = [];
    const repeated = addAdvancedCombatants(initial, [{ ...character('new'), filename: '0.json' }], (value) => warning.push(value), true);
    expect(repeated.combatants).toHaveLength(32); expect(repeated.combatants[0]?.data.name).toBe('0'); expect(repeated.adjudicationEvents).toMatchObject([{ description: 'new' }]); expect(warning).toHaveLength(1);
    const batch = addAdvancedCombatants(createInitialArenaDraft(), [character('one'), character('two')], undefined, true); expect(batch.combatants).toHaveLength(2);
    expect(() => validateArenaDraft({ ...initial, auxScenarios: [{ content: {}, fileName: [] }] }, 'arena')).toThrow('资源');
  });

});
