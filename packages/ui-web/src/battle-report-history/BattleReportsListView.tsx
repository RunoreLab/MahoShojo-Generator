import { useEffect } from 'react';
import { PageJump } from '../pagination';
import { RefreshCcw, Search, X } from 'lucide-react';
import type { BattleReportFilters, BattleReportList } from '@mahoshojo/contracts/battle-report-history';
import { BATTLE_REPORT_MAX_PAGE, DEFAULT_BATTLE_REPORT_FILTERS } from '@mahoshojo/contracts/battle-report-history';
import { battleReportSourceLabel as sourceLabel, formatBattleReportTime as formatTime } from './presentation';

type Props = {
  filters: BattleReportFilters;
  onFiltersChange: (filters: BattleReportFilters) => void;
  searchInput: string;
  onSearchInputChange: (value: string) => void;
  data?: BattleReportList;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  onRefresh: () => void;
  onOpenDetails: (generationId: string) => void;
  onRegenerate?: (generationId: string) => void;
  isRegenerating?: boolean;
  regenerateError?: string | null;
};
type StatusFilter = BattleReportFilters['status'];
type ModeFilter = BattleReportFilters['mode'];
type GenerationModeFilter = BattleReportFilters['generationMode'];
type SortFilter = BattleReportFilters['sort'];

export function BattleReportsListView({ filters, onFiltersChange, searchInput, onSearchInputChange: setSearchInput,
  data, loading, refreshing, error, onRefresh, onOpenDetails, onRegenerate, isRegenerating, regenerateError }: Props) {
  const { page, pageSize, status, mode, generationMode, pvpOnly, sort, q: search } = filters;
  const change = <K extends keyof BattleReportFilters>(key: K, value: BattleReportFilters[K]) => onFiltersChange({ ...filters, [key]: value, page: 1 });
  const setPage = (value: number | ((page: number) => number)) => onFiltersChange({ ...filters, page: typeof value === 'function' ? value(page) : value });
  const setPageSize = (value: number) => change('pageSize', value);
  const setStatus = (value: StatusFilter) => change('status', value);
  const setMode = (value: ModeFilter) => change('mode', value);
  const setGenerationMode = (value: GenerationModeFilter) => change('generationMode', value);
  const setPvpOnly = (value: boolean) => change('pvpOnly', value);
  const setSort = (value: SortFilter) => change('sort', value);
  const setSearch = (value: string) => change('q', value);
  const totalPages = Math.min(BATTLE_REPORT_MAX_PAGE, Math.max(1, Math.ceil((data?.total ?? 0) / pageSize)));
  useEffect(() => {
    if (data && !loading && !error && page > totalPages) onFiltersChange({ ...filters, page: totalPages });
  }, [data, loading, error, page, totalPages, filters, onFiltersChange]);
  const canPrev = page > 1;
  const canNext = page < totalPages;
  const records = data?.records ?? [];
  const isFiltered = Boolean(status || mode || generationMode || pvpOnly || sort !== 'started_at_desc' || search);
  const resetFilters = () => { setSearchInput(''); onFiltersChange({ ...DEFAULT_BATTLE_REPORT_FILTERS, pageSize }); };

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-gray-700">
          {!data ? '服务器战报记录' : isFiltered ? (
            <>
              筛选后 <span className="font-semibold">{data?.total ?? 0}</span> 条
              <span className="ml-2 text-xs text-gray-500">（已开启筛选）</span>
            </>
          ) : (
            <>
              共 <span className="font-semibold">{data?.total ?? 0}</span> 条记录
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
            onClick={() => onRefresh()}
            disabled={refreshing}
            title="刷新"
          >
            <RefreshCcw className={['h-4 w-4', refreshing ? 'animate-spin' : ''].join(' ')} />
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
            aria-label="搜索战报标题"
            maxLength={120}
            value={searchInput}
            onChange={(e) => {
              setSearchInput(e.target.value);
            }}
          />
          {searchInput.trim() ? (
            <button
              type="button"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-gray-500 hover:bg-gray-100"
              onClick={() => {
                setSearchInput('');
                setSearch('');
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

      {loading && <div className="mt-3 text-sm text-gray-600">加载中…</div>}
      {error && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          加载失败：{error}
        </div>
      )}

      {!loading && !error && (
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
                            {r.displayTitle || r.headline || '（无标题）'}
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
                          <span className="rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[11px] text-indigo-800">
                            {sourceLabel(r)}
                          </span>
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
                          {r.sourceKind === 'pvp' && r.pvpMatchId ? (
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
                        {onRegenerate ? <button
                          type="button"
                          className="rounded-lg bg-gray-900 px-3 py-2 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-60"
                          onClick={() => onRegenerate(r.id)}
                          disabled={isRegenerating || !r.canRegenerate}
                          title={r.canRegenerate ? '尽力复现并生成可下载的战报卡片' : (r.errorMessage || '当前没有可重生正文')}
                        >
                          {isRegenerating ? '生成中…' : '重生战报'}
                        </button> : null}
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
            <div className="flex flex-wrap items-center gap-2">
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
              <PageJump currentPage={page} totalPages={totalPages} onPageChange={setPage} disabled={loading || refreshing || !!error} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
