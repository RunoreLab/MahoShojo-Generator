import { describe, expect, it } from 'bun:test';

import { buildTrendPoints, buildUtcDateKeys, computeTrailingAverage } from '@/lib/admin/user-analytics-trends';
import { buildAdminUserAnalyticsSnapshotTrendSeries } from '@/lib/database/admin-user-analytics';

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

  it('窗口型快照趋势只返回真实存在的快照日，不为缺口补零', () => {
    const series = buildAdminUserAnalyticsSnapshotTrendSeries(
      [
        {
          metricDate: '2026-03-07',
          totalUsers: 100,
          trackedUsers: 80,
          untrackedUsers: 20,
          activeUsers24h: 10,
          activeUsers7d: 30,
          activeUsers30d: 50,
          activityCoverageRate: 0.8,
          generationTotal1d: 8,
          generationCompleted1d: 6,
          generationAborted1d: 1,
          generationFailed1d: 1,
          generationDistinctUsers1d: 5,
          authSuccess1d: 3,
          authFailed1d: 1,
          frequencyTrendLookbackDays: 30,
          frequencyProfile: 'v20260209',
          sampleUsersActive7d: 30,
          highPlusUsersActive7d: 4,
          veryHighPlusUsersActive7d: 1,
          extremeUsersActive7d: 0,
          highPlusShareActive7d: 0.1333,
          veryHighPlusShareActive7d: 0.0333,
          extremeShareActive7d: 0,
          sampleUsersTracked: 80,
          highPlusUsersTracked: 8,
          veryHighPlusUsersTracked: 2,
          extremeUsersTracked: 1,
          highPlusShareTracked: 0.1,
          veryHighPlusShareTracked: 0.025,
          extremeShareTracked: 0.0125,
          sampleUsersAll: 100,
          highPlusUsersAll: 10,
          veryHighPlusUsersAll: 4,
          extremeUsersAll: 1,
          highPlusShareAll: 0.1,
          veryHighPlusShareAll: 0.04,
          extremeShareAll: 0.01,
          createdAt: '2026-03-07T00:05:00.000Z',
          updatedAt: '2026-03-07T00:05:00.000Z',
        },
        {
          metricDate: '2026-03-09',
          totalUsers: 110,
          trackedUsers: 85,
          untrackedUsers: 25,
          activeUsers24h: 12,
          activeUsers7d: 34,
          activeUsers30d: 55,
          activityCoverageRate: 0.7727,
          generationTotal1d: 9,
          generationCompleted1d: 7,
          generationAborted1d: 1,
          generationFailed1d: 1,
          generationDistinctUsers1d: 6,
          authSuccess1d: 4,
          authFailed1d: 2,
          frequencyTrendLookbackDays: 30,
          frequencyProfile: 'v20260209',
          sampleUsersActive7d: 34,
          highPlusUsersActive7d: 5,
          veryHighPlusUsersActive7d: 2,
          extremeUsersActive7d: 0,
          highPlusShareActive7d: 0.1471,
          veryHighPlusShareActive7d: 0.0588,
          extremeShareActive7d: 0,
          sampleUsersTracked: 85,
          highPlusUsersTracked: 9,
          veryHighPlusUsersTracked: 3,
          extremeUsersTracked: 1,
          highPlusShareTracked: 0.1059,
          veryHighPlusShareTracked: 0.0353,
          extremeShareTracked: 0.0118,
          sampleUsersAll: 110,
          highPlusUsersAll: 11,
          veryHighPlusUsersAll: 4,
          extremeUsersAll: 1,
          highPlusShareAll: 0.1,
          veryHighPlusShareAll: 0.0364,
          extremeShareAll: 0.0091,
          createdAt: '2026-03-09T00:05:00.000Z',
          updatedAt: '2026-03-09T00:05:00.000Z',
        },
      ],
      'tracked',
    );

    expect(series.activityPoints.map((point) => point.date)).toEqual(['2026-03-07', '2026-03-09']);
    expect(series.frequencyPoints.map((point) => point.date)).toEqual(['2026-03-07', '2026-03-09']);
  });
});
