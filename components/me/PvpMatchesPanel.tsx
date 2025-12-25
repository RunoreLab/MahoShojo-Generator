'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { RefreshCcw } from 'lucide-react';

import { authStorage } from '@/lib/auth';

type PvpUserSummary = {
  completedMatches: number;
  wins: number;
  losses: number;
  draws: number;
  abortedMatches: number;
  lastPlayedAt: string | null;
};

type PvpMatchItem = {
  id: string;
  roomId: string | null;
  status: string;
  startedAt: string;
  endedAt: string | null;
  winnerUserId: number | null;
  players: Array<{ userId: number; seat: number; username: string | null; prefix: string | null }>;
};

type PvpResponse = {
  success: true;
  summary: PvpUserSummary;
  page: number;
  pageSize: number;
  totalMatches: number;
  recentMatches: PvpMatchItem[];
};

type Props = {
  isAuthenticated: boolean;
  myUserId: number | null;
  onOpenMatchDetails: (matchId: string) => void;
};

const formatUserLabel = (p: { userId: number; username: string | null; prefix: string | null }) => {
  const prefix = p.prefix ? `${p.prefix} ` : '';
  const username = p.username ? p.username : `用户${p.userId}`;
  return `${prefix}${username}`;
};

const formatTime = (iso: string | null): string => {
  if (!iso) return '暂无';
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return String(iso);
  return new Date(ms).toLocaleString();
};

export function PvpMatchesPanel({ isAuthenticated, myUserId, onOpenMatchDetails }: Props) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const pvpQuery = useQuery({
    queryKey: ['me', 'pvp', page, pageSize],
    enabled: Boolean(isAuthenticated),
    queryFn: async (): Promise<PvpResponse> => {
      const authHeader = await authStorage.getAuthHeader();
      if (!authHeader) throw new Error('未登录');
      const res = await fetch(`/api/me/pvp?page=${page}&pageSize=${pageSize}`, { headers: { Authorization: authHeader } });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '加载 PVP 战绩失败');
      return data as PvpResponse;
    },
    staleTime: 10_000,
  });

  const winRate = useMemo(() => {
    const summary = pvpQuery.data?.summary;
    if (!summary) return '0%';
    const total = summary.wins + summary.losses + summary.draws;
    if (total <= 0) return '0%';
    return `${Math.round((summary.wins / total) * 100)}%`;
  }, [pvpQuery.data?.summary]);

  const totalPages = useMemo(() => {
    const total = pvpQuery.data?.totalMatches ?? 0;
    return Math.max(1, Math.ceil(total / pageSize));
  }, [pvpQuery.data?.totalMatches, pageSize]);

  const canPrev = page > 1;
  const canNext = page < totalPages;

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-gray-700">
          共 <span className="font-semibold">{pvpQuery.data?.totalMatches ?? 0}</span> 场对局
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
            onClick={() => void pvpQuery.refetch()}
            disabled={pvpQuery.isFetching}
            title="刷新"
          >
            <RefreshCcw className={['h-4 w-4', pvpQuery.isFetching ? 'animate-spin' : ''].join(' ')} />
            刷新
          </button>
        </div>
      </div>

      {pvpQuery.isLoading && <div className="mt-3 text-sm text-gray-600">加载中…</div>}
      {pvpQuery.error && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          加载失败：{(pvpQuery.error as Error).message}
        </div>
      )}

      {pvpQuery.data ? (
        <div className="mt-3 space-y-3">
          <div className="rounded-xl border bg-white p-4 text-sm">
            <div className="font-semibold text-gray-900">我的战绩</div>
            <div className="mt-1">
              已完赛：{pvpQuery.data.summary.completedMatches} 场（胜 {pvpQuery.data.summary.wins} / 负{' '}
              {pvpQuery.data.summary.losses} / 平 {pvpQuery.data.summary.draws}，胜率 {winRate}）
            </div>
            <div className="mt-1 text-xs text-gray-600">
              中止：{pvpQuery.data.summary.abortedMatches}；最近一场：{formatTime(pvpQuery.data.summary.lastPlayedAt)}
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border bg-white">
            <div className="divide-y">
              {pvpQuery.data.recentMatches.length <= 0 ? (
                <div className="p-4 text-sm text-gray-600">暂无 PVP 对局记录。</div>
              ) : (
                pvpQuery.data.recentMatches.map((m) => {
                  const myId = myUserId ?? 0;
                  const mySeat = m.players.find((p) => p.userId === myId)?.seat ?? null;
                  const opponentLabels = m.players
                    .filter((p) => p.userId !== myId)
                    .map((p) => formatUserLabel(p))
                    .join(' / ');

                  const resultText =
                    m.status !== 'completed'
                      ? m.status
                      : m.winnerUserId === null
                        ? '平局'
                        : m.winnerUserId === myId
                          ? '胜'
                          : '负';

                  return (
                    <div key={m.id} className="p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <div className="font-semibold text-gray-900">{resultText}</div>
                            <span className="rounded-full border bg-gray-50 px-2 py-0.5 text-[11px] text-gray-700">
                              {m.status}
                            </span>
                          </div>
                          <div className="mt-1 text-xs text-gray-600">
                            {formatTime(m.startedAt)}；我的座位：{mySeat ?? '？'}；对手：{opponentLabels || '（未知）'}
                          </div>
                          <div className="mt-1 text-[11px] text-gray-500">
                            match：{m.id}
                            {m.roomId ? ` · room：${m.roomId}` : ''}
                          </div>
                        </div>
                        <div className="shrink-0">
                          <button
                            type="button"
                            className="rounded-lg border bg-white px-3 py-2 text-xs text-gray-700 hover:bg-gray-50"
                            onClick={() => onOpenMatchDetails(m.id)}
                          >
                            详情
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
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
        </div>
      ) : null}
    </div>
  );
}

