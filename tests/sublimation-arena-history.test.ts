import { describe, expect, test } from 'bun:test';

import {
  DEFAULT_ARENA_HISTORY_RETENTION_STRATEGY,
  applySublimationArenaHistoryStrategy,
  buildSublimationHistoryEntry,
  normalizeArenaHistoryRetentionStrategy,
} from '@/lib/sublimation/arena-history';
import type { ArenaHistoryRetentionStrategy } from '@/lib/sublimation/arena-history';

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

describe('sublimation arena history retention', () => {
  test('keep-all: 保留全部历史并追加新的升华记录', () => {
    const entry = buildSublimationHistoryEntry({
      title: '二转',
      impact: '完成蜕变',
      participantsName: '白百合',
      finalUserGuidance: null,
      hasQuestionnaireLore: false,
      questionnaireSelectionCount: 0,
      nonNativeDataInvolved: false,
    });

    const result = applySublimationArenaHistoryStrategy({
      sourceArenaHistory: sourceHistory,
      strategy: 'keep-all',
      newEntry: entry,
      nowISO: '2026-03-28T10:00:00.000Z',
      createWorldLineId: () => 'world-new',
    });

    expect(result.attributes.world_line_id).toBe('world-old');
    expect(result.attributes.sublimation_count).toBe(3);
    expect(result.entries.map((item: any) => item.type)).toEqual(['battle', 'sublimation', 'sublimation']);
    expect(result.entries[2]?.id).toBe(9);
  });

  test('keep-sublimation-only: 只保留升华记录并追加新记录', () => {
    const result = applySublimationArenaHistoryStrategy({
      sourceArenaHistory: sourceHistory,
      strategy: 'keep-sublimation-only',
      newEntry: buildSublimationHistoryEntry({
        title: '二转',
        impact: '完成蜕变',
        participantsName: '白百合',
        finalUserGuidance: '朝守护方向成长',
        hasQuestionnaireLore: true,
        questionnaireSelectionCount: 2,
        nonNativeDataInvolved: true,
      }),
      nowISO: '2026-03-28T10:00:00.000Z',
      createWorldLineId: () => 'world-new',
    });

    expect(result.attributes.world_line_id).toBe('world-old');
    expect(result.entries.map((item: any) => item.type)).toEqual(['sublimation', 'sublimation']);
    expect(result.entries[1]?.metadata?.user_guidance).toBe('朝守护方向成长');
  });

  test('运行时非法策略会退回 keep-sublimation-only', () => {
    const result = applySublimationArenaHistoryStrategy({
      sourceArenaHistory: sourceHistory,
      strategy: ('  ???  ' as ArenaHistoryRetentionStrategy),
      newEntry: buildSublimationHistoryEntry({
        title: '二转',
        impact: '完成蜕变',
        participantsName: '白百合',
        finalUserGuidance: '朝守护方向成长',
        hasQuestionnaireLore: true,
        questionnaireSelectionCount: 2,
        nonNativeDataInvolved: true,
      }),
      nowISO: '2026-03-28T10:00:00.000Z',
      createWorldLineId: () => 'world-new',
    });

    expect(result.attributes.world_line_id).toBe('world-old');
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0]?.id).toBe(8);
    expect(result.entries.map((item: any) => item.type)).toEqual(['sublimation', 'sublimation']);
    expect(result.entries[1]?.metadata?.user_guidance).toBe('朝守护方向成长');
  });

  test('非 reset 策略保留 created_at，其余属性基于 nowISO', () => {
    const now = '2026-03-28T10:00:00.000Z';
    const result = applySublimationArenaHistoryStrategy({
      sourceArenaHistory: sourceHistory,
      strategy: 'keep-all',
      newEntry: buildSublimationHistoryEntry({
        title: '二转',
        impact: '完成蜕变',
        participantsName: '白百合',
        finalUserGuidance: null,
        hasQuestionnaireLore: false,
        questionnaireSelectionCount: 0,
        nonNativeDataInvolved: false,
      }),
      nowISO: now,
      createWorldLineId: () => 'world-new',
    });

    expect(result.attributes.created_at).toBe(sourceHistory.attributes.created_at);
    expect(result.attributes.updated_at).toBe(now);
    expect(result.attributes.last_sublimation_at).toBe(now);
    expect(result.attributes.sublimation_count).toBe(sourceHistory.attributes.sublimation_count + 1);
  });

  test('新 id 应基于依旧保留的升华记录最大 id，且都 canonical 为数字', () => {
    const sourceWithLargeBattleId = {
      ...sourceHistory,
      entries: [
        { id: 100, type: 'battle', title: '准备战斗' },
        { id: '10', type: 'sublimation', title: '一转', impact: '觉醒' },
        { id: 'abc', type: 'sublimation', title: '觉醒后', impact: '增强' },
      ],
    };

    const result = applySublimationArenaHistoryStrategy({
      sourceArenaHistory: sourceWithLargeBattleId,
      strategy: 'keep-sublimation-only',
      newEntry: buildSublimationHistoryEntry({
        title: '二转',
        impact: '完成蜕变',
        participantsName: '白百合',
        finalUserGuidance: null,
        hasQuestionnaireLore: false,
        questionnaireSelectionCount: 0,
        nonNativeDataInvolved: false,
      }),
      nowISO: '2026-03-28T10:00:00.000Z',
      createWorldLineId: () => 'world-new',
    });

    expect(result.entries.map((item: any) => item.id)).toEqual([10, 11, 12]);
    expect(typeof result.entries[2]?.id).toBe('number');
  });

  test('newEntry 非对象仍能返回条目且 id 为 number', () => {
    const result = applySublimationArenaHistoryStrategy({
      sourceArenaHistory: sourceHistory,
      strategy: 'keep-all',
      newEntry: null,
      nowISO: '2026-03-28T10:00:00.000Z',
      createWorldLineId: () => 'world-new',
    });

    expect(result.entries).toHaveLength(3);
    expect(typeof result.entries[2]?.id).toBe('number');
  });

  test('reset-all: 仅保留本次升华记录并重置世界线', () => {
    const result = applySublimationArenaHistoryStrategy({
      sourceArenaHistory: sourceHistory,
      strategy: 'reset-all',
      newEntry: buildSublimationHistoryEntry({
        title: '新世界线开端',
        impact: '抹去旧战痕后重生',
        participantsName: '白百合',
        finalUserGuidance: null,
        hasQuestionnaireLore: false,
        questionnaireSelectionCount: 0,
        nonNativeDataInvolved: true,
      }),
      nowISO: '2026-03-28T10:00:00.000Z',
      createWorldLineId: () => 'world-reset',
    });

    expect(result.attributes.world_line_id).toBe('world-reset');
    expect(result.attributes.created_at).toBe('2026-03-28T10:00:00.000Z');
    expect(result.attributes.sublimation_count).toBe(1);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]?.id).toBe(1);
  });

  test('非法策略值回退为默认 keep-sublimation-only', () => {
    expect(normalizeArenaHistoryRetentionStrategy('  ???  ')).toBe(DEFAULT_ARENA_HISTORY_RETENTION_STRATEGY);
  });
});
