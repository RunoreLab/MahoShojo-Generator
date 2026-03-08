import { describe, expect, test } from 'bun:test';
import { filterAndFormatHistory, formatNarrativeHistoryForPrompt } from '@/lib/arena/logic';
import {
  extractNarrativeHistoryImportEntries,
  limitNarrativeHistoryEntriesForPrompt,
  mergeNarrativeHistoryEntries,
  migrateLegacyNarrativeHistoryOrder,
  moveNarrativeHistoryEntry,
  reorderNarrativeHistoryEntries,
  sortNarrativeHistoryEntries,
} from '@/lib/narrative-history';

describe('arena 历史命名兼容回归', () => {
  test('纯战斗过滤应兼容 user_guidance 字段', () => {
    const history = {
      attributes: {
        world_line_id: 'world-1',
        created_at: '2026-03-01T00:00:00.000Z',
        updated_at: '2026-03-01T00:00:00.000Z',
        sublimation_count: 0,
        last_sublimation_at: null,
      },
      entries: [
        {
          id: 1,
          type: 'classic',
          title: '应被过滤',
          participants: ['雪绒', '白玫瑰'],
          winner: '雪绒',
          impact: '引导战斗',
          metadata: {
            user_guidance: '请按我指定剧情推进',
            scenario_title: null,
            non_native_data_involved: false,
          },
        },
        {
          id: 2,
          type: 'classic',
          title: '应保留',
          participants: ['雪绒', '白玫瑰'],
          winner: '白玫瑰',
          impact: '正常战斗',
          metadata: {
            user_guidance: null,
            scenario_title: null,
            non_native_data_involved: false,
          },
        },
      ],
    } as any;

    const formatted = filterAndFormatHistory('雪绒', history, ['白玫瑰'], true, null);
    expect(formatted).toContain('应保留');
    expect(formatted).not.toContain('应被过滤');
  });

  test('叙事历史应保留传入顺序，同时兼容 created_at/updated_at 字段', () => {
    const prompt = formatNarrativeHistoryForPrompt([
      {
        id: 'new',
        title: '新记录',
        content: '这是较新的内容',
        created_at: '2026-03-01T12:00:00.000Z',
        updated_at: '2026-03-01T12:00:00.000Z',
      },
      {
        id: 'old',
        title: '旧记录',
        content: '这是较旧的内容',
        created_at: '2026-03-01T08:00:00.000Z',
        updated_at: '2026-03-01T08:00:00.000Z',
      },
    ] as any);

    const oldIndex = prompt.indexOf('旧记录');
    const newIndex = prompt.indexOf('新记录');
    expect(oldIndex).toBeGreaterThanOrEqual(0);
    expect(newIndex).toBeGreaterThanOrEqual(0);
    expect(newIndex).toBeLessThan(oldIndex);
  });

  test('旧版本地缓存迁移后应恢复为按创建时间从旧到新', () => {
    const migrated = migrateLegacyNarrativeHistoryOrder([
      {
        id: 'new',
        title: '新记录',
        content: '这是较新的内容',
        createdAt: '2026-03-01T12:00:00.000Z',
        updatedAt: '2026-03-01T12:00:00.000Z',
      },
      {
        id: 'old',
        title: '旧记录',
        content: '这是较旧的内容',
        createdAt: '2026-03-01T08:00:00.000Z',
        updatedAt: '2026-03-01T08:00:00.000Z',
      },
    ]);

    expect(migrated.map((entry) => entry.id)).toEqual(['old', 'new']);
  });

  test('手动排序工具应支持拖拽换位与上下移动', () => {
    const base = [
      { id: 'a', title: 'A', content: 'A', createdAt: '2026-03-01T08:00:00.000Z', updatedAt: '2026-03-01T08:00:00.000Z' },
      { id: 'b', title: 'B', content: 'B', createdAt: '2026-03-01T09:00:00.000Z', updatedAt: '2026-03-01T09:00:00.000Z' },
      { id: 'c', title: 'C', content: 'C', createdAt: '2026-03-01T10:00:00.000Z', updatedAt: '2026-03-01T10:00:00.000Z' },
    ];

    expect(reorderNarrativeHistoryEntries(base, 'c', 'a').map((entry) => entry.id)).toEqual(['c', 'a', 'b']);
    expect(moveNarrativeHistoryEntry(base, 'b', 'top').map((entry) => entry.id)).toEqual(['b', 'a', 'c']);
    expect(moveNarrativeHistoryEntry(base, 'b', 'down').map((entry) => entry.id)).toEqual(['a', 'c', 'b']);
  });

  test('提示词读取条数应按当前提示词顺序截取末尾内容', () => {
    const ordered = [
      { id: 'a', title: 'A', content: 'A', createdAt: '2026-03-01T08:00:00.000Z', updatedAt: '2026-03-01T08:00:00.000Z' },
      { id: 'b', title: 'B', content: 'B', createdAt: '2026-03-01T09:00:00.000Z', updatedAt: '2026-03-01T09:00:00.000Z' },
      { id: 'c', title: 'C', content: 'C', createdAt: '2026-03-01T10:00:00.000Z', updatedAt: '2026-03-01T10:00:00.000Z' },
    ];

    expect(limitNarrativeHistoryEntriesForPrompt(ordered, 2).map((entry) => entry.id)).toEqual(['b', 'c']);
    expect(sortNarrativeHistoryEntries(ordered, 'prompt_order').map((entry) => entry.id)).toEqual(['a', 'b', 'c']);
  });

  test('应支持从多张叙事历史数据卡数组中提取并拼接 entries', () => {
    const extracted = extractNarrativeHistoryImportEntries([
      {
        templateId: 'narrative-history',
        version: 1,
        entries: [{ id: 'a', title: 'A', content: 'A', createdAt: '2026-03-01T08:00:00.000Z', updatedAt: '2026-03-01T08:00:00.000Z' }],
      },
      {
        templateId: 'narrative-history',
        version: 1,
        data: {
          entries: [{ id: 'b', title: 'B', content: 'B', createdAt: '2026-03-01T09:00:00.000Z', updatedAt: '2026-03-01T09:00:00.000Z' }],
        },
      },
    ] as any);

    expect(extracted.groupCount).toBe(2);
    expect(Array.isArray(extracted.entries)).toBe(true);
    expect(extracted.entries).toHaveLength(2);
  });

  test('追加导入时应保留现有顺序，并自动处理重复 id', () => {
    const current = [
      { id: 'same', title: '旧条目', content: '旧', createdAt: '2026-03-01T08:00:00.000Z', updatedAt: '2026-03-01T08:00:00.000Z' },
    ];
    const imported = [
      { id: 'same', title: '新条目 1', content: '新1', createdAt: '2026-03-01T09:00:00.000Z', updatedAt: '2026-03-01T09:00:00.000Z' },
      { id: 'same', title: '新条目 2', content: '新2', createdAt: '2026-03-01T10:00:00.000Z', updatedAt: '2026-03-01T10:00:00.000Z' },
    ];

    const merged = mergeNarrativeHistoryEntries(current, imported, 'append');
    expect(merged.map((entry) => entry.title)).toEqual(['旧条目', '新条目 1', '新条目 2']);
    expect(new Set(merged.map((entry) => entry.id)).size).toBe(3);
  });
});
