import { AI_PROVIDER_CATALOG } from '../node-runtime/provider-catalog';
import type { AdminReadDatabase } from './read-models';

type NumericRow = Record<string, number>;
const DAY = 86_400_000;
export const ANALYTICS_ESTIMATE_NOTE = '历史回填使用当前保存的最近活跃记录和仍存续的用户，无法重建已被覆盖的历史活跃状态；留存为最后观测跨度，非逐日回访留存。';
export async function adminAggregateRows<T>(db: AdminReadDatabase, sql: string, parameters: unknown[] = []): Promise<T[]> {
  const result = await db.prepare(sql).bind(...parameters).all<T>();
  if (!result.success || !Array.isArray(result.results)) throw new Error('ADMIN_DATABASE_UNAVAILABLE');
  return result.results;
}
const numeric = async (db: AdminReadDatabase, sql: string, parameters: unknown[] = []): Promise<NumericRow> => {
  const rows = await adminAggregateRows<NumericRow>(db, sql, parameters);
  if (rows.length !== 1 || Object.values(rows[0]).some((value) => typeof value !== 'number' || !Number.isFinite(value))) throw new Error('ADMIN_INVALID_ANALYTICS_RESULT');
  return rows[0];
};
const ratio = (part: number, total: number): number => total > 0 ? part / total : 0;
const ago = (now: Date, days: number): string => new Date(now.getTime() - days * DAY).toISOString();
export type AdminAnalyticsOptions = { lookbackDays?: number; sample?: 'active7d' | 'tracked' | 'all'; cohort?: 'week' | 'month'; activeWindowDays?: number };

export async function readAdminAnalyticsFrequency(db: AdminReadDatabase, sample: 'active7d' | 'tracked' | 'all', now = new Date(), lookbackDays = 30): Promise<NumericRow> {
  const sampleWhere = sample === 'all' ? '1=1' : sample === 'tracked' ? 'last_seen_at IS NOT NULL' : 'julianday(last_seen_at) >= julianday(?)';
  const data = await numeric(db, `WITH generations AS (
    SELECT user_id,count(*) AS total_count,sum(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS completed_count
    FROM battle_report_generations WHERE julianday(started_at)>=julianday(?) AND julianday(started_at)<julianday(?) AND user_id IS NOT NULL GROUP BY user_id
  ), base AS (
    SELECT u.id,a.last_seen_at,coalesce(g.total_count,0) AS total_count,coalesce(g.completed_count,0) AS completed_count
    FROM users u LEFT JOIN user_last_activity a ON a.user_id=u.id AND julianday(a.last_seen_at)<julianday(?)
    LEFT JOIN generations g ON g.user_id=u.id WHERE julianday(u.created_at)<julianday(?)
  ) SELECT count(*) AS sample_users,
    coalesce(sum(total_count=0),0) AS silent_users, coalesce(sum(total_count BETWEEN 1 AND 29),0) AS light_users,
    coalesce(sum(total_count BETWEEN 30 AND 99),0) AS regular_users,coalesce(sum(total_count BETWEEN 100 AND 499),0) AS high_users,
    coalesce(sum(total_count BETWEEN 500 AND 999),0) AS very_high_users,coalesce(sum(total_count>=1000),0) AS extreme_users,
    coalesce(sum(total_count>=100),0) AS high_plus_users,coalesce(sum(total_count>=500),0) AS very_high_plus_users,
    coalesce(avg(total_count),0) AS avg_total_count,
    coalesce(avg(CASE WHEN total_count>0 THEN 1.0*completed_count/total_count END),0) AS avg_success_rate
    FROM base WHERE ${sampleWhere}`, [ago(now, lookbackDays), now.toISOString(), now.toISOString(), now.toISOString(), ...(sample === 'active7d' ? [ago(now, 7)] : [])]);
  return { ...data, high_plus_share: ratio(data.high_plus_users, data.sample_users), very_high_plus_share: ratio(data.very_high_plus_users, data.sample_users), extreme_share: ratio(data.extreme_users, data.sample_users) };
}

export async function collectAdminAnalyticsSnapshot(db: AdminReadDatabase, now = new Date()) {
  const end = now.toISOString();
  const overview = await numeric(db, `SELECT count(*) AS total_users,
    coalesce(sum(a.last_seen_at IS NOT NULL),0) AS tracked_users,
    coalesce(sum(julianday(a.last_seen_at)>=julianday(?)),0) AS active_users_24h,
    coalesce(sum(julianday(a.last_seen_at)>=julianday(?)),0) AS active_users_7d,
    coalesce(sum(julianday(a.last_seen_at)>=julianday(?)),0) AS active_users_30d
    FROM users u LEFT JOIN user_last_activity a ON a.user_id=u.id AND julianday(a.last_seen_at)<julianday(?) WHERE julianday(u.created_at)<julianday(?)`, [ago(now, 1), ago(now, 7), ago(now, 30), end, end]);
  const generation = await numeric(db, `SELECT count(*) AS generation_total_1d,
    coalesce(sum(status='completed'),0) AS generation_completed_1d,coalesce(sum(status='aborted'),0) AS generation_aborted_1d,
    coalesce(sum(status='failed'),0) AS generation_failed_1d,count(DISTINCT user_id) AS generation_distinct_users_1d
    FROM battle_report_generations WHERE julianday(started_at)>=julianday(?) AND julianday(started_at)<julianday(?)`, [ago(now, 1), end]);
  const auth = await numeric(db, `SELECT coalesce(sum(result_code='SUCCESS'),0) AS auth_success_1d,coalesce(sum(result_code!='SUCCESS'),0) AS auth_failed_1d
    FROM auth_audit_logs WHERE created_at>=unixepoch(?) AND created_at<unixepoch(?)`, [ago(now, 1), end]);
  const frequencies: Record<string, number> = {};
  for (const sample of ['active7d', 'tracked', 'all'] as const) {
    const frequency = await readAdminAnalyticsFrequency(db, sample, now);
    for (const key of ['sample_users', 'high_plus_users', 'very_high_plus_users', 'extreme_users', 'high_plus_share', 'very_high_plus_share', 'extreme_share'] as const) frequencies[`${key}_${sample}`] = frequency[key];
  }
  return { metric_date: end.slice(0, 10), ...overview, total_users: overview.total_users, untracked_users: overview.total_users - overview.tracked_users,
    activity_coverage_rate: ratio(overview.tracked_users, overview.total_users), ...generation, ...auth,
    frequency_trend_lookback_days: 30, frequency_profile: 'v20260209', ...frequencies, created_at: end, updated_at: end };
}

export async function readAdminAnalytics(db: AdminReadDatabase, options: AdminAnalyticsOptions = {}, now = new Date()) {
  const lookbackDays = options.lookbackDays ?? 30;
  const activeWindowDays = options.activeWindowDays ?? 7;
  if (!Number.isInteger(lookbackDays) || lookbackDays < 1 || lookbackDays > 365 || !Number.isInteger(activeWindowDays) || activeWindowDays < 1 || activeWindowDays > 180
    || !['active7d', 'tracked', 'all'].includes(options.sample ?? 'active7d') || !['week', 'month'].includes(options.cohort ?? 'week')) throw new Error('ADMIN_ANALYTICS_INPUT_INVALID');
  const snapshot = await collectAdminAnalyticsSnapshot(db, now);
  const frequency = await readAdminAnalyticsFrequency(db, options.sample ?? 'active7d', now, lookbackDays);
  const retentionBase = `WITH params(as_of) AS (VALUES (?)), base AS (
    SELECT max(0,CAST(julianday(params.as_of)-julianday(u.created_at) AS INTEGER)) AS age_days,
      max(0,CAST(julianday(coalesce(a.last_seen_at,CASE WHEN julianday(u.last_login_at)<julianday(params.as_of) THEN u.last_login_at END,u.created_at))-julianday(u.created_at) AS INTEGER)) AS retention_days
    FROM users u CROSS JOIN params LEFT JOIN user_last_activity a ON a.user_id=u.id AND julianday(a.last_seen_at)<julianday(params.as_of)
    WHERE julianday(u.created_at)<julianday(params.as_of)
  )`;
  const retentionSummary = await numeric(db, `${retentionBase}, histogram AS (
    SELECT retention_days,count(*) AS n FROM base GROUP BY retention_days
  ), ranked AS (
    SELECT retention_days,sum(n) OVER (ORDER BY retention_days) AS cumulative,sum(n) OVER () AS total FROM histogram
  ) SELECT (SELECT count(*) FROM base) AS total_users,(SELECT coalesce(avg(retention_days),0) FROM base) AS avg_observed_retention_days,
    coalesce(min(CASE WHEN cumulative>(total-1)*0.5 THEN retention_days END),0) AS median_observed_retention_days,
    coalesce(min(CASE WHEN cumulative>(total-1)*0.9 THEN retention_days END),0) AS p90_observed_retention_days FROM ranked`, [now.toISOString()]);
  const retentionCounts = await numeric(db, `${retentionBase} SELECT ${[1, 7, 30, 90].flatMap((days) => [
    `coalesce(sum(age_days>=${days}),0) AS d${days}_eligible`,
    `coalesce(sum(age_days>=${days} AND retention_days>=${days}),0) AS d${days}_retained`,
  ]).join(',')} FROM base`, [now.toISOString()]);
  const retentionPoints = [1, 7, 30, 90].map((days) => ({ days, eligible: retentionCounts[`d${days}_eligible`], retained: retentionCounts[`d${days}_retained`],
    rate: ratio(retentionCounts[`d${days}_retained`], retentionCounts[`d${days}_eligible`]) }));
  const cohort = options.cohort === 'month' ? "strftime('%Y-%m',u.created_at)" : "strftime('%Y-W%W',u.created_at)";
  const retention = await adminAggregateRows<{ cohort: string; users: number; d7_eligible: number; d7_retained: number; d30_eligible: number; d30_retained: number }>(db, `SELECT ${cohort} AS cohort,count(*) AS users,
    sum(julianday(?)-julianday(u.created_at)>=7) AS d7_eligible,
    sum(julianday(?)-julianday(u.created_at)>=7 AND coalesce(julianday(a.last_seen_at)-julianday(u.created_at),0)>=7) AS d7_retained,
    sum(julianday(?)-julianday(u.created_at)>=30) AS d30_eligible,
    sum(julianday(?)-julianday(u.created_at)>=30 AND coalesce(julianday(a.last_seen_at)-julianday(u.created_at),0)>=30) AS d30_retained
    FROM users u LEFT JOIN user_last_activity a ON a.user_id=u.id AND julianday(a.last_seen_at)<julianday(?)
    WHERE julianday(u.created_at)>=julianday(?) AND julianday(u.created_at)<julianday(?) GROUP BY ${cohort} ORDER BY cohort DESC LIMIT 120`,
  [now.toISOString(), now.toISOString(), now.toISOString(), now.toISOString(), now.toISOString(), ago(now, lookbackDays), now.toISOString()]);
  const composition = await adminAggregateRows<{ tenure: string; users: number }>(db, `SELECT CASE WHEN julianday(?)-julianday(u.created_at)<7 THEN '0-6d'
    WHEN julianday(?)-julianday(u.created_at)<30 THEN '7-29d' WHEN julianday(?)-julianday(u.created_at)<90 THEN '30-89d' ELSE '90d+' END AS tenure,count(*) AS users
    FROM users u JOIN user_last_activity a ON a.user_id=u.id WHERE julianday(a.last_seen_at)>=julianday(?) AND julianday(a.last_seen_at)<julianday(?) GROUP BY tenure`,
  [now.toISOString(), now.toISOString(), now.toISOString(), ago(now, activeWindowDays), now.toISOString()]);
  const compositionSummary = await numeric(db, `WITH active AS (
    SELECT max(0,CAST(julianday(?)-julianday(u.created_at) AS INTEGER)) AS tenure_days FROM users u JOIN user_last_activity a ON a.user_id=u.id
    WHERE julianday(a.last_seen_at)>=julianday(?) AND julianday(a.last_seen_at)<julianday(?)
  ), histogram AS (SELECT tenure_days,count(*) AS n FROM active GROUP BY tenure_days), ranked AS (
    SELECT tenure_days,sum(n) OVER (ORDER BY tenure_days) AS cumulative,sum(n) OVER () AS total FROM histogram
  ) SELECT (SELECT count(*) FROM active) AS active_users,(SELECT coalesce(avg(tenure_days),0) FROM active) AS avg_tenure_days,
    coalesce(min(CASE WHEN cumulative>(total-1)*0.5 THEN tenure_days END),0) AS median_tenure_days,
    coalesce(min(CASE WHEN cumulative>(total-1)*0.9 THEN tenure_days END),0) AS p90_tenure_days FROM ranked`, [now.toISOString(), ago(now, activeWindowDays), now.toISOString()]);
  const trends = await adminAggregateRows<{ metric_date: string; total_users: number; active_users_24h: number; active_users_7d: number; active_users_30d: number; generation_total_1d: number; updated_at: string }>(db,
    'SELECT metric_date,total_users,active_users_24h,active_users_7d,active_users_30d,generation_total_1d,updated_at FROM admin_user_analytics_daily WHERE metric_date>=? AND metric_date<=? ORDER BY metric_date LIMIT 366', [ago(now, lookbackDays).slice(0, 10), now.toISOString().slice(0, 10)]);
  const daily = await adminAggregateRows<{ date: string; generations: number; completed: number; distinct_users: number }>(db,
    "SELECT date(started_at) AS date,count(*) AS generations,sum(status='completed') AS completed,count(DISTINCT user_id) AS distinct_users FROM battle_report_generations WHERE julianday(started_at)>=julianday(?) AND julianday(started_at)<julianday(?) GROUP BY date(started_at) ORDER BY date LIMIT 366", [ago(now, lookbackDays), now.toISOString()]);
  return { generatedAt: now.toISOString(), overview: snapshot, frequency: Object.assign({ sample: options.sample ?? 'active7d', lookbackDays, profile: 'v20260209' }, frequency),
    retention, retentionSummary, retentionPoints, composition, compositionSummary, trends, daily, approximateWindowMetrics: true, estimateNote: ANALYTICS_ESTIMATE_NOTE };
}

type Status = 'healthy' | 'degraded' | 'poor' | 'unknown';
type Rate = { window: '1h' | 'none'; successRate: number | null; status: Status };
export type AdminAvailabilityChannel = { providerId: string; modelId: string; success1h: number; failure1h: number; excluded1h: number; success24h: number; failure24h: number; excluded24h: number;
  primary: Rate; reference?: { window: '24h'; successRate: number; status: Exclude<Status, 'unknown'> } };
const statusFor = (rate: number): Exclude<Status, 'unknown'> => rate >= .9 ? 'healthy' : rate >= .7 ? 'degraded' : 'poor';
const withRate = (row: Omit<AdminAvailabilityChannel, 'primary' | 'reference'>): AdminAvailabilityChannel => {
  const total1h = row.success1h + row.failure1h;
  const total24h = row.success24h + row.failure24h;
  if (total1h >= 3) { const rate = row.success1h / total1h; return { ...row, primary: { window: '1h', successRate: rate, status: statusFor(rate) } }; }
  return { ...row, primary: { window: 'none', successRate: null, status: 'unknown' }, ...(total24h >= 3 ? { reference: { window: '24h' as const, successRate: row.success24h / total24h, status: statusFor(row.success24h / total24h) } } : {}) };
};
export async function readAdminAvailability(db: AdminReadDatabase, now = new Date()) {
  const end = now.toISOString();
  const cutoff1h = new Date(now.getTime() - 3_600_000).toISOString();
  const grouped = await adminAggregateRows<Omit<AdminAvailabilityChannel, 'primary' | 'reference'>>(db, `SELECT provider_id AS providerId,model_id AS modelId,
    sum(CASE WHEN bucket_start>=? THEN success_count ELSE 0 END) AS success1h,
    sum(CASE WHEN bucket_start>=? THEN failure_count ELSE 0 END) AS failure1h,
    sum(CASE WHEN bucket_start>=? THEN excluded_count ELSE 0 END) AS excluded1h,
    sum(success_count) AS success24h,sum(failure_count) AS failure24h,sum(excluded_count) AS excluded24h
    FROM ai_channel_availability_buckets WHERE bucket_start>=? AND bucket_start<=? GROUP BY provider_id,model_id ORDER BY sum(success_count+failure_count) DESC,provider_id,model_id LIMIT 1001`, [cutoff1h, cutoff1h, cutoff1h, ago(now, 1), end]);
  if (grouped.length > 1000) throw new Error('ADMIN_AVAILABILITY_CHANNEL_LIMIT');
  const channels = grouped.map(withRate);
  const summary = await adminAggregateRows<{ total_providers: number; total_models: number; total_buckets: number; total_success: number; total_failure: number; total_excluded: number; earliest_bucket: string | null; latest_bucket: string | null }>(db,
    'SELECT count(DISTINCT provider_id) AS total_providers,count(DISTINCT model_id) AS total_models,count(*) AS total_buckets,coalesce(sum(success_count),0) AS total_success,coalesce(sum(failure_count),0) AS total_failure,coalesce(sum(excluded_count),0) AS total_excluded,min(bucket_start) AS earliest_bucket,max(bucket_start) AS latest_bucket FROM ai_channel_availability_buckets');
  const snapshots = await adminAggregateRows<{ updated_at: string; source_bucket_max: string | null }>(db, "SELECT updated_at,source_bucket_max FROM ai_channel_availability_snapshot WHERE id='default'");
  const errors = await adminAggregateRows<{ error_class: string; count: number }>(db, 'SELECT last_error_class AS error_class,sum(failure_count) AS count FROM ai_channel_availability_buckets WHERE bucket_start>=? AND bucket_start<=? AND failure_count>0 AND last_error_class IS NOT NULL GROUP BY last_error_class ORDER BY count DESC,last_error_class LIMIT 100', [ago(now, 1), end]);
  const catalogEntries: { providerId: string; modelId: string; primary: Rate; reference?: AdminAvailabilityChannel['reference'] }[] = [];
  const catalogKeys = new Set<string>();
  for (const provider of AI_PROVIDER_CATALOG) for (const model of provider.models) {
    const key = JSON.stringify([provider.id, model.value]); catalogKeys.add(key);
    const match = channels.find((channel) => channel.providerId === provider.id && channel.modelId === model.value);
    catalogEntries.push({ providerId: provider.id, modelId: model.value, primary: match?.primary ?? { window: 'none', successRate: null, status: 'unknown' }, ...(match?.reference ? { reference: match.reference } : {}) });
  }
  const custom = channels.filter((channel) => !catalogKeys.has(JSON.stringify([channel.providerId, channel.modelId])) && channel.success24h + channel.failure24h >= 3).slice(0, 200);
  const snapshot = { success: true as const, generatedAt: end, windows: { '1h': { durationSeconds: 3600 }, '24h': { durationSeconds: 86400 } }, minSampleCount: 3,
    entries: [...catalogEntries, ...custom.map(({ providerId, modelId, primary, reference }) => ({ providerId, modelId, primary, ...(reference ? { reference } : {}) }))] };
  const stored = snapshots[0] ?? null;
  return { summary: summary[0], channels, errorDistribution: errors, storedSnapshot: stored,
    stale: !stored || !Number.isFinite(Date.parse(stored.updated_at)) || now.getTime() - Date.parse(stored.updated_at) >= 120_000, snapshot };
}
