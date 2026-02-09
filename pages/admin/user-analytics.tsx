import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { BarChart3, Clock, Users, Activity, RefreshCw } from 'lucide-react';

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
  sampleUsers: number;
  newUsers: number;
  oldUsers: number;
  newUsersShare: number;
  avgTenureDays: number;
  medianTenureDays: number;
  p90TenureDays: number;
  buckets: CompositionBucket[];
  activityTrackingOk: boolean;
};

type ApiResponse = {
  success: boolean;
  section: 'all';
  stats: {
    overview: OverviewStats;
    frequency: FrequencyStats;
    retention: RetentionStats;
    composition: CompositionStats;
  };
  meta: {
    generatedAt: string;
    lookbackDays: number;
    frequencySample: 'active7d' | 'tracked' | 'all';
    activeWindowDays: number;
    frequencyProfile: 'v20260209';
  };
  error?: string;
};

type FrequencySample = 'active7d' | 'tracked' | 'all';

const formatPercent = (value: number): string => `${(Math.max(0, Math.min(1, value)) * 100).toFixed(1)}%`;

const formatNumber = (value: number): string => {
  if (!Number.isFinite(value)) return '0';
  return Math.round(value).toLocaleString('zh-CN');
};

const StatCard: React.FC<{ title: string; value: string; note?: string; icon: React.ElementType; color: string }> = ({
  title,
  value,
  note,
  icon: Icon,
  color,
}) => (
  <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
    <div className="mb-3 flex items-center gap-3">
      <div className={`flex h-10 w-10 items-center justify-center rounded-full ${color}`}>
        <Icon className="h-5 w-5 text-white" />
      </div>
      <p className="text-sm font-medium text-gray-600">{title}</p>
    </div>
    <p className="text-3xl font-semibold text-gray-800">{value}</p>
    {note ? <p className="mt-2 text-xs text-gray-400">{note}</p> : null}
  </div>
);

const UserAnalyticsPage: React.FC = () => {
  const [lookbackDays, setLookbackDays] = useState<number>(30);
  const [activeWindowDays, setActiveWindowDays] = useState<number>(7);
  const [frequencySample, setFrequencySample] = useState<FrequencySample>('active7d');
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
      frequencyProfile: 'v20260209',
    });
    return `/api/admin/user-analytics?${params.toString()}`;
  }, [lookbackDays, frequencySample, activeWindowDays]);

  const fetchData = useCallback(async (showRefreshing: boolean) => {
    if (!showRefreshing) setLoading(true);
    if (showRefreshing) setRefreshing(true);

    try {
      const response = await fetch(fetchUrl);
      if (!response.ok) {
        throw new Error('请求失败');
      }
      const json = (await response.json()) as ApiResponse;
      if (!json.success) {
        throw new Error(json.error || '读取失败');
      }
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
  const generatedAt = data?.meta.generatedAt;

  return (
    <>
      <Head>
        <title>用户统计分析 - Admin</title>
      </Head>
      <div className="min-h-screen bg-gray-50 p-4 sm:p-6">
        <div className="mx-auto max-w-7xl">
          <div className="mb-4 flex items-center justify-between">
            <Link href="/admin" className="text-sm text-purple-600 hover:underline">
              &larr; 返回管理后台主页
            </Link>
            <button
              type="button"
              onClick={() => void fetchData(true)}
              className="inline-flex items-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              刷新
            </button>
          </div>

          <div className="mb-5 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <h1 className="text-2xl font-bold text-gray-800">用户统计分析</h1>
            <p className="mt-1 text-sm text-gray-500">
              当前支持活跃概览与高频生成分层（profile: <code>v20260209</code>）
            </p>
            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-4">
              <label className="text-sm text-gray-700">
                统计窗口
                <select
                  value={lookbackDays}
                  onChange={(e) => setLookbackDays(Number.parseInt(e.target.value, 10))}
                  className="mt-1 block w-full rounded-md border border-gray-200 px-3 py-2 text-sm"
                >
                  <option value={30}>近 30 天</option>
                  <option value={60}>近 60 天</option>
                  <option value={90}>近 90 天</option>
                  <option value={180}>近 180 天</option>
                </select>
              </label>
              <label className="text-sm text-gray-700">
                高频样本口径
                <select
                  value={frequencySample}
                  onChange={(e) => setFrequencySample(e.target.value as FrequencySample)}
                  className="mt-1 block w-full rounded-md border border-gray-200 px-3 py-2 text-sm"
                >
                  <option value="active7d">最近 7 天活跃用户</option>
                  <option value="tracked">有活跃记录用户</option>
                  <option value="all">全体用户</option>
                </select>
              </label>
              <label className="text-sm text-gray-700">
                活跃样本窗口
                <select
                  value={activeWindowDays}
                  onChange={(e) => setActiveWindowDays(Number.parseInt(e.target.value, 10))}
                  className="mt-1 block w-full rounded-md border border-gray-200 px-3 py-2 text-sm"
                >
                  <option value={1}>近 1 天</option>
                  <option value={7}>近 7 天</option>
                  <option value={30}>近 30 天</option>
                  <option value={90}>近 90 天</option>
                </select>
              </label>
              <div className="text-sm text-gray-700">
                数据时间
                <div className="mt-1 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600">
                  {generatedAt ? new Date(generatedAt).toLocaleString('zh-CN') : '—'}
                </div>
              </div>
            </div>
          </div>

          {loading && !data ? (
            <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-gray-500">加载中...</div>
          ) : null}

          {error ? (
            <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              读取失败：{error}
            </div>
          ) : null}

          {overview ? (
            <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
              <StatCard
                title="总用户"
                value={formatNumber(overview.totalUsers)}
                icon={Users}
                color="bg-teal-500"
              />
              <StatCard
                title="已追踪用户"
                value={formatNumber(overview.trackedUsers)}
                icon={Activity}
                color="bg-violet-600"
                note={`覆盖率 ${formatPercent(overview.activityCoverageRate)}`}
              />
              <StatCard
                title="活跃用户（24h）"
                value={formatNumber(overview.activeUsers24h)}
                icon={Clock}
                color="bg-fuchsia-600"
                note={overview.activityTrackingOk ? '口径：user_last_activity' : 'user_last_activity 未就绪'}
              />
              <StatCard
                title="活跃用户（7d）"
                value={formatNumber(overview.activeUsers7d)}
                icon={Users}
                color="bg-indigo-600"
                note={`活跃用户（30d）${formatNumber(overview.activeUsers30d)}`}
              />
              <StatCard
                title={`战报生成（${overview.lookbackDays}d）`}
                value={formatNumber(overview.generationTotal)}
                icon={BarChart3}
                color="bg-blue-600"
              />
              <StatCard
                title="完成率"
                value={formatPercent(1 - overview.generationAbortFailRate)}
                icon={Activity}
                color="bg-emerald-600"
                note={`中断+失败 ${formatPercent(overview.generationAbortFailRate)}`}
              />
              <StatCard
                title="参与生成用户数"
                value={formatNumber(overview.generationDistinctUsers)}
                icon={Users}
                color="bg-sky-600"
              />
              <StatCard
                title="人均生成（tracked）"
                value={overview.generationPerTrackedUser.toFixed(1)}
                icon={BarChart3}
                color="bg-cyan-600"
                note={`孤立 user_id 事件 ${formatNumber(overview.generationOrphanUserEvents)}`}
              />
            </div>
          ) : null}

          {frequency ? (
            <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg font-semibold text-gray-800">高频生成分层</h2>
                <p className="text-xs text-gray-500">
                  样本 {frequency.sample} · 窗口 {frequency.lookbackDays}d · profile {frequency.profile}
                </p>
              </div>

              <div className="mb-5 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                  <p className="text-xs text-gray-500">样本用户数</p>
                  <p className="mt-1 text-xl font-semibold text-gray-800">{formatNumber(frequency.sampleUsers)}</p>
                </div>
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                  <p className="text-xs text-gray-500">high+ (≥100)</p>
                  <p className="mt-1 text-xl font-semibold text-gray-800">
                    {formatNumber(frequency.highPlusUsers)} · {formatPercent(frequency.highPlusShare)}
                  </p>
                </div>
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                  <p className="text-xs text-gray-500">very_high+ (≥500)</p>
                  <p className="mt-1 text-xl font-semibold text-gray-800">
                    {formatNumber(frequency.veryHighPlusUsers)} · {formatPercent(frequency.veryHighPlusShare)}
                  </p>
                </div>
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                  <p className="text-xs text-gray-500">extreme (≥1000)</p>
                  <p className="mt-1 text-xl font-semibold text-gray-800">
                    {formatNumber(frequency.extremeUsers)} · {formatPercent(frequency.extremeShare)}
                  </p>
                </div>
              </div>

              <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="rounded-lg border border-gray-200 bg-white p-3">
                  <p className="text-xs text-gray-500">样本人均生成次数</p>
                  <p className="mt-1 text-lg font-semibold text-gray-800">{frequency.avgTotalCount.toFixed(1)}</p>
                </div>
                <div className="rounded-lg border border-gray-200 bg-white p-3">
                  <p className="text-xs text-gray-500">样本平均成功率</p>
                  <p className="mt-1 text-lg font-semibold text-gray-800">{formatPercent(frequency.avgSuccessRate)}</p>
                </div>
              </div>

              <div className="overflow-x-auto rounded-lg border border-gray-200">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-600">
                    <tr>
                      <th className="px-4 py-3">分层</th>
                      <th className="px-4 py-3">人数</th>
                      <th className="px-4 py-3">占比</th>
                    </tr>
                  </thead>
                  <tbody>
                    {frequency.buckets.map((bucket) => (
                      <tr key={bucket.key} className="border-t border-gray-100">
                        <td className="px-4 py-3 text-gray-700">{bucket.label}</td>
                        <td className="px-4 py-3 text-gray-800">{formatNumber(bucket.count)}</td>
                        <td className="px-4 py-3 text-gray-800">{formatPercent(bucket.share)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {!frequency.activityTrackingOk ? (
                <p className="mt-3 text-xs text-amber-700">
                  提示：`user_last_activity` 未就绪，`active7d/tracked` 口径会退化为低可用状态。
                </p>
              ) : null}
            </div>
          ) : null}

          {retention ? (
            <div className="mt-6 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg font-semibold text-gray-800">留存概览（累计回访口径）</h2>
                <p className="text-xs text-gray-500">
                  样本总量 {formatNumber(retention.totalUsers)} · 口径 {retention.activityTrackingOk ? 'last_activity + last_login' : 'last_login 回退'}
                </p>
              </div>

              <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-3">
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                  <p className="text-xs text-gray-500">平均留存时长</p>
                  <p className="mt-1 text-xl font-semibold text-gray-800">{retention.avgObservedRetentionDays.toFixed(2)} 天</p>
                </div>
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                  <p className="text-xs text-gray-500">中位留存时长</p>
                  <p className="mt-1 text-xl font-semibold text-gray-800">{retention.medianObservedRetentionDays} 天</p>
                </div>
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                  <p className="text-xs text-gray-500">P90 留存时长</p>
                  <p className="mt-1 text-xl font-semibold text-gray-800">{retention.p90ObservedRetentionDays} 天</p>
                </div>
              </div>

              <div className="overflow-x-auto rounded-lg border border-gray-200">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-600">
                    <tr>
                      <th className="px-4 py-3">窗口</th>
                      <th className="px-4 py-3">可观测用户</th>
                      <th className="px-4 py-3">已达到阈值</th>
                      <th className="px-4 py-3">留存率</th>
                    </tr>
                  </thead>
                  <tbody>
                    {retention.points.map((point) => (
                      <tr key={point.key} className="border-t border-gray-100">
                        <td className="px-4 py-3 text-gray-700">{point.label}</td>
                        <td className="px-4 py-3 text-gray-800">{formatNumber(point.eligible)}</td>
                        <td className="px-4 py-3 text-gray-800">{formatNumber(point.retained)}</td>
                        <td className="px-4 py-3 text-gray-800">{formatPercent(point.rate)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {composition ? (
            <div className="mt-6 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg font-semibold text-gray-800">活跃用户构成</h2>
                <p className="text-xs text-gray-500">
                  活跃窗口 {composition.activeWindowDays} 天 · 样本 {formatNumber(composition.sampleUsers)}
                </p>
              </div>

              <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-4">
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                  <p className="text-xs text-gray-500">新用户（≤30天）</p>
                  <p className="mt-1 text-xl font-semibold text-gray-800">
                    {formatNumber(composition.newUsers)} · {formatPercent(composition.newUsersShare)}
                  </p>
                </div>
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                  <p className="text-xs text-gray-500">老用户（&gt;30天）</p>
                  <p className="mt-1 text-xl font-semibold text-gray-800">{formatNumber(composition.oldUsers)}</p>
                </div>
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                  <p className="text-xs text-gray-500">平均注册时长</p>
                  <p className="mt-1 text-xl font-semibold text-gray-800">{composition.avgTenureDays.toFixed(2)} 天</p>
                </div>
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                  <p className="text-xs text-gray-500">中位 / P90 注册时长</p>
                  <p className="mt-1 text-xl font-semibold text-gray-800">
                    {composition.medianTenureDays} / {composition.p90TenureDays} 天
                  </p>
                </div>
              </div>

              <div className="overflow-x-auto rounded-lg border border-gray-200">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-600">
                    <tr>
                      <th className="px-4 py-3">注册时长分层</th>
                      <th className="px-4 py-3">人数</th>
                      <th className="px-4 py-3">占比</th>
                    </tr>
                  </thead>
                  <tbody>
                    {composition.buckets.map((bucket) => (
                      <tr key={bucket.key} className="border-t border-gray-100">
                        <td className="px-4 py-3 text-gray-700">{bucket.label}</td>
                        <td className="px-4 py-3 text-gray-800">{formatNumber(bucket.count)}</td>
                        <td className="px-4 py-3 text-gray-800">{formatPercent(bucket.share)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
};

export default UserAnalyticsPage;
