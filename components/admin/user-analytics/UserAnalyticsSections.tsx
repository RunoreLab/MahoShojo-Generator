import type { ReactNode } from 'react';
import { Activity, BarChart3, Clock, TrendingUp, Users } from 'lucide-react';

import { HorizontalBarList } from '@/components/admin/user-analytics/UserAnalyticsCharts';
import {
  type CompositionStats,
  type FrequencySample,
  type FrequencyStats,
  type OverviewStats,
  type RetentionStats,
  type TrendStats,
  StatCard,
  formatNumber,
  formatPercent,
} from '@/components/admin/user-analytics/shared';
import { buildCohortDisplayMeta, getCohortGranularityZhLabel } from '@/lib/admin/user-analytics-display';

type UserAnalyticsSectionsProps = {
  overview?: OverviewStats;
  trends?: TrendStats;
  frequency?: FrequencyStats;
  retention?: RetentionStats;
  composition?: CompositionStats;
  frequencySample: FrequencySample;
  activityTrendStartLabel: string | null;
  frequencyTrendStartLabel: string | null;
  userGrowthChart: ReactNode;
  cumulativeUserChart: ReactNode;
  generationTrendChart: ReactNode;
  authTrendChart: ReactNode;
  activityWindowTrendChart: ReactNode;
  coverageTrendChart: ReactNode;
  frequencyShareTrendChart: ReactNode;
};

export function UserAnalyticsSections(props: UserAnalyticsSectionsProps) {
  const {
    overview,
    trends,
    frequency,
    retention,
    composition,
    frequencySample,
    activityTrendStartLabel,
    frequencyTrendStartLabel,
    userGrowthChart,
    cumulativeUserChart,
    generationTrendChart,
    authTrendChart,
    activityWindowTrendChart,
    coverageTrendChart,
    frequencyShareTrendChart,
  } = props;

  return (
    <>
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

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4">
              <h2 className="text-lg font-semibold text-slate-900">活跃窗口趋势</h2>
              <p className="text-xs text-slate-500">
                基于 `admin_user_analytics_daily` 快照。{activityTrendStartLabel ? `趋势起始日期 ${activityTrendStartLabel}` : '当前还没有可用快照数据。'}
              </p>
            </div>
            {activityWindowTrendChart ? (
              activityWindowTrendChart
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">当前窗口内暂无日快照，活跃趋势将在首次快照后显示。</div>
            )}
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4">
              <h2 className="text-lg font-semibold text-slate-900">覆盖率趋势</h2>
              <p className="text-xs text-slate-500">
                展示 tracked / total 覆盖率变化。{activityTrendStartLabel ? `趋势起始日期 ${activityTrendStartLabel}` : '当前还没有可用快照数据。'}
              </p>
            </div>
            {coverageTrendChart ? (
              coverageTrendChart
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">当前窗口内暂无日快照，覆盖率趋势将在首次快照后显示。</div>
            )}
          </section>
        </div>
      ) : null}

      <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        窗口型趋势说明：当前仅基于 <code>admin_user_analytics_daily</code> 日快照记录，不引入 <code>user_activity_daily</code>。因此 24h / 7d / 30d 活跃、覆盖率与高频占比只从首个快照日开始显示，不对更早历史做严格回填。当前定时任务会自动尝试补齐最近 7 天缺口，但这些窗口型回补仍属于 best-effort。平台若未配置定时调用，则需要手动点击“记录今日快照”/“补缺失快照”或执行脚本。
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

          <div className="mb-5 rounded-2xl border border-slate-200 p-4">
            <h3 className="mb-2 text-sm font-semibold text-slate-900">高频占比趋势</h3>
            <p className="mb-4 text-xs text-slate-500">
              当前按样本 {frequencySample} 展示，固定滚动 {trends?.frequencyTrendLookbackDays ?? 30} 天口径。
              {frequencyTrendStartLabel ? ` 趋势起始日期 ${frequencyTrendStartLabel}。` : ' 当前还没有可用快照数据。'}
            </p>
            {frequencyShareTrendChart ? (
              frequencyShareTrendChart
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">当前窗口内暂无日快照，高频占比趋势将在首次快照后显示。</div>
            )}
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
    </>
  );
}
