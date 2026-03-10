export type AdminUserAnalyticsDailyFrequencySample = 'active7d' | 'tracked' | 'all';

export const ADMIN_USER_ANALYTICS_FREQUENCY_TREND_LOOKBACK_DAYS = 30;
export const ADMIN_USER_ANALYTICS_FREQUENCY_PROFILE = 'v20260209' as const;

export type AdminUserAnalyticsDailySnapshot = {
  metricDate: string;
  totalUsers: number;
  trackedUsers: number;
  untrackedUsers: number;
  activeUsers24h: number;
  activeUsers7d: number;
  activeUsers30d: number;
  activityCoverageRate: number;
  generationTotal1d: number;
  generationCompleted1d: number;
  generationAborted1d: number;
  generationFailed1d: number;
  generationDistinctUsers1d: number;
  authSuccess1d: number;
  authFailed1d: number;
  frequencyTrendLookbackDays: number;
  frequencyProfile: string;
  sampleUsersActive7d: number;
  highPlusUsersActive7d: number;
  veryHighPlusUsersActive7d: number;
  extremeUsersActive7d: number;
  highPlusShareActive7d: number;
  veryHighPlusShareActive7d: number;
  extremeShareActive7d: number;
  sampleUsersTracked: number;
  highPlusUsersTracked: number;
  veryHighPlusUsersTracked: number;
  extremeUsersTracked: number;
  highPlusShareTracked: number;
  veryHighPlusShareTracked: number;
  extremeShareTracked: number;
  sampleUsersAll: number;
  highPlusUsersAll: number;
  veryHighPlusUsersAll: number;
  extremeUsersAll: number;
  highPlusShareAll: number;
  veryHighPlusShareAll: number;
  extremeShareAll: number;
  createdAt: string;
  updatedAt: string;
};

export type AdminUserAnalyticsDailyFrequencyTrendPoint = {
  date: string;
  sample: AdminUserAnalyticsDailyFrequencySample;
  sampleUsers: number;
  highPlusUsers: number;
  veryHighPlusUsers: number;
  extremeUsers: number;
  highPlusShare: number;
  veryHighPlusShare: number;
  extremeShare: number;
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

const readText = (value: unknown, fallback = ''): string => {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
};

export const mapAdminUserAnalyticsDailySnapshotRow = (
  row: Record<string, unknown>,
): AdminUserAnalyticsDailySnapshot => {
  const frequencyTrendLookbackDays = readInt(row.frequency_trend_lookback_days);

  return {
    metricDate: readText(row.metric_date),
    totalUsers: readInt(row.total_users),
    trackedUsers: readInt(row.tracked_users),
    untrackedUsers: readInt(row.untracked_users),
    activeUsers24h: readInt(row.active_users_24h),
    activeUsers7d: readInt(row.active_users_7d),
    activeUsers30d: readInt(row.active_users_30d),
    activityCoverageRate: Math.max(0, Math.min(1, readFloat(row.activity_coverage_rate))),
    generationTotal1d: readInt(row.generation_total_1d),
    generationCompleted1d: readInt(row.generation_completed_1d),
    generationAborted1d: readInt(row.generation_aborted_1d),
    generationFailed1d: readInt(row.generation_failed_1d),
    generationDistinctUsers1d: readInt(row.generation_distinct_users_1d),
    authSuccess1d: readInt(row.auth_success_1d),
    authFailed1d: readInt(row.auth_failed_1d),
    frequencyTrendLookbackDays:
      frequencyTrendLookbackDays > 0
        ? frequencyTrendLookbackDays
        : ADMIN_USER_ANALYTICS_FREQUENCY_TREND_LOOKBACK_DAYS,
    frequencyProfile: readText(row.frequency_profile, ADMIN_USER_ANALYTICS_FREQUENCY_PROFILE),
    sampleUsersActive7d: readInt(row.sample_users_active7d),
    highPlusUsersActive7d: readInt(row.high_plus_users_active7d),
    veryHighPlusUsersActive7d: readInt(row.very_high_plus_users_active7d),
    extremeUsersActive7d: readInt(row.extreme_users_active7d),
    highPlusShareActive7d: Math.max(0, Math.min(1, readFloat(row.high_plus_share_active7d))),
    veryHighPlusShareActive7d: Math.max(0, Math.min(1, readFloat(row.very_high_plus_share_active7d))),
    extremeShareActive7d: Math.max(0, Math.min(1, readFloat(row.extreme_share_active7d))),
    sampleUsersTracked: readInt(row.sample_users_tracked),
    highPlusUsersTracked: readInt(row.high_plus_users_tracked),
    veryHighPlusUsersTracked: readInt(row.very_high_plus_users_tracked),
    extremeUsersTracked: readInt(row.extreme_users_tracked),
    highPlusShareTracked: Math.max(0, Math.min(1, readFloat(row.high_plus_share_tracked))),
    veryHighPlusShareTracked: Math.max(0, Math.min(1, readFloat(row.very_high_plus_share_tracked))),
    extremeShareTracked: Math.max(0, Math.min(1, readFloat(row.extreme_share_tracked))),
    sampleUsersAll: readInt(row.sample_users_all),
    highPlusUsersAll: readInt(row.high_plus_users_all),
    veryHighPlusUsersAll: readInt(row.very_high_plus_users_all),
    extremeUsersAll: readInt(row.extreme_users_all),
    highPlusShareAll: Math.max(0, Math.min(1, readFloat(row.high_plus_share_all))),
    veryHighPlusShareAll: Math.max(0, Math.min(1, readFloat(row.very_high_plus_share_all))),
    extremeShareAll: Math.max(0, Math.min(1, readFloat(row.extreme_share_all))),
    createdAt: readText(row.created_at),
    updatedAt: readText(row.updated_at),
  };
};

export const getAdminUserAnalyticsDailyFrequencyTrendPoint = (
  snapshot: AdminUserAnalyticsDailySnapshot,
  sample: AdminUserAnalyticsDailyFrequencySample,
): AdminUserAnalyticsDailyFrequencyTrendPoint => {
  if (sample === 'tracked') {
    return {
      date: snapshot.metricDate,
      sample,
      sampleUsers: snapshot.sampleUsersTracked,
      highPlusUsers: snapshot.highPlusUsersTracked,
      veryHighPlusUsers: snapshot.veryHighPlusUsersTracked,
      extremeUsers: snapshot.extremeUsersTracked,
      highPlusShare: snapshot.highPlusShareTracked,
      veryHighPlusShare: snapshot.veryHighPlusShareTracked,
      extremeShare: snapshot.extremeShareTracked,
    };
  }

  if (sample === 'all') {
    return {
      date: snapshot.metricDate,
      sample,
      sampleUsers: snapshot.sampleUsersAll,
      highPlusUsers: snapshot.highPlusUsersAll,
      veryHighPlusUsers: snapshot.veryHighPlusUsersAll,
      extremeUsers: snapshot.extremeUsersAll,
      highPlusShare: snapshot.highPlusShareAll,
      veryHighPlusShare: snapshot.veryHighPlusShareAll,
      extremeShare: snapshot.extremeShareAll,
    };
  }

  return {
    date: snapshot.metricDate,
    sample: 'active7d',
    sampleUsers: snapshot.sampleUsersActive7d,
    highPlusUsers: snapshot.highPlusUsersActive7d,
    veryHighPlusUsers: snapshot.veryHighPlusUsersActive7d,
    extremeUsers: snapshot.extremeUsersActive7d,
    highPlusShare: snapshot.highPlusShareActive7d,
    veryHighPlusShare: snapshot.veryHighPlusShareActive7d,
    extremeShare: snapshot.extremeShareActive7d,
  };
};
