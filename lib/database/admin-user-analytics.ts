import { queryFromD1 } from './core';

export type AdminUserAnalyticsSection = 'overview' | 'frequency' | 'all';
export type AdminFrequencySample = 'active7d' | 'tracked' | 'all';
export type AdminFrequencyProfile = 'v20260209';

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

const readFirstRow = (result: unknown): Record<string, unknown> => {
  const row = (result as any)?.result?.[0]?.results?.[0];
  return row && typeof row === 'object' ? (row as Record<string, unknown>) : {};
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

const clampLookbackDays = (input?: number): number => {
  const fallback = 30;
  if (!Number.isFinite(input)) return fallback;
  return Math.max(7, Math.min(365, Math.floor(input as number)));
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

const toRate = (part: number, total: number): number => {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(1, part / total));
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
