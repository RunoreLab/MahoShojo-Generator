import { describe, expect, it } from 'bun:test';

import { buildDataCardReviewDiff } from '@/lib/data-card-review-diff';

describe('data-card-review-diff', () => {
  it('生成名称、简介与 JSON 字段的结构化差异', () => {
    const diff = buildDataCardReviewDiff({
      originalName: '原版卡片',
      originalDescription: '旧简介',
      originalData: JSON.stringify({
        portrait: 'https://example.com/a.webp',
        profile: {
          title: '旧标题',
          tags: ['a', 'b'],
        },
      }),
      updatedName: '新版卡片',
      updatedDescription: '新简介',
      updatedData: JSON.stringify({
        portrait: 'https://example.com/b.webp',
        profile: {
          title: '新标题',
          tags: ['a', 'c'],
          summary: '新增摘要',
        },
      }),
    });

    expect(diff.total).toBe(6);
    expect(diff.changed).toBe(5);
    expect(diff.added).toBe(1);
    expect(diff.removed).toBe(0);
    expect(diff.entries.map((entry) => entry.path)).toEqual([
      '__card.description',
      '__card.name',
      'portrait',
      'profile.summary',
      'profile.tags[1]',
      'profile.title',
    ]);
  });

  it('当 JSON 无法解析时退回原文差异', () => {
    const diff = buildDataCardReviewDiff({
      originalName: '卡片',
      originalDescription: '',
      originalData: '{invalid',
      updatedName: '卡片',
      updatedDescription: '',
      updatedData: '{"valid":true}',
    });

    expect(diff.entries.some((entry) => entry.path === '__card.data')).toBe(true);
  });
});
