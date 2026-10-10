import { describe, expect, it } from 'vitest';
import type { AdjudicatorEvent } from '../src/arena-types';
import * as events from '../src/arena-adjudication-events';
import { buildArenaQuestionnaireRequest } from '../src/arena-questionnaire-request';
import { buildQuestionnaireSelectionLoreText, type QuestionnaireSelection } from '../src/questionnaire-selection';
import * as legacy from './fixtures/arena-source-events-legacy';

const event = (id: string, sourceKey?: string): AdjudicatorEvent => ({
  id, description: id, type: 'binary', probability: 50, ...(sourceKey ? { sourceKey } : {}),
});

describe('高级单次配置纯规则与提取前 Web 双跑', () => {
  it.each([
    null, {}, { id: ' id ' }, { filename: ' file ', fileName: ' scenario ' },
    { sourceDataCardId: ' card ', filename: 'file', fileName: 'scenario', sourceDataCardName: 'label' },
    { adjudicationSourceKey: ' explicit ', sourceDataCardId: 'card', filename: 'file' },
    { sourceDataCardName: ' label ' },
  ])('来源 key 和角色删除标识与原 store 一致 %#', (source) => {
    expect(events.getCombatantAdjudicationSourceKey(source)).toBe(legacy.getCombatantSourceKey(source));
    expect(events.getScenarioAdjudicationSourceKey(source)).toBe(legacy.getScenarioSourceKey(source));
    for (const identifier of ['', 'id', 'card', 'file', 'explicit', 'data_card:card', 'label:label', null]) {
      expect(events.matchesArenaCombatantIdentifier(source, identifier)).toBe(legacy.matchesCombatantIdentifier(source, identifier));
    }
  });

  it('事件标记/替换/移除的同 key 全局语义保持，手动保留，无引用计数', () => {
    const current = [event('manual'), event('old-a', 'data_card:a'), event('other', 'file:b')];
    const incoming = [event('new-a', 'wrong'), event('next')];
    for (const key of [undefined, null, '', ' ', ' data_card:a ']) {
      expect(events.appendAdjudicationEventsFromSource(current, incoming, key)).toStrictEqual(legacy.appendEvents(current, incoming, key));
      expect(events.markAdjudicationEventsWithSource(incoming, key ?? null)).toStrictEqual(legacy.markAdjudicationEventsWithSource(incoming, key ?? null));
      expect(events.applyAdjudicationEventSourceRemoval(current, key ?? '')).toStrictEqual(legacy.applyAdjudicationEventSourceRemoval(current, key ?? ''));
    }
    for (const keys of [[], [' '], ['data_card:a'], [' data_card:a ', 'file:b']]) {
      expect(events.removeAdjudicationEventsForKeys(current, keys)).toStrictEqual(legacy.removeAdjudicationEventsForKeys(current, keys));
    }
    for (const empty of [null, undefined, {}, []]) {
      expect(events.appendAdjudicationEventsFromSource(current, empty, 'data_card:a')).toBe(
        legacy.appendEvents(current, empty, 'data_card:a'),
      );
    }
    const replaced = events.appendAdjudicationEventsFromSource(current, incoming, 'data_card:a');
    expect(replaced.map((entry) => entry.id)).toEqual(['manual', 'other', 'new-a', 'next']);
    expect(events.appendAdjudicationEventsFromSource(replaced, incoming, 'data_card:a')).toStrictEqual(replaced);
    expect(events.removeAdjudicationEventsForKeys(replaced, ['data_card:a']).map((entry) => entry.id)).toEqual(['manual', 'other']);
    expect(incoming[0].sourceKey).toBe('wrong');
  });

  it('导入 gate 空/legacy 不替换，接受后才标来源，不执行事件或提升素材/Lore', () => {
    const current = [event('old', 'label:来源'), event('manual')];
    for (const input of [undefined, null, {}, [], [{ event: '旧事件', probability: 50 }]]) {
      const prepared = events.prepareAdjudicationEventImport(input, '来源');
      expect(prepared.status).toBe(Array.isArray(input) && input.length ? 'legacy' : 'empty');
      const next = prepared.status === 'ready' ? events.appendAdjudicationEventsFromSource(current, prepared.events, prepared.sourceKey) : current;
      expect(next).toBe(current);
    }
    const prepared = events.prepareAdjudicationEventImport([event('imported')], '来源');
    expect(prepared).toStrictEqual({ status: 'ready', events: [event('imported', 'label:来源')], sourceKey: 'label:来源' });
    expect(events.prepareAdjudicationEventImport([event('imported')], '来源', '')).toStrictEqual({ status: 'ready', events: [event('imported')], sourceKey: '' });
  });

  it('问卷请求逐字保 source/preset/database/useLore 和旧 Lore 拼接，不传嵌入 events', () => {
    const q = { id: 'q', title: '问卷', kind: 'magical-girl' as const, questions: [], loreMarkdown: '  正文  ', adjudicationEvents: [event('embedded')] };
    const selections: QuestionnaireSelection[] = [
      { source: 'preset', questionnaire: q, dataCardId: 'must-not-leak' },
      { source: 'database', dataCardId: 'cloud-id', questionnaire: { ...q, id: 'q2' }, useLore: false },
      { source: 'upload', questionnaire: { ...q, id: 'q3', loreMarkdown: '' } },
    ];
    for (const selected of [[], selections, [...selections].reverse()]) {
      expect(buildArenaQuestionnaireRequest(selected)).toStrictEqual(legacy.buildArenaQuestionnaireRequest(selected));
      expect(JSON.stringify(buildArenaQuestionnaireRequest(selected))).toBe(JSON.stringify(legacy.buildArenaQuestionnaireRequest(selected)));
    }
    expect(buildQuestionnaireSelectionLoreText(selections)).toBe('【设定来源：问卷】\n正文');
    expect(JSON.stringify(buildArenaQuestionnaireRequest(selections))).not.toContain('adjudicationEvents');
    expect(buildArenaQuestionnaireRequest(selections).questionnaireSelections?.[2]).not.toHaveProperty('dataCardId');
  });
});
