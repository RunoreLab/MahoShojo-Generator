import { describe, expect, it } from 'vitest';

import { AnnouncementListSchema, parseAnnouncementList } from '../src/announcements';

describe('announcements contract', () => {
  it('accepts the bundled product announcement shape', () => {
    const list = [
      {
        id: '20261004-pvp-retirement',
        date: '2026-10-04',
        title: 'PVP 玩法退役公告',
        content: '正文 **Markdown** 内容。',
        publisher: '运营组',
        pinned: true,
      },
      { id: '20260810-1st-anniversary', date: '2026-08-10', title: '一周年', content: '内容。' },
    ];

    const parsed = AnnouncementListSchema.safeParse(list);
    expect(parsed.success).toBe(true);
    expect(parseAnnouncementList(list)).toHaveLength(2);
  });

  it('fail-closed：结构不合法的公告源返回 null 而不是半截数据', () => {
    // 远端/缓存 JSON 是宿主不可信的输入：坏一条就意味着整个来源不可展示，不能截断后
    // 假装「部分公告有效」（DESK-ONLINE-017 同一条失败语义线）。
    expect(parseAnnouncementList([{ id: 'x', date: '2026-10-04', title: 't', content: 'c' }, { id: 1 }])).toBeNull();
    expect(parseAnnouncementList('not json')).toBeNull();
    expect(parseAnnouncementList([{ id: '', date: '2026-01-01', title: 't', content: 'c' }])).toBeNull();
    expect(parseAnnouncementList([{ id: 'x', date: '2026/10/04', title: 't', content: 'c' }])).toBeNull();
  });
});
