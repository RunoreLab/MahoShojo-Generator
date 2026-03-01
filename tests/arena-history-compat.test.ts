import { describe, expect, test } from 'bun:test';
import { filterAndFormatHistory, formatNarrativeHistoryForPrompt } from '@/lib/arena/logic';

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

  test('叙事历史排序应兼容 created_at/updated_at 字段', () => {
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
    expect(oldIndex).toBeLessThan(newIndex);
  });
});
