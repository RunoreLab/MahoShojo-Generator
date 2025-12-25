'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { RefreshCcw } from 'lucide-react';

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
  contentBlocked: boolean;
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

const formatTime = (iso: string): string => {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  return new Date(ms).toLocaleString();
};

export function BattleReportsPanel({ isAuthenticated, onOpenDetails, onRegenerate, isRegenerating, regenerateError }: Props) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const reportsQuery = useQuery({
    queryKey: ['me', 'battle-reports', page, pageSize],
    enabled: Boolean(isAuthenticated),
    queryFn: async (): Promise<ListResponse> => {
      const authHeader = await authStorage.getAuthHeader();
      if (!authHeader) throw new Error('未登录');
      const res = await fetch(`/api/me/battle-reports?page=${page}&pageSize=${pageSize}`, {
        headers: { Authorization: authHeader },
      });
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

  const canPrev = page > 1;
  const canNext = page < totalPages;

  const records = reportsQuery.data?.records ?? [];

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-gray-700">
          共 <span className="font-semibold">{reportsQuery.data?.total ?? 0}</span> 条记录
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
                          disabled={isRegenerating}
                          title="尽力复现并生成可下载的战报卡片"
                        >
                          {isRegenerating ? '生成中…' : '重生战报'}
                        </button>
                      </div>
                    </div>
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
