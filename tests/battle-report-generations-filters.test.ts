import { describe, expect, it } from 'bun:test';

import { buildBattleReportGenerationsWhereClause } from '@/lib/d1';

describe('battle report generations list filters', () => {
  it('默认仅按 user_id 查询并按 started_at 倒序', () => {
    const built = buildBattleReportGenerationsWhereClause(42);
    expect(built.whereSql).toBe('user_id = ?');
    expect(built.params).toEqual([42]);
    expect(built.orderBySql).toBe('started_at DESC');
  });

  it('支持状态/模式/生成方式/仅 PVP/标题搜索/排序组合', () => {
    const built = buildBattleReportGenerationsWhereClause(7, {
      status: 'completed',
      mode: 'classic',
      generationMode: 'stream',
      pvpOnly: true,
      titleQuery: '小圆',
      sort: 'started_at_asc',
    });

    expect(built.whereSql).toContain('user_id = ?');
    expect(built.whereSql).toContain('status = ?');
    expect(built.whereSql).toContain('generation_mode = ?');
    expect(built.whereSql).toContain('mode = ?');
    expect(built.whereSql).toContain('pvp_match_id IS NOT NULL');
    expect(built.whereSql).toContain('(headline LIKE ? OR scenario_title LIKE ?)');
    expect(built.params).toEqual([7, 'completed', 'stream', 'classic', '%小圆%', '%小圆%']);
    expect(built.orderBySql).toBe('started_at ASC');
  });

  it('会忽略非法状态/非法生成方式，标题会裁剪到 120 字符', () => {
    const long = 'a'.repeat(200);
    const built = buildBattleReportGenerationsWhereClause(1, {
      status: 'whatever' as any,
      generationMode: 'unknown' as any,
      titleQuery: long,
    });

    expect(built.whereSql).toBe('user_id = ? AND (headline LIKE ? OR scenario_title LIKE ?)');
    expect(built.params[0]).toBe(1);

    const like = built.params[1] as string;
    expect(like.startsWith('%')).toBe(true);
    expect(like.endsWith('%')).toBe(true);
    expect(like.length).toBe(122);
  });
});

