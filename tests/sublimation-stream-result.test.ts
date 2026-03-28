import { describe, expect, test } from 'bun:test';

import {
  buildStreamedSublimationResultCard,
  extractSublimationEventFromMarkdown,
} from '@/lib/sublimation/stream-result';

const sourceHistory = {
  attributes: {
    world_line_id: 'world-old',
    created_at: '2026-03-01T00:00:00.000Z',
    updated_at: '2026-03-10T00:00:00.000Z',
    sublimation_count: 2,
    last_sublimation_at: '2026-03-10T00:00:00.000Z',
  },
  entries: [
    { id: 4, type: 'battle', title: '普通对战', impact: '留下旧伤' },
    { id: 8, type: 'sublimation', title: '一转', impact: '觉醒' },
  ],
};

describe('sublimation stream result', () => {
  test('extractSublimationEventFromMarkdown: 能从“## 升华事件”段提取标题与影响', () => {
    const markdown = [
      '# 白百合「晨曦之刃」',
      '',
      '## 升华事件',
      '- 标题：于灰烬中重燃',
      '- 影响：她重建了对伙伴的信任，并重塑了战斗风格。',
      '',
      '## 设定更新',
      '其余正文……',
    ].join('\n');

    const event = extractSublimationEventFromMarkdown(markdown, '白百合');
    expect(event.title).toBe('于灰烬中重燃');
    expect(event.impact).toBe('她重建了对伙伴的信任，并重塑了战斗风格。');
  });

  test('buildStreamedSublimationResultCard: keep-all 时保留历史/当前状态并清除旧签名', () => {
    const markdown = [
      '# 白百合「晨曦之刃」',
      '',
      '## 升华事件',
      '- 标题：于灰烬中重燃',
      '- 影响：她重建了对伙伴的信任，并重塑了战斗风格。',
      '',
      '## 正文',
      '……',
    ].join('\n');

    const sourceCard = {
      codename: '白百合',
      name: '林悠',
      signature: 'legacy-signature',
      arena_history: sourceHistory,
      current_state: {
        summary: '旧状态',
        fields: [{ label: '体力', type: 'number', value: 30 }],
        updated_at: '2026-03-12T00:00:00.000Z',
      },
    };

    const result = buildStreamedSublimationResultCard({
      markdown,
      originalCharacterData: sourceCard,
      fallbackName: '白百合',
      defaultName: '角色',
      writeArenaHistory: true,
      retentionStrategy: 'keep-all',
      finalUserGuidance: null,
      hasNarrativeHistory: false,
      hasQuestionnaireLore: false,
      hasNonNativeQuestionnaireLore: false,
      questionnaireSelectionCount: 0,
      isNative: true,
      nowISO: '2026-03-28T10:00:00.000Z',
      createWorldLineId: () => 'world-new',
    });

    expect(result.templateId).toBe('通用角色');
    expect(result.current_state).toEqual(sourceCard.current_state);
    expect(result.current_state).not.toBe(sourceCard.current_state);
    expect(result.arena_history.entries.map((item: any) => item.type)).toEqual(['battle', 'sublimation', 'sublimation']);
    expect(result.arena_history.entries[2]?.id).toBe(9);
    expect('signature' in result).toBe(false);
  });

  test('buildStreamedSublimationResultCard: writeArenaHistory=false 时保留源卡历史', () => {
    const sourceCard = {
      codename: '白百合',
      arena_history: sourceHistory,
    };

    const result = buildStreamedSublimationResultCard({
      markdown: '# 白百合',
      originalCharacterData: sourceCard,
      fallbackName: '白百合',
      defaultName: '角色',
      writeArenaHistory: false,
      retentionStrategy: 'keep-all',
    });

    expect(result.arena_history).toEqual(sourceCard.arena_history);
    expect(result.arena_history).not.toBe(sourceCard.arena_history);
  });
});
