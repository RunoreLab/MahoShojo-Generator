import { Clock, Download, RefreshCw } from 'lucide-react';

import type { FrequencySample, UserAnalyticsHeaderProps } from '@/components/admin/user-analytics/shared';

export function UserAnalyticsHeader(props: UserAnalyticsHeaderProps) {
  const {
    lookbackDays,
    setLookbackDays,
    activeWindowDays,
    setActiveWindowDays,
    frequencySample,
    setFrequencySample,
    cohort,
    setCohort,
    generatedAt,
    snapshotRunning,
    refreshing,
    snapshotMessage,
    onRunDailySnapshot,
    onBackfillDailySnapshot,
    onRefresh,
    onExportOverviewSnapshotCsv,
    onExportOverviewTrendCsv,
    onExportActivityTrendCsv,
    onExportFrequencyCsv,
    onExportFrequencyTrendCsv,
    onExportRetentionCsv,
    onExportCompositionCsv,
    onExportZipBundle,
    canExportOverview,
    canExportTrends,
    canExportActivityTrends,
    canExportFrequency,
    canExportFrequencyTrends,
    canExportRetention,
    canExportComposition,
    canExportBundle,
  } = props;

  return (
    <div className="mb-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h1 className="text-3xl font-semibold text-slate-900">用户统计分析</h1>
      <p className="mt-2 text-sm leading-6 text-slate-600">
        当前版本已补齐可回算趋势、基础图表与分析包导出，并接入 <code>admin_user_analytics_daily</code> 日快照，开始展示窗口型活跃、覆盖率与高频占比趋势。当前仍不引入 <code>user_activity_daily</code>，因此这些趋势只从首个快照日开始记录，不对更早历史做严格回填。
      </p>

      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-5">
        <label className="text-sm text-slate-700">
          统计窗口
          <select value={lookbackDays} onChange={(event) => setLookbackDays(Number.parseInt(event.target.value, 10))} className="mt-1 block w-full rounded-xl border border-slate-200 px-3 py-2 text-sm">
            <option value={30}>近 30 天</option>
            <option value={60}>近 60 天</option>
            <option value={90}>近 90 天</option>
            <option value={180}>近 180 天</option>
          </select>
        </label>

        <label className="text-sm text-slate-700">
          高频样本口径
          <select value={frequencySample} onChange={(event) => setFrequencySample(event.target.value as FrequencySample)} className="mt-1 block w-full rounded-xl border border-slate-200 px-3 py-2 text-sm">
            <option value="active7d">最近 7 天活跃用户</option>
            <option value="tracked">有活跃记录用户</option>
            <option value="all">全体用户</option>
          </select>
        </label>

        <label className="text-sm text-slate-700">
          活跃样本窗口
          <select value={activeWindowDays} onChange={(event) => setActiveWindowDays(Number.parseInt(event.target.value, 10))} className="mt-1 block w-full rounded-xl border border-slate-200 px-3 py-2 text-sm">
            <option value={1}>近 1 天</option>
            <option value={7}>近 7 天</option>
            <option value={30}>近 30 天</option>
            <option value={90}>近 90 天</option>
          </select>
        </label>

        <label className="text-sm text-slate-700">
          Cohort 粒度
          <select value={cohort} onChange={(event) => setCohort(event.target.value as typeof cohort)} className="mt-1 block w-full rounded-xl border border-slate-200 px-3 py-2 text-sm">
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
        <button type="button" onClick={() => void onRunDailySnapshot()} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm hover:bg-slate-50">
          <Clock className={`h-4 w-4 ${snapshotRunning ? 'animate-spin' : ''}`} />
          记录今日快照
        </button>
        <button type="button" onClick={() => void onBackfillDailySnapshot()} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm hover:bg-slate-50">
          <RefreshCw className={`h-4 w-4 ${snapshotRunning ? 'animate-spin' : ''}`} />
          补缺失快照
        </button>
        <button type="button" onClick={() => void onRefresh()} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm hover:bg-slate-50">
          <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
          刷新
        </button>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" onClick={onExportOverviewSnapshotCsv} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 hover:bg-slate-50" disabled={!canExportOverview}>
          <Download className="h-3.5 w-3.5" />
          导出 Overview 快照
        </button>
        <button type="button" onClick={onExportOverviewTrendCsv} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 hover:bg-slate-50" disabled={!canExportTrends}>
          <Download className="h-3.5 w-3.5" />
          导出总览趋势 CSV
        </button>
        <button type="button" onClick={onExportActivityTrendCsv} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 hover:bg-slate-50" disabled={!canExportActivityTrends}>
          <Download className="h-3.5 w-3.5" />
          导出活跃趋势 CSV
        </button>
        <button type="button" onClick={onExportFrequencyCsv} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 hover:bg-slate-50" disabled={!canExportFrequency}>
          <Download className="h-3.5 w-3.5" />
          导出分层 CSV
        </button>
        <button type="button" onClick={onExportFrequencyTrendCsv} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 hover:bg-slate-50" disabled={!canExportFrequencyTrends}>
          <Download className="h-3.5 w-3.5" />
          导出高频趋势 CSV
        </button>
        <button type="button" onClick={onExportRetentionCsv} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 hover:bg-slate-50" disabled={!canExportRetention}>
          <Download className="h-3.5 w-3.5" />
          导出留存 CSV
        </button>
        <button type="button" onClick={onExportCompositionCsv} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 hover:bg-slate-50" disabled={!canExportComposition}>
          <Download className="h-3.5 w-3.5" />
          导出构成 CSV
        </button>
        <button type="button" onClick={onExportZipBundle} className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-3 py-2 text-xs text-white hover:bg-slate-800" disabled={!canExportBundle}>
          <Download className="h-3.5 w-3.5" />
          导出分析包 ZIP
        </button>
      </div>

      {snapshotMessage ? <div className="mt-4 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-800">{snapshotMessage}</div> : null}
    </div>
  );
}
