// 生产分支约束：
// 本文件仅供本地脚本与 GitHub Actions 复用统计辅助逻辑，
// 不得在生产分支通过线上页面或线上 API 暴露任何 admin 入口。
export type AdminUserAnalyticsDailyFrequencySample = 'active7d' | 'tracked' | 'all';

export const ADMIN_USER_ANALYTICS_FREQUENCY_TREND_LOOKBACK_DAYS = 30;
export const ADMIN_USER_ANALYTICS_FREQUENCY_PROFILE = 'v20260209' as const;
export const ADMIN_USER_ANALYTICS_SNAPSHOT_BACKFILL_MAX_DAYS = 30;
export const ADMIN_USER_ANALYTICS_SCHEDULED_SNAPSHOT_UTC_HOUR = 0;
export const ADMIN_USER_ANALYTICS_SCHEDULED_SNAPSHOT_UTC_MINUTE = 5;

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

const UTC_DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const formatAdminUserAnalyticsMetricDate = (date: Date): string => {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const normalizeAdminUserAnalyticsMetricDate = (value: string | null | undefined): string | null => {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!UTC_DATE_KEY_PATTERN.test(trimmed)) return null;
  const date = new Date(`${trimmed}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  return formatAdminUserAnalyticsMetricDate(date) === trimmed ? trimmed : null;
};

export const isFutureAdminUserAnalyticsMetricDate = (metricDate: string, referenceDate = new Date()): boolean => {
  const normalizedMetricDate = normalizeAdminUserAnalyticsMetricDate(metricDate);
  if (!normalizedMetricDate) {
    throw new Error(`非法 metricDate：${metricDate}`);
  }

  return normalizedMetricDate > formatAdminUserAnalyticsMetricDate(referenceDate);
};

export const assertAdminUserAnalyticsMetricDateNotFuture = (
  metricDate: string,
  referenceDate = new Date(),
  label = 'metricDate',
): string => {
  const normalizedMetricDate = normalizeAdminUserAnalyticsMetricDate(metricDate);
  if (!normalizedMetricDate) {
    throw new Error(`${label} 非法：${metricDate}`);
  }

  const referenceMetricDate = formatAdminUserAnalyticsMetricDate(referenceDate);
  if (normalizedMetricDate > referenceMetricDate) {
    throw new Error(`${label} 不能晚于 ${referenceMetricDate}`);
  }

  return normalizedMetricDate;
};

export const resolveAdminUserAnalyticsBackfillEndMetricDate = (options?: {
  metricDate?: string | null;
  skipCurrent?: boolean;
  referenceDate?: Date;
}): string => {
  const referenceDate = options?.referenceDate instanceof Date ? options.referenceDate : new Date();
  const normalizedMetricDate = options?.metricDate
    ? assertAdminUserAnalyticsMetricDateNotFuture(options.metricDate, referenceDate, 'metricDate')
    : null;

  if (!normalizedMetricDate) {
    return shiftAdminUserAnalyticsMetricDate(formatAdminUserAnalyticsMetricDate(referenceDate), -1);
  }

  if (options?.skipCurrent) {
    return normalizedMetricDate;
  }

  return shiftAdminUserAnalyticsMetricDate(normalizedMetricDate, -1);
};

export const shiftAdminUserAnalyticsMetricDate = (metricDate: string, deltaDays: number): string => {
  const normalized = normalizeAdminUserAnalyticsMetricDate(metricDate);
  if (!normalized) {
    throw new Error(`非法 metricDate：${metricDate}`);
  }
  const date = new Date(`${normalized}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + Math.trunc(deltaDays));
  return formatAdminUserAnalyticsMetricDate(date);
};

export const buildAdminUserAnalyticsScheduledSnapshotAt = (metricDate: string): Date => {
  const normalized = normalizeAdminUserAnalyticsMetricDate(metricDate);
  if (!normalized) {
    throw new Error(`非法 metricDate：${metricDate}`);
  }
  return new Date(
    `${normalized}T${String(ADMIN_USER_ANALYTICS_SCHEDULED_SNAPSHOT_UTC_HOUR).padStart(2, '0')}:${String(
      ADMIN_USER_ANALYTICS_SCHEDULED_SNAPSHOT_UTC_MINUTE,
    ).padStart(2, '0')}:00.000Z`,
  );
};

export const buildAdminUserAnalyticsBackfillMetricDates = (
  lookbackDays: number,
  endMetricDate: string,
): string[] => {
  const normalizedEndDate = normalizeAdminUserAnalyticsMetricDate(endMetricDate);
  if (!normalizedEndDate) {
    throw new Error(`非法 endMetricDate：${endMetricDate}`);
  }

  const safeLookbackDays = Math.max(1, Math.min(ADMIN_USER_ANALYTICS_SNAPSHOT_BACKFILL_MAX_DAYS, Math.floor(lookbackDays)));
  const dates: string[] = [];
  for (let index = safeLookbackDays - 1; index >= 0; index -= 1) {
    dates.push(shiftAdminUserAnalyticsMetricDate(normalizedEndDate, -index));
  }
  return dates;
};

export const findMissingAdminUserAnalyticsMetricDates = (
  expectedMetricDates: string[],
  existingMetricDates: string[],
): string[] => {
  const existing = new Set(existingMetricDates.map((value) => normalizeAdminUserAnalyticsMetricDate(value)).filter(Boolean));
  return expectedMetricDates.filter((value) => {
    const normalized = normalizeAdminUserAnalyticsMetricDate(value);
    return Boolean(normalized) && !existing.has(normalized);
  });
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
