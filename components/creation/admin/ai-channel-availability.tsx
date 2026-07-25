'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { Activity, AlertTriangle, Clock, Download, RefreshCw, Trash2 } from 'lucide-react';

import { AdminTableScroll } from '@/components/admin/AdminTableScroll';

// --- Types ---

type ChannelRow = {
  providerId: string;
  modelId: string;
  success1h: number;
  failure1h: number;
  excluded1h: number;
  successRate1h: number | null;
  status1h: string;
  sampleCount1h: number;
  success24h: number;
  failure24h: number;
  excluded24h: number;
  successRate24h: number | null;
  status24h: string;
  sampleCount24h: number;
  lastErrorClass: string | null;
};

type ErrorDistItem = { errorClass: string; count: number };

type SummaryResponse = {
  success: true;
  view: 'summary';
  summary: {
    totalProviders: number;
    totalModels: number;
    totalBuckets: number;
    totalSuccess: number;
    totalFailure: number;
    totalExcluded: number;
    overallSuccessRate: number | null;
    earliestBucket: string | null;
    latestBucket: string | null;
    snapshotUpdatedAt: string | null;
    snapshotSourceBucketMax: string | null;
  };
  channels: ChannelRow[];
  errorDistribution: ErrorDistItem[];
};

type BucketRow = {
  bucketStart: string;
  providerId: string;
  modelId: string;
  successCount: number;
  failureCount: number;
  excludedCount: number;
  lastErrorClass: string | null;
  updatedAt: string;
};

type BucketsResponse = {
  success: true;
  view: 'buckets';
  rows: BucketRow[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
};

type ApiResponse = SummaryResponse | BucketsResponse | { success: false; error?: string };

// --- Helpers ---

const formatPercent = (value: number | null): string => {
  if (value === null) return '—';
  return `${Math.round(value * 100)}%`;
};

const formatNumber = (value: number): string => value.toLocaleString('zh-CN');

const formatDateTime = (value: string | null | undefined): string => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', { hour12: false });
};

function statusBadge(status: string): string {
  if (status === 'healthy') return 'bg-green-100 text-green-700 border-green-200';
  if (status === 'degraded') return 'bg-amber-100 text-amber-700 border-amber-200';
  if (status === 'poor') return 'bg-red-100 text-red-700 border-red-200';
  return 'bg-slate-100 text-slate-500 border-slate-200';
}

function statusLabel(status: string): string {
  if (status === 'healthy') return '健康';
  if (status === 'degraded') return '降级';
  if (status === 'poor') return '差';
  return '未知';
}

// --- Sub-components ---

function SummaryCard(props: {
  title: string;
  value: string;
  note?: string;
  icon: React.ElementType;
  color: string;
}) {
  const { title, value, note, icon: Icon, color } = props;
  return (
    <div className="rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-sm backdrop-blur">
      <div className="mb-3 flex items-center gap-3">
        <div className={`flex h-10 w-10 items-center justify-center rounded-full ${color}`}>
          <Icon className="h-5 w-5 text-white" />
        </div>
        <div>
          <div className="text-sm font-medium text-slate-600">{title}</div>
          <div className="text-2xl font-semibold text-slate-900">{value}</div>
        </div>
      </div>
      {note ? <div className="text-xs leading-5 text-slate-500">{note}</div> : null}
    </div>
  );
}

function ErrorBar(props: { label: string; value: number; max: number }) {
  const widthPercent = props.max > 0 ? Math.max(8, Math.round((props.value / props.max) * 100)) : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="truncate text-slate-700">{props.label}</span>
        <span className="font-medium text-slate-900">{formatNumber(props.value)}</span>
      </div>
      <div className="h-2 rounded-full bg-slate-100">
        <div className="h-2 rounded-full bg-red-400" style={{ width: `${widthPercent}%` }} />
      </div>
    </div>
  );
}

// --- Main component ---

export default function AdminAiChannelAvailabilityPage() {
  const [view, setView] = useState<'summary' | 'buckets'>('summary');
  const [summaryData, setSummaryData] = useState<SummaryResponse | null>(null);
  const [bucketData, setBucketData] = useState<BucketsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Buckets filters
  const [bucketProvider, setBucketProvider] = useState('');
  const [bucketModel, setBucketModel] = useState('');
  const [bucketFrom, setBucketFrom] = useState('');
  const [bucketTo, setBucketTo] = useState('');
  const [bucketPage, setBucketPage] = useState(1);
  const BUCKET_LIMIT = 50;

  // Actions
  const [refreshing, setRefreshing] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [cleanupDays, setCleanupDays] = useState(48);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const messageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // --- Data loading ---

  const loadSummary = useCallback(async (isRefresh = false) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/admin/ai-channel-availability', { signal: controller.signal });
      const data = await res.json() as ApiResponse;
      if (!res.ok || !data.success) {
        throw new Error('success' in data && !data.success ? data.error || '加载失败' : '加载失败');
      }
      if (data.view === 'summary') {
        setSummaryData(data);
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const loadBuckets = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({ view: 'buckets', page: String(bucketPage), limit: String(BUCKET_LIMIT) });
      if (bucketProvider) params.set('provider', bucketProvider);
      if (bucketModel) params.set('model', bucketModel);
      if (bucketFrom) params.set('from', bucketFrom);
      if (bucketTo) params.set('to', bucketTo);

      const res = await fetch(`/api/admin/ai-channel-availability?${params}`, { signal: controller.signal });
      const data = await res.json() as ApiResponse;
      if (!res.ok || !data.success) {
        throw new Error('success' in data && !data.success ? data.error || '加载失败' : '加载失败');
      }
      if (data.view === 'buckets') {
        setBucketData(data);
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [bucketPage, bucketProvider, bucketModel, bucketFrom, bucketTo]);

  // --- Effects ---

  useEffect(() => {
    if (view === 'summary') {
      void loadSummary();
      const timer = window.setInterval(() => void loadSummary(true), 60_000);
      return () => {
        window.clearInterval(timer);
        abortRef.current?.abort();
      };
    }
    void loadBuckets();
    return () => { abortRef.current?.abort(); };
  }, [view, loadSummary, loadBuckets]);

  // Auto-dismiss message
  useEffect(() => {
    if (!message) return;
    if (messageTimerRef.current) clearTimeout(messageTimerRef.current);
    messageTimerRef.current = setTimeout(() => setMessage(null), 5000);
    return () => { if (messageTimerRef.current) clearTimeout(messageTimerRef.current); };
  }, [message]);

  // --- Actions ---

  const handleRefreshSnapshot = async () => {
    setRefreshing(true);
    try {
      const res = await fetch('/api/admin/ai-channel-availability', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'refresh-snapshot' }),
      });
      const data = await res.json() as { success: boolean; generatedAt?: string; error?: string };
      if (!res.ok || !data.success) {
        throw new Error(data.error || '刷新快照失败');
      }
      setMessage({ type: 'success', text: `快照已重建 (${data.generatedAt})` });
      void loadSummary(true);
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : '刷新快照失败' });
    } finally {
      setRefreshing(false);
    }
  };

  const handleCleanup = async () => {
    if (!window.confirm(`确定要清理 ${cleanupDays} 天前的桶数据吗？此操作不可撤销。`)) return;
    setCleaning(true);
    try {
      const res = await fetch('/api/admin/ai-channel-availability', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cleanup', olderThanDays: cleanupDays }),
      });
      const data = await res.json() as { success: boolean; deletedRows?: number; error?: string };
      if (!res.ok || !data.success) {
        throw new Error(data.error || '清理失败');
      }
      setMessage({ type: 'success', text: `已清理 ${formatNumber(data.deletedRows ?? 0)} 条旧记录` });
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : '清理失败' });
    } finally {
      setCleaning(false);
    }
  };

  // --- Derived ---

  const errorDistMax = useMemo(() => {
    const dist = summaryData?.errorDistribution ?? [];
    return dist.reduce((max, item) => Math.max(max, item.count), 0);
  }, [summaryData]);

  // --- Render ---

  return (
    <>
      <Head>
        <title>AI 渠道可用性 - Admin</title>
      </Head>

      <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(6,182,212,0.12),_transparent_32%),linear-gradient(180deg,_#f0fdfa_0%,_#f8fafc_100%)] p-4 sm:p-6">
        <div className="mx-auto max-w-7xl">
          {/* Header */}
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <Link href="/admin" className="text-sm text-cyan-700 hover:underline">
                ← 返回管理后台主页
              </Link>
              <h1 className="mt-3 text-3xl font-semibold text-slate-900">AI 渠道可用性</h1>
              <p className="mt-1 text-sm text-slate-600">
                查看 AI 渠道/模型的可用性汇总、错误分布，浏览原始桶数据，清理过期记录。
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setView(view === 'summary' ? 'buckets' : 'summary')}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm hover:bg-slate-50"
              >
                <Download className="h-4 w-4" />
                {view === 'summary' ? '查看原始桶' : '返回汇总'}
              </button>
              <button
                type="button"
                onClick={() => void handleRefreshSnapshot()}
                disabled={refreshing}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50"
              >
                <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
                刷新快照
              </button>
            </div>
          </div>

          {/* Message */}
          {message ? (
            <div
              className={`mb-4 rounded-2xl border px-4 py-3 text-sm ${
                message.type === 'success'
                  ? 'border-green-200 bg-green-50 text-green-700'
                  : 'border-red-200 bg-red-50 text-red-700'
              }`}
            >
              {message.text}
            </div>
          ) : null}

          {/* Error */}
          {error ? (
            <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
          ) : null}

          {/* Loading */}
          {loading && !summaryData && !bucketData ? (
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-500">
              正在加载 AI 渠道可用性数据…
            </div>
          ) : null}

          {/* Summary View */}
          {view === 'summary' && summaryData ? (
            <>
              {/* Stat Cards */}
              <div className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <SummaryCard
                  title="活跃渠道"
                  value={String(summaryData.summary.totalProviders)}
                  note={`${summaryData.summary.totalModels} 个模型`}
                  icon={Activity}
                  color="bg-cyan-600"
                />
                <SummaryCard
                  title="总成功率"
                  value={formatPercent(summaryData.summary.overallSuccessRate)}
                  note={`${formatNumber(summaryData.summary.totalSuccess)} 成功 / ${formatNumber(summaryData.summary.totalFailure)} 失败`}
                  icon={Activity}
                  color="bg-emerald-600"
                />
                <SummaryCard
                  title="桶记录数"
                  value={formatNumber(summaryData.summary.totalBuckets)}
                  note={`排除 ${formatNumber(summaryData.summary.totalExcluded)}`}
                  icon={Clock}
                  color="bg-indigo-600"
                />
                <SummaryCard
                  title="快照状态"
                  value={summaryData.summary.snapshotUpdatedAt ? '已缓存' : '无快照'}
                  note={
                    summaryData.summary.snapshotUpdatedAt
                      ? `更新于 ${formatDateTime(summaryData.summary.snapshotUpdatedAt)}`
                      : '将自动重建'
                  }
                  icon={AlertTriangle}
                  color={summaryData.summary.snapshotUpdatedAt ? 'bg-emerald-600' : 'bg-amber-500'}
                />
              </div>

              {/* Channel Table */}
              <AdminTableScroll
                hint="按渠道/模型展示 1h 与 24h 可用性，按状态降序排列"
                className="mb-6"
              >
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-4 py-3">渠道</th>
                      <th className="px-4 py-3">模型</th>
                      <th className="px-4 py-3 text-right">1h 成功率</th>
                      <th className="px-4 py-3 text-right">1h 样本</th>
                      <th className="px-4 py-3 text-center">1h 状态</th>
                      <th className="px-4 py-3 text-right">24h 成功率</th>
                      <th className="px-4 py-3 text-right">24h 样本</th>
                      <th className="px-4 py-3 text-center">24h 状态</th>
                      <th className="px-4 py-3">最近错误</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {summaryData.channels.length > 0 ? (
                      summaryData.channels.map((ch) => (
                        <tr key={`${ch.providerId}:${ch.modelId}`}>
                          <td className="px-4 py-3 font-medium text-slate-900">{ch.providerId}</td>
                          <td className="px-4 py-3 text-slate-700">{ch.modelId}</td>
                          <td className="px-4 py-3 text-right text-slate-700">{formatPercent(ch.successRate1h)}</td>
                          <td className="px-4 py-3 text-right text-slate-500">{formatNumber(ch.sampleCount1h)}</td>
                          <td className="px-4 py-3 text-center">
                            <span className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${statusBadge(ch.status1h)}`}>
                              {statusLabel(ch.status1h)}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right text-slate-700">{formatPercent(ch.successRate24h)}</td>
                          <td className="px-4 py-3 text-right text-slate-500">{formatNumber(ch.sampleCount24h)}</td>
                          <td className="px-4 py-3 text-center">
                            <span className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${statusBadge(ch.status24h)}`}>
                              {statusLabel(ch.status24h)}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-xs text-slate-500">{ch.lastErrorClass ?? '—'}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={9} className="px-4 py-8 text-center text-slate-500">
                          暂无渠道数据
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </AdminTableScroll>

              {/* Error Distribution */}
              {summaryData.errorDistribution.length > 0 ? (
                <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="mb-4 flex items-center gap-2">
                    <AlertTriangle className="h-5 w-5 text-red-500" />
                    <h2 className="text-lg font-semibold text-slate-900">错误分类分布（近 24h）</h2>
                  </div>
                  <div className="space-y-3">
                    {summaryData.errorDistribution.map((item) => (
                      <ErrorBar key={item.errorClass} label={item.errorClass} value={item.count} max={errorDistMax} />
                    ))}
                  </div>
                </section>
              ) : null}

              {/* Cleanup Section */}
              <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
                <div className="flex flex-wrap items-end gap-4">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">清理过期桶数据</h3>
                    <p className="mt-1 text-xs text-slate-600">删除超过指定天数的历史桶记录。快照重建仅依赖近 24h 数据，建议保留至少 48 小时。</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="text-sm text-slate-700">保留天数：</label>
                    <input
                      type="number"
                      min={1}
                      max={365}
                      value={cleanupDays}
                      onChange={(e) => setCleanupDays(Math.max(1, Number(e.target.value) || 48))}
                      className="h-9 w-20 rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-700 shadow-sm"
                    />
                    <button
                      type="button"
                      onClick={() => void handleCleanup()}
                      disabled={cleaning}
                      className="inline-flex items-center gap-2 rounded-xl border border-red-200 bg-white px-3 py-2 text-sm text-red-700 shadow-sm hover:bg-red-50 disabled:opacity-50"
                    >
                      <Trash2 className="h-4 w-4" />
                      {cleaning ? '清理中…' : '清理'}
                    </button>
                  </div>
                </div>
              </section>
            </>
          ) : null}

          {/* Buckets View */}
          {view === 'buckets' && bucketData ? (
            <>
              {/* Filters */}
              <div className="mb-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-5">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-600">渠道</label>
                    <input
                      value={bucketProvider}
                      onChange={(e) => setBucketProvider(e.target.value)}
                      placeholder="provider_id"
                      className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-700 shadow-sm"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-600">模型（模糊）</label>
                    <input
                      value={bucketModel}
                      onChange={(e) => setBucketModel(e.target.value)}
                      placeholder="model_id"
                      className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-700 shadow-sm"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-600">起始时间</label>
                    <input
                      type="datetime-local"
                      value={bucketFrom}
                      onChange={(e) => setBucketFrom(e.target.value ? new Date(e.target.value).toISOString() : '')}
                      className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-700 shadow-sm"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-600">结束时间</label>
                    <input
                      type="datetime-local"
                      value={bucketTo}
                      onChange={(e) => setBucketTo(e.target.value ? new Date(e.target.value).toISOString() : '')}
                      className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-700 shadow-sm"
                    />
                  </div>
                  <div className="flex items-end gap-2">
                    <button
                      type="button"
                      onClick={() => { setBucketPage(1); void loadBuckets(); }}
                      className="h-9 rounded-lg bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-800"
                    >
                      查询
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setBucketProvider('');
                        setBucketModel('');
                        setBucketFrom('');
                        setBucketTo('');
                        setBucketPage(1);
                      }}
                      className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 hover:bg-slate-50"
                    >
                      重置
                    </button>
                  </div>
                </div>
                <div className="mt-2 text-xs text-slate-500">
                  共 {formatNumber(bucketData.total)} 条记录
                </div>
              </div>

              {/* Bucket Table */}
              <AdminTableScroll
                hint="原始 5 分钟粒度桶数据，按时间倒序"
                footer={
                  bucketData.totalPages > 1 ? (
                    <div className="flex items-center justify-between">
                      <button
                        type="button"
                        disabled={bucketPage <= 1}
                        onClick={() => { setBucketPage((p) => Math.max(1, p - 1)); }}
                        className="admin-button-sm disabled:opacity-50"
                      >
                        上一页
                      </button>
                      <span className="text-sm text-slate-600">
                        {bucketData.page} / {bucketData.totalPages}
                      </span>
                      <button
                        type="button"
                        disabled={bucketPage >= bucketData.totalPages}
                        onClick={() => { setBucketPage((p) => p + 1); }}
                        className="admin-button-sm disabled:opacity-50"
                      >
                        下一页
                      </button>
                    </div>
                  ) : null
                }
              >
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-4 py-3">桶起始时间</th>
                      <th className="px-4 py-3">渠道</th>
                      <th className="px-4 py-3">模型</th>
                      <th className="px-4 py-3 text-right">成功</th>
                      <th className="px-4 py-3 text-right">失败</th>
                      <th className="px-4 py-3 text-right">排除</th>
                      <th className="px-4 py-3">错误分类</th>
                      <th className="px-4 py-3">更新时间</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {bucketData.rows.length > 0 ? (
                      bucketData.rows.map((row) => (
                        <tr key={`${row.bucketStart}:${row.providerId}:${row.modelId}`}>
                          <td className="px-4 py-3 font-mono text-xs text-slate-700">{formatDateTime(row.bucketStart)}</td>
                          <td className="px-4 py-3 text-slate-900">{row.providerId}</td>
                          <td className="px-4 py-3 text-slate-700">{row.modelId}</td>
                          <td className="px-4 py-3 text-right text-emerald-600">{formatNumber(row.successCount)}</td>
                          <td className="px-4 py-3 text-right text-red-600">{formatNumber(row.failureCount)}</td>
                          <td className="px-4 py-3 text-right text-slate-500">{formatNumber(row.excludedCount)}</td>
                          <td className="px-4 py-3 text-xs text-slate-500">{row.lastErrorClass ?? '—'}</td>
                          <td className="px-4 py-3 text-xs text-slate-500">{formatDateTime(row.updatedAt)}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={8} className="px-4 py-8 text-center text-slate-500">
                          暂无桶数据
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </AdminTableScroll>
            </>
          ) : null}
        </div>
      </div>
    </>
  );
}
