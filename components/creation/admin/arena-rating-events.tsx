import Head from 'next/head';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';

import { AdminTableScroll } from '@/components/admin/AdminTableScroll';

type ArenaQueue = 'strict' | 'free';
type ArenaRatingEventStatus = 'pending' | 'applied' | 'skipped' | 'failed';

type AdminArenaRatingEventRow = {
  id: string;
  generation_id: string;
  queue: ArenaQueue;
  status: ArenaRatingEventStatus;
  skip_reason: string | null;
  user_id: number | null;
  username: string | null;
  ip_anonymized: string | null;
  pair_key: string;
  a_entity_type: 'data_card' | 'preset';
  a_entity_id: string;
  b_entity_type: 'data_card' | 'preset';
  b_entity_id: string;
  winner_slot: number;
  a_before_rating: number | null;
  a_after_rating: number | null;
  a_delta: number | null;
  b_before_rating: number | null;
  b_after_rating: number | null;
  b_delta: number | null;
  details_json: any;
  created_at: string;
  applied_at: string | null;
  generation_started_at: string | null;
};

type ListResponse =
  | { success: true; records: AdminArenaRatingEventRow[]; total: number; currentPage: number; totalPages: number }
  | { success: false; error?: string };

const fetchJson = async <T,>(url: string, init?: RequestInit): Promise<T> => {
  const res = await fetch(url, init);
  const json = (await res.json()) as T;
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(json)}`);
  return json;
};

const formatIso = (iso: string | null | undefined) => {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toISOString().replace('T', ' ').replace('Z', ' UTC');
};

const formatQueue = (queue: ArenaQueue) => (queue === 'strict' ? '严格' : '自由');
const formatStatus = (status: ArenaRatingEventStatus) => {
  if (status === 'applied') return '已应用';
  if (status === 'skipped') return '已跳过';
  if (status === 'failed') return '失败';
  return '待处理';
};

export default function AdminArenaRatingEventsPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [records, setRecords] = useState<AdminArenaRatingEventRow[]>([]);
  const [total, setTotal] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const [filters, setFilters] = useState({
    queue: 'all' as 'all' | ArenaQueue,
    status: 'all' as 'all' | ArenaRatingEventStatus,
    search: '',
    generationId: '',
    entityId: '',
    userId: '',
    dateFrom: '',
    dateTo: '',
    sortBy: 'created_at',
    sortOrder: 'desc',
  });

  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsRow, setDetailsRow] = useState<AdminArenaRatingEventRow | null>(null);

  const buildParams = (page: number) => {
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('limit', '50');
    params.set('sortBy', filters.sortBy);
    params.set('sortOrder', filters.sortOrder);
    if (filters.queue !== 'all') params.set('queue', filters.queue);
    if (filters.status !== 'all') params.set('status', filters.status);
    if (filters.search.trim()) params.set('search', filters.search.trim());
    if (filters.generationId.trim()) params.set('generationId', filters.generationId.trim());
    if (filters.entityId.trim()) params.set('entityId', filters.entityId.trim());
    if (filters.userId.trim()) params.set('userId', filters.userId.trim());
    if (filters.dateFrom) params.set('dateFrom', filters.dateFrom);
    if (filters.dateTo) params.set('dateTo', filters.dateTo);
    return params;
  };

  const load = async (page = 1) => {
    setLoading(true);
    setError(null);
    try {
      const params = buildParams(page);
      const json = await fetchJson<ListResponse>(`/api/admin/arena-rating-events?${params.toString()}`);
      if (json.success !== true) throw new Error(json.error || '无法加载事件列表');
      setRecords(json.records ?? []);
      setTotal(Number(json.total || 0));
      setCurrentPage(Number(json.currentPage || 1));
      setTotalPages(Number(json.totalPages || 1));
    } catch (err) {
      setError(err instanceof Error ? err.message : '未知错误');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.queue, filters.status, filters.sortBy, filters.sortOrder]);

  const summary = useMemo(() => `共 ${total} 条 · 当前页 ${records.length} 条`, [records.length, total]);

  return (
    <>
      <Head>
        <title>排位事件审计 - Admin</title>
      </Head>

      <div className="min-h-screen bg-gradient-to-br from-amber-50 to-purple-50 p-4 sm:p-6">
        <div className="mx-auto max-w-7xl">
          <div className="mb-4 flex items-center justify-between">
            <Link href="/admin" className="text-sm text-purple-600 hover:underline">
              ← 返回管理后台主页
            </Link>
            <div className="flex items-center gap-3 text-sm">
              <Link href="/admin/arena-ratings" className="text-blue-600 hover:underline">
                查看当前分
              </Link>
              <Link href="/admin/arena-risk-audit" className="text-blue-600 hover:underline">
                strict 风控审计
              </Link>
              <button
                onClick={() => void load(currentPage)}
                className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                disabled={loading}
              >
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                刷新
              </button>
            </div>
          </div>

          <h1 className="mb-4 text-2xl font-bold text-gray-800">排位计分事件审计（arena_rating_events）</h1>

          <div className="mb-4 rounded-xl bg-white p-4 shadow-sm ring-1 ring-gray-100">
            <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-6">
	              <select
	                className="input-field"
	                value={filters.queue}
	                onChange={(e) => setFilters((prev) => ({ ...prev, queue: e.target.value as any }))}
	              >
	                <option value="all">所有队列</option>
	                <option value="strict">严格（strict）</option>
	                <option value="free">自由（free）</option>
	              </select>
	              <select
	                className="input-field"
	                value={filters.status}
	                onChange={(e) => setFilters((prev) => ({ ...prev, status: e.target.value as any }))}
	              >
	                <option value="all">所有状态</option>
	                <option value="applied">已应用（applied）</option>
	                <option value="skipped">已跳过（skipped）</option>
	                <option value="failed">失败（failed）</option>
	                <option value="pending">待处理（pending）</option>
	              </select>
	              <input
	                className="input-field"
	                placeholder="搜索：id / generationId / entityId / userId / 用户名"
	                value={filters.search}
	                onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value }))}
	                onKeyDown={(e) => {
	                  if (e.key !== 'Enter') return;
	                  void load(1);
	                }}
	              />
	              <input
	                className="input-field"
	                placeholder="generationId（生成ID）"
	                value={filters.generationId}
	                onChange={(e) => setFilters((prev) => ({ ...prev, generationId: e.target.value }))}
	                onKeyDown={(e) => {
	                  if (e.key !== 'Enter') return;
	                  void load(1);
	                }}
	              />
	              <input
	                className="input-field"
	                placeholder="entityId（实体ID）"
	                value={filters.entityId}
	                onChange={(e) => setFilters((prev) => ({ ...prev, entityId: e.target.value }))}
	                onKeyDown={(e) => {
	                  if (e.key !== 'Enter') return;
	                  void load(1);
	                }}
	              />
	              <input
	                className="input-field"
	                placeholder="userId（用户ID）"
	                value={filters.userId}
	                onChange={(e) => setFilters((prev) => ({ ...prev, userId: e.target.value }))}
	                onKeyDown={(e) => {
	                  if (e.key !== 'Enter') return;
                  void load(1);
                }}
              />
              <input
                className="input-field"
                type="date"
                value={filters.dateFrom}
                onChange={(e) => setFilters((prev) => ({ ...prev, dateFrom: e.target.value }))}
              />
              <input
                className="input-field"
                type="date"
                value={filters.dateTo}
                onChange={(e) => setFilters((prev) => ({ ...prev, dateTo: e.target.value }))}
              />
	              <select
	                className="input-field"
	                value={filters.sortBy}
	                onChange={(e) => setFilters((prev) => ({ ...prev, sortBy: e.target.value }))}
	              >
	                <option value="created_at">按创建时间（created_at）</option>
	                <option value="applied_at">按应用时间（applied_at）</option>
	              </select>
	              <select
	                className="input-field"
	                value={filters.sortOrder}
	                onChange={(e) => setFilters((prev) => ({ ...prev, sortOrder: e.target.value }))}
	              >
	                <option value="desc">降序（desc）</option>
	                <option value="asc">升序（asc）</option>
	              </select>
              <button
                onClick={() => void load(1)}
                className="rounded-lg bg-gray-900 px-3 py-2 text-sm text-white hover:bg-gray-800"
                disabled={loading}
              >
                应用筛选
              </button>
              <div className="self-center text-sm text-gray-600">{summary}</div>
            </div>
          </div>

	          {error ? <div className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}

	          <AdminTableScroll
	            footer={
	              <div className="flex items-center justify-between text-sm text-gray-600">
	                <span>
	                  第 {currentPage} / {totalPages} 页
	                </span>
	                <div className="flex items-center gap-2">
	                  <button
	                    className="admin-button-sm"
	                    onClick={() => void load(Math.max(1, currentPage - 1))}
	                    disabled={loading || currentPage <= 1}
	                  >
	                    上一页
	                  </button>
	                  <button
	                    className="admin-button-sm"
	                    onClick={() => void load(Math.min(totalPages, currentPage + 1))}
	                    disabled={loading || currentPage >= totalPages}
	                  >
	                    下一页
	                  </button>
	                </div>
	              </div>
	            }
	          >
	            <table className="min-w-full w-max text-left text-sm text-gray-600">
	              <thead className="bg-gray-50 text-xs text-gray-600">
	                <tr>
	                  <th className="px-4 py-3 whitespace-nowrap">创建时间</th>
	                  <th className="px-4 py-3 whitespace-nowrap">队列</th>
	                  <th className="px-4 py-3 whitespace-nowrap">状态</th>
	                  <th className="px-4 py-3 whitespace-nowrap">生成</th>
	                  <th className="px-4 py-3 whitespace-nowrap">用户</th>
	                  <th className="px-4 py-3 whitespace-nowrap">A vs B</th>
	                  <th className="px-4 py-3 whitespace-nowrap">Δ</th>
	                  <th className="px-4 py-3 whitespace-nowrap">跳过原因</th>
	                  <th className="px-4 py-3 whitespace-nowrap">详情</th>
	                </tr>
	              </thead>
	              <tbody className="divide-y divide-gray-100">
	                {records.map((row) => (
	                  <tr key={row.id} className="hover:bg-gray-50">
	                    <td className="px-4 py-3 text-[11px] text-gray-500">{formatIso(row.created_at)}</td>
	                    <td className="px-4 py-3" title={row.queue}>
	                      {formatQueue(row.queue)}
	                    </td>
	                    <td className="px-4 py-3">
	                      <span
	                        className={`rounded-full px-2 py-0.5 text-xs ${
	                          row.status === 'applied'
                            ? 'bg-green-100 text-green-700'
                            : row.status === 'skipped'
                              ? 'bg-yellow-100 text-yellow-700'
                              : row.status === 'failed'
                                ? 'bg-red-100 text-red-700'
	                                : 'bg-gray-100 text-gray-700'
	                        }`}
	                        title={row.status}
	                      >
	                        {formatStatus(row.status)}
	                      </span>
	                    </td>
	                    <td className="px-4 py-3">
	                      <div className="font-mono text-xs text-gray-700">{row.generation_id}</div>
                      {row.generation_started_at ? (
                        <div className="mt-1 text-[11px] text-gray-500">{formatIso(row.generation_started_at)}</div>
                      ) : null}
                      <Link
                        href={`/admin/battle-report-generations?id=${encodeURIComponent(row.generation_id)}`}
                        className="mt-1 inline-block text-xs text-purple-600 hover:underline"
                      >
                        打开战报
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      {row.username ? (
                        <div className="text-gray-800">{row.username}</div>
                      ) : (
                        <div className="text-gray-400">—</div>
                      )}
                      <div className="mt-1 text-[11px] text-gray-500">
                        userId={row.user_id ?? '—'} ip={row.ip_anonymized ?? '—'}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-xs text-gray-700">
                        {row.a_entity_type}:{row.a_entity_id}
                      </div>
                      <div className="mt-1 text-xs text-gray-700">
                        {row.b_entity_type}:{row.b_entity_id}
                      </div>
                      <div className="mt-1 text-[11px] text-gray-500">winner_slot={row.winner_slot}</div>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <div>A: {row.a_delta ?? '—'}</div>
                      <div className="mt-1">B: {row.b_delta ?? '—'}</div>
                    </td>
	                    <td className="px-4 py-3 text-xs text-gray-700">{row.skip_reason ?? '—'}</td>
	                    <td className="px-4 py-3">
	                      <button
	                        onClick={() => {
                          setDetailsRow(row);
                          setDetailsOpen(true);
                        }}
                        className="rounded border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
                      >
                        查看
                      </button>
                    </td>
	                  </tr>
	                ))}
	                {records.length === 0 && (
	                  <tr>
	                    <td colSpan={9} className="px-4 py-8 text-center text-gray-500">
	                      {loading ? '加载中...' : '暂无数据'}
	                    </td>
	                  </tr>
	                )}
	              </tbody>
	            </table>
	          </AdminTableScroll>

	          {detailsOpen && detailsRow ? (
	            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
	              <div className="w-full max-w-4xl overflow-hidden rounded-xl bg-white shadow-lg">
	                <div className="flex items-center justify-between border-b px-6 py-4">
	                  <div>
	                    <div className="text-sm font-semibold text-gray-800">事件详情（details_json）</div>
	                    <div className="mt-1 font-mono text-xs text-gray-500">{detailsRow.id}</div>
	                  </div>
                  <button
                    onClick={() => {
                      setDetailsOpen(false);
                      setDetailsRow(null);
                    }}
                    className="rounded-lg px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                  >
                    关闭
                  </button>
                </div>
                <div className="max-h-[70vh] overflow-auto p-6">
                  <pre className="whitespace-pre-wrap text-xs text-gray-800">
                    {JSON.stringify(detailsRow.details_json ?? null, null, 2)}
                  </pre>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}
