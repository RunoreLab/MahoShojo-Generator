import { describe, expect, test } from 'bun:test';

import {
  buildAdjudicationRecordMarkdown,
  resolveAdjudicationOutcomeTone,
} from '@/lib/adjudicator/presentation';

describe('adjudicator presentation utils', () => {
  test('resolveAdjudicationOutcomeTone 会统一大成功与大失败的显示色调', () => {
    expect(resolveAdjudicationOutcomeTone('成功')).toBe('success');
    expect(resolveAdjudicationOutcomeTone('大成功')).toBe('success');
    expect(resolveAdjudicationOutcomeTone('失败')).toBe('failure');
    expect(resolveAdjudicationOutcomeTone('大失败')).toBe('failure');
    expect(resolveAdjudicationOutcomeTone('平局')).toBe('neutral');
  });

  test('buildAdjudicationRecordMarkdown 会输出嵌套的随机判定记录 Markdown', () => {
    const markdown = buildAdjudicationRecordMarkdown([
      {
        depth: 0,
        description: '暴雨是否提前降临',
        type: 'binary',
        roll: 12,
        outcome: '大成功',
        details: '掷骰(12) vs 成功率(80%)',
      },
      {
        depth: 1,
        description: '避雷针是否及时生效',
        type: 'binary',
        roll: 88,
        outcome: '失败',
        details: '掷骰(88) vs 成功率(40%)',
      },
    ]);

    expect(markdown).toContain('## 随机判定记录');
    expect(markdown).toContain('- **事件**: 暴雨是否提前降临');
    expect(markdown).toContain('  - **事件**: 避雷针是否及时生效');
    expect(markdown).toContain('**结果**: 大成功 (掷骰(12) vs 成功率(80%))');
  });
});
