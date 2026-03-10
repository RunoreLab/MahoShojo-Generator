import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { zipSync, strToU8 } from 'fflate';

import { UserAnalyticsHeader } from '@/components/admin/user-analytics/UserAnalyticsHeader';
import { LineSeriesChart, StackedBarChart } from '@/components/admin/user-analytics/UserAnalyticsCharts';
import { UserAnalyticsSections } from '@/components/admin/user-analytics/UserAnalyticsSections';
import {
  type ApiResponse,
  type CsvCell,
  type FrequencySample,
  normalizeIsoTimestamp,
} from '@/components/admin/user-analytics/shared';
import { buildCohortDisplayMeta, type CohortGranularity } from '@/lib/admin/user-analytics-display';
import { downloadCsvWithBom, formatTimestampForFilename } from '@/lib/client/csv-export';

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

export default function UserAnalyticsPage() {
  const [lookbackDays, setLookbackDays] = useState<number>(30);
  const [activeWindowDays, setActiveWindowDays] = useState<number>(7);
  const [frequencySample, setFrequencySample] = useState<FrequencySample>('active7d');
  const [cohort, setCohort] = useState<CohortGranularity>('week');
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [snapshotRunning, setSnapshotRunning] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [snapshotMessage, setSnapshotMessage] = useState<string | null>(null);

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

  const fetchData = useCallback(
    async (showRefreshing: boolean) => {
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
    },
    [fetchUrl],
  );

  useEffect(() => {
    void fetchData(false);
  }, [fetchData]);

  const handleRunDailySnapshot = useCallback(async () => {
    setSnapshotRunning(true);
    setSnapshotMessage(null);
    try {
      const response = await fetch('/api/admin/user-analytics/snapshot', {
        method: 'POST',
      });
      const json = (await response.json()) as {
        success?: boolean;
        snapshot?: { metricDate?: string; updatedAt?: string };
        error?: string;
      };
      if (!response.ok || json.success !== true) {
        throw new Error(json.error || '执行失败');
      }
      const metricDate = typeof json.snapshot?.metricDate === 'string' ? json.snapshot.metricDate : 'unknown';
      setSnapshotMessage(`已记录 ${metricDate} 的日快照`);
      await fetchData(true);
    } catch (runError) {
      setSnapshotMessage(runError instanceof Error ? `记录快照失败：${runError.message}` : '记录快照失败');
    } finally {
      setSnapshotRunning(false);
    }
  }, [fetchData]);

  const handleBackfillDailySnapshot = useCallback(async () => {
    setSnapshotRunning(true);
    setSnapshotMessage(null);
    try {
      const response = await fetch('/api/admin/user-analytics/snapshot?backfillDays=7&includeCurrent=0', {
        method: 'POST',
      });
      const json = (await response.json()) as {
        success?: boolean;
        backfill?: { missingDates?: string[]; writtenDates?: string[] };
        error?: string;
      };
      if (!response.ok || json.success !== true) {
        throw new Error(json.error || '执行失败');
      }
      const writtenDates = Array.isArray(json.backfill?.writtenDates) ? json.backfill?.writtenDates ?? [] : [];
      const missingDates = Array.isArray(json.backfill?.missingDates) ? json.backfill?.missingDates ?? [] : [];
      if (writtenDates.length > 0) {
        setSnapshotMessage(`已补齐 ${writtenDates.length} 天缺口：${writtenDates.join(', ')}（窗口型指标为 best-effort）`);
      } else if (missingDates.length > 0) {
        setSnapshotMessage(`检测到 ${missingDates.length} 天缺口，但本次未写入`);
      } else {
        setSnapshotMessage('近 7 天没有检测到缺失快照');
      }
      await fetchData(true);
    } catch (runError) {
      setSnapshotMessage(runError instanceof Error ? `补缺失快照失败：${runError.message}` : '补缺失快照失败');
    } finally {
      setSnapshotRunning(false);
    }
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

  const activityTrendRows = useMemo<Array<Array<CsvCell>>>(() => {
    if (!trends) return [];
    return trends.activityPoints.map((point) => [
      point.date,
      point.totalUsers,
      point.trackedUsers,
      point.untrackedUsers,
      point.activeUsers24h,
      point.activeUsers7d,
      point.activeUsers30d,
      (point.activityCoverageRate * 100).toFixed(2),
    ]);
  }, [trends]);

  const frequencyTrendRows = useMemo<Array<Array<CsvCell>>>(() => {
    if (!trends) return [];
    return trends.frequencyPoints.map((point) => [
      point.date,
      point.sample,
      point.sampleUsers,
      point.highPlusUsers,
      point.veryHighPlusUsers,
      point.extremeUsers,
      (point.highPlusShare * 100).toFixed(2),
      (point.veryHighPlusShare * 100).toFixed(2),
      (point.extremeShare * 100).toFixed(2),
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
      [...exportContextMeta, { key: 'auth_available_from_utc', value: normalizeIsoTimestamp(trends.authAvailableFrom) || 'unknown' }],
    );
  };

  const handleExportActivityTrendCsv = () => {
    if (!trends) return;
    const exportedAt = new Date();
    const exportTimestamp = formatTimestampForFilename(exportedAt);
    downloadCsvWithBom(
      `activity_trends_daily_${lookbackDays}d_${exportTimestamp}.csv`,
      [
        'date',
        'total_users',
        'tracked_users',
        'untracked_users',
        'active_users_24h',
        'active_users_7d',
        'active_users_30d',
        'activity_coverage_rate_percent',
      ],
      activityTrendRows,
      [...exportContextMeta, { key: 'activity_trend_available_from_utc', value: normalizeIsoTimestamp(trends.activityAvailableFrom) || 'unknown' }],
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

  const handleExportFrequencyTrendCsv = () => {
    if (!trends) return;
    const exportedAt = new Date();
    const exportTimestamp = formatTimestampForFilename(exportedAt);
    downloadCsvWithBom(
      `frequency_trends_${frequencySample}_${lookbackDays}d_${exportTimestamp}.csv`,
      [
        'date',
        'sample',
        'sample_users',
        'high_plus_users',
        'very_high_plus_users',
        'extreme_users',
        'high_plus_share_percent',
        'very_high_plus_share_percent',
        'extreme_share_percent',
      ],
      frequencyTrendRows,
      [
        ...exportContextMeta,
        { key: 'frequency_trend_available_from_utc', value: normalizeIsoTimestamp(trends.frequencyAvailableFrom) || 'unknown' },
        { key: 'frequency_trend_lookback_days', value: trends.frequencyTrendLookbackDays },
        { key: 'frequency_trend_profile', value: trends.frequencyTrendProfile },
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

    const activityTrendsCsv = buildCsvString(
      [
        'date',
        'total_users',
        'tracked_users',
        'untracked_users',
        'active_users_24h',
        'active_users_7d',
        'active_users_30d',
        'activity_coverage_rate_percent',
      ],
      activityTrendRows,
      exportContextMeta,
    );

    const frequencyTrendsCsv = buildCsvString(
      [
        'date',
        'sample',
        'sample_users',
        'high_plus_users',
        'very_high_plus_users',
        'extreme_users',
        'high_plus_share_percent',
        'very_high_plus_share_percent',
        'extreme_share_percent',
      ],
      frequencyTrendRows,
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
      activityTrendAvailableFrom: trends.activityAvailableFrom,
      frequencyTrendAvailableFrom: trends.frequencyAvailableFrom,
      frequencyTrendLookbackDays: trends.frequencyTrendLookbackDays,
      frequencyTrendProfile: trends.frequencyTrendProfile,
      files: [
        'overview_snapshot.csv',
        'overview_trends_daily.csv',
        'activity_trends_daily.csv',
        'frequency_buckets.csv',
        'frequency_trends.csv',
        'retention_points.csv',
        'composition_buckets.csv',
      ],
    };

    const entries = {
      'manifest.json': strToU8(JSON.stringify(manifest, null, 2)),
      'overview_snapshot.csv': strToU8(overviewSnapshotCsv),
      'overview_trends_daily.csv': strToU8(overviewTrendsCsv),
      'activity_trends_daily.csv': strToU8(activityTrendsCsv),
      'frequency_buckets.csv': strToU8(frequencyCsv),
      'frequency_trends.csv': strToU8(frequencyTrendsCsv),
      'retention_points.csv': strToU8(retentionCsv),
      'composition_buckets.csv': strToU8(compositionCsv),
    };

    const zipped = zipSync(entries, { level: 6 });
    const zippedBytes = Uint8Array.from(zipped);
    downloadBlob(new Blob([zippedBytes], { type: 'application/zip' }), `user_analytics_bundle_${exportTimestamp}.zip`);
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

  const activityWindowTrendChart = useMemo(() => {
    if (!trends || trends.activityPoints.length <= 0) return null;
    return (
      <LineSeriesChart
        labels={trends.activityPoints.map((point) => point.date)}
        series={[
          { key: 'active24h', label: '24h 活跃', color: '#0f766e', values: trends.activityPoints.map((point) => point.activeUsers24h) },
          { key: 'active7d', label: '7d 活跃', color: '#0284c7', values: trends.activityPoints.map((point) => point.activeUsers7d) },
          { key: 'active30d', label: '30d 活跃', color: '#7c3aed', values: trends.activityPoints.map((point) => point.activeUsers30d) },
        ]}
      />
    );
  }, [trends]);

  const coverageTrendChart = useMemo(() => {
    if (!trends || trends.activityPoints.length <= 0) return null;
    return (
      <LineSeriesChart
        labels={trends.activityPoints.map((point) => point.date)}
        series={[
          {
            key: 'coverageRate',
            label: '追踪覆盖率',
            color: '#ea580c',
            values: trends.activityPoints.map((point) => Number((point.activityCoverageRate * 100).toFixed(2))),
          },
        ]}
      />
    );
  }, [trends]);

  const frequencyShareTrendChart = useMemo(() => {
    if (!trends || trends.frequencyPoints.length <= 0) return null;
    return (
      <LineSeriesChart
        labels={trends.frequencyPoints.map((point) => point.date)}
        series={[
          {
            key: 'highPlus',
            label: 'high+ (>=100)',
            color: '#0284c7',
            values: trends.frequencyPoints.map((point) => Number((point.highPlusShare * 100).toFixed(2))),
          },
          {
            key: 'veryHighPlus',
            label: 'very_high+ (>=500)',
            color: '#7c3aed',
            values: trends.frequencyPoints.map((point) => Number((point.veryHighPlusShare * 100).toFixed(2))),
          },
          {
            key: 'extreme',
            label: 'extreme (>=1000)',
            color: '#e11d48',
            values: trends.frequencyPoints.map((point) => Number((point.extremeShare * 100).toFixed(2))),
          },
        ]}
      />
    );
  }, [trends]);

  const activityTrendStartLabel = useMemo(() => {
    if (!trends?.activityAvailableFrom) return null;
    return new Date(trends.activityAvailableFrom).toLocaleDateString('zh-CN');
  }, [trends?.activityAvailableFrom]);

  const frequencyTrendStartLabel = useMemo(() => {
    if (!trends?.frequencyAvailableFrom) return null;
    return new Date(trends.frequencyAvailableFrom).toLocaleDateString('zh-CN');
  }, [trends?.frequencyAvailableFrom]);

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
          </div>

          <UserAnalyticsHeader
            lookbackDays={lookbackDays}
            setLookbackDays={setLookbackDays}
            activeWindowDays={activeWindowDays}
            setActiveWindowDays={setActiveWindowDays}
            frequencySample={frequencySample}
            setFrequencySample={setFrequencySample}
            cohort={cohort}
            setCohort={setCohort}
            generatedAt={generatedAt}
            snapshotRunning={snapshotRunning}
            refreshing={refreshing}
            snapshotMessage={snapshotMessage}
            onRunDailySnapshot={handleRunDailySnapshot}
            onBackfillDailySnapshot={handleBackfillDailySnapshot}
            onRefresh={() => fetchData(true)}
            onExportOverviewSnapshotCsv={handleExportOverviewSnapshotCsv}
            onExportOverviewTrendCsv={handleExportOverviewTrendCsv}
            onExportActivityTrendCsv={handleExportActivityTrendCsv}
            onExportFrequencyCsv={handleExportFrequencyCsv}
            onExportFrequencyTrendCsv={handleExportFrequencyTrendCsv}
            onExportRetentionCsv={handleExportRetentionCsv}
            onExportCompositionCsv={handleExportCompositionCsv}
            onExportZipBundle={handleExportZipBundle}
            canExportOverview={Boolean(overview)}
            canExportTrends={Boolean(trends)}
            canExportActivityTrends={Boolean(trends && trends.activityPoints.length > 0)}
            canExportFrequency={Boolean(frequency)}
            canExportFrequencyTrends={Boolean(trends && trends.frequencyPoints.length > 0)}
            canExportRetention={Boolean(retention)}
            canExportComposition={Boolean(composition)}
            canExportBundle={Boolean(data)}
          />

          {loading && !data ? <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-500">加载中...</div> : null}

          {error ? <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">读取失败：{error}</div> : null}

          <UserAnalyticsSections
            overview={overview}
            trends={trends}
            frequency={frequency}
            retention={retention}
            composition={composition}
            frequencySample={frequencySample}
            activityTrendStartLabel={activityTrendStartLabel}
            frequencyTrendStartLabel={frequencyTrendStartLabel}
            userGrowthChart={userGrowthChart}
            cumulativeUserChart={cumulativeUserChart}
            generationTrendChart={generationTrendChart}
            authTrendChart={authTrendChart}
            activityWindowTrendChart={activityWindowTrendChart}
            coverageTrendChart={coverageTrendChart}
            frequencyShareTrendChart={frequencyShareTrendChart}
          />
        </div>
      </div>
    </>
  );
}
