import { queryFromD1 } from './core';

export type AdminArenaRiskAuditSummary = {
  applied24h: number;
  skipped24h: number;
  failed24h: number;
  applied7d: number;
  skipped7d: number;
  failed7d: number;
  applied30d: number;
  skipped30d: number;
  failed30d: number;
  distinctUsers30d: number;
  distinctPairs30d: number;
};

export type AdminArenaRiskAuditSkipReasonRow = {
  skipReason: string;
  count24h: number;
  count7d: number;
  count30d: number;
};

export type AdminArenaRiskAuditTopUserRow = {
  userId: number;
  username: string | null;
  applied24h: number;
  applied7d: number;
  applied30d: number;
  skipped30d: number;
  pairCount30d: number;
  dedupSkips30d: number;
  pairDailyLimitSkips30d: number;
  dailyLimitSkips30d: number;
  outOfRangeSkips30d: number;
};

export type AdminArenaRiskAuditTopPairRow = {
  pairKey: string;
  aEntityType: string;
  aEntityId: string;
  bEntityType: string;
  bEntityId: string;
  applied24h: number;
  applied7d: number;
  applied30d: number;
  skipped30d: number;
  distinctUsers30d: number;
  lastEventAt: string | null;
  dedupSkips30d: number;
  pairDailyLimitSkips30d: number;
  dailyLimitSkips30d: number;
  outOfRangeSkips30d: number;
};

export type AdminArenaRiskAuditRecentRow = {
  id: string;
  generationId: string;
  createdAt: string;
  skipReason: string | null;
  status: string;
  userId: number | null;
  username: string | null;
  pairKey: string;
  aEntityType: string;
  aEntityId: string;
  bEntityType: string;
  bEntityId: string;
};

const readRows = <T>(result: unknown): T[] => {
  const rows = (result as { result?: Array<{ results?: T[] }> })?.result?.[0]?.results;
  return Array.isArray(rows) ? rows : [];
};

const readInt = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.floor(value);
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.floor(parsed);
  }
  return 0;
};

const readNullableInt = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return Math.floor(value);
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.floor(parsed);
  }
  return null;
};

const readNullableString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const readString = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  return String(value);
};

export async function getAdminArenaRiskAudit(): Promise<{
  summary: AdminArenaRiskAuditSummary;
  skipReasonDistribution: AdminArenaRiskAuditSkipReasonRow[];
  topUsers: AdminArenaRiskAuditTopUserRow[];
  topPairs: AdminArenaRiskAuditTopPairRow[];
  recentSamples: AdminArenaRiskAuditRecentRow[];
}> {
  const summarySql = `
    SELECT
      COALESCE(SUM(CASE WHEN are.status = 'applied' AND datetime(are.created_at) >= datetime('now', '-1 day') THEN 1 ELSE 0 END), 0) AS applied_24h,
      COALESCE(SUM(CASE WHEN are.status = 'skipped' AND datetime(are.created_at) >= datetime('now', '-1 day') THEN 1 ELSE 0 END), 0) AS skipped_24h,
      COALESCE(SUM(CASE WHEN are.status = 'failed' AND datetime(are.created_at) >= datetime('now', '-1 day') THEN 1 ELSE 0 END), 0) AS failed_24h,
      COALESCE(SUM(CASE WHEN are.status = 'applied' AND datetime(are.created_at) >= datetime('now', '-7 day') THEN 1 ELSE 0 END), 0) AS applied_7d,
      COALESCE(SUM(CASE WHEN are.status = 'skipped' AND datetime(are.created_at) >= datetime('now', '-7 day') THEN 1 ELSE 0 END), 0) AS skipped_7d,
      COALESCE(SUM(CASE WHEN are.status = 'failed' AND datetime(are.created_at) >= datetime('now', '-7 day') THEN 1 ELSE 0 END), 0) AS failed_7d,
      COALESCE(SUM(CASE WHEN are.status = 'applied' AND datetime(are.created_at) >= datetime('now', '-30 day') THEN 1 ELSE 0 END), 0) AS applied_30d,
      COALESCE(SUM(CASE WHEN are.status = 'skipped' AND datetime(are.created_at) >= datetime('now', '-30 day') THEN 1 ELSE 0 END), 0) AS skipped_30d,
      COALESCE(SUM(CASE WHEN are.status = 'failed' AND datetime(are.created_at) >= datetime('now', '-30 day') THEN 1 ELSE 0 END), 0) AS failed_30d,
      COUNT(DISTINCT CASE WHEN datetime(are.created_at) >= datetime('now', '-30 day') AND are.user_id IS NOT NULL THEN are.user_id END) AS distinct_users_30d,
      COUNT(DISTINCT CASE WHEN datetime(are.created_at) >= datetime('now', '-30 day') THEN are.pair_key END) AS distinct_pairs_30d
    FROM arena_rating_events are
    WHERE are.queue = 'strict';
  `;

  const skipReasonSql = `
    SELECT
      COALESCE(are.skip_reason, '(none)') AS skip_reason,
      COALESCE(SUM(CASE WHEN datetime(are.created_at) >= datetime('now', '-1 day') THEN 1 ELSE 0 END), 0) AS count_24h,
      COALESCE(SUM(CASE WHEN datetime(are.created_at) >= datetime('now', '-7 day') THEN 1 ELSE 0 END), 0) AS count_7d,
      COALESCE(SUM(CASE WHEN datetime(are.created_at) >= datetime('now', '-30 day') THEN 1 ELSE 0 END), 0) AS count_30d
    FROM arena_rating_events are
    WHERE are.queue = 'strict'
      AND are.status = 'skipped'
      AND datetime(are.created_at) >= datetime('now', '-30 day')
    GROUP BY COALESCE(are.skip_reason, '(none)')
    ORDER BY count_30d DESC, skip_reason ASC
    LIMIT 20;
  `;

  const topUsersSql = `
    SELECT
      are.user_id,
      u.username,
      COALESCE(SUM(CASE WHEN are.status = 'applied' AND datetime(are.created_at) >= datetime('now', '-1 day') THEN 1 ELSE 0 END), 0) AS applied_24h,
      COALESCE(SUM(CASE WHEN are.status = 'applied' AND datetime(are.created_at) >= datetime('now', '-7 day') THEN 1 ELSE 0 END), 0) AS applied_7d,
      COALESCE(SUM(CASE WHEN are.status = 'applied' AND datetime(are.created_at) >= datetime('now', '-30 day') THEN 1 ELSE 0 END), 0) AS applied_30d,
      COALESCE(SUM(CASE WHEN are.status = 'skipped' AND datetime(are.created_at) >= datetime('now', '-30 day') THEN 1 ELSE 0 END), 0) AS skipped_30d,
      COUNT(DISTINCT CASE WHEN datetime(are.created_at) >= datetime('now', '-30 day') THEN are.pair_key END) AS pair_count_30d,
      COALESCE(SUM(CASE WHEN are.skip_reason = 'dedup-user-pair' AND datetime(are.created_at) >= datetime('now', '-30 day') THEN 1 ELSE 0 END), 0) AS dedup_skips_30d,
      COALESCE(SUM(CASE WHEN are.skip_reason = 'pair-daily-limit' AND datetime(are.created_at) >= datetime('now', '-30 day') THEN 1 ELSE 0 END), 0) AS pair_daily_limit_skips_30d,
      COALESCE(SUM(CASE WHEN are.skip_reason = 'daily-limit' AND datetime(are.created_at) >= datetime('now', '-30 day') THEN 1 ELSE 0 END), 0) AS daily_limit_skips_30d,
      COALESCE(SUM(CASE WHEN are.skip_reason = 'strict-out-of-range' AND datetime(are.created_at) >= datetime('now', '-30 day') THEN 1 ELSE 0 END), 0) AS out_of_range_skips_30d
    FROM arena_rating_events are
    LEFT JOIN users u ON u.id = are.user_id
    WHERE are.queue = 'strict'
      AND are.user_id IS NOT NULL
      AND datetime(are.created_at) >= datetime('now', '-30 day')
    GROUP BY are.user_id
    ORDER BY applied_30d DESC, skipped_30d DESC, pair_count_30d DESC
    LIMIT 15;
  `;

  const topPairsSql = `
    SELECT
      are.pair_key,
      are.a_entity_type,
      are.a_entity_id,
      are.b_entity_type,
      are.b_entity_id,
      COALESCE(SUM(CASE WHEN are.status = 'applied' AND datetime(are.created_at) >= datetime('now', '-1 day') THEN 1 ELSE 0 END), 0) AS applied_24h,
      COALESCE(SUM(CASE WHEN are.status = 'applied' AND datetime(are.created_at) >= datetime('now', '-7 day') THEN 1 ELSE 0 END), 0) AS applied_7d,
      COALESCE(SUM(CASE WHEN are.status = 'applied' AND datetime(are.created_at) >= datetime('now', '-30 day') THEN 1 ELSE 0 END), 0) AS applied_30d,
      COALESCE(SUM(CASE WHEN are.status = 'skipped' AND datetime(are.created_at) >= datetime('now', '-30 day') THEN 1 ELSE 0 END), 0) AS skipped_30d,
      COUNT(DISTINCT CASE WHEN datetime(are.created_at) >= datetime('now', '-30 day') AND are.user_id IS NOT NULL THEN are.user_id END) AS distinct_users_30d,
      MAX(are.created_at) AS last_event_at,
      COALESCE(SUM(CASE WHEN are.skip_reason = 'dedup-user-pair' AND datetime(are.created_at) >= datetime('now', '-30 day') THEN 1 ELSE 0 END), 0) AS dedup_skips_30d,
      COALESCE(SUM(CASE WHEN are.skip_reason = 'pair-daily-limit' AND datetime(are.created_at) >= datetime('now', '-30 day') THEN 1 ELSE 0 END), 0) AS pair_daily_limit_skips_30d,
      COALESCE(SUM(CASE WHEN are.skip_reason = 'daily-limit' AND datetime(are.created_at) >= datetime('now', '-30 day') THEN 1 ELSE 0 END), 0) AS daily_limit_skips_30d,
      COALESCE(SUM(CASE WHEN are.skip_reason = 'strict-out-of-range' AND datetime(are.created_at) >= datetime('now', '-30 day') THEN 1 ELSE 0 END), 0) AS out_of_range_skips_30d
    FROM arena_rating_events are
    WHERE are.queue = 'strict'
      AND datetime(are.created_at) >= datetime('now', '-30 day')
    GROUP BY are.pair_key, are.a_entity_type, are.a_entity_id, are.b_entity_type, are.b_entity_id
    ORDER BY applied_30d DESC, skipped_30d DESC, distinct_users_30d DESC
    LIMIT 15;
  `;

  const recentSamplesSql = `
    SELECT
      are.id,
      are.generation_id,
      are.created_at,
      are.skip_reason,
      are.status,
      are.user_id,
      u.username,
      are.pair_key,
      are.a_entity_type,
      are.a_entity_id,
      are.b_entity_type,
      are.b_entity_id
    FROM arena_rating_events are
    LEFT JOIN users u ON u.id = are.user_id
    WHERE are.queue = 'strict'
      AND are.status IN ('skipped', 'failed')
    ORDER BY datetime(are.created_at) DESC
    LIMIT 30;
  `;

  const [summaryResult, skipReasonResult, topUsersResult, topPairsResult, recentSamplesResult] = await Promise.all([
    queryFromD1(summarySql),
    queryFromD1(skipReasonSql),
    queryFromD1(topUsersSql),
    queryFromD1(topPairsSql),
    queryFromD1(recentSamplesSql),
  ]);

  const summaryRow = readRows<Record<string, unknown>>(summaryResult)[0] ?? {};
  const summary: AdminArenaRiskAuditSummary = {
    applied24h: readInt(summaryRow.applied_24h),
    skipped24h: readInt(summaryRow.skipped_24h),
    failed24h: readInt(summaryRow.failed_24h),
    applied7d: readInt(summaryRow.applied_7d),
    skipped7d: readInt(summaryRow.skipped_7d),
    failed7d: readInt(summaryRow.failed_7d),
    applied30d: readInt(summaryRow.applied_30d),
    skipped30d: readInt(summaryRow.skipped_30d),
    failed30d: readInt(summaryRow.failed_30d),
    distinctUsers30d: readInt(summaryRow.distinct_users_30d),
    distinctPairs30d: readInt(summaryRow.distinct_pairs_30d),
  };

  const skipReasonDistribution = readRows<Record<string, unknown>>(skipReasonResult).map((row) => ({
    skipReason: readString(row.skip_reason) || '(none)',
    count24h: readInt(row.count_24h),
    count7d: readInt(row.count_7d),
    count30d: readInt(row.count_30d),
  }));

  const topUsers = readRows<Record<string, unknown>>(topUsersResult).map((row) => ({
    userId: readInt(row.user_id),
    username: readNullableString(row.username),
    applied24h: readInt(row.applied_24h),
    applied7d: readInt(row.applied_7d),
    applied30d: readInt(row.applied_30d),
    skipped30d: readInt(row.skipped_30d),
    pairCount30d: readInt(row.pair_count_30d),
    dedupSkips30d: readInt(row.dedup_skips_30d),
    pairDailyLimitSkips30d: readInt(row.pair_daily_limit_skips_30d),
    dailyLimitSkips30d: readInt(row.daily_limit_skips_30d),
    outOfRangeSkips30d: readInt(row.out_of_range_skips_30d),
  }));

  const topPairs = readRows<Record<string, unknown>>(topPairsResult).map((row) => ({
    pairKey: readString(row.pair_key),
    aEntityType: readString(row.a_entity_type),
    aEntityId: readString(row.a_entity_id),
    bEntityType: readString(row.b_entity_type),
    bEntityId: readString(row.b_entity_id),
    applied24h: readInt(row.applied_24h),
    applied7d: readInt(row.applied_7d),
    applied30d: readInt(row.applied_30d),
    skipped30d: readInt(row.skipped_30d),
    distinctUsers30d: readInt(row.distinct_users_30d),
    lastEventAt: readNullableString(row.last_event_at),
    dedupSkips30d: readInt(row.dedup_skips_30d),
    pairDailyLimitSkips30d: readInt(row.pair_daily_limit_skips_30d),
    dailyLimitSkips30d: readInt(row.daily_limit_skips_30d),
    outOfRangeSkips30d: readInt(row.out_of_range_skips_30d),
  }));

  const recentSamples = readRows<Record<string, unknown>>(recentSamplesResult).map((row) => ({
    id: readString(row.id),
    generationId: readString(row.generation_id),
    createdAt: readString(row.created_at),
    skipReason: readNullableString(row.skip_reason),
    status: readString(row.status),
    userId: readNullableInt(row.user_id),
    username: readNullableString(row.username),
    pairKey: readString(row.pair_key),
    aEntityType: readString(row.a_entity_type),
    aEntityId: readString(row.a_entity_id),
    bEntityType: readString(row.b_entity_type),
    bEntityId: readString(row.b_entity_id),
  }));

  return {
    summary,
    skipReasonDistribution,
    topUsers,
    topPairs,
    recentSamples,
  };
}
