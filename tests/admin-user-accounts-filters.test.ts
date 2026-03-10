import { describe, expect, it } from 'bun:test';

import { buildAdminUserAccountWhereClause } from '@/lib/database/admin-user-accounts';

describe('admin user accounts list filters', () => {
  it('支持旧版日期范围与卡片数量范围筛选组合', () => {
    const built = buildAdminUserAccountWhereClause({
      regDateStart: '2026-03-01',
      regDateEnd: '2026-03-31',
      loginDateStart: '2026-03-02',
      loginDateEnd: '2026-03-30',
      activity: 'tracked',
      activeDateStart: '2026-03-03',
      activeDateEnd: '2026-03-29',
      minPublicCards: 3,
      maxPublicCards: 9,
      minBannedCards: 0,
      maxBannedCards: 2,
    });

    expect(built.whereSql).toContain('DATE(u.created_at) >= DATE(?)');
    expect(built.whereSql).toContain('DATE(u.created_at) <= DATE(?)');
    expect(built.whereSql).toContain('DATE(u.last_login_at) >= DATE(?)');
    expect(built.whereSql).toContain('DATE(u.last_login_at) <= DATE(?)');
    expect(built.whereSql).toContain('ula.user_id IS NOT NULL');
    expect(built.whereSql).toContain('DATE(ula.last_seen_at) >= DATE(?)');
    expect(built.whereSql).toContain('DATE(ula.last_seen_at) <= DATE(?)');
    expect(built.whereSql).toContain('COALESCE(card_stats.public_cards, 0) >= ?');
    expect(built.whereSql).toContain('COALESCE(card_stats.public_cards, 0) <= ?');
    expect(built.whereSql).toContain('COALESCE(card_stats.banned_cards, 0) >= ?');
    expect(built.whereSql).toContain('COALESCE(card_stats.banned_cards, 0) <= ?');
    expect(built.params).toEqual(['2026-03-01', '2026-03-31', '2026-03-02', '2026-03-30', '2026-03-03', '2026-03-29', 3, 9, 0, 2]);
  });

  it('支持无封禁卡快捷筛选', () => {
    const built = buildAdminUserAccountWhereClause({
      maxBannedCards: 0,
    });

    expect(built.whereSql).toBe('WHERE COALESCE(card_stats.banned_cards, 0) <= ?');
    expect(built.params).toEqual([0]);
  });
});
