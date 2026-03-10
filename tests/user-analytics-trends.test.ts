import { describe, expect, it } from 'bun:test';

import { buildTrendPoints, buildUtcDateKeys, computeTrailingAverage } from '@/lib/admin/user-analytics-trends';

describe('user analytics trends helpers', () => {
  it('按 UTC 生成连续日期键', () => {
    const keys = buildUtcDateKeys(3, new Date('2026-03-09T12:34:56.000Z'));
    expect(keys).toEqual(['2026-03-07', '2026-03-08', '2026-03-09']);
  });

  it('计算 trailing average 时会自动缩短窗口到可用样本数', () => {
    const averages = computeTrailingAverage([10, 20, 30, 40], 3);
    expect(averages).toEqual([10, 15, 20, 30]);
  });

  it('构建趋势点时会补齐缺失日期并累计总用户', () => {
    const points = buildTrendPoints(
      ['2026-03-07', '2026-03-08', '2026-03-09'],
      100,
      {
        '2026-03-07': {
          newUsers: 2,
          generationTotal: 4,
          generationCompleted: 3,
        },
        '2026-03-09': {
          newUsers: 5,
          authFailure: 1,
        },
      },
    );

    expect(points).toHaveLength(3);
    expect(points[0]).toMatchObject({
      date: '2026-03-07',
      newUsers: 2,
      totalUsers: 102,
      generationTotal: 4,
      generationCompleted: 3,
      authFailure: 0,
    });
    expect(points[1]).toMatchObject({
      date: '2026-03-08',
      newUsers: 0,
      totalUsers: 102,
      generationTotal: 0,
      authFailure: 0,
    });
    expect(points[2]).toMatchObject({
      date: '2026-03-09',
      newUsers: 5,
      totalUsers: 107,
      authFailure: 1,
    });
  });
});
