import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { zipSync, strToU8 } from 'fflate';
import { Activity, BarChart3, Clock, Download, RefreshCw, TrendingUp, Users } from 'lucide-react';

import {
  HorizontalBarList,
  LineSeriesChart,
  StackedBarChart,
} from '@/components/admin/user-analytics/UserAnalyticsCharts';
import { buildCohortDisplayMeta, getCohortGranularityZhLabel, type CohortGranularity } from '@/lib/admin/user-analytics-display';
import { downloadCsvWithBom, formatTimestampForFilename } from '@/lib/client/csv-export';

type OverviewStats = {
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

type FrequencyBucket = {
  key: string;
  label: string;
  count: number;
  share: number;
};

type FrequencyStats = {
  sample: 'active7d' | 'tracked' | 'all';
  profile: 'v20260209';
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
  buckets: FrequencyBucket[];
  activityTrackingOk: boolean;
};

type RetentionPoint = {
  key: 'd1' | 'd7' | 'd30' | 'd90';
  label: string;
  days: number;
  eligible: number;
  retained: number;
  rate: number;
};

type RetentionStats = {
  totalUsers: number;
  avgObservedRetentionDays: number;
  medianObservedRetentionDays: number;
  p90ObservedRetentionDays: number;
  cohortGranularity: 'week' | 'month';
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
  points: RetentionPoint[];
  activityTrackingOk: boolean;
};

type CompositionBucket = {
  key: string;
  label: string;
  count: number;
  share: number;
};

type CompositionStats = {
  activeWindowDays: number;
  cohortGranularity: 'week' | 'month';
  cohortLookbackDays: number;
  sampleUsers: number;
  newUsers: number;
  oldUsers: number;
  newUsersShare: number;
  avgTenureDays: number;
  medianTenureDays: number;
  p90TenureDays: number;
  buckets: CompositionBucket[];
  cohorts: Array<{
    cohortKey: string;
    sampleUsers: number;
    newUsers: number;
    newUsersShare: number;
    avgTenureDays: number;
  }>;
  activityTrackingOk: boolean;
};

type TrendPoint = {
  date: string;
  newUsers: number;
  newUsers7dAvg: number;
  totalUsers: number;
  generationTotal: number;
  generationCompleted: number;
  generationAborted: number;
  generationFailed: number;
  generationDistinctUsers: number;
  authSuccess: number;
  authFailure: number;
};

type TrendStats = {
  lookbackDays: number;
  authAvailableFrom: string | null;
  points: TrendPoint[];
};

type ApiResponse = {
  success: boolean;
  section: 'all';
  stats: {
    overview: OverviewStats;
    frequency: FrequencyStats;
    retention: RetentionStats;
    composition: CompositionStats;
    trends: TrendStats;
  };
  meta: {
    generatedAt: string;
    lookbackDays: number;
    frequencySample: 'active7d' | 'tracked' | 'all';
    activeWindowDays: number;
    cohort: 'week' | 'month';
    frequencyProfile: 'v20260209';
  };
  error?: string;
};

type FrequencySample = 'active7d' | 'tracked' | 'all';
type CsvCell = string | number | boolean | null | undefined;

const formatPercent = (value: number): string => `${(Math.max(0, Math.min(1, value)) * 100).toFixed(1)}%`;
const formatNumber = (value: number): string => (Number.isFinite(value) ? Math.round(value).toLocaleString('zh-CN') : '0');

const normalizeIsoTimestamp = (value?: string): string => {
  if (!value) return '';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
};

const escapeCsvCell = (value: string): string => {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
};

const buildCsvString = (
  headers: string[],
  rows: Array<Array<CsvCell>>,
  meta: Array<{ key: string; value: CsvCell }> = [],
): string => {
  const metaLines = meta.map((item) => [escapeCsvCell(String(item.key)), escapeCsvCell(String(item.value ?? ''))].join(','));
  const headerLine = headers.map((header) => escapeCsvCell(header)).join(',');
  const rowLines = rows.map((row) => row.map((cell) => escapeCsvCell(String(cell ?? ''))).join(','));
  return `\uFEFF${[...metaLines, ...(metaLines.length > 0 ? [''] : []), headerLine, ...rowLines].join('\r\n')}`;
};

const downloadBlob = (blob: Blob, filename: string): void => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

function StatCard(props: { title: string; value: string; note?: string; icon: React.ElementType; color: string }) {
  const { title, value, note, icon: Icon, color } = props;
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center gap-3">
        <div className={`flex h-10 w-10 items-center justify-center rounded-full ${color}`}>
          <Icon className="h-5 w-5 text-white" />
        </div>
        <p className="text-sm font-medium text-slate-600">{title}</p>
      </div>
      <p className="text-3xl font-semibold text-slate-900">{value}</p>
      {note ? <p className="mt-2 text-xs leading-5 text-slate-500">{note}</p> : null}
    </div>
  );
}

export default function UserAnalyticsPage() {
  const [lookbackDays, setLookbackDays] = useState<number>(30);
  const [activeWindowDays, setActiveWindowDays] = useState<number>(7);
  const [frequencySample, setFrequencySample] = useState<FrequencySample>('active7d');
  const [cohort, setCohort] = useState<CohortGranularity>('week');
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const fetchUrl = useMemo(() => {
    const params = new URLSearchParams({
      section: 'all',
      lookbackDays: String(lookbackDays),
      frequencySample,
      activeWindowDays: String(activeWindowDays),
      cohort,
      frequencyProfile: 'v20260209',
    });
    return `/api/admin/user-analytics?${params.toString()}`;
  }, [lookbackDays, frequencySample, activeWindowDays, cohort]);

  const fetchData = useCallback(async (showRefreshing: boolean) => {
    if (showRefreshing) setRefreshing(true);
    else setLoading(true);

    try {
      const response = await fetch(fetchUrl);
      if (!response.ok) throw new Error('请求失败');
      const json = (await response.json()) as ApiResponse;
      if (!json.success) throw new Error(json.error || '读取失败');
      setData(json);
      setError(null);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : '读取失败');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [fetchUrl]);

  useEffect(() => {
    void fetchData(false);
  }, [fetchData]);

  const overview = data?.stats.overview;
  const frequency = data?.stats.frequency;
  const retention = data?.stats.retention;
  const composition = data?.stats.composition;
  const trends = data?.stats.trends;
  const generatedAt = data?.meta.generatedAt;

  const exportContextMeta = useMemo(() => {
    const exportedAt = new Date();
    return [
      { key: 'data_generated_at_utc', value: normalizeIsoTimestamp(generatedAt) || 'unknown' },
      { key: 'exported_at_utc', value: exportedAt.toISOString() },
      { key: 'lookback_days', value: lookbackDays },
      { key: 'frequency_sample', value: frequencySample },
      { key: 'active_window_days', value: activeWindowDays },
      { key: 'cohort', value: cohort },
    ];
  }, [activeWindowDays, cohort, frequencySample, generatedAt, lookbackDays]);

  const overviewTrendRows = useMemo<Array<Array<CsvCell>>>(() => {
    if (!trends) return [];
    return trends.points.map((point) => [
      point.date,
      point.newUsers,
      point.newUsers7dAvg,
      point.totalUsers,
      point.generationTotal,
      point.generationCompleted,
      point.generationAborted,
      point.generationFailed,
      point.generationDistinctUsers,
      point.authSuccess,
      point.authFailure,
    ]);
  }, [trends]);

  const handleExportOverviewSnapshotCsv = () => {
    if (!overview) return;
    const exportedAt = new Date();
    const exportTimestamp = formatTimestampForFilename(exportedAt);
    downloadCsvWithBom(
      `overview_snapshot_${lookbackDays}d_${exportTimestamp}.csv`,
      ['metric', 'value'],
      [
        ['total_users', overview.totalUsers],
        ['tracked_users', overview.trackedUsers],
        ['untracked_users', overview.untrackedUsers],
        ['active_users_24h', overview.activeUsers24h],
        ['active_users_7d', overview.activeUsers7d],
        ['active_users_30d', overview.activeUsers30d],
        ['activity_coverage_rate_percent', (overview.activityCoverageRate * 100).toFixed(2)],
        ['generation_total', overview.generationTotal],
        ['generation_completed', overview.generationCompleted],
        ['generation_aborted', overview.generationAborted],
        ['generation_failed', overview.generationFailed],
        ['generation_abort_fail_rate_percent', (overview.generationAbortFailRate * 100).toFixed(2)],
        ['generation_distinct_users', overview.generationDistinctUsers],
        ['generation_orphan_user_events', overview.generationOrphanUserEvents],
        ['generation_per_tracked_user', overview.generationPerTrackedUser.toFixed(2)],
      ],
      exportContextMeta,
    );
  };

  const handleExportOverviewTrendCsv = () => {
    if (!trends) return;
    const exportedAt = new Date();
    const exportTimestamp = formatTimestampForFilename(exportedAt);
    downloadCsvWithBom(
      `overview_trends_daily_${lookbackDays}d_${exportTimestamp}.csv`,
      [
        'date',
        'new_users',
        'new_users_7d_avg',
        'total_users',
        'generation_total',
        'generation_completed',
        'generation_aborted',
        'generation_failed',
        'generation_distinct_users',
        'auth_success',
        'auth_failure',
      ],
      overviewTrendRows,
      [
        ...exportContextMeta,
        { key: 'auth_available_from_utc', value: normalizeIsoTimestamp(trends.authAvailableFrom) || 'unknown' },
      ],
    );
  };

  const handleExportFrequencyCsv = () => {
    if (!frequency) return;
    const exportedAt = new Date();
    const exportTimestamp = formatTimestampForFilename(exportedAt);
    downloadCsvWithBom(
      `frequency_${frequency.sample}_${frequency.lookbackDays}d_${exportTimestamp}.csv`,
      ['bucket_key', 'bucket_label', 'count', 'share_percent'],
      frequency.buckets.map((bucket) => [bucket.key, bucket.label, bucket.count, (bucket.share * 100).toFixed(2)]),
      [
        ...exportContextMeta,
        { key: 'sample_users', value: frequency.sampleUsers },
        { key: 'avg_total_count', value: frequency.avgTotalCount.toFixed(2) },
        { key: 'avg_success_rate_percent', value: (frequency.avgSuccessRate * 100).toFixed(2) },
        { key: 'high_plus_users', value: frequency.highPlusUsers },
        { key: 'very_high_plus_users', value: frequency.veryHighPlusUsers },
        { key: 'extreme_users', value: frequency.extremeUsers },
      ],
    );
  };

  const handleExportRetentionCsv = () => {
    if (!retention) return;
    const rows: Array<Array<CsvCell>> = [];
    const exportedAt = new Date();
    const exportTimestamp = formatTimestampForFilename(exportedAt);

    retention.points.forEach((point) => {
      rows.push(['retention_point', point.label, '', '', point.days, point.eligible, point.retained, (point.rate * 100).toFixed(2), '', '']);
    });

    retention.cohorts.forEach((cohortRow) => {
      const cohortMeta = buildCohortDisplayMeta(retention.cohortGranularity, cohortRow.cohortKey);
      rows.push([
        'retention_cohort',
        cohortMeta.keyWithDateRange,
        cohortMeta.periodZh,
        cohortMeta.dateRange,
        '',
        cohortRow.cohortSize,
        '',
        '',
        `${cohortRow.d7Retained}/${cohortRow.d7Eligible} (${(cohortRow.d7Rate * 100).toFixed(2)}%)`,
        `${cohortRow.d30Retained}/${cohortRow.d30Eligible} (${(cohortRow.d30Rate * 100).toFixed(2)}%)`,
      ]);
    });

    downloadCsvWithBom(
      `retention_${retention.cohortGranularity}_${retention.cohortLookbackDays}d_${exportTimestamp}.csv`,
      ['type', 'label_or_cohort', 'cohort_period_zh', 'cohort_date_range', 'days', 'eligible_or_size', 'retained', 'rate_percent', 'd7', 'd30'],
      rows,
      exportContextMeta,
    );
  };

  const handleExportCompositionCsv = () => {
    if (!composition) return;
    const rows: Array<Array<CsvCell>> = [];
    const exportedAt = new Date();
    const exportTimestamp = formatTimestampForFilename(exportedAt);

    composition.buckets.forEach((bucket) => {
      rows.push(['tenure_bucket', bucket.label, '', '', bucket.count, (bucket.share * 100).toFixed(2), '', '']);
    });

    composition.cohorts.forEach((cohortRow) => {
      const cohortMeta = buildCohortDisplayMeta(composition.cohortGranularity, cohortRow.cohortKey);
      rows.push([
        'composition_cohort',
        cohortMeta.keyWithDateRange,
        cohortMeta.periodZh,
        cohortMeta.dateRange,
        cohortRow.sampleUsers,
        '',
        cohortRow.newUsers,
        (cohortRow.newUsersShare * 100).toFixed(2),
      ]);
    });

    downloadCsvWithBom(
      `composition_${composition.cohortGranularity}_${composition.cohortLookbackDays}d_${exportTimestamp}.csv`,
      ['type', 'label_or_cohort', 'cohort_period_zh', 'cohort_date_range', 'sample_users_or_count', 'share_percent', 'new_users', 'new_users_share_percent'],
      rows,
      exportContextMeta,
    );
  };

  const handleExportZipBundle = () => {
    if (!overview || !frequency || !retention || !composition || !trends) return;
    const exportedAt = new Date();
    const exportTimestamp = formatTimestampForFilename(exportedAt);

    const overviewSnapshotCsv = buildCsvString(
      ['metric', 'value'],
      [
        ['total_users', overview.totalUsers],
        ['tracked_users', overview.trackedUsers],
        ['untracked_users', overview.untrackedUsers],
        ['active_users_24h', overview.activeUsers24h],
        ['active_users_7d', overview.activeUsers7d],
        ['active_users_30d', overview.activeUsers30d],
        ['activity_coverage_rate_percent', (overview.activityCoverageRate * 100).toFixed(2)],
        ['generation_total', overview.generationTotal],
        ['generation_completed', overview.generationCompleted],
        ['generation_aborted', overview.generationAborted],
        ['generation_failed', overview.generationFailed],
      ],
      exportContextMeta,
    );

    const overviewTrendsCsv = buildCsvString(
      [
        'date',
        'new_users',
        'new_users_7d_avg',
        'total_users',
        'generation_total',
        'generation_completed',
        'generation_aborted',
        'generation_failed',
        'generation_distinct_users',
        'auth_success',
        'auth_failure',
      ],
      overviewTrendRows,
      exportContextMeta,
    );

    const frequencyCsv = buildCsvString(
      ['bucket_key', 'bucket_label', 'count', 'share_percent'],
      frequency.buckets.map((bucket) => [bucket.key, bucket.label, bucket.count, (bucket.share * 100).toFixed(2)]),
      exportContextMeta,
    );

    const retentionCsv = buildCsvString(
      ['window', 'eligible', 'retained', 'rate_percent'],
      retention.points.map((point) => [point.label, point.eligible, point.retained, (point.rate * 100).toFixed(2)]),
      exportContextMeta,
    );

    const compositionCsv = buildCsvString(
      ['bucket_key', 'bucket_label', 'count', 'share_percent'],
      composition.buckets.map((bucket) => [bucket.key, bucket.label, bucket.count, (bucket.share * 100).toFixed(2)]),
      exportContextMeta,
    );

    const manifest = {
      generatedAt: generatedAt ?? null,
      exportedAt: exportedAt.toISOString(),
      lookbackDays,
      frequencySample,
      activeWindowDays,
      cohort,
      authTrendAvailableFrom: trends.authAvailableFrom,
      files: [
        'overview_snapshot.csv',
        'overview_trends_daily.csv',
        'frequency_buckets.csv',
        'retention_points.csv',
        'composition_buckets.csv',
      ],
    };

    const entries = {
      'manifest.json': strToU8(JSON.stringify(manifest, null, 2)),
      'overview_snapshot.csv': strToU8(overviewSnapshotCsv),
      'overview_trends_daily.csv': strToU8(overviewTrendsCsv),
      'frequency_buckets.csv': strToU8(frequencyCsv),
      'retention_points.csv': strToU8(retentionCsv),
      'composition_buckets.csv': strToU8(compositionCsv),
    };

    const zipped = zipSync(entries, { level: 6 });
    downloadBlob(new Blob([zipped], { type: 'application/zip' }), `user_analytics_bundle_${exportTimestamp}.zip`);
  };

  const userGrowthChart = useMemo(() => {
    if (!trends) return null;
    return (
      <LineSeriesChart
        labels={trends.points.map((point) => point.date)}
        series={[
          { key: 'newUsers', label: '每日新增用户', color: '#0f766e', values: trends.points.map((point) => point.newUsers) },
          { key: 'newUsers7dAvg', label: '7 日移动平均', color: '#0284c7', values: trends.points.map((point) => point.newUsers7dAvg) },
        ]}
      />
    );
  }, [trends]);

  const cumulativeUserChart = useMemo(() => {
    if (!trends) return null;
    return (
      <LineSeriesChart
        labels={trends.points.map((point) => point.date)}
        series={[{ key: 'totalUsers', label: '累计总用户', color: '#7c3aed', values: trends.points.map((point) => point.totalUsers) }]}
      />
    );
  }, [trends]);

  const generationTrendChart = useMemo(() => {
    if (!trends) return null;
    return (
      <StackedBarChart
        labels={trends.points.map((point) => point.date)}
        series={[
          { key: 'completed', label: '完成', color: '#16a34a', values: trends.points.map((point) => point.generationCompleted) },
          { key: 'aborted', label: '中断', color: '#f59e0b', values: trends.points.map((point) => point.generationAborted) },
          { key: 'failed', label: '失败', color: '#ef4444', values: trends.points.map((point) => point.generationFailed) },
        ]}
      />
    );
  }, [trends]);

  const authTrendChart = useMemo(() => {
    if (!trends) return null;
    return (
      <LineSeriesChart
        labels={trends.points.map((point) => point.date)}
        series={[
          { key: 'authSuccess', label: 'Auth 成功事件', color: '#0f766e', values: trends.points.map((point) => point.authSuccess) },
          { key: 'authFailure', label: 'Auth 失败事件', color: '#dc2626', values: trends.points.map((point) => point.authFailure) },
        ]}
      />
    );
  }, [trends]);

  return (
    <>
      <Head>
        <title>用户统计分析 - Admin</title>
      </Head>

      <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.12),_transparent_32%),linear-gradient(180deg,_#f8fafc_0%,_#eff6ff_100%)] p-4 sm:p-6">
        <div className="mx-auto max-w-7xl">
          <div className="mb-4 flex items-center justify-between">
            <Link href="/admin" className="text-sm text-sky-700 hover:underline">
              ← 返回管理后台主页
            </Link>
            <button
              type="button"
              onClick={() => void fetchData(true)}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm hover:bg-slate-50"
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
              刷新
            </button>
          </div>

          <div className="mb-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h1 className="text-3xl font-semibold text-slate-900">用户统计分析</h1>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              当前版本已补齐可回算的历史趋势、基础图表与分析包导出。按当前决策，窗口型活跃趋势暂不引入 <code>user_activity_daily</code>，
              因此 24h / 7d / 30d 活跃只展示当前快照，不展示历史曲线。
            </p>

            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-5">
              <label className="text-sm text-slate-700">
                统计窗口
                <select
                  value={lookbackDays}
                  onChange={(event) => setLookbackDays(Number.parseInt(event.target.value, 10))}
                  className="mt-1 block w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                >
                  <option value={30}>近 30 天</option>
                  <option value={60}>近 60 天</option>
                  <option value={90}>近 90 天</option>
                  <option value={180}>近 180 天</option>
                </select>
              </label>

              <label className="text-sm text-slate-700">
                高频样本口径
                <select
                  value={frequencySample}
                  onChange={(event) => setFrequencySample(event.target.value as FrequencySample)}
                  className="mt-1 block w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                >
                  <option value="active7d">最近 7 天活跃用户</option>
                  <option value="tracked">有活跃记录用户</option>
                  <option value="all">全体用户</option>
                </select>
              </label>

              <label className="text-sm text-slate-700">
                活跃样本窗口
                <select
                  value={activeWindowDays}
                  onChange={(event) => setActiveWindowDays(Number.parseInt(event.target.value, 10))}
                  className="mt-1 block w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                >
                  <option value={1}>近 1 天</option>
                  <option value={7}>近 7 天</option>
                  <option value={30}>近 30 天</option>
                  <option value={90}>近 90 天</option>
                </select>
              </label>

              <label className="text-sm text-slate-700">
                Cohort 粒度
                <select
                  value={cohort}
                  onChange={(event) => setCohort(event.target.value as CohortGranularity)}
                  className="mt-1 block w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                >
                  <option value="week">按周</option>
                  <option value="month">按月</option>
                </select>
              </label>

              <div className="text-sm text-slate-700">
                数据时间
                <div className="mt-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                  {generatedAt ? new Date(generatedAt).toLocaleString('zh-CN', { hour12: false }) : '—'}
                </div>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" onClick={handleExportOverviewSnapshotCsv} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 hover:bg-slate-50" disabled={!overview}>
                <Download className="h-3.5 w-3.5" />
                导出 Overview 快照
              </button>
              <button type="button" onClick={handleExportOverviewTrendCsv} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 hover:bg-slate-50" disabled={!trends}>
                <Download className="h-3.5 w-3.5" />
                导出趋势 CSV
              </button>
              <button type="button" onClick={handleExportFrequencyCsv} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 hover:bg-slate-50" disabled={!frequency}>
                <Download className="h-3.5 w-3.5" />
                导出分层 CSV
              </button>
              <button type="button" onClick={handleExportRetentionCsv} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 hover:bg-slate-50" disabled={!retention}>
                <Download className="h-3.5 w-3.5" />
                导出留存 CSV
              </button>
              <button type="button" onClick={handleExportCompositionCsv} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 hover:bg-slate-50" disabled={!composition}>
                <Download className="h-3.5 w-3.5" />
                导出构成 CSV
              </button>
              <button type="button" onClick={handleExportZipBundle} className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-3 py-2 text-xs text-white hover:bg-slate-800" disabled={!data}>
                <Download className="h-3.5 w-3.5" />
                导出分析包 ZIP
              </button>
            </div>
          </div>

          {loading && !data ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-500">加载中...</div>
          ) : null}

          {error ? (
            <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              读取失败：{error}
            </div>
          ) : null}

          {overview ? (
            <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
              <StatCard title="总用户" value={formatNumber(overview.totalUsers)} icon={Users} color="bg-teal-600" />
              <StatCard title="已追踪用户" value={formatNumber(overview.trackedUsers)} icon={Activity} color="bg-violet-600" note={`覆盖率 ${formatPercent(overview.activityCoverageRate)}`} />
              <StatCard title="活跃用户（24h）" value={formatNumber(overview.activeUsers24h)} icon={Clock} color="bg-fuchsia-600" note={overview.activityTrackingOk ? '当前快照' : 'user_last_activity 未就绪'} />
              <StatCard title="活跃用户（7d）" value={formatNumber(overview.activeUsers7d)} icon={Users} color="bg-indigo-600" note={`30d 活跃 ${formatNumber(overview.activeUsers30d)}`} />
              <StatCard title={`战报生成（${overview.lookbackDays}d）`} value={formatNumber(overview.generationTotal)} icon={BarChart3} color="bg-blue-600" />
              <StatCard title="完成率" value={formatPercent(1 - overview.generationAbortFailRate)} icon={TrendingUp} color="bg-emerald-600" note={`中断+失败 ${formatPercent(overview.generationAbortFailRate)}`} />
              <StatCard title="参与生成用户数" value={formatNumber(overview.generationDistinctUsers)} icon={Users} color="bg-sky-600" />
              <StatCard title="人均生成（tracked）" value={overview.generationPerTrackedUser.toFixed(1)} icon={BarChart3} color="bg-cyan-600" note={`孤立 user_id ${formatNumber(overview.generationOrphanUserEvents)}`} />
            </div>
          ) : null}

          {trends ? (
            <div className="mb-6 grid gap-6 xl:grid-cols-2">
              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="mb-4">
                  <h2 className="text-lg font-semibold text-slate-900">新增用户趋势</h2>
                  <p className="text-xs text-slate-500">每日新增用户 + 7 日移动平均，适合看拉新节奏与异常波动。</p>
                </div>
                {userGrowthChart}
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="mb-4">
                  <h2 className="text-lg font-semibold text-slate-900">累计用户趋势</h2>
                  <p className="text-xs text-slate-500">基于 `users.created_at` 严格回算。</p>
                </div>
                {cumulativeUserChart}
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="mb-4">
                  <h2 className="text-lg font-semibold text-slate-900">战报生成状态趋势</h2>
                  <p className="text-xs text-slate-500">completed / aborted / failed 按日堆叠，可快速发现失败尖峰。</p>
                </div>
                {generationTrendChart}
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="mb-4">
                  <h2 className="text-lg font-semibold text-slate-900">Auth 审计趋势</h2>
                  <p className="text-xs text-slate-500">
                    当前基于 `auth_audit_logs`。{trends.authAvailableFrom ? `最早记录时间 ${new Date(trends.authAvailableFrom).toLocaleString('zh-CN', { hour12: false })}` : '当前没有可用审计记录。'}
                  </p>
                </div>
                {authTrendChart}
              </section>
            </div>
          ) : null}

          <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            窗口型趋势说明：按当前决策暂不上 <code>user_activity_daily</code>，因此 24h / 7d / 30d 活跃趋势、覆盖率趋势与高频占比趋势暂不回填历史，只保留当前快照与可回算趋势。
          </div>

          {frequency ? (
            <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">高频生成分层</h2>
                  <p className="text-xs text-slate-500">
                    样本 {frequency.sample} · 窗口 {frequency.lookbackDays}d · profile {frequency.profile}
                  </p>
                </div>
              </div>

              <div className="mb-5 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                <StatCard title="样本用户数" value={formatNumber(frequency.sampleUsers)} icon={Users} color="bg-slate-700" />
                <StatCard title="high+ (≥100)" value={`${formatNumber(frequency.highPlusUsers)} · ${formatPercent(frequency.highPlusShare)}`} icon={TrendingUp} color="bg-sky-600" />
                <StatCard title="very_high+ (≥500)" value={`${formatNumber(frequency.veryHighPlusUsers)} · ${formatPercent(frequency.veryHighPlusShare)}`} icon={TrendingUp} color="bg-violet-600" />
                <StatCard title="extreme (≥1000)" value={`${formatNumber(frequency.extremeUsers)} · ${formatPercent(frequency.extremeShare)}`} icon={TrendingUp} color="bg-rose-600" />
              </div>

              <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
                <div className="rounded-2xl border border-slate-200 p-4">
                  <h3 className="mb-4 text-sm font-semibold text-slate-900">当前分层可视化</h3>
                  <HorizontalBarList
                    items={frequency.buckets.map((bucket) => ({
                      key: bucket.key,
                      label: bucket.label,
                      value: bucket.count,
                      note: formatPercent(bucket.share),
                      color: bucket.key === 'extreme' ? '#e11d48' : bucket.key === 'very_high' ? '#7c3aed' : bucket.key === 'high' ? '#0284c7' : '#334155',
                    }))}
                  />
                </div>

                <div className="overflow-x-auto rounded-2xl border border-slate-200">
                  <table className="min-w-full text-left text-sm">
                    <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-4 py-3">分层</th>
                        <th className="px-4 py-3">人数</th>
                        <th className="px-4 py-3">占比</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {frequency.buckets.map((bucket) => (
                        <tr key={bucket.key}>
                          <td className="px-4 py-3 text-slate-700">{bucket.label}</td>
                          <td className="px-4 py-3 text-slate-900">{formatNumber(bucket.count)}</td>
                          <td className="px-4 py-3 text-slate-900">{formatPercent(bucket.share)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          ) : null}

          {retention ? (
            <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-5">
                <h2 className="text-lg font-semibold text-slate-900">留存概览</h2>
                <p className="text-xs text-slate-500">
                  样本总量 {formatNumber(retention.totalUsers)} · 分群粒度 {getCohortGranularityZhLabel(retention.cohortGranularity)} · 口径 {retention.activityTrackingOk ? 'last_activity + last_login' : 'last_login 回退'}
                </p>
              </div>

              <div className="mb-5 grid grid-cols-1 gap-4 md:grid-cols-3">
                <StatCard title="平均留存时长" value={`${retention.avgObservedRetentionDays.toFixed(2)} 天`} icon={Clock} color="bg-sky-600" />
                <StatCard title="中位留存时长" value={`${retention.medianObservedRetentionDays} 天`} icon={Clock} color="bg-violet-600" />
                <StatCard title="P90 留存时长" value={`${retention.p90ObservedRetentionDays} 天`} icon={Clock} color="bg-rose-600" />
              </div>

              <div className="grid gap-6 xl:grid-cols-[0.75fr_1.25fr]">
                <div className="rounded-2xl border border-slate-200 p-4">
                  <h3 className="mb-4 text-sm font-semibold text-slate-900">留存窗口</h3>
                  <HorizontalBarList
                    items={retention.points.map((point) => ({
                      key: point.key,
                      label: point.label,
                      value: Number((point.rate * 10000).toFixed(0)),
                      note: `${formatNumber(point.retained)} / ${formatNumber(point.eligible)} · ${formatPercent(point.rate)}`,
                      color: point.key === 'd90' ? '#0284c7' : point.key === 'd30' ? '#7c3aed' : point.key === 'd7' ? '#0f766e' : '#334155',
                    }))}
                  />
                </div>

                <div className="overflow-x-auto rounded-2xl border border-slate-200">
                  <table className="min-w-full text-left text-sm">
                    <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-4 py-3">注册分群</th>
                        <th className="px-4 py-3">用户数</th>
                        <th className="px-4 py-3">D7 留存</th>
                        <th className="px-4 py-3">D30 留存</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {retention.cohorts.map((row) => {
                        const cohortMeta = buildCohortDisplayMeta(retention.cohortGranularity, row.cohortKey);
                        return (
                          <tr key={row.cohortKey}>
                            <td className="px-4 py-3 text-slate-700">
                              <div>{cohortMeta.keyWithDateRange}</div>
                              <div className="mt-0.5 text-xs text-slate-500">{cohortMeta.periodZh}</div>
                            </td>
                            <td className="px-4 py-3 text-slate-900">{formatNumber(row.cohortSize)}</td>
                            <td className="px-4 py-3 text-slate-900">
                              {formatNumber(row.d7Retained)} / {formatNumber(row.d7Eligible)}（{formatPercent(row.d7Rate)}）
                            </td>
                            <td className="px-4 py-3 text-slate-900">
                              {formatNumber(row.d30Retained)} / {formatNumber(row.d30Eligible)}（{formatPercent(row.d30Rate)}）
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          ) : null}

          {composition ? (
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-5">
                <h2 className="text-lg font-semibold text-slate-900">活跃用户构成</h2>
                <p className="text-xs text-slate-500">
                  活跃窗口 {composition.activeWindowDays} 天 · 样本 {formatNumber(composition.sampleUsers)} · 分群粒度 {getCohortGranularityZhLabel(composition.cohortGranularity)}
                </p>
              </div>

              <div className="mb-5 grid grid-cols-1 gap-4 md:grid-cols-4">
                <StatCard title="新用户（≤30天）" value={`${formatNumber(composition.newUsers)} · ${formatPercent(composition.newUsersShare)}`} icon={Users} color="bg-sky-600" />
                <StatCard title="老用户（>30天）" value={formatNumber(composition.oldUsers)} icon={Users} color="bg-slate-700" />
                <StatCard title="平均注册时长" value={`${composition.avgTenureDays.toFixed(2)} 天`} icon={Clock} color="bg-violet-600" />
                <StatCard title="中位 / P90" value={`${composition.medianTenureDays} / ${composition.p90TenureDays} 天`} icon={Clock} color="bg-rose-600" />
              </div>

              <div className="grid gap-6 xl:grid-cols-[0.75fr_1.25fr]">
                <div className="rounded-2xl border border-slate-200 p-4">
                  <h3 className="mb-4 text-sm font-semibold text-slate-900">注册时长分层</h3>
                  <HorizontalBarList
                    items={composition.buckets.map((bucket) => ({
                      key: bucket.key,
                      label: bucket.label,
                      value: bucket.count,
                      note: formatPercent(bucket.share),
                      color: bucket.key === 'over_365' ? '#0284c7' : bucket.key === '181_365' ? '#7c3aed' : bucket.key === '31_180' ? '#0f766e' : '#334155',
                    }))}
                  />
                </div>

                <div className="overflow-x-auto rounded-2xl border border-slate-200">
                  <table className="min-w-full text-left text-sm">
                    <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-4 py-3">注册分群</th>
                        <th className="px-4 py-3">样本用户</th>
                        <th className="px-4 py-3">新用户（≤30天）</th>
                        <th className="px-4 py-3">新用户占比</th>
                        <th className="px-4 py-3">平均注册时长</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {composition.cohorts.map((row) => {
                        const cohortMeta = buildCohortDisplayMeta(composition.cohortGranularity, row.cohortKey);
                        return (
                          <tr key={row.cohortKey}>
                            <td className="px-4 py-3 text-slate-700">
                              <div>{cohortMeta.keyWithDateRange}</div>
                              <div className="mt-0.5 text-xs text-slate-500">{cohortMeta.periodZh}</div>
                            </td>
                            <td className="px-4 py-3 text-slate-900">{formatNumber(row.sampleUsers)}</td>
                            <td className="px-4 py-3 text-slate-900">{formatNumber(row.newUsers)}</td>
                            <td className="px-4 py-3 text-slate-900">{formatPercent(row.newUsersShare)}</td>
                            <td className="px-4 py-3 text-slate-900">{row.avgTenureDays.toFixed(2)} 天</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          ) : null}
        </div>
      </div>
    </>
  );
}
