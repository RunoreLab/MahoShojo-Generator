import Head from 'next/head';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { ElementType, FormEvent } from 'react';
import {
  Copy,
  Gift,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Wallet,
} from 'lucide-react';

import { AdminTableScroll } from '@/components/admin/AdminTableScroll';

type RedemptionCodeItem = {
  code: string;
  slotCount: number;
  estimatedValueCny: number;
  createdAt: string | null;
};

type RedemptionCodeStats = {
  unusedCodeTotal: number;
  unusedSlotTotal: number;
  unusedEstimatedValueCny: number;
  inferredRedeemedSlotTotal: number;
  inferredRedeemedEstimatedValueCny: number;
  inferredRedeemedUserTotal: number;
  inferredRedeemedAverageValueCny: number;
  reporterRewardSlotTotal: number;
  latestCreatedAt: string | null;
};

type ListResponse = {
  success?: boolean;
  items?: RedemptionCodeItem[];
  stats?: RedemptionCodeStats;
  total?: number;
  page?: number;
  limit?: number;
  error?: string;
};

type GeneratedResponse = {
  success?: boolean;
  generated?: RedemptionCodeItem[];
  stats?: RedemptionCodeStats;
  error?: string;
};

const EMPTY_STATS: RedemptionCodeStats = {
  unusedCodeTotal: 0,
  unusedSlotTotal: 0,
  unusedEstimatedValueCny: 0,
  inferredRedeemedSlotTotal: 0,
  inferredRedeemedEstimatedValueCny: 0,
  inferredRedeemedUserTotal: 0,
  inferredRedeemedAverageValueCny: 0,
  reporterRewardSlotTotal: 0,
  latestCreatedAt: null,
};

const formatNumber = (value: number | null | undefined): string =>
  typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('zh-CN') : '0';

const formatCny = (value: number | null | undefined): string =>
  `${formatNumber(value)} 元`;

const formatDateTime = (value: string | null | undefined): string => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', { hour12: false });
};

const clampPositiveInt = (value: string, fallback: number): number => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.floor(parsed));
};

function StatCard(props: {
  title: string;
  value: string;
  note: string;
  icon: ElementType;
  tone: string;
}) {
  const { title, value, note, icon: Icon, tone } = props;
  return (
    <div className="rounded-2xl border border-white/70 bg-white/90 p-4 shadow-sm backdrop-blur">
      <div className="flex items-start gap-3">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${tone}`}>
          <Icon className="h-5 w-5 text-white" />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-medium text-slate-500">{title}</p>
          <p className="mt-1 text-2xl font-semibold text-slate-900">{value}</p>
          <p className="mt-1 text-xs leading-5 text-slate-500">{note}</p>
        </div>
      </div>
    </div>
  );
}

export default function AdminRedemptionCodesPage() {
  const [items, setItems] = useState<RedemptionCodeItem[]>([]);
  const [stats, setStats] = useState<RedemptionCodeStats>(EMPTY_STATS);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [search, setSearch] = useState('');
  const [minSlotCount, setMinSlotCount] = useState('');
  const [maxSlotCount, setMaxSlotCount] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [appliedMinSlotCount, setAppliedMinSlotCount] = useState('');
  const [appliedMaxSlotCount, setAppliedMaxSlotCount] = useState('');
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [selectedCodes, setSelectedCodes] = useState<Set<string>>(() => new Set());
  const [generateSlotCount, setGenerateSlotCount] = useState('64');
  const [generateCount, setGenerateCount] = useState('10');
  const [generated, setGenerated] = useState<RedemptionCodeItem[]>([]);
  const [refreshTick, setRefreshTick] = useState(0);

  const totalPages = Math.max(1, Math.ceil(total / limit));
  const allVisibleSelected = items.length > 0 && items.every((item) => selectedCodes.has(item.code));
  const selectedCount = selectedCodes.size;

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/redemption-codes?${new URLSearchParams({
        page: String(page),
        limit: String(limit),
        ...(appliedSearch.trim() ? { search: appliedSearch.trim() } : {}),
        ...(appliedMinSlotCount.trim() ? { minSlotCount: appliedMinSlotCount.trim() } : {}),
        ...(appliedMaxSlotCount.trim() ? { maxSlotCount: appliedMaxSlotCount.trim() } : {}),
      }).toString()}`);
      const payload = (await response.json()) as ListResponse;
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || '读取兑换码失败');
      }
      setItems(Array.isArray(payload.items) ? payload.items : []);
      setStats(payload.stats ?? EMPTY_STATS);
      setTotal(typeof payload.total === 'number' ? payload.total : 0);
      setPage(typeof payload.page === 'number' ? payload.page : page);
      setLimit(typeof payload.limit === 'number' ? payload.limit : limit);
      setSelectedCodes((prev) => {
        if (prev.size === 0) return prev;
        const visible = new Set((payload.items ?? []).map((item) => item.code));
        return new Set(Array.from(prev).filter((code) => visible.has(code)));
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '读取兑换码失败');
    } finally {
      setLoading(false);
    }
  }, [appliedMaxSlotCount, appliedMinSlotCount, appliedSearch, limit, page]);

  useEffect(() => {
    void loadData();
  }, [loadData, refreshTick]);

  const handleSearchSubmit = (event: FormEvent) => {
    event.preventDefault();
    setAppliedSearch(search);
    setAppliedMinSlotCount(minSlotCount);
    setAppliedMaxSlotCount(maxSlotCount);
    setPage(1);
  };

  const handleGenerate = async (event: FormEvent) => {
    event.preventDefault();
    setActionLoading(true);
    setError(null);
    setMessage(null);
    try {
      const slotCount = clampPositiveInt(generateSlotCount, 64);
      const count = clampPositiveInt(generateCount, 1);
      const response = await fetch('/api/admin/redemption-codes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slotCount, count }),
      });
      const payload = (await response.json()) as GeneratedResponse;
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || '生成兑换码失败');
      }
      const nextGenerated = Array.isArray(payload.generated) ? payload.generated : [];
      setGenerated(nextGenerated);
      setStats(payload.stats ?? stats);
      setMessage(`已生成 ${nextGenerated.length} 个兑换码。`);
      setPage(1);
      setRefreshTick((tick) => tick + 1);
    } catch (generateError) {
      setError(generateError instanceof Error ? generateError.message : '生成兑换码失败');
    } finally {
      setActionLoading(false);
    }
  };

  const copyText = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setMessage(`已复制${label}`);
    } catch {
      setError('复制失败，请手动选择文本复制。');
    }
  };

  const toggleCode = (code: string) => {
    setSelectedCodes((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  const toggleVisible = () => {
    setSelectedCodes((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        items.forEach((item) => next.delete(item.code));
      } else {
        items.forEach((item) => next.add(item.code));
      }
      return next;
    });
  };

  const deleteCodes = async (codes: string[]) => {
    if (codes.length === 0) return;
    const confirmed = window.confirm(`确认废弃 ${codes.length} 个未使用兑换码？此操作会直接删除记录，无法恢复。`);
    if (!confirmed) return;

    setActionLoading(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch('/api/admin/redemption-codes', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codes }),
      });
      const payload = (await response.json()) as { success?: boolean; deletedCount?: number; stats?: RedemptionCodeStats; error?: string };
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || '废弃兑换码失败');
      }
      setSelectedCodes(new Set());
      setStats(payload.stats ?? stats);
      setMessage(`已废弃 ${payload.deletedCount ?? 0} 个兑换码。`);
      setRefreshTick((tick) => tick + 1);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : '废弃兑换码失败');
    } finally {
      setActionLoading(false);
    }
  };

  const generatedCopyText = generated.map((item) => item.code).join('\n');

  return (
    <>
      <Head>
        <title>兑换码管理 - MahoShojo Generator</title>
      </Head>

      <div className="min-h-screen bg-[linear-gradient(180deg,_#f8fafc_0%,_#eef2ff_100%)] p-4 sm:p-6">
        <div className="mx-auto max-w-7xl">
          <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <Link href="/admin" className="text-sm text-sky-700 hover:underline">
                返回管理后台
              </Link>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">兑换码管理</h1>
              <p className="mt-2 text-sm text-slate-600">
                管理当前未使用兑换码，并基于用户槽位扣除记者系列奖励后估算兑换规模。
              </p>
            </div>
            <button
              type="button"
              onClick={() => setRefreshTick((tick) => tick + 1)}
              disabled={loading || actionLoading}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              刷新
            </button>
          </div>

          <div className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <StatCard
              title="未使用兑换码"
              value={formatNumber(stats.unusedCodeTotal)}
              note={`库存槽位 ${formatNumber(stats.unusedSlotTotal)}`}
              icon={Gift}
              tone="bg-sky-600"
            />
            <StatCard
              title="库存估算价值"
              value={formatCny(stats.unusedEstimatedValueCny)}
              note={`最近生成 ${formatDateTime(stats.latestCreatedAt)}`}
              icon={Wallet}
              tone="bg-emerald-600"
            />
            <StatCard
              title="倒推已兑换槽位"
              value={formatNumber(stats.inferredRedeemedSlotTotal)}
              note={`估算总价值 ${formatCny(stats.inferredRedeemedEstimatedValueCny)}`}
              icon={Wallet}
              tone="bg-violet-600"
            />
            <StatCard
              title="兑换用户人均"
              value={formatCny(stats.inferredRedeemedAverageValueCny)}
              note={`推断 ${formatNumber(stats.inferredRedeemedUserTotal)} 人，记者扣除 ${formatNumber(stats.reporterRewardSlotTotal)} 槽`}
              icon={Gift}
              tone="bg-amber-600"
            />
          </div>

          {error ? <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
          {message ? <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div> : null}

          <div className="mb-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.8fr)]">
            <section className="rounded-2xl border border-white/70 bg-white/90 p-5 shadow-sm backdrop-blur">
              <h2 className="text-lg font-semibold text-slate-900">批量生成</h2>
              <form onSubmit={handleGenerate} className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                <label className="block">
                  <span className="text-xs font-medium text-slate-500">单码槽位</span>
                  <input
                    type="number"
                    min={1}
                    value={generateSlotCount}
                    onChange={(event) => setGenerateSlotCount(event.target.value)}
                    className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none focus:border-sky-400"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-slate-500">生成数量</span>
                  <input
                    type="number"
                    min={1}
                    max={500}
                    value={generateCount}
                    onChange={(event) => setGenerateCount(event.target.value)}
                    className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none focus:border-sky-400"
                  />
                </label>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {actionLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  生成
                </button>
              </form>
              <p className="mt-3 text-xs leading-5 text-slate-500">
                价值估算使用阶梯：小于 64 槽为 0 元，64-127 槽为 5 元，128-255 槽为 12 元，256 槽及以上为 24 元。
              </p>
            </section>

            <section className="rounded-2xl border border-white/70 bg-white/90 p-5 shadow-sm backdrop-blur">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">本次生成</h2>
                  <p className="mt-1 text-xs text-slate-500">{generated.length > 0 ? `${generated.length} 个兑换码` : '生成后会显示在这里'}</p>
                </div>
                <button
                  type="button"
                  onClick={() => void copyText(generatedCopyText, '本次生成兑换码')}
                  disabled={generated.length === 0}
                  className="admin-button-sm"
                >
                  <Copy className="h-4 w-4" />
                  复制
                </button>
              </div>
              <textarea
                value={generatedCopyText}
                readOnly
                className="mt-4 h-28 w-full resize-none rounded-xl border border-slate-200 bg-slate-50 p-3 font-mono text-xs leading-5 text-slate-700"
                placeholder="暂无本次生成结果"
              />
            </section>
          </div>

          <section className="rounded-2xl border border-white/70 bg-white/90 p-5 shadow-sm backdrop-blur">
            <form onSubmit={handleSearchSubmit} className="mb-4 grid gap-3 lg:grid-cols-[minmax(14rem,1fr)_10rem_10rem_8rem_auto_auto] lg:items-end">
              <label className="block">
                <span className="text-xs font-medium text-slate-500">搜索兑换码</span>
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="AAAA-BBBB"
                  className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none focus:border-sky-400"
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-500">最小槽位</span>
                <input
                  type="number"
                  min={0}
                  value={minSlotCount}
                  onChange={(event) => setMinSlotCount(event.target.value)}
                  className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none focus:border-sky-400"
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-500">最大槽位</span>
                <input
                  type="number"
                  min={0}
                  value={maxSlotCount}
                  onChange={(event) => setMaxSlotCount(event.target.value)}
                  className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none focus:border-sky-400"
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-500">每页</span>
                <select
                  value={limit}
                  onChange={(event) => {
                    setLimit(Number.parseInt(event.target.value, 10));
                    setPage(1);
                  }}
                  className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none focus:border-sky-400"
                >
                  <option value={20}>20</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                  <option value={200}>200</option>
                </select>
              </label>
              <button type="submit" className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-800">
                <Search className="h-4 w-4" />
                筛选
              </button>
              <button
                type="button"
                onClick={() => void deleteCodes(Array.from(selectedCodes))}
                disabled={selectedCount === 0 || actionLoading}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 text-sm font-medium text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" />
                废弃选中
              </button>
            </form>

            <AdminTableScroll withCard={false} className="rounded-xl border border-slate-200">
              <table className="min-w-[860px] w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="w-12 px-4 py-3">
                      <input type="checkbox" checked={allVisibleSelected} onChange={toggleVisible} aria-label="选择当前页全部兑换码" />
                    </th>
                    <th className="px-4 py-3">兑换码</th>
                    <th className="px-4 py-3">槽位</th>
                    <th className="px-4 py-3">估算价值</th>
                    <th className="px-4 py-3">创建时间</th>
                    <th className="px-4 py-3 text-right">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {loading ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-10 text-center text-slate-500">
                        正在读取兑换码...
                      </td>
                    </tr>
                  ) : items.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-10 text-center text-slate-500">
                        当前筛选条件下没有未使用兑换码。
                      </td>
                    </tr>
                  ) : (
                    items.map((item) => (
                      <tr key={item.code} className="hover:bg-slate-50">
                        <td className="px-4 py-3">
                          <input
                            type="checkbox"
                            checked={selectedCodes.has(item.code)}
                            onChange={() => toggleCode(item.code)}
                            aria-label={`选择兑换码 ${item.code}`}
                          />
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-slate-800">{item.code}</td>
                        <td className="px-4 py-3 text-slate-700">{formatNumber(item.slotCount)}</td>
                        <td className="px-4 py-3 text-slate-700">{formatCny(item.estimatedValueCny)}</td>
                        <td className="px-4 py-3 text-xs text-slate-500">{formatDateTime(item.createdAt)}</td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-2">
                            <button type="button" onClick={() => void copyText(item.code, '兑换码')} className="admin-button-sm">
                              <Copy className="h-4 w-4" />
                              复制
                            </button>
                            <button
                              type="button"
                              onClick={() => void deleteCodes([item.code])}
                              disabled={actionLoading}
                              className="admin-button-sm border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
                            >
                              <Trash2 className="h-4 w-4" />
                              废弃
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </AdminTableScroll>

            <div className="mt-4 flex flex-col gap-3 text-sm text-slate-600 sm:flex-row sm:items-center sm:justify-between">
              <span>
                共 {formatNumber(total)} 条，当前第 {formatNumber(page)} / {formatNumber(totalPages)} 页
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                  disabled={page <= 1 || loading}
                  className="admin-button-sm"
                >
                  上一页
                </button>
                <button
                  type="button"
                  onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
                  disabled={page >= totalPages || loading}
                  className="admin-button-sm"
                >
                  下一页
                </button>
              </div>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
