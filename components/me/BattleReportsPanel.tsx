'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { useQuery } from '@tanstack/react-query';
import { RefreshCcw, Search, X } from 'lucide-react';

import { authStorage } from '@/lib/auth';

type BattleReportRecordSummary = {
  id: string;
  startedAt: string;
  status: string;
  endpoint: string;
  generationMode: string;
  mode: string;
  headline: string | null;
  winner: string | null;
  hasPreview: boolean;
  canRegenerate: boolean;
  contentBlocked: boolean;
  errorMessage: string | null;
  outputHasShieldWords: boolean;
  pvpRoomId: string | null;
  pvpMatchId: string | null;
  pvpRoundId: string | null;
};

type ListResponse = {
  success: true;
  page: number;
  pageSize: number;
  total: number;
  records: BattleReportRecordSummary[];
};

type Props = {
  isAuthenticated: boolean;
  onOpenDetails: (generationId: string) => void;
  onRegenerate: (generationId: string) => void;
  isRegenerating: boolean;
  regenerateError: string | null;
};

type StatusFilter = '' | 'completed' | 'aborted' | 'failed';
type GenerationModeFilter = '' | 'stream' | 'non-stream';
type SortFilter = 'started_at_desc' | 'started_at_asc';
type ModeFilter = '' | 'classic' | 'kizuna' | 'daily' | 'scenario';

const formatTime = (iso: string): string => {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  return new Date(ms).toLocaleString();
};

const clampInt = (value: unknown, fallback: number, min: number, max: number): number => {
  const n = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
};

const getSingleQueryValue = (value: string | string[] | undefined): string | null => {
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : null;
  return typeof value === 'string' ? value : null;
};

const areQueryRecordsEqual = (a: Record<string, string>, b: Record<string, string>): boolean => {
  const aKeys = Object.keys(a).sort();
  const bKeys = Object.keys(b).sort();
  if (aKeys.length !== bKeys.length) return false;
  for (let i = 0; i < aKeys.length; i++) {
    const key = aKeys[i];
    if (key !== bKeys[i]) return false;
    if (a[key] !== b[key]) return false;
  }
  return true;
};

const normalizeQueryFromRouter = (
  query: Record<string, string | string[] | undefined>
): Record<string, string> => {
  const normalized: Record<string, string> = {};

  const page = clampInt(getSingleQueryValue(query.page), 1, 1, 10_000);
  const pageSize = clampInt(getSingleQueryValue(query.pageSize), 10, 1, 30);
  const status = getSingleQueryValue(query.status);
  const mode = getSingleQueryValue(query.mode);
  const generationMode = getSingleQueryValue(query.generationMode);
  const pvpOnly = getSingleQueryValue(query.pvpOnly);
  const sort = getSingleQueryValue(query.sort);
  const q = getSingleQueryValue(query.q);

  if (page !== 1) normalized.page = String(page);
  if (pageSize !== 10) normalized.pageSize = String(pageSize);
  if (status === 'completed' || status === 'aborted' || status === 'failed') normalized.status = status;
  if (mode === 'classic' || mode === 'kizuna' || mode === 'daily' || mode === 'scenario') normalized.mode = mode;
  if (generationMode === 'stream' || generationMode === 'non-stream') normalized.generationMode = generationMode;
  if (typeof pvpOnly === 'string') {
    const v = pvpOnly.trim().toLowerCase();
    if (v === '1' || v === 'true' || v === 'yes' || v === 'on') normalized.pvpOnly = '1';
  }
  if (sort === 'started_at_asc' || sort === 'started_at_desc') {
    if (sort !== 'started_at_desc') normalized.sort = sort;
  }
  if (typeof q === 'string' && q.trim()) normalized.q = q.trim();

  return normalized;
};

export function BattleReportsPanel({ isAuthenticated, onOpenDetails, onRegenerate, isRegenerating, regenerateError }: Props) {
  const router = useRouter();

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const [status, setStatus] = useState<StatusFilter>('');
  const [mode, setMode] = useState<ModeFilter>('');
  const [generationMode, setGenerationMode] = useState<GenerationModeFilter>('');
  const [pvpOnly, setPvpOnly] = useState(false);
  const [sort, setSort] = useState<SortFilter>('started_at_desc');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const didInitFromUrl = useRef(false);

  useEffect(() => {
    const next = searchInput.trim();
    const handle = setTimeout(() => setSearch(next), 300);
    return () => clearTimeout(handle);
  }, [searchInput]);

  useEffect(() => {
    if (!router.isReady) return;
    if (didInitFromUrl.current) return;

    const initialPage = clampInt(getSingleQueryValue(router.query.page), 1, 1, 10_000);
    const initialPageSize = clampInt(getSingleQueryValue(router.query.pageSize), 10, 1, 30);
    const initialStatus = getSingleQueryValue(router.query.status);
    const initialMode = getSingleQueryValue(router.query.mode);
    const initialGenerationMode = getSingleQueryValue(router.query.generationMode);
    const initialPvpOnly = getSingleQueryValue(router.query.pvpOnly);
    const initialSort = getSingleQueryValue(router.query.sort);
    const initialQ = getSingleQueryValue(router.query.q);

    setPage(initialPage);
    setPageSize(initialPageSize);

    if (initialStatus === 'completed' || initialStatus === 'aborted' || initialStatus === 'failed') setStatus(initialStatus);
    if (initialMode === 'classic' || initialMode === 'kizuna' || initialMode === 'daily' || initialMode === 'scenario') setMode(initialMode);
    if (initialGenerationMode === 'stream' || initialGenerationMode === 'non-stream') setGenerationMode(initialGenerationMode);
    if (initialSort === 'started_at_asc' || initialSort === 'started_at_desc') setSort(initialSort);
    if (typeof initialQ === 'string' && initialQ.trim()) {
      const q = initialQ.trim();
      setSearchInput(q);
      setSearch(q);
    }
    if (typeof initialPvpOnly === 'string') {
      const v = initialPvpOnly.trim().toLowerCase();
      setPvpOnly(v === '1' || v === 'true' || v === 'yes' || v === 'on');
    }

    didInitFromUrl.current = true;
  }, [router.isReady, router.query]);

  useEffect(() => {
    if (!router.isReady) return;
    if (!didInitFromUrl.current) return;

    const nextQuery: Record<string, string> = {};
    if (page !== 1) nextQuery.page = String(page);
    if (pageSize !== 10) nextQuery.pageSize = String(pageSize);
    if (status) nextQuery.status = status;
    if (mode) nextQuery.mode = mode;
    if (generationMode) nextQuery.generationMode = generationMode;
    if (pvpOnly) nextQuery.pvpOnly = '1';
    if (sort !== 'started_at_desc') nextQuery.sort = sort;
    if (search) nextQuery.q = search;

    const currentQuery = normalizeQueryFromRouter(router.query as Record<string, string | string[] | undefined>);
    if (areQueryRecordsEqual(currentQuery, nextQuery)) return;

    void router.replace({ pathname: router.pathname, query: nextQuery }, undefined, { shallow: true });
  }, [router, page, pageSize, status, mode, generationMode, pvpOnly, sort, search]);

  const reportsQuery = useQuery({
    queryKey: ['me', 'battle-reports', page, pageSize, status, mode, generationMode, pvpOnly, sort, search],
    enabled: Boolean(isAuthenticated),
    queryFn: async (): Promise<ListResponse> => {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      });
      if (status) params.set('status', status);
      if (mode) params.set('mode', mode);
      if (generationMode) params.set('generationMode', generationMode);
      if (pvpOnly) params.set('pvpOnly', '1');
      if (sort) params.set('sort', sort);
      if (search) params.set('q', search);

      const res = await authStorage.fetch(`/api/me/battle-reports?${params.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '加载战报记录失败');
      return data as ListResponse;
    },
    staleTime: 10_000,
  });

  const totalPages = useMemo(() => {
    const total = reportsQuery.data?.total ?? 0;
    return Math.max(1, Math.ceil(total / pageSize));
  }, [reportsQuery.data?.total, pageSize]);

  useEffect(() => {
    if (!reportsQuery.data) return;
    if (page > totalPages) setPage(totalPages);
  }, [reportsQuery.data, page, totalPages]);

  const canPrev = page > 1;
  const canNext = page < totalPages;

  const records = reportsQuery.data?.records ?? [];

  const isFiltered = Boolean(status || mode || generationMode || pvpOnly || (sort && sort !== 'started_at_desc') || search);

  const resetFilters = (): void => {
    setStatus('');
    setMode('');
    setGenerationMode('');
    setPvpOnly(false);
    setSort('started_at_desc');
    setSearchInput('');
    setSearch('');
    setPage(1);
  };

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-gray-700">
          {isFiltered ? (
            <>
              筛选后 <span className="font-semibold">{reportsQuery.data?.total ?? 0}</span> 条
              <span className="ml-2 text-xs text-gray-500">（已开启筛选）</span>
            </>
          ) : (
            <>
              共 <span className="font-semibold">{reportsQuery.data?.total ?? 0}</span> 条记录
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="text-sm text-gray-600">
            每页
            <select
              className="ml-2 rounded-md border border-gray-200 bg-white px-2 py-1 text-sm"
              value={pageSize}
              onChange={(e) => {
                const next = Number(e.target.value);
                setPageSize(Number.isFinite(next) ? next : 10);
                setPage(1);
              }}
            >
              <option value={8}>8</option>
              <option value={10}>10</option>
              <option value={15}>15</option>
              <option value={20}>20</option>
              <option value={30}>30</option>
            </select>
          </label>

          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-lg border bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
            onClick={() => void reportsQuery.refetch()}
            disabled={reportsQuery.isFetching}
            title="刷新"
          >
            <RefreshCcw className={['h-4 w-4', reportsQuery.isFetching ? 'animate-spin' : ''].join(' ')} />
            刷新
          </button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[240px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-10 pr-10 text-sm outline-none focus:border-gray-300"
            placeholder="搜索标题（支持战报标题/剧本名）"
            value={searchInput}
            onChange={(e) => {
              setSearchInput(e.target.value);
              setPage(1);
            }}
          />
          {searchInput.trim() ? (
            <button
              type="button"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-gray-500 hover:bg-gray-100"
              onClick={() => {
                setSearchInput('');
                setSearch('');
                setPage(1);
              }}
              title="清空搜索"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>

        <label className="text-sm text-gray-600">
          状态
          <select
            className="ml-2 rounded-md border border-gray-200 bg-white px-2 py-2 text-sm"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as StatusFilter);
              setPage(1);
            }}
          >
            <option value="">全部</option>
            <option value="completed">完成</option>
            <option value="failed">失败</option>
            <option value="aborted">中止</option>
          </select>
        </label>

        <label className="text-sm text-gray-600">
          模式
          <select
            className="ml-2 rounded-md border border-gray-200 bg-white px-2 py-2 text-sm"
            value={mode}
            onChange={(e) => {
              setMode(e.target.value as ModeFilter);
              setPage(1);
            }}
          >
            <option value="">全部</option>
            <option value="classic">经典</option>
            <option value="kizuna">羁绊</option>
            <option value="daily">日常</option>
            <option value="scenario">剧本</option>
          </select>
        </label>

        <label className="text-sm text-gray-600">
          生成方式
          <select
            className="ml-2 rounded-md border border-gray-200 bg-white px-2 py-2 text-sm"
            value={generationMode}
            onChange={(e) => {
              setGenerationMode(e.target.value as GenerationModeFilter);
              setPage(1);
            }}
          >
            <option value="">全部</option>
            <option value="non-stream">非流式</option>
            <option value="stream">流式</option>
          </select>
        </label>

        <label className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={pvpOnly}
            onChange={(e) => {
              setPvpOnly(e.target.checked);
              setPage(1);
            }}
          />
          仅 PVP
        </label>

        <label className="text-sm text-gray-600">
          排序
          <select
            className="ml-2 rounded-md border border-gray-200 bg-white px-2 py-2 text-sm"
            value={sort}
            onChange={(e) => {
              setSort(e.target.value as SortFilter);
              setPage(1);
            }}
          >
            <option value="started_at_desc">最新优先</option>
            <option value="started_at_asc">最旧优先</option>
          </select>
        </label>

        {isFiltered ? (
          <button
            type="button"
            className="rounded-lg border bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
            onClick={resetFilters}
          >
            清空筛选
          </button>
        ) : null}
      </div>

      {reportsQuery.isLoading && <div className="mt-3 text-sm text-gray-600">加载中…</div>}
      {reportsQuery.error && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          加载失败：{(reportsQuery.error as Error).message}
        </div>
      )}

      {!reportsQuery.isLoading && !reportsQuery.error && (
        <>
          <div className="mt-3 overflow-hidden rounded-xl border bg-white">
            <div className="divide-y">
              {records.length <= 0 ? (
                <div className="p-4 text-sm text-gray-600">暂无战报记录。</div>
              ) : (
                records.map((r) => (
                  <div key={r.id} className="p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="truncate font-semibold text-gray-900">
                            {r.headline || '（无标题）'}
                          </div>
                          {r.contentBlocked ? (
                            <span className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] text-red-800">
                              内容已屏蔽
                            </span>
                          ) : null}
                          {r.outputHasShieldWords ? (
                            <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] text-amber-800">
                              含屏蔽词
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-600">
                          <span className="rounded-full border bg-gray-50 px-2 py-0.5">
                            {r.mode || '未知'} / {r.status || 'unknown'}
                          </span>
                          {r.generationMode ? (
                            <span className="rounded-full border bg-gray-50 px-2 py-0.5">
                              {r.generationMode}
                            </span>
                          ) : null}
                          <span>{formatTime(r.startedAt)}</span>
                          <span className="text-gray-400">·</span>
                          <span>胜者：{r.winner || '（未知）'}</span>
                          {r.pvpMatchId ? (
                            <>
                              <span className="text-gray-400">·</span>
                              <span className="truncate">PVP：{r.pvpMatchId}</span>
                            </>
                          ) : null}
                        </div>
                      </div>

                      <div className="flex shrink-0 items-center gap-2">
                        <button
                          type="button"
                          className="rounded-lg border bg-white px-3 py-2 text-xs text-gray-700 hover:bg-gray-50"
                          onClick={() => onOpenDetails(r.id)}
                        >
                          详情
                        </button>
                        <button
                          type="button"
                          className="rounded-lg bg-gray-900 px-3 py-2 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-60"
                          onClick={() => onRegenerate(r.id)}
                          disabled={isRegenerating || !r.canRegenerate}
                          title={r.canRegenerate ? '尽力复现并生成可下载的战报卡片' : (r.errorMessage || '当前没有可重生正文')}
                        >
                          {isRegenerating ? '生成中…' : '重生战报'}
                        </button>
                      </div>
                    </div>
                    {!r.canRegenerate && r.errorMessage ? (
                      <div className="mt-2 text-xs text-amber-700">失败原因：{r.errorMessage}</div>
                    ) : null}
                  </div>
                ))
              )}
            </div>
          </div>

          {regenerateError ? (
            <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              重新生成失败：{regenerateError}
            </div>
          ) : null}

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs text-gray-600">
              第 <span className="font-semibold">{page}</span> / {totalPages} 页
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="rounded-lg border bg-white px-3 py-2 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={!canPrev}
              >
                上一页
              </button>
              <button
                type="button"
                className="rounded-lg border bg-white px-3 py-2 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                onClick={() => setPage((p) => p + 1)}
                disabled={!canNext}
              >
                下一页
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
