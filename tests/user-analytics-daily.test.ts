import { describe, expect, it } from 'bun:test';

import {
  ADMIN_USER_ANALYTICS_SCHEDULED_SNAPSHOT_UTC_HOUR,
  ADMIN_USER_ANALYTICS_SCHEDULED_SNAPSHOT_UTC_MINUTE,
  ADMIN_USER_ANALYTICS_FREQUENCY_PROFILE,
  ADMIN_USER_ANALYTICS_FREQUENCY_TREND_LOOKBACK_DAYS,
  assertAdminUserAnalyticsMetricDateNotFuture,
  buildAdminUserAnalyticsBackfillMetricDates,
  buildAdminUserAnalyticsScheduledSnapshotAt,
  findMissingAdminUserAnalyticsMetricDates,
  getAdminUserAnalyticsDailyFrequencyTrendPoint,
  isFutureAdminUserAnalyticsMetricDate,
  mapAdminUserAnalyticsDailySnapshotRow,
  normalizeAdminUserAnalyticsMetricDate,
  resolveAdminUserAnalyticsBackfillEndMetricDate,
  shiftAdminUserAnalyticsMetricDate,
} from '@/lib/admin/user-analytics-daily';

describe('user analytics daily snapshot mapper', () => {
  it('将 snake_case 快照行收敛为 camelCase 业务对象', () => {
    const snapshot = mapAdminUserAnalyticsDailySnapshotRow({
      metric_date: '2026-03-10',
      total_users: '120',
      tracked_users: 80,
      untracked_users: '40',
      active_users_24h: '12',
      active_users_7d: 30,
      active_users_30d: 55,
      activity_coverage_rate: '0.6667',
      generation_total_1d: '18',
      generation_completed_1d: 15,
      generation_aborted_1d: 2,
      generation_failed_1d: 1,
      generation_distinct_users_1d: 9,
      auth_success_1d: 7,
      auth_failed_1d: 3,
      frequency_trend_lookback_days: '30',
      frequency_profile: 'v20260209',
      sample_users_active7d: 20,
      high_plus_users_active7d: 3,
      very_high_plus_users_active7d: 1,
      extreme_users_active7d: 0,
      high_plus_share_active7d: '0.15',
      very_high_plus_share_active7d: '0.05',
      extreme_share_active7d: '0',
      sample_users_tracked: 80,
      high_plus_users_tracked: 8,
      very_high_plus_users_tracked: 2,
      extreme_users_tracked: 1,
      high_plus_share_tracked: '0.10',
      very_high_plus_share_tracked: '0.025',
      extreme_share_tracked: '0.0125',
      sample_users_all: 120,
      high_plus_users_all: 10,
      very_high_plus_users_all: 4,
      extreme_users_all: 1,
      high_plus_share_all: '0.0833',
      very_high_plus_share_all: '0.0333',
      extreme_share_all: '0.0083',
      created_at: '2026-03-10T00:05:00.000Z',
      updated_at: '2026-03-10T00:05:00.000Z',
    });

    expect(snapshot).toMatchObject({
      metricDate: '2026-03-10',
      totalUsers: 120,
      trackedUsers: 80,
      untrackedUsers: 40,
      activeUsers7d: 30,
      activityCoverageRate: 0.6667,
      generationTotal1d: 18,
      authFailed1d: 3,
      frequencyTrendLookbackDays: 30,
      frequencyProfile: 'v20260209',
      sampleUsersTracked: 80,
      highPlusUsersTracked: 8,
      extremeShareAll: 0.0083,
    });
  });

  it('按样本口径读取 canonical 高频趋势字段', () => {
    const snapshot = mapAdminUserAnalyticsDailySnapshotRow({
      metric_date: '2026-03-10',
      sample_users_active7d: 12,
      high_plus_users_active7d: 2,
      very_high_plus_users_active7d: 1,
      extreme_users_active7d: 0,
      high_plus_share_active7d: '0.1667',
      very_high_plus_share_active7d: '0.0833',
      extreme_share_active7d: '0',
      sample_users_tracked: 40,
      high_plus_users_tracked: 8,
      very_high_plus_users_tracked: 2,
      extreme_users_tracked: 1,
      high_plus_share_tracked: '0.2',
      very_high_plus_share_tracked: '0.05',
      extreme_share_tracked: '0.025',
      sample_users_all: 100,
      high_plus_users_all: 10,
      very_high_plus_users_all: 4,
      extreme_users_all: 2,
      high_plus_share_all: '0.1',
      very_high_plus_share_all: '0.04',
      extreme_share_all: '0.02',
    });

    expect(getAdminUserAnalyticsDailyFrequencyTrendPoint(snapshot, 'tracked')).toEqual({
      date: '2026-03-10',
      sample: 'tracked',
      sampleUsers: 40,
      highPlusUsers: 8,
      veryHighPlusUsers: 2,
      extremeUsers: 1,
      highPlusShare: 0.2,
      veryHighPlusShare: 0.05,
      extremeShare: 0.025,
    });
  });

  it('对缺失 profile / lookback 字段回退到 canonical 默认值', () => {
    const snapshot = mapAdminUserAnalyticsDailySnapshotRow({
      metric_date: '2026-03-10',
    });

    expect(snapshot.frequencyTrendLookbackDays).toBe(ADMIN_USER_ANALYTICS_FREQUENCY_TREND_LOOKBACK_DAYS);
    expect(snapshot.frequencyProfile).toBe(ADMIN_USER_ANALYTICS_FREQUENCY_PROFILE);
  });

  it('标准化 metricDate 并拒绝非法日期', () => {
    expect(normalizeAdminUserAnalyticsMetricDate('2026-03-10')).toBe('2026-03-10');
    expect(normalizeAdminUserAnalyticsMetricDate('2026-02-30')).toBeNull();
    expect(normalizeAdminUserAnalyticsMetricDate('20260310')).toBeNull();
  });

  it('拒绝未来 metricDate，并按显式日期推导回补结束日', () => {
    const referenceDate = new Date('2026-03-10T12:00:00.000Z');

    expect(isFutureAdminUserAnalyticsMetricDate('2026-03-11', referenceDate)).toBe(true);
    expect(isFutureAdminUserAnalyticsMetricDate('2026-03-10', referenceDate)).toBe(false);
    expect(() => assertAdminUserAnalyticsMetricDateNotFuture('2026-03-11', referenceDate)).toThrow(
      /不能晚于 2026-03-10/,
    );

    expect(
      resolveAdminUserAnalyticsBackfillEndMetricDate({
        metricDate: '2026-03-10',
        skipCurrent: false,
        referenceDate,
      }),
    ).toBe('2026-03-09');
    expect(
      resolveAdminUserAnalyticsBackfillEndMetricDate({
        metricDate: '2026-03-10',
        skipCurrent: true,
        referenceDate,
      }),
    ).toBe('2026-03-10');
  });

  it('按定时任务约定构造补快照时间点并支持日期偏移', () => {
    expect(shiftAdminUserAnalyticsMetricDate('2026-03-10', -2)).toBe('2026-03-08');

    const scheduledAt = buildAdminUserAnalyticsScheduledSnapshotAt('2026-03-10');
    expect(scheduledAt.toISOString()).toBe(
      `2026-03-10T${String(ADMIN_USER_ANALYTICS_SCHEDULED_SNAPSHOT_UTC_HOUR).padStart(2, '0')}:${String(
        ADMIN_USER_ANALYTICS_SCHEDULED_SNAPSHOT_UTC_MINUTE,
      ).padStart(2, '0')}:00.000Z`,
    );
  });

  it('按回补窗口找出缺失日期', () => {
    const expectedDates = buildAdminUserAnalyticsBackfillMetricDates(4, '2026-03-10');
    expect(expectedDates).toEqual(['2026-03-07', '2026-03-08', '2026-03-09', '2026-03-10']);

    expect(findMissingAdminUserAnalyticsMetricDates(expectedDates, ['2026-03-07', '2026-03-09'])).toEqual([
      '2026-03-08',
      '2026-03-10',
    ]);
  });
});
