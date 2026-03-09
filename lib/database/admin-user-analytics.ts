import {
  buildTrendPoints,
  buildUtcDateKeys,
  type AdminUserAnalyticsTrendPoint,
  type AnalyticsDateKey,
  type DailyTrendAccumulator,
} from '@/lib/admin/user-analytics-trends';
import { queryFromD1 } from './core';

export type AdminUserAnalyticsSection = 'overview' | 'frequency' | 'retention' | 'composition' | 'trends' | 'all';
export type AdminFrequencySample = 'active7d' | 'tracked' | 'all';
export type AdminFrequencyProfile = 'v20260209';
export type AdminCohortGranularity = 'week' | 'month';

export type AdminUserAnalyticsOverview = {
  totalUsers: number;
  trackedUsers: number;
  untrackedUsers: number;
  activeUsers24h: number;
  activeUsers7d: number;
  activeUsers30d: number;
  activityCoverageRate: number;
  activityTrackingOk: boolean;
  lookbackDays: number;
  generationTotal: number;
  generationCompleted: number;
  generationAborted: number;
  generationFailed: number;
  generationAbortFailRate: number;
  generationDistinctUsers: number;
  generationOrphanUserEvents: number;
  generationPerTrackedUser: number;
};

export type AdminUserAnalyticsFrequencyBucket = {
  key: string;
  label: string;
  count: number;
  share: number;
};

export type AdminUserAnalyticsFrequency = {
  sample: AdminFrequencySample;
  profile: AdminFrequencyProfile;
  lookbackDays: number;
  sampleUsers: number;
  avgTotalCount: number;
  avgSuccessRate: number;
  highPlusUsers: number;
  veryHighPlusUsers: number;
  extremeUsers: number;
  highPlusShare: number;
  veryHighPlusShare: number;
  extremeShare: number;
  buckets: AdminUserAnalyticsFrequencyBucket[];
  activityTrackingOk: boolean;
};

export type AdminUserAnalyticsRetentionPoint = {
  key: 'd1' | 'd7' | 'd30' | 'd90';
  label: string;
  days: number;
  eligible: number;
  retained: number;
  rate: number;
};

export type AdminUserAnalyticsRetention = {
  totalUsers: number;
  avgObservedRetentionDays: number;
  medianObservedRetentionDays: number;
  p90ObservedRetentionDays: number;
  cohortGranularity: AdminCohortGranularity;
  cohortLookbackDays: number;
  cohorts: Array<{
    cohortKey: string;
    cohortSize: number;
    d7Eligible: number;
    d7Retained: number;
    d7Rate: number;
    d30Eligible: number;
    d30Retained: number;
    d30Rate: number;
  }>;
  points: AdminUserAnalyticsRetentionPoint[];
  activityTrackingOk: boolean;
};

export type AdminUserAnalyticsCompositionBucket = {
  key: string;
  label: string;
  count: number;
  share: number;
};

export type AdminUserAnalyticsComposition = {
  activeWindowDays: number;
  cohortGranularity: AdminCohortGranularity;
  cohortLookbackDays: number;
  sampleUsers: number;
  newUsers: number;
  oldUsers: number;
  newUsersShare: number;
  avgTenureDays: number;
  medianTenureDays: number;
  p90TenureDays: number;
  buckets: AdminUserAnalyticsCompositionBucket[];
  cohorts: Array<{
    cohortKey: string;
    sampleUsers: number;
    newUsers: number;
    newUsersShare: number;
    avgTenureDays: number;
  }>;
  activityTrackingOk: boolean;
};

export type AdminUserAnalyticsTrends = {
  lookbackDays: number;
  authAvailableFrom: string | null;
  points: AdminUserAnalyticsTrendPoint[];
};

const readFirstRow = (result: unknown): Record<string, unknown> => {
  const row = (result as any)?.result?.[0]?.results?.[0];
  return row && typeof row === 'object' ? (row as Record<string, unknown>) : {};
};

const readRows = (result: unknown): Record<string, unknown>[] => {
  const rows = (result as any)?.result?.[0]?.results;
  return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
};

const readInt = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.floor(value));
  if (typeof value === 'string') {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return Math.max(0, Math.floor(parsed));
  }
  return 0;
};

const readFloat = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
};

const toIsoFromEpochSeconds = (value: unknown): string | null => {
  const seconds = readInt(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const clampLookbackDays = (input?: number): number => {
  const fallback = 30;
  if (!Number.isFinite(input)) return fallback;
  return Math.max(7, Math.min(365, Math.floor(input as number)));
};

const clampActiveWindowDays = (input?: number): number => {
  const fallback = 7;
  if (!Number.isFinite(input)) return fallback;
  return Math.max(1, Math.min(180, Math.floor(input as number)));
};

const isMissingActivityTableError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('user_last_activity') && message.toLowerCase().includes('no such table');
};

const normalizeSample = (sample?: string): AdminFrequencySample => {
  if (sample === 'all') return 'all';
  if (sample === 'tracked') return 'tracked';
  return 'active7d';
};

const normalizeCohortGranularity = (input?: string): AdminCohortGranularity => {
  if (input === 'month') return 'month';
  return 'week';
};

const toRate = (part: number, total: number): number => {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(1, part / total));
};

const toFixed2 = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  return Number(value.toFixed(2));
};

const quantileFromHistogram = (
  buckets: Array<{ value: number; count: number }>,
  quantile: number,
): number => {
  if (buckets.length <= 0) return 0;
  const safeQuantile = Math.max(0, Math.min(1, quantile));
  const total = buckets.reduce((sum, bucket) => sum + Math.max(0, bucket.count), 0);
  if (total <= 0) return 0;
  const target = (total - 1) * safeQuantile;
  let cumulative = 0;
  for (const bucket of buckets) {
    cumulative += Math.max(0, bucket.count);
    if (cumulative > target) return bucket.value;
  }
  return buckets[buckets.length - 1]?.value ?? 0;
};

export const getAdminUserAnalyticsOverview = async (lookbackDaysInput?: number): Promise<AdminUserAnalyticsOverview> => {
  const lookbackDays = clampLookbackDays(lookbackDaysInput);
  const now = Date.now();
  const since24hIso = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  const since7dIso = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
  const since30dIso = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();
  const sinceLookbackIso = new Date(now - lookbackDays * 24 * 60 * 60 * 1000).toISOString();

  const output: AdminUserAnalyticsOverview = {
    totalUsers: 0,
    trackedUsers: 0,
    untrackedUsers: 0,
    activeUsers24h: 0,
    activeUsers7d: 0,
    activeUsers30d: 0,
    activityCoverageRate: 0,
    activityTrackingOk: false,
    lookbackDays,
    generationTotal: 0,
    generationCompleted: 0,
    generationAborted: 0,
    generationFailed: 0,
    generationAbortFailRate: 0,
    generationDistinctUsers: 0,
    generationOrphanUserEvents: 0,
    generationPerTrackedUser: 0,
  };

  try {
    const usersResult = await queryFromD1('SELECT COUNT(1) AS totalUsers FROM users');
    const usersRow = readFirstRow(usersResult);
    output.totalUsers = readInt(usersRow.totalUsers);
  } catch (error) {
    console.error('[AdminUserAnalytics] 读取用户总数失败:', error);
  }

  try {
    const activityResult = await queryFromD1(
      `SELECT
         COUNT(1) AS trackedUsers,
         COALESCE(SUM(CASE WHEN last_seen_at >= ? THEN 1 ELSE 0 END), 0) AS activeUsers24h,
         COALESCE(SUM(CASE WHEN last_seen_at >= ? THEN 1 ELSE 0 END), 0) AS activeUsers7d,
         COALESCE(SUM(CASE WHEN last_seen_at >= ? THEN 1 ELSE 0 END), 0) AS activeUsers30d
       FROM user_last_activity`,
      [since24hIso, since7dIso, since30dIso],
    );
    const activityRow = readFirstRow(activityResult);
    output.trackedUsers = readInt(activityRow.trackedUsers);
    output.activeUsers24h = readInt(activityRow.activeUsers24h);
    output.activeUsers7d = readInt(activityRow.activeUsers7d);
    output.activeUsers30d = readInt(activityRow.activeUsers30d);
    output.activityTrackingOk = true;
  } catch (error) {
    if (!isMissingActivityTableError(error)) {
      console.error('[AdminUserAnalytics] 读取活跃统计失败:', error);
    }
  }

  try {
    const generationResult = await queryFromD1(
      `SELECT
         COUNT(1) AS generationTotal,
         COALESCE(SUM(CASE WHEN brg.status = 'completed' THEN 1 ELSE 0 END), 0) AS generationCompleted,
         COALESCE(SUM(CASE WHEN brg.status = 'aborted' THEN 1 ELSE 0 END), 0) AS generationAborted,
         COALESCE(SUM(CASE WHEN brg.status = 'failed' THEN 1 ELSE 0 END), 0) AS generationFailed,
         COUNT(DISTINCT CASE WHEN brg.user_id IS NOT NULL THEN brg.user_id END) AS generationDistinctUsers,
         COALESCE(SUM(CASE WHEN brg.user_id IS NOT NULL AND u.id IS NULL THEN 1 ELSE 0 END), 0) AS generationOrphanUserEvents
       FROM battle_report_generations brg
       LEFT JOIN users u ON u.id = brg.user_id
       WHERE brg.started_at >= ?`,
      [sinceLookbackIso],
    );
    const generationRow = readFirstRow(generationResult);
    output.generationTotal = readInt(generationRow.generationTotal);
    output.generationCompleted = readInt(generationRow.generationCompleted);
    output.generationAborted = readInt(generationRow.generationAborted);
    output.generationFailed = readInt(generationRow.generationFailed);
    output.generationDistinctUsers = readInt(generationRow.generationDistinctUsers);
    output.generationOrphanUserEvents = readInt(generationRow.generationOrphanUserEvents);
  } catch (error) {
    console.error('[AdminUserAnalytics] 读取战报统计失败:', error);
  }

  output.untrackedUsers = Math.max(0, output.totalUsers - output.trackedUsers);
  output.activityCoverageRate = toRate(output.trackedUsers, output.totalUsers);
  output.generationAbortFailRate = toRate(output.generationAborted + output.generationFailed, output.generationTotal);
  output.generationPerTrackedUser = output.trackedUsers > 0
    ? output.generationTotal / output.trackedUsers
    : 0;

  return output;
};

const buildFrequencySql = (sample: AdminFrequencySample, useActivityTable: boolean): { sql: string; paramsBuilder: (sinceLookbackIso: string, since7dIso: string) => unknown[] } => {
  const sampleWhere = (() => {
    if (sample === 'all') return '1 = 1';
    if (sample === 'tracked') return 'ub.last_seen_at IS NOT NULL';
    return 'ub.last_seen_at >= ?';
  })();

  const activityJoinSql = useActivityTable
    ? 'LEFT JOIN user_last_activity ula ON ula.user_id = u.id'
    : '';
  const activitySelectSql = useActivityTable ? 'ula.last_seen_at AS last_seen_at' : 'NULL AS last_seen_at';

  const sql = `
    WITH generation_by_user AS (
      SELECT
        user_id,
        COUNT(1) AS total_count,
        COALESCE(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END), 0) AS completed_count
      FROM battle_report_generations
      WHERE user_id IS NOT NULL AND started_at >= ?
      GROUP BY user_id
    ),
    user_base AS (
      SELECT
        u.id AS user_id,
        ${activitySelectSql},
        COALESCE(g.total_count, 0) AS total_count,
        COALESCE(g.completed_count, 0) AS completed_count
      FROM users u
      ${activityJoinSql}
      LEFT JOIN generation_by_user g ON g.user_id = u.id
    )
    SELECT
      COUNT(1) AS sample_users,
      COALESCE(SUM(CASE WHEN total_count = 0 THEN 1 ELSE 0 END), 0) AS silent_users,
      COALESCE(SUM(CASE WHEN total_count BETWEEN 1 AND 29 THEN 1 ELSE 0 END), 0) AS light_users,
      COALESCE(SUM(CASE WHEN total_count BETWEEN 30 AND 99 THEN 1 ELSE 0 END), 0) AS regular_users,
      COALESCE(SUM(CASE WHEN total_count BETWEEN 100 AND 499 THEN 1 ELSE 0 END), 0) AS high_users,
      COALESCE(SUM(CASE WHEN total_count BETWEEN 500 AND 999 THEN 1 ELSE 0 END), 0) AS very_high_users,
      COALESCE(SUM(CASE WHEN total_count >= 1000 THEN 1 ELSE 0 END), 0) AS extreme_users,
      COALESCE(SUM(CASE WHEN total_count >= 100 THEN 1 ELSE 0 END), 0) AS high_plus_users,
      COALESCE(SUM(CASE WHEN total_count >= 500 THEN 1 ELSE 0 END), 0) AS very_high_plus_users,
      COALESCE(SUM(CASE WHEN total_count >= 1000 THEN 1 ELSE 0 END), 0) AS extreme_plus_users,
      COALESCE(AVG(total_count), 0) AS avg_total_count,
      COALESCE(AVG(CASE WHEN total_count > 0 THEN (completed_count * 1.0 / total_count) END), 0) AS avg_success_rate
    FROM user_base ub
    WHERE ${sampleWhere};
  `;

  return {
    sql,
    paramsBuilder: (sinceLookbackIso: string, since7dIso: string) => {
      if (sample === 'active7d') {
        return [sinceLookbackIso, since7dIso];
      }
      return [sinceLookbackIso];
    },
  };
};

export const getAdminUserAnalyticsFrequency = async (options?: {
  sample?: string;
  profile?: string;
  lookbackDays?: number;
}): Promise<AdminUserAnalyticsFrequency> => {
  const sample = normalizeSample(options?.sample);
  const profile: AdminFrequencyProfile = 'v20260209';
  const lookbackDays = clampLookbackDays(options?.lookbackDays ?? 30);
  const now = Date.now();
  const sinceLookbackIso = new Date(now - lookbackDays * 24 * 60 * 60 * 1000).toISOString();
  const since7dIso = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();

  const output: AdminUserAnalyticsFrequency = {
    sample,
    profile,
    lookbackDays,
    sampleUsers: 0,
    avgTotalCount: 0,
    avgSuccessRate: 0,
    highPlusUsers: 0,
    veryHighPlusUsers: 0,
    extremeUsers: 0,
    highPlusShare: 0,
    veryHighPlusShare: 0,
    extremeShare: 0,
    buckets: [],
    activityTrackingOk: false,
  };

  const runQuery = async (useActivityTable: boolean): Promise<void> => {
    const { sql, paramsBuilder } = buildFrequencySql(sample, useActivityTable);
    const result = await queryFromD1(sql, paramsBuilder(sinceLookbackIso, since7dIso));
    const row = readFirstRow(result);

    const sampleUsers = readInt(row.sample_users);
    const silentUsers = readInt(row.silent_users);
    const lightUsers = readInt(row.light_users);
    const regularUsers = readInt(row.regular_users);
    const highUsers = readInt(row.high_users);
    const veryHighUsers = readInt(row.very_high_users);
    const extremeUsers = readInt(row.extreme_users);
    const highPlusUsers = readInt(row.high_plus_users);
    const veryHighPlusUsers = readInt(row.very_high_plus_users);
    const extremePlusUsers = readInt(row.extreme_plus_users);

    const rate = (count: number): number => toRate(count, sampleUsers);
    output.sampleUsers = sampleUsers;
    output.avgTotalCount = readFloat(row.avg_total_count);
    output.avgSuccessRate = Math.max(0, Math.min(1, readFloat(row.avg_success_rate)));
    output.highPlusUsers = highPlusUsers;
    output.veryHighPlusUsers = veryHighPlusUsers;
    output.extremeUsers = extremePlusUsers;
    output.highPlusShare = rate(highPlusUsers);
    output.veryHighPlusShare = rate(veryHighPlusUsers);
    output.extremeShare = rate(extremePlusUsers);
    output.buckets = [
      { key: 'silent', label: 'silent (0)', count: silentUsers, share: rate(silentUsers) },
      { key: 'light', label: 'light (1~29)', count: lightUsers, share: rate(lightUsers) },
      { key: 'regular', label: 'regular (30~99)', count: regularUsers, share: rate(regularUsers) },
      { key: 'high', label: 'high (100~499)', count: highUsers, share: rate(highUsers) },
      { key: 'very_high', label: 'very_high (500~999)', count: veryHighUsers, share: rate(veryHighUsers) },
      { key: 'extreme', label: 'extreme (>=1000)', count: extremeUsers, share: rate(extremeUsers) },
    ];
    output.activityTrackingOk = useActivityTable;
  };

  try {
    await runQuery(true);
  } catch (error) {
    if (!isMissingActivityTableError(error)) {
      console.error('[AdminUserAnalytics] 读取高频分层失败:', error);
      return output;
    }
    try {
      await runQuery(false);
    } catch (fallbackError) {
      console.error('[AdminUserAnalytics] 高频分层回退失败:', fallbackError);
      return output;
    }
  }

  return output;
};

const buildRetentionSql = (
  useActivityTable: boolean,
  cohortGranularity: AdminCohortGranularity,
): {
  aggregateSql: string;
  distributionSql: string;
  cohortSql: string;
  paramsBuilder: (nowIso: string, cohortLookbackDays: number) => unknown[];
} => {
  const activityJoinSql = useActivityTable ? 'LEFT JOIN user_last_activity ula ON ula.user_id = u.id' : '';
  const observedAtExpr = useActivityTable
    ? 'COALESCE(ula.last_seen_at, u.last_login_at, u.created_at)'
    : 'COALESCE(u.last_login_at, u.created_at)';
  const cohortExpr = cohortGranularity === 'month'
    ? "strftime('%Y-%m', created_at)"
    : "strftime('%Y-W%W', created_at)";

  const baseCte = `
    WITH base AS (
      SELECT
        u.id,
        u.created_at,
        CASE
          WHEN (julianday(?) - julianday(u.created_at)) < 0 THEN 0
          ELSE CAST((julianday(?) - julianday(u.created_at)) AS INTEGER)
        END AS user_age_days,
        CASE
          WHEN (julianday(${observedAtExpr}) - julianday(u.created_at)) < 0 THEN 0
          ELSE CAST((julianday(${observedAtExpr}) - julianday(u.created_at)) AS INTEGER)
        END AS retention_days
      FROM users u
      ${activityJoinSql}
    )
  `;

  const aggregateSql = `
    ${baseCte}
    SELECT
      COUNT(1) AS total_users,
      COALESCE(AVG(retention_days), 0) AS avg_retention_days,
      COALESCE(SUM(CASE WHEN user_age_days >= 1 THEN 1 ELSE 0 END), 0) AS d1_eligible,
      COALESCE(SUM(CASE WHEN user_age_days >= 1 AND retention_days >= 1 THEN 1 ELSE 0 END), 0) AS d1_retained,
      COALESCE(SUM(CASE WHEN user_age_days >= 7 THEN 1 ELSE 0 END), 0) AS d7_eligible,
      COALESCE(SUM(CASE WHEN user_age_days >= 7 AND retention_days >= 7 THEN 1 ELSE 0 END), 0) AS d7_retained,
      COALESCE(SUM(CASE WHEN user_age_days >= 30 THEN 1 ELSE 0 END), 0) AS d30_eligible,
      COALESCE(SUM(CASE WHEN user_age_days >= 30 AND retention_days >= 30 THEN 1 ELSE 0 END), 0) AS d30_retained,
      COALESCE(SUM(CASE WHEN user_age_days >= 90 THEN 1 ELSE 0 END), 0) AS d90_eligible,
      COALESCE(SUM(CASE WHEN user_age_days >= 90 AND retention_days >= 90 THEN 1 ELSE 0 END), 0) AS d90_retained
    FROM base;
  `;

  const distributionSql = `
    ${baseCte}
    SELECT retention_days AS retention_days, COUNT(1) AS bucket_count
    FROM base
    GROUP BY retention_days
    ORDER BY retention_days ASC;
  `;

  const cohortSql = `
    ${baseCte}
    SELECT
      ${cohortExpr} AS cohort_key,
      COUNT(1) AS cohort_size,
      COALESCE(SUM(CASE WHEN user_age_days >= 7 THEN 1 ELSE 0 END), 0) AS d7_eligible,
      COALESCE(SUM(CASE WHEN user_age_days >= 7 AND retention_days >= 7 THEN 1 ELSE 0 END), 0) AS d7_retained,
      COALESCE(SUM(CASE WHEN user_age_days >= 30 THEN 1 ELSE 0 END), 0) AS d30_eligible,
      COALESCE(SUM(CASE WHEN user_age_days >= 30 AND retention_days >= 30 THEN 1 ELSE 0 END), 0) AS d30_retained
    FROM base
    WHERE user_age_days <= ?
    GROUP BY cohort_key
    ORDER BY cohort_key DESC
    LIMIT 120;
  `;

  return {
    aggregateSql,
    distributionSql,
    cohortSql,
    paramsBuilder: (nowIso: string, cohortLookbackDays: number) => [nowIso, nowIso, cohortLookbackDays],
  };
};

export const getAdminUserAnalyticsRetention = async (options?: {
  cohort?: string;
  lookbackDays?: number;
}): Promise<AdminUserAnalyticsRetention> => {
  const nowIso = new Date().toISOString();
  const cohortGranularity = normalizeCohortGranularity(options?.cohort);
  const cohortLookbackDays = clampLookbackDays(options?.lookbackDays ?? 180);
  const output: AdminUserAnalyticsRetention = {
    totalUsers: 0,
    avgObservedRetentionDays: 0,
    medianObservedRetentionDays: 0,
    p90ObservedRetentionDays: 0,
    cohortGranularity,
    cohortLookbackDays,
    cohorts: [],
    points: [
      { key: 'd1', label: 'D1', days: 1, eligible: 0, retained: 0, rate: 0 },
      { key: 'd7', label: 'D7', days: 7, eligible: 0, retained: 0, rate: 0 },
      { key: 'd30', label: 'D30', days: 30, eligible: 0, retained: 0, rate: 0 },
      { key: 'd90', label: 'D90', days: 90, eligible: 0, retained: 0, rate: 0 },
    ],
    activityTrackingOk: false,
  };

  const runQuery = async (useActivityTable: boolean): Promise<void> => {
    const { aggregateSql, distributionSql, cohortSql, paramsBuilder } = buildRetentionSql(useActivityTable, cohortGranularity);
    const params = paramsBuilder(nowIso, cohortLookbackDays);
    const [aggregateResult, distributionResult, cohortResult] = await Promise.all([
      queryFromD1(aggregateSql, params.slice(0, 2)),
      queryFromD1(distributionSql, params.slice(0, 2)),
      queryFromD1(cohortSql, params),
    ]);

    const aggregateRow = readFirstRow(aggregateResult);
    output.totalUsers = readInt(aggregateRow.total_users);
    output.avgObservedRetentionDays = toFixed2(readFloat(aggregateRow.avg_retention_days));

    const pointsMap: Array<{ key: 'd1' | 'd7' | 'd30' | 'd90'; eligibleField: string; retainedField: string }> = [
      { key: 'd1', eligibleField: 'd1_eligible', retainedField: 'd1_retained' },
      { key: 'd7', eligibleField: 'd7_eligible', retainedField: 'd7_retained' },
      { key: 'd30', eligibleField: 'd30_eligible', retainedField: 'd30_retained' },
      { key: 'd90', eligibleField: 'd90_eligible', retainedField: 'd90_retained' },
    ];

    output.points = output.points.map((point) => {
      const mapping = pointsMap.find((item) => item.key === point.key);
      if (!mapping) return point;
      const eligible = readInt(aggregateRow[mapping.eligibleField]);
      const retained = readInt(aggregateRow[mapping.retainedField]);
      return { ...point, eligible, retained, rate: toRate(retained, eligible) };
    });

    const distributionRows = ((distributionResult as any)?.result?.[0]?.results ?? []) as Array<Record<string, unknown>>;
    const histogram = distributionRows.map((row) => ({
      value: readInt(row.retention_days),
      count: readInt(row.bucket_count),
    })).filter((row) => row.count > 0);

    output.medianObservedRetentionDays = quantileFromHistogram(histogram, 0.5);
    output.p90ObservedRetentionDays = quantileFromHistogram(histogram, 0.9);

    const cohortRows = ((cohortResult as any)?.result?.[0]?.results ?? []) as Array<Record<string, unknown>>;
    output.cohorts = cohortRows.map((row) => {
      const cohortSize = readInt(row.cohort_size);
      const d7Eligible = readInt(row.d7_eligible);
      const d7Retained = readInt(row.d7_retained);
      const d30Eligible = readInt(row.d30_eligible);
      const d30Retained = readInt(row.d30_retained);
      return {
        cohortKey: String(row.cohort_key ?? ''),
        cohortSize,
        d7Eligible,
        d7Retained,
        d7Rate: toRate(d7Retained, d7Eligible),
        d30Eligible,
        d30Retained,
        d30Rate: toRate(d30Retained, d30Eligible),
      };
    });
    output.activityTrackingOk = useActivityTable;
  };

  try {
    await runQuery(true);
  } catch (error) {
    if (!isMissingActivityTableError(error)) {
      console.error('[AdminUserAnalytics] 读取留存统计失败:', error);
      return output;
    }
    try {
      await runQuery(false);
    } catch (fallbackError) {
      console.error('[AdminUserAnalytics] 留存统计回退失败:', fallbackError);
      return output;
    }
  }

  return output;
};

const buildCompositionSqlWithCohort = (
  useActivityTable: boolean,
  cohortGranularity: AdminCohortGranularity,
): {
  cohortSql: string;
  aggregateSql: string;
  bucketSql: string;
  distributionSql: string;
  paramsBuilder: (nowIso: string, sinceActiveIso: string, cohortLookbackDays: number) => unknown[];
} => {
  const activityJoinSql = useActivityTable ? 'LEFT JOIN user_last_activity ula ON ula.user_id = u.id' : '';
  const activityWhereSql = useActivityTable
    ? 'ula.last_seen_at IS NOT NULL AND julianday(ula.last_seen_at) >= julianday(?)'
    : 'u.last_login_at IS NOT NULL AND julianday(u.last_login_at) >= julianday(?)';
  const cohortExpr = cohortGranularity === 'month'
    ? "strftime('%Y-%m', created_at)"
    : "strftime('%Y-W%W', created_at)";

  const baseCte = `
    WITH active_sample AS (
      SELECT
        u.id,
        u.created_at,
        CASE
          WHEN (julianday(?) - julianday(u.created_at)) < 0 THEN 0
          ELSE CAST((julianday(?) - julianday(u.created_at)) AS INTEGER)
        END AS tenure_days
      FROM users u
      ${activityJoinSql}
      WHERE ${activityWhereSql}
    )
  `;

  const aggregateSql = `
    ${baseCte}
    SELECT
      COUNT(1) AS sample_users,
      COALESCE(SUM(CASE WHEN tenure_days <= 30 THEN 1 ELSE 0 END), 0) AS new_users,
      COALESCE(AVG(tenure_days), 0) AS avg_tenure_days
    FROM active_sample;
  `;

  const bucketSql = `
    ${baseCte}
    SELECT
      CASE
        WHEN tenure_days BETWEEN 0 AND 3 THEN '0_3d'
        WHEN tenure_days BETWEEN 4 AND 7 THEN '4_7d'
        WHEN tenure_days BETWEEN 8 AND 30 THEN '8_30d'
        WHEN tenure_days BETWEEN 31 AND 90 THEN '31_90d'
        WHEN tenure_days BETWEEN 91 AND 180 THEN '91_180d'
        ELSE '180d_plus'
      END AS bucket_key,
      CASE
        WHEN tenure_days BETWEEN 0 AND 3 THEN '0~3 天'
        WHEN tenure_days BETWEEN 4 AND 7 THEN '4~7 天'
        WHEN tenure_days BETWEEN 8 AND 30 THEN '8~30 天'
        WHEN tenure_days BETWEEN 31 AND 90 THEN '31~90 天'
        WHEN tenure_days BETWEEN 91 AND 180 THEN '91~180 天'
        ELSE '180 天以上'
      END AS bucket_label,
      CASE
        WHEN tenure_days BETWEEN 0 AND 3 THEN 1
        WHEN tenure_days BETWEEN 4 AND 7 THEN 2
        WHEN tenure_days BETWEEN 8 AND 30 THEN 3
        WHEN tenure_days BETWEEN 31 AND 90 THEN 4
        WHEN tenure_days BETWEEN 91 AND 180 THEN 5
        ELSE 6
      END AS bucket_order,
      COUNT(1) AS bucket_count
    FROM active_sample
    GROUP BY bucket_key, bucket_label, bucket_order
    ORDER BY bucket_order ASC;
  `;

  const distributionSql = `
    ${baseCte}
    SELECT tenure_days AS tenure_days, COUNT(1) AS bucket_count
    FROM active_sample
    GROUP BY tenure_days
    ORDER BY tenure_days ASC;
  `;

  const cohortSql = `
    ${baseCte}
    SELECT
      ${cohortExpr} AS cohort_key,
      COUNT(1) AS sample_users,
      COALESCE(SUM(CASE WHEN tenure_days <= 30 THEN 1 ELSE 0 END), 0) AS new_users,
      COALESCE(AVG(tenure_days), 0) AS avg_tenure_days
    FROM active_sample
    WHERE tenure_days <= ?
    GROUP BY cohort_key
    ORDER BY cohort_key DESC
    LIMIT 120;
  `;

  return {
    cohortSql,
    aggregateSql,
    bucketSql,
    distributionSql,
    paramsBuilder: (nowIso: string, sinceActiveIso: string, cohortLookbackDays: number) => [
      nowIso,
      nowIso,
      sinceActiveIso,
      cohortLookbackDays,
    ],
  };
};

export const getAdminUserAnalyticsComposition = async (options?: {
  activeWindowDays?: number;
  cohort?: string;
  lookbackDays?: number;
}): Promise<AdminUserAnalyticsComposition> => {
  const activeWindowDays = clampActiveWindowDays(options?.activeWindowDays);
  const cohortGranularity = normalizeCohortGranularity(options?.cohort);
  const cohortLookbackDays = clampLookbackDays(options?.lookbackDays ?? 180);
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const sinceActiveIso = new Date(now - activeWindowDays * 24 * 60 * 60 * 1000).toISOString();

  const output: AdminUserAnalyticsComposition = {
    activeWindowDays,
    cohortGranularity,
    cohortLookbackDays,
    sampleUsers: 0,
    newUsers: 0,
    oldUsers: 0,
    newUsersShare: 0,
    avgTenureDays: 0,
    medianTenureDays: 0,
    p90TenureDays: 0,
    buckets: [],
    cohorts: [],
    activityTrackingOk: false,
  };

  const runQuery = async (useActivityTable: boolean): Promise<void> => {
    const { cohortSql, aggregateSql, bucketSql, distributionSql, paramsBuilder } = buildCompositionSqlWithCohort(
      useActivityTable,
      cohortGranularity,
    );
    const params = paramsBuilder(nowIso, sinceActiveIso, cohortLookbackDays);
    const coreParams = params.slice(0, 3);
    const [aggregateResult, bucketResult, distributionResult, cohortResult] = await Promise.all([
      queryFromD1(aggregateSql, coreParams),
      queryFromD1(bucketSql, coreParams),
      queryFromD1(distributionSql, coreParams),
      queryFromD1(cohortSql, params),
    ]);

    const aggregateRow = readFirstRow(aggregateResult);
    output.sampleUsers = readInt(aggregateRow.sample_users);
    output.newUsers = readInt(aggregateRow.new_users);
    output.oldUsers = Math.max(0, output.sampleUsers - output.newUsers);
    output.newUsersShare = toRate(output.newUsers, output.sampleUsers);
    output.avgTenureDays = toFixed2(readFloat(aggregateRow.avg_tenure_days));

    const bucketRows = ((bucketResult as any)?.result?.[0]?.results ?? []) as Array<Record<string, unknown>>;
    output.buckets = bucketRows.map((row) => {
      const count = readInt(row.bucket_count);
      return {
        key: String(row.bucket_key ?? ''),
        label: String(row.bucket_label ?? ''),
        count,
        share: toRate(count, output.sampleUsers),
      };
    });

    const distributionRows = ((distributionResult as any)?.result?.[0]?.results ?? []) as Array<Record<string, unknown>>;
    const histogram = distributionRows.map((row) => ({
      value: readInt(row.tenure_days),
      count: readInt(row.bucket_count),
    })).filter((row) => row.count > 0);

    output.medianTenureDays = quantileFromHistogram(histogram, 0.5);
    output.p90TenureDays = quantileFromHistogram(histogram, 0.9);

    const cohortRows = ((cohortResult as any)?.result?.[0]?.results ?? []) as Array<Record<string, unknown>>;
    output.cohorts = cohortRows.map((row) => {
      const sampleUsers = readInt(row.sample_users);
      const newUsers = readInt(row.new_users);
      return {
        cohortKey: String(row.cohort_key ?? ''),
        sampleUsers,
        newUsers,
        newUsersShare: toRate(newUsers, sampleUsers),
        avgTenureDays: toFixed2(readFloat(row.avg_tenure_days)),
      };
    });
    output.activityTrackingOk = useActivityTable;
  };

  try {
    await runQuery(true);
  } catch (error) {
    if (!isMissingActivityTableError(error)) {
      console.error('[AdminUserAnalytics] 读取活跃构成失败:', error);
      return output;
    }
    try {
      await runQuery(false);
    } catch (fallbackError) {
      console.error('[AdminUserAnalytics] 活跃构成回退失败:', fallbackError);
      return output;
    }
  }

  return output;
};

export const getAdminUserAnalyticsTrends = async (lookbackDaysInput?: number): Promise<AdminUserAnalyticsTrends> => {
  const lookbackDays = clampLookbackDays(lookbackDaysInput);
  const dates = buildUtcDateKeys(lookbackDays);
  const firstDate = dates[0];
  const windowStartIso = `${firstDate}T00:00:00.000Z`;

  const output: AdminUserAnalyticsTrends = {
    lookbackDays,
    authAvailableFrom: null,
    points: [],
  };

  const byDate: Record<string, DailyTrendAccumulator> = {};
  const ensureDateBucket = (date: string): DailyTrendAccumulator => {
    if (!byDate[date]) byDate[date] = {};
    return byDate[date];
  };

  let baseTotalUsers = 0;

  try {
    const [baseUsersResult, userTrendResult, generationTrendResult, authTrendResult, authMinResult] = await Promise.all([
      queryFromD1('SELECT COUNT(1) AS total_users_before_window FROM users WHERE created_at < ?', [windowStartIso]),
      queryFromD1(
        `SELECT
           substr(created_at, 1, 10) AS metric_date,
           COUNT(1) AS new_users
         FROM users
         WHERE created_at >= ?
         GROUP BY substr(created_at, 1, 10)
         ORDER BY metric_date ASC`,
        [windowStartIso],
      ),
      queryFromD1(
        `SELECT
           substr(started_at, 1, 10) AS metric_date,
           COUNT(1) AS generation_total,
           COALESCE(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END), 0) AS generation_completed,
           COALESCE(SUM(CASE WHEN status = 'aborted' THEN 1 ELSE 0 END), 0) AS generation_aborted,
           COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) AS generation_failed,
           COUNT(DISTINCT CASE WHEN user_id IS NOT NULL THEN user_id END) AS generation_distinct_users
         FROM battle_report_generations
         WHERE started_at >= ?
         GROUP BY substr(started_at, 1, 10)
         ORDER BY metric_date ASC`,
        [windowStartIso],
      ),
      queryFromD1(
        `SELECT
           strftime('%Y-%m-%d', created_at, 'unixepoch') AS metric_date,
           COALESCE(SUM(CASE WHEN result_code = 'SUCCESS' THEN 1 ELSE 0 END), 0) AS auth_success,
           COALESCE(SUM(CASE WHEN result_code != 'SUCCESS' THEN 1 ELSE 0 END), 0) AS auth_failure
         FROM auth_audit_logs
         WHERE created_at >= unixepoch(?)
         GROUP BY strftime('%Y-%m-%d', created_at, 'unixepoch')
         ORDER BY metric_date ASC`,
        [windowStartIso],
      ),
      queryFromD1(
        `SELECT
           MIN(created_at) AS min_created_at
         FROM auth_audit_logs`,
      ),
    ]);

    baseTotalUsers = readInt(readFirstRow(baseUsersResult).total_users_before_window);

    readRows(userTrendResult).forEach((row) => {
      const metricDate = String(row.metric_date ?? '') as AnalyticsDateKey;
      if (!metricDate) return;
      ensureDateBucket(metricDate).newUsers = readInt(row.new_users);
    });

    readRows(generationTrendResult).forEach((row) => {
      const metricDate = String(row.metric_date ?? '') as AnalyticsDateKey;
      if (!metricDate) return;
      const bucket = ensureDateBucket(metricDate);
      bucket.generationTotal = readInt(row.generation_total);
      bucket.generationCompleted = readInt(row.generation_completed);
      bucket.generationAborted = readInt(row.generation_aborted);
      bucket.generationFailed = readInt(row.generation_failed);
      bucket.generationDistinctUsers = readInt(row.generation_distinct_users);
    });

    readRows(authTrendResult).forEach((row) => {
      const metricDate = String(row.metric_date ?? '') as AnalyticsDateKey;
      if (!metricDate) return;
      const bucket = ensureDateBucket(metricDate);
      bucket.authSuccess = readInt(row.auth_success);
      bucket.authFailure = readInt(row.auth_failure);
    });

    output.authAvailableFrom = toIsoFromEpochSeconds(readFirstRow(authMinResult).min_created_at);
  } catch (error) {
    console.error('[AdminUserAnalytics] 读取趋势数据失败:', error);
  }

  output.points = buildTrendPoints(dates, baseTotalUsers, byDate);
  return output;
};
