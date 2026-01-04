import Head from 'next/head';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { RefreshCw, RotateCcw } from 'lucide-react';

type ArenaQueue = 'strict' | 'free';
type ArenaEntityType = 'data_card' | 'preset';

type AdminArenaRatingRow = {
  entity_type: ArenaEntityType;
  entity_id: string;
  queue: ArenaQueue;
  rating: number;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  created_at: string;
  updated_at: string;

  data_card_name: string | null;
  data_card_user_id: number | null;
  data_card_is_public: number | null;
  data_card_review_status: string | null;
  data_card_deleted_at: string | null;
  owner_username: string | null;

  tech_score: number | null;
  tech_level: string | null;
  is_native: number | null;
  tag_ids: string | null;
};

type ListResponse =
  | { success: true; records: AdminArenaRatingRow[]; total: number; currentPage: number; totalPages: number }
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

export default function AdminArenaRatingsPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [records, setRecords] = useState<AdminArenaRatingRow[]>([]);
  const [total, setTotal] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const [filters, setFilters] = useState({
    queue: 'strict' as ArenaQueue,
    entityType: 'data_card' as ArenaEntityType | 'all',
    search: '',
    ownerUserId: '',
    isPublic: '',
    reviewStatus: '',
    minRating: '',
    minGames: '',
    sortBy: 'rating',
    sortOrder: 'desc',
  });

  const buildParams = (page: number) => {
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('limit', '50');
    params.set('sortBy', filters.sortBy);
    params.set('sortOrder', filters.sortOrder);
    params.set('queue', filters.queue);
    if (filters.entityType !== 'all') params.set('entityType', filters.entityType);
    if (filters.search.trim()) params.set('search', filters.search.trim());
    if (filters.ownerUserId.trim()) params.set('ownerUserId', filters.ownerUserId.trim());
    if (filters.isPublic) params.set('isPublic', filters.isPublic);
    if (filters.reviewStatus) params.set('reviewStatus', filters.reviewStatus);
    if (filters.minRating.trim()) params.set('minRating', filters.minRating.trim());
    if (filters.minGames.trim()) params.set('minGames', filters.minGames.trim());
    return params;
  };

  const load = async (page = 1) => {
    setLoading(true);
    setError(null);
    try {
      const params = buildParams(page);
      const json = await fetchJson<ListResponse>(`/api/admin/arena-ratings?${params.toString()}`);
      if (json.success !== true) throw new Error(json.error || '无法加载排位数据');
      setRecords(json.records ?? []);
      setTotal(Number(json.total || 0));
      setCurrentPage(Number(json.currentPage || 1));
      setTotalPages(Number(json.totalPages || 1));
      setSelectedIds(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : '未知错误');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.queue, filters.entityType, filters.isPublic, filters.reviewStatus, filters.sortBy, filters.sortOrder]);

  const selectedEntities = useMemo(() => Array.from(selectedIds), [selectedIds]);

  const resetOne = async (entityType: ArenaEntityType, entityId: string) => {
    if (!window.confirm(`确认重置 ${entityType}:${entityId} 的 strict/free 排位分吗？`)) return;
    await fetchJson('/api/admin/arena-ratings/reset', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entityType, entityId, queue: 'all' }),
    });
    await load(currentPage);
  };

  const resetSelected = async () => {
    if (selectedEntities.length === 0) {
      alert('请先选择要重置的条目');
      return;
    }
    if (!window.confirm(`确认重置选中的 ${selectedEntities.length} 个实体的排位分吗？`)) return;
    const results = await Promise.allSettled(
      selectedEntities.map(async (key) => {
        const [entityType, entityId] = key.split(':', 2) as [ArenaEntityType, string];
        await fetchJson('/api/admin/arena-ratings/reset', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ entityType, entityId, queue: 'all' }),
        });
      }),
    );

    const failed = results
      .map((r, idx) => ({ r, key: selectedEntities[idx] }))
      .filter(({ r }) => r.status === 'rejected')
      .map(({ key, r }) => `${key}: ${(r as PromiseRejectedResult).reason instanceof Error ? (r as PromiseRejectedResult).reason.message : String((r as PromiseRejectedResult).reason)}`);

    if (failed.length > 0) {
      alert(`部分重置失败（${failed.length}/${selectedEntities.length}）：\n${failed.slice(0, 10).join('\n')}${failed.length > 10 ? '\n...' : ''}`);
    } else {
      alert(`重置完成：${selectedEntities.length} 个实体`);
    }
    await load(currentPage);
  };

  const toggleSelected = (key: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const allSelectedOnPage = useMemo(() => {
    if (records.length === 0) return false;
    const keys = records.map((r) => `${r.entity_type}:${r.entity_id}`);
    return keys.every((k) => selectedIds.has(k));
  }, [records, selectedIds]);

  const toggleSelectAllCurrentPage = () => {
    const keys = records.map((r) => `${r.entity_type}:${r.entity_id}`);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const allSelected = keys.every((k) => next.has(k));
      if (allSelected) {
        for (const k of keys) next.delete(k);
      } else {
        for (const k of keys) next.add(k);
      }
      return next;
    });
  };

  return (
    <>
      <Head>
        <title>排位运维 - Admin</title>
      </Head>

      <div className="min-h-screen bg-gradient-to-br from-sky-50 to-purple-50 p-4 sm:p-6">
        <div className="mx-auto max-w-7xl">
          <div className="mb-4 flex items-center justify-between">
            <Link href="/admin" className="text-sm text-purple-600 hover:underline">
              ← 返回管理后台主页
            </Link>
            <div className="flex items-center gap-2">
              <Link href="/admin/arena-rating-events" className="text-sm text-blue-600 hover:underline">
                查看计分事件
              </Link>
              <button
                onClick={() => void load(currentPage)}
                className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                disabled={loading}
              >
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                刷新
              </button>
              <button
                onClick={() => void resetSelected()}
                className="inline-flex items-center gap-2 rounded-lg bg-rose-700 px-3 py-2 text-sm text-white hover:bg-rose-800 disabled:opacity-50"
                disabled={loading || selectedEntities.length === 0}
              >
                <RotateCcw className="h-4 w-4" />
                批量重置
              </button>
            </div>
          </div>

          <h1 className="mb-4 text-2xl font-bold text-gray-800">排位 / 排行榜运维（arena_ratings）</h1>

          <div className="mb-4 rounded-xl bg-white p-4 shadow-sm ring-1 ring-gray-100">
            <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-6">
              <select
                className="input-field"
                value={filters.queue}
                onChange={(e) => setFilters((prev) => ({ ...prev, queue: e.target.value as ArenaQueue }))}
              >
                <option value="strict">strict</option>
                <option value="free">free</option>
              </select>
              <select
                className="input-field"
                value={filters.entityType}
                onChange={(e) => setFilters((prev) => ({ ...prev, entityType: e.target.value as any }))}
              >
                <option value="all">所有 entity</option>
                <option value="data_card">data_card</option>
                <option value="preset">preset</option>
              </select>
              <input
                className="input-field"
                placeholder="search: entity_id / name / username"
                value={filters.search}
                onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return;
                  void load(1);
                }}
              />
              <input
                className="input-field"
                placeholder="ownerUserId"
                value={filters.ownerUserId}
                onChange={(e) => setFilters((prev) => ({ ...prev, ownerUserId: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return;
                  void load(1);
                }}
              />
              <select
                className="input-field"
                value={filters.reviewStatus}
                onChange={(e) => setFilters((prev) => ({ ...prev, reviewStatus: e.target.value }))}
              >
                <option value="">所有审核</option>
                <option value="pending">pending</option>
                <option value="approved">approved</option>
                <option value="rejected">rejected</option>
              </select>
              <select
                className="input-field"
                value={filters.isPublic}
                onChange={(e) => setFilters((prev) => ({ ...prev, isPublic: e.target.value }))}
              >
                <option value="">所有公开</option>
                <option value="1">公开</option>
                <option value="0">私有</option>
                <option value="-1">封禁</option>
              </select>
              <input
                className="input-field"
                placeholder="minRating"
                value={filters.minRating}
                onChange={(e) => setFilters((prev) => ({ ...prev, minRating: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return;
                  void load(1);
                }}
              />
              <input
                className="input-field"
                placeholder="minGames"
                value={filters.minGames}
                onChange={(e) => setFilters((prev) => ({ ...prev, minGames: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return;
                  void load(1);
                }}
              />
              <select
                className="input-field"
                value={filters.sortBy}
                onChange={(e) => setFilters((prev) => ({ ...prev, sortBy: e.target.value }))}
              >
                <option value="rating">rating</option>
                <option value="games">games</option>
                <option value="updated_at">updated_at</option>
              </select>
              <select
                className="input-field"
                value={filters.sortOrder}
                onChange={(e) => setFilters((prev) => ({ ...prev, sortOrder: e.target.value }))}
              >
                <option value="desc">desc</option>
                <option value="asc">asc</option>
              </select>
              <button
                onClick={() => void load(1)}
                className="rounded-lg bg-gray-900 px-3 py-2 text-sm text-white hover:bg-gray-800"
                disabled={loading}
              >
                应用筛选
              </button>
              <div className="text-sm text-gray-600 self-center">
                选中 {selectedEntities.length} / {records.length}（共 {total}）
              </div>
            </div>
          </div>

          {error ? <div className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}

          <div className="overflow-x-auto rounded-xl bg-white shadow-sm ring-1 ring-gray-100">
            <table className="w-full text-left text-sm text-gray-600">
              <thead className="bg-gray-50 text-xs uppercase text-gray-600">
                <tr>
                  <th className="p-4">
                    <input type="checkbox" checked={allSelectedOnPage} onChange={toggleSelectAllCurrentPage} />
                  </th>
                  <th className="px-4 py-3">entity</th>
                  <th className="px-4 py-3">owner</th>
                  <th className="px-4 py-3">rating</th>
                  <th className="px-4 py-3">games</th>
                  <th className="px-4 py-3">W/L/D</th>
                  <th className="px-4 py-3">tech</th>
                  <th className="px-4 py-3">tags</th>
                  <th className="px-4 py-3">updated</th>
                  <th className="px-4 py-3">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {records.map((row) => {
                  const key = `${row.entity_type}:${row.entity_id}`;
                  const displayName = row.entity_type === 'data_card' ? row.data_card_name ?? row.entity_id : row.entity_id;
                  const tagCount = row.tag_ids ? row.tag_ids.split(',').filter(Boolean).length : 0;
                  return (
                    <tr key={`${row.entity_type}:${row.entity_id}:${row.queue}`} className="hover:bg-gray-50">
                      <td className="p-4">
                        <input type="checkbox" checked={selectedIds.has(key)} onChange={() => toggleSelected(key)} />
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-gray-800">{displayName}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-gray-500">
                          <span className="rounded bg-gray-100 px-2 py-0.5">{row.queue}</span>
                          <span className="rounded bg-gray-100 px-2 py-0.5">{row.entity_type}</span>
                          <span className="font-mono">{row.entity_id}</span>
                          {row.entity_type === 'data_card' ? (
                            <Link href={`/admin/character-management?id=${encodeURIComponent(row.entity_id)}`} className="text-purple-600 hover:underline">
                              管理卡
                            </Link>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {row.owner_username ? (
                          <div className="text-gray-800">{row.owner_username}</div>
                        ) : (
                          <div className="text-gray-400">—</div>
                        )}
                        {row.entity_type === 'data_card' ? (
                          <div className="mt-1 text-[11px] text-gray-500">
                            public={row.data_card_is_public ?? '—'} review={row.data_card_review_status ?? '—'}
                            {row.data_card_deleted_at ? ' deleted' : ''}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 font-semibold text-gray-900">{row.rating}</td>
                      <td className="px-4 py-3">{row.games}</td>
                      <td className="px-4 py-3">
                        {row.wins}/{row.losses}/{row.draws}
                      </td>
                      <td className="px-4 py-3">
                        {row.tech_score != null ? (
                          <span>
                            {row.tech_score} ({row.tech_level ?? '—'})
                          </span>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                        {row.is_native != null ? (
                          <div className="mt-1 text-[11px] text-gray-500">native={row.is_native === 1 ? '1' : '0'}</div>
                        ) : (
                          <div className="mt-1 text-[11px] text-gray-400">native=—</div>
                        )}
                      </td>
                      <td className="px-4 py-3">{tagCount}</td>
                      <td className="px-4 py-3 text-[11px] text-gray-500">{formatIso(row.updated_at)}</td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => void resetOne(row.entity_type, row.entity_id)}
                          className="rounded border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
                        >
                          重置
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {records.length === 0 && (
                  <tr>
                    <td colSpan={10} className="px-4 py-8 text-center text-gray-500">
                      {loading ? '加载中...' : '暂无数据'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex items-center justify-between text-sm text-gray-600">
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
        </div>
      </div>
    </>
  );
}

