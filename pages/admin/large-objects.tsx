import Head from 'next/head';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Download, Image as ImageIcon, RefreshCw, Trash2 } from 'lucide-react';

import { AdminTableScroll } from '@/components/admin/AdminTableScroll';
import {
  formatLargeObjectAssetFamily,
  formatLargeObjectKindLabel,
  getLargeObjectAssetFamily,
  isLargeObjectPreviewableImage,
  type LargeObjectAssetFamily,
} from '@/lib/admin/large-object-insights';

type LargeObjectRow = {
  id: string;
  kind: string;
  owner_ref_id: string;
  owner_user_id: number | null;
  owner_username: string | null;
  r2_key: string;
  bytes: number;
  stored_bytes: number | null;
  sha256: string | null;
  content_type: string | null;
  content_encoding: string | null;
  created_at: string;
  updated_at: string;
};

type ListResponse =
  | {
      success: true;
      rows: LargeObjectRow[];
      total: number;
      page: number;
      limit: number;
      kindSummaries: Array<{
        kind: string;
        total: number;
        bytes: number;
        storedBytes: number;
        lastCreatedAt: string | null;
      }>;
      familySummaries: Array<{
        family: LargeObjectAssetFamily;
        total: number;
        bytes: number;
        storedBytes: number;
      }>;
    }
  | { success: false; error?: string };

type PresignResponse =
  | { success: true; row: LargeObjectRow; downloadUrl: string; expiresInSeconds: number }
  | { success: false; error?: string };

type KindSummary = {
  kind: string;
  total: number;
  bytes: number;
  storedBytes: number;
  lastCreatedAt: string | null;
};

type FamilySummary = {
  family: LargeObjectAssetFamily;
  total: number;
  bytes: number;
  storedBytes: number;
};

type LargeObjectFilters = {
  kind: string;
  family: 'all' | LargeObjectAssetFamily;
  search: string;
  ownerUserId: string;
  dateFrom: string;
  dateTo: string;
  minBytes: string;
};

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

const formatBytes = (bytes: number | null | undefined) => {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes)) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = bytes;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u += 1;
  }
  return `${v.toFixed(u === 0 ? 0 : 2)} ${units[u]}`;
};

const familyBadgeClass = (family: LargeObjectAssetFamily) => {
  if (family === 'image') return 'border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700';
  if (family === 'text') return 'border-cyan-200 bg-cyan-50 text-cyan-700';
  return 'border-slate-200 bg-slate-50 text-slate-600';
};

export default function AdminLargeObjectsPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [detailsVisible, setDetailsVisible] = useState(true);

  const [rows, setRows] = useState<LargeObjectRow[]>([]);
  const [kindSummaries, setKindSummaries] = useState<KindSummary[]>([]);
  const [familySummaries, setFamilySummaries] = useState<FamilySummary[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const limit = 50;

  const [filters, setFilters] = useState<LargeObjectFilters>({
    kind: '',
    family: 'all' as 'all' | LargeObjectAssetFamily,
    search: '',
    ownerUserId: '',
    dateFrom: '',
    dateTo: '',
    minBytes: '',
  });

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = useMemo(() => rows.find((r) => r.id === selectedId) ?? null, [rows, selectedId]);

  const [downloadLoading, setDownloadLoading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);

  const buildParams = (nextPage: number, nextFilters = filters) => {
    const params = new URLSearchParams();
    params.set('page', String(nextPage));
    params.set('limit', String(limit));
    if (nextFilters.kind.trim()) params.set('kind', nextFilters.kind.trim());
    if (nextFilters.family !== 'all') params.set('family', nextFilters.family);
    if (nextFilters.search.trim()) params.set('search', nextFilters.search.trim());
    if (nextFilters.ownerUserId.trim()) params.set('ownerUserId', nextFilters.ownerUserId.trim());
    if (nextFilters.dateFrom) params.set('dateFrom', nextFilters.dateFrom);
    if (nextFilters.dateTo) params.set('dateTo', nextFilters.dateTo);
    if (nextFilters.minBytes.trim()) params.set('minBytes', nextFilters.minBytes.trim());
    return params;
  };

  const load = async (nextPage = 1, nextFilters = filters) => {
    setLoading(true);
    setError(null);
    try {
      const params = buildParams(nextPage, nextFilters);
      const json = await fetchJson<ListResponse>(`/api/admin/large-objects?${params.toString()}`);
      if (json.success !== true) throw new Error(json.error || '无法加载大对象列表');
      setRows(json.rows ?? []);
      setTotal(Number(json.total || 0));
      setPage(Number(json.page || nextPage));
      setKindSummaries(json.kindSummaries ?? []);
      setFamilySummaries(json.familySummaries ?? []);
      setSelectedId(null);
      setDownloadUrl(null);
      setDownloadError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '未知错误');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totalPages = Math.max(1, Math.ceil(total / limit));

  const presignSelected = async () => {
    if (!selected) return;
    setDownloadLoading(true);
    setDownloadError(null);
    setDownloadUrl(null);
    try {
      const json = await fetchJson<PresignResponse>(`/api/admin/large-objects/${encodeURIComponent(selected.id)}?presign=1`);
      if (json.success !== true) throw new Error(json.error || '无法生成下载链接');
      setDownloadUrl(json.downloadUrl);
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : '未知错误');
    } finally {
      setDownloadLoading(false);
    }
  };

  const deleteSelected = async (deleteR2: boolean) => {
    if (!selected) return;
    if (
      !window.confirm(
        deleteR2
          ? `确认删除该记录，并尝试删除 R2 对象吗？\n\n${selected.id}\n${selected.r2_key}`
          : `确认仅删除该记录（不删 R2 对象）吗？\n\n${selected.id}\n${selected.r2_key}`,
      )
    ) {
      return;
    }

    try {
      await fetchJson(`/api/admin/large-objects/${encodeURIComponent(selected.id)}?deleteR2=${deleteR2 ? '1' : '0'}`, {
        method: 'DELETE',
      });
      await load(page);
    } catch (err) {
      alert(`删除失败：${err instanceof Error ? err.message : '未知错误'}`);
    }
  };

  const maybeBattleReportLink = useMemo(() => {
    if (!selected) return null;
    if (selected.kind !== 'battle_report_generation_output') return null;
    const id = selected.owner_ref_id;
    if (!id) return null;
    return `/admin/battle-report-generations?id=${encodeURIComponent(id)}`;
  }, [selected]);

  const selectedFamily = useMemo(
    () => (selected ? getLargeObjectAssetFamily(selected.kind, selected.content_type) : null),
    [selected],
  );
  const selectedPreviewableImage = useMemo(
    () => (selected ? isLargeObjectPreviewableImage(selected.kind, selected.content_type) : false),
    [selected],
  );

  const copyText = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      alert(`已复制：${label}`);
    } catch {
      alert('复制失败：浏览器不支持或权限不足');
    }
  };

  return (
    <>
      <Head>
        <title>大对象管理 - Admin</title>
      </Head>

      <div className="min-h-screen bg-gradient-to-br from-emerald-50 to-purple-50 p-4 sm:p-6">
        <div className="mx-auto max-w-7xl">
          <div className="mb-4 flex items-center justify-between">
            <Link href="/admin" className="text-sm text-purple-600 hover:underline">
              ← 返回管理后台主页
            </Link>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setDetailsVisible((v) => !v)}
                className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                {detailsVisible ? '隐藏详情' : '显示详情'}
              </button>
              <button
                onClick={() => void load(page)}
                className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                disabled={loading}
              >
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                刷新
              </button>
            </div>
          </div>

          <h1 className="mb-2 text-2xl font-bold text-gray-800">大对象 / 资产工作台（large_objects）</h1>
          <p className="mb-4 text-sm text-gray-600">
            当前既能继续管理战报正文对象，也为后续插图、立绘等多 kind 资产预留统一视图。优先按资产家族与 kind 观察，而不是只把它当作战报 R2 索引表。
          </p>

          <div className="mb-4 grid gap-4 lg:grid-cols-[1.1fr_1.4fr]">
            <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-gray-100">
              <div className="mb-3 text-sm font-semibold text-gray-800">资产家族分布</div>
              <div className="grid gap-3 sm:grid-cols-3">
                {familySummaries.map((summary) => (
                  <button
                    key={summary.family}
                    type="button"
                    onClick={() => {
                      const nextFilters: LargeObjectFilters = {
                        ...filters,
                        family: filters.family === summary.family ? 'all' : summary.family,
                      };
                      setFilters(nextFilters);
                      void load(1, nextFilters);
                    }}
                    className={`rounded-xl border px-4 py-3 text-left transition ${familyBadgeClass(summary.family)} ${
                      filters.family === summary.family ? 'ring-2 ring-offset-1 ring-gray-300' : ''
                    }`}
                  >
                    <div className="text-xs font-medium">{formatLargeObjectAssetFamily(summary.family)}</div>
                    <div className="mt-2 text-lg font-semibold">{summary.total.toLocaleString('zh-CN')}</div>
                    <div className="mt-1 text-xs opacity-80">存储 {formatBytes(summary.storedBytes)}</div>
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-gray-100">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="text-sm font-semibold text-gray-800">Top kind</div>
                <button
                  type="button"
                  onClick={() => {
                    const nextFilters: LargeObjectFilters = { ...filters, kind: '' };
                    setFilters(nextFilters);
                    void load(1, nextFilters);
                  }}
                  className="text-xs text-teal-700 hover:underline"
                >
                  清空 kind 过滤
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {kindSummaries.length ? (
                  kindSummaries.map((summary) => (
                    <button
                      key={summary.kind}
                      type="button"
                      onClick={() => {
                        const nextFilters: LargeObjectFilters = { ...filters, kind: summary.kind };
                        setFilters(nextFilters);
                        void load(1, nextFilters);
                      }}
                      className={`rounded-full border px-3 py-2 text-left text-xs transition ${
                        filters.kind.trim() === summary.kind
                          ? 'border-teal-300 bg-teal-50 text-teal-800'
                          : 'border-gray-200 bg-gray-50 text-gray-700 hover:border-teal-200 hover:bg-teal-50'
                      }`}
                    >
                      <div className="font-medium">{formatLargeObjectKindLabel(summary.kind)}</div>
                      <div className="mt-1 opacity-80">{summary.total.toLocaleString('zh-CN')} 条 · {formatBytes(summary.storedBytes)}</div>
                    </button>
                  ))
                ) : (
                  <div className="text-sm text-gray-500">当前筛选范围内没有可展示的 kind。</div>
                )}
              </div>
            </div>
          </div>

          <div className="mb-4 rounded-xl bg-white p-4 shadow-sm ring-1 ring-gray-100">
            <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-7">
              <input
                className="input-field"
                placeholder="类型 kind（可留空）"
                value={filters.kind}
                onChange={(e) => setFilters((prev) => ({ ...prev, kind: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return;
                  void load(1);
                }}
              />
              <select
                className="input-field"
                value={filters.family}
                onChange={(e) => setFilters((prev) => ({ ...prev, family: e.target.value as any }))}
              >
                <option value="all">全部资产家族</option>
                <option value="text">文本对象</option>
                <option value="image">图片资产</option>
                <option value="other">其他对象</option>
              </select>
              <input
                className="input-field"
                placeholder="搜索：owner_ref_id / r2_key / 用户名"
                value={filters.search}
                onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return;
                  void load(1);
                }}
              />
              <input
                className="input-field"
                placeholder="归属用户ID（ownerUserId）"
                value={filters.ownerUserId}
                onChange={(e) => setFilters((prev) => ({ ...prev, ownerUserId: e.target.value }))}
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
              <input
                className="input-field"
                placeholder="最小大小（minBytes，单位：字节）"
                value={filters.minBytes}
                onChange={(e) => setFilters((prev) => ({ ...prev, minBytes: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return;
                  void load(1);
                }}
              />
              <button
                onClick={() => void load(1)}
                className="rounded-lg bg-gray-900 px-3 py-2 text-sm text-white hover:bg-gray-800"
                disabled={loading}
              >
                应用筛选
              </button>
              <div className="self-center text-sm text-gray-600">
                共 {total} 条 · 当前页 {rows.length} 条
              </div>
            </div>
          </div>

          {error ? <div className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}

          <div className="grid gap-6 lg:grid-cols-3">
            <div className={`min-w-0 ${detailsVisible ? 'lg:col-span-2' : 'lg:col-span-3'}`}>
              <AdminTableScroll
                className="min-w-0"
                footer={
                  <div className="flex items-center justify-between text-sm text-gray-600">
                    <span>
                      第 {page} / {totalPages} 页
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        className="admin-button-sm"
                        onClick={() => void load(Math.max(1, page - 1))}
                        disabled={loading || page <= 1}
                      >
                        上一页
                      </button>
                      <button
                        className="admin-button-sm"
                        onClick={() => void load(Math.min(totalPages, page + 1))}
                        disabled={loading || page >= totalPages}
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
                    <th className="px-4 py-3 whitespace-nowrap">类型 / 家族</th>
                    <th className="px-4 py-3 whitespace-nowrap">归属引用ID</th>
                    <th className="px-4 py-3 whitespace-nowrap">归属用户</th>
                    <th className="px-4 py-3 whitespace-nowrap">大小</th>
                    <th className="px-4 py-3 whitespace-nowrap">创建时间</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {rows.map((row) => (
                    <tr
                      key={row.id}
                      className={`cursor-pointer hover:bg-gray-50 ${selectedId === row.id ? 'bg-emerald-50' : ''}`}
                      onClick={() => {
                        setSelectedId(row.id);
                        setDownloadUrl(null);
                        setDownloadError(null);
                      }}
                    >
                      <td className="px-4 py-3">
                        <div className="text-gray-800">{formatLargeObjectKindLabel(row.kind)}</div>
                        <div className="mt-1">
                          <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] ${familyBadgeClass(getLargeObjectAssetFamily(row.kind, row.content_type))}`}>
                            {formatLargeObjectAssetFamily(getLargeObjectAssetFamily(row.kind, row.content_type))}
                          </span>
                        </div>
                        <div className="mt-1 font-mono text-[11px] text-gray-500">{row.id}</div>
                        <div className="mt-1 text-[11px] text-gray-400">{row.kind}</div>
                      </td>
	                      <td className="px-4 py-3">
	                        <div className="font-mono text-xs text-gray-700 truncate max-w-[20rem]" title={row.owner_ref_id}>
	                          {row.owner_ref_id}
	                        </div>
	                        <div className="mt-1 text-[11px] text-gray-500 truncate max-w-[22rem]" title={row.r2_key}>
	                          {row.r2_key}
	                        </div>
	                      </td>
                      <td className="px-4 py-3">
                        <div className="text-gray-800">{row.owner_username ?? '—'}</div>
                        <div className="mt-1 text-[11px] text-gray-500">userId={row.owner_user_id ?? '—'}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-gray-800">{formatBytes(row.bytes)}</div>
                        <div className="mt-1 text-[11px] text-gray-500">存储={formatBytes(row.stored_bytes)}</div>
                      </td>
                      <td className="px-4 py-3 text-[11px] text-gray-500">{formatIso(row.created_at)}</td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                        {loading ? '加载中...' : '暂无数据'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              </AdminTableScroll>
            </div>

            {detailsVisible ? (
            <div className="min-w-0 rounded-xl bg-white p-4 shadow-sm ring-1 ring-gray-100 lg:sticky lg:top-6 h-fit">
              <h2 className="mb-3 text-lg font-semibold text-gray-800">详情 / 操作</h2>
	              {!selected ? (
	                <div className="text-sm text-gray-500">从左侧列表选择一条记录。</div>
	              ) : (
	                <div className="space-y-2 text-sm text-gray-700">
	                  <div className="flex items-start justify-between gap-3">
	                    <div className="font-mono text-xs text-gray-600 break-all">{selected.id}</div>
	                    <button type="button" onClick={() => void copyText(selected.id, '记录ID')} className="admin-button-sm shrink-0">
	                      复制
	                    </button>
	                  </div>
                  <div>
                    <span className="text-gray-500">类型：</span>
                    {formatLargeObjectKindLabel(selected.kind)}
                  </div>
                  <div>
                    <span className="text-gray-500">资产家族：</span>
                    {selectedFamily ? formatLargeObjectAssetFamily(selectedFamily) : '—'}
                  </div>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <span className="text-gray-500">归属引用ID：</span>
	                      <span className="font-mono text-xs break-all">{selected.owner_ref_id}</span>
	                    </div>
	                    <button
	                      type="button"
	                      onClick={() => void copyText(selected.owner_ref_id, '归属引用ID')}
	                      className="admin-button-sm shrink-0"
	                    >
	                      复制
	                    </button>
	                  </div>
	                  <div className="flex items-start justify-between gap-3">
	                    <div>
	                      <span className="text-gray-500">R2 键：</span>
	                      <span className="font-mono text-xs break-all">{selected.r2_key}</span>
	                    </div>
	                    <button type="button" onClick={() => void copyText(selected.r2_key, 'R2 键')} className="admin-button-sm shrink-0">
	                      复制
	                    </button>
	                  </div>
                  <div>
                    <span className="text-gray-500">大小：</span>
                    {formatBytes(selected.bytes)}（存储 {formatBytes(selected.stored_bytes)}）
                  </div>
                  <div>
                    <span className="text-gray-500">内容类型：</span>
                    {selected.content_type ?? '—'} {selected.content_encoding ? `(${selected.content_encoding})` : ''}
                  </div>
                  <div>
                    <span className="text-gray-500">创建时间：</span>
                    {formatIso(selected.created_at)}
                  </div>
                  <div>
                    <span className="text-gray-500">更新时间：</span>
                    {formatIso(selected.updated_at)}
                  </div>

                  {maybeBattleReportLink ? (
                    <div className="pt-2">
                      <Link href={maybeBattleReportLink} className="text-sm text-purple-600 hover:underline">
                        打开关联战报生成记录
                      </Link>
                    </div>
                  ) : null}

                  {selectedPreviewableImage && downloadUrl ? (
                    <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
                      <div className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-700">
                        <ImageIcon className="h-4 w-4" />
                        图片预览
                      </div>
                      {/* 这里直接消费 R2 预签名 URL，避免受 next/image 远端域名配置限制。 */}
                      <img src={downloadUrl} alt={selected.kind} className="max-h-72 w-full rounded-lg object-contain bg-white" />
                    </div>
                  ) : selectedPreviewableImage ? (
                    <div className="rounded-xl border border-dashed border-fuchsia-200 bg-fuchsia-50 p-3 text-xs text-fuchsia-700">
                      该对象可直接图片预览。先点击“生成下载链接”，再在此处查看缩略预览。
                    </div>
                  ) : null}

                  <div className="pt-4 space-y-2">
                    <button
                      onClick={() => void presignSelected()}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm text-white hover:bg-emerald-700 disabled:opacity-50"
                      disabled={downloadLoading}
                    >
                      <Download className="h-4 w-4" />
                      {downloadLoading ? '生成中...' : '生成下载链接'}
                    </button>

                    {downloadError ? <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{downloadError}</div> : null}
                    {downloadUrl ? (
                      <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                        <div className="text-xs text-gray-600 break-all">{downloadUrl}</div>
                        <div className="mt-2 flex items-center gap-2">
                          <a
                            href={downloadUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded bg-white px-3 py-2 text-xs text-gray-700 hover:bg-gray-100 border border-gray-200"
                          >
                            打开
                          </a>
                          <button
                            onClick={() => {
                              void navigator.clipboard.writeText(downloadUrl);
                              alert('已复制下载链接');
                            }}
                            className="rounded bg-white px-3 py-2 text-xs text-gray-700 hover:bg-gray-100 border border-gray-200"
                          >
                            复制
                          </button>
                        </div>
                      </div>
                    ) : null}

                    <button
                      onClick={() => void deleteSelected(false)}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 hover:bg-red-100"
                    >
                      <Trash2 className="h-4 w-4" />
                      仅删除索引记录
                    </button>
                    <button
                      onClick={() => void deleteSelected(true)}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-red-700 px-3 py-2 text-sm text-white hover:bg-red-800"
                    >
                      <Trash2 className="h-4 w-4" />
                      删除索引 + 删除 R2
                    </button>
                  </div>
                </div>
              )}
            </div>
            ) : null}
          </div>
        </div>
      </div>
    </>
  );
}
