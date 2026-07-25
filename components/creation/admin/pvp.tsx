import React, { useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import {
  Activity,
  AlertTriangle,
  Download,
  Eraser,
  History,
  MessageSquareText,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  Users,
  Wrench,
  XCircle,
  Zap,
} from 'lucide-react';

import type {
  AdminPvpDashboardResponse,
  AdminPvpRoomDetail,
} from '@/lib/database/admin-pvp';

type ApiResponse =
  | ({ success: true } & AdminPvpDashboardResponse)
  | { success: false; error?: string };

type ActionResponse =
  | {
      success: true;
      result: {
        roomId: string;
        action: 'forcePending' | 'recoverResolving' | 'restartRoom' | 'closeRoom' | 'clearRoomEphemeral';
        message: string;
      };
    }
  | {
      success: false;
      error?: string;
    };

type RoomFiltersState = {
  roomSearch: string;
  roomStatus: 'all' | 'open' | 'closed';
  roomPhase: string;
  roomStalledOnly: boolean;
  roomPage: number;
  roomLimit: number;
};

type MatchFiltersState = {
  matchSearch: string;
  matchStatus: 'all' | 'active' | 'completed' | 'aborted';
  matchRoomId: string;
  matchUserId: string;
  matchPage: number;
  matchLimit: number;
};

const defaultRoomFilters: RoomFiltersState = {
  roomSearch: '',
  roomStatus: 'all',
  roomPhase: 'all',
  roomStalledOnly: false,
  roomPage: 1,
  roomLimit: 12,
};

const defaultMatchFilters: MatchFiltersState = {
  matchSearch: '',
  matchStatus: 'all',
  matchRoomId: '',
  matchUserId: '',
  matchPage: 1,
  matchLimit: 12,
};

const formatNumber = (value: number): string => value.toLocaleString('zh-CN');

const formatDateTime = (value: string | null | undefined): string => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', { hour12: false });
};

const formatDurationMinutes = (minutes: number): string => {
  if (!Number.isFinite(minutes) || minutes <= 0) return '0 分钟';
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const remain = minutes % 60;
  return remain > 0 ? `${hours} 小时 ${remain} 分钟` : `${hours} 小时`;
};

const resultBytesLabel = (value: string | null | undefined): string => {
  if (!value) return '—';
  return `${new Blob([value]).size.toLocaleString('zh-CN')} B`;
};

const phaseTone = (phase: string): string => {
  if (phase === 'resolving' || phase === 'aborted') return 'border-red-200 bg-red-50 text-red-700';
  if (phase === 'reviewing' || phase === 'voting') return 'border-amber-200 bg-amber-50 text-amber-700';
  if (phase === 'choosing' || phase === 'submitting') return 'border-cyan-200 bg-cyan-50 text-cyan-700';
  if (phase === 'finished' || phase === 'closed') return 'border-slate-200 bg-slate-100 text-slate-600';
  return 'border-emerald-200 bg-emerald-50 text-emerald-700';
};

const statusTone = (status: string): string => {
  if (status === 'aborted' || status === 'closed') return 'border-red-200 bg-red-50 text-red-700';
  if (status === 'active' || status === 'open') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (status === 'completed' || status === 'finished') return 'border-slate-200 bg-slate-100 text-slate-700';
  return 'border-amber-200 bg-amber-50 text-amber-700';
};

const pendingActionLabel = (kind: 'submit' | 'choose' | 'confirm'): string => {
  if (kind === 'submit') return '提交';
  if (kind === 'choose') return '出牌';
  if (kind === 'confirm') return '确认';
  return '推进';
};

function SummaryCard(props: {
  title: string;
  value: string;
  note?: string;
  icon: React.ElementType;
  tone: string;
}) {
  const { title, value, note, icon: Icon, tone } = props;
  return (
    <div className="rounded-3xl border border-white/70 bg-white/90 p-4 shadow-sm backdrop-blur">
      <div className="flex items-center gap-3">
        <div className={`flex h-11 w-11 items-center justify-center rounded-2xl ${tone}`}>
          <Icon className="h-5 w-5 text-white" />
        </div>
        <div>
          <p className="text-sm text-slate-500">{title}</p>
          <p className="text-2xl font-semibold text-slate-900">{value}</p>
        </div>
      </div>
      {note ? <p className="mt-3 text-xs leading-5 text-slate-500">{note}</p> : null}
    </div>
  );
}

function TinyBadge(props: { label: string; tone?: string }) {
  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs ${props.tone ?? 'border-slate-200 bg-slate-100 text-slate-600'}`}>
      {props.label}
    </span>
  );
}

function EmptyState(props: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
      {props.text}
    </div>
  );
}

function SectionHeader(props: { title: string; note?: string; action?: React.ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">{props.title}</h2>
        {props.note ? <p className="mt-1 text-sm text-slate-500">{props.note}</p> : null}
      </div>
      {props.action}
    </div>
  );
}

export default function AdminPvpPage() {
  const [roomFilters, setRoomFilters] = useState<RoomFiltersState>(defaultRoomFilters);
  const [matchFilters, setMatchFilters] = useState<MatchFiltersState>(defaultMatchFilters);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const buildSearchParams = (options?: {
    roomFilters?: RoomFiltersState;
    matchFilters?: MatchFiltersState;
    roomId?: string | null;
    matchId?: string | null;
    includeSelection?: boolean;
    format?: 'csv';
    scope?: 'rooms' | 'matches' | 'roomChats' | 'roomRounds';
    exportRoomId?: string | null;
    maxRows?: number;
  }): URLSearchParams => {
    const nextRoomFilters = options?.roomFilters ?? roomFilters;
    const nextMatchFilters = options?.matchFilters ?? matchFilters;
    const nextRoomId = options?.roomId !== undefined ? options.roomId : selectedRoomId;
    const nextMatchId = options?.matchId !== undefined ? options.matchId : selectedMatchId;
    const params = new URLSearchParams();
    if (nextRoomFilters.roomSearch.trim()) params.set('roomSearch', nextRoomFilters.roomSearch.trim());
    if (nextRoomFilters.roomStatus !== 'all') params.set('roomStatus', nextRoomFilters.roomStatus);
    if (nextRoomFilters.roomPhase !== 'all') params.set('roomPhase', nextRoomFilters.roomPhase);
    if (nextRoomFilters.roomStalledOnly) params.set('roomStalledOnly', '1');
    params.set('roomPage', String(nextRoomFilters.roomPage));
    params.set('roomLimit', String(nextRoomFilters.roomLimit));

    if (nextMatchFilters.matchSearch.trim()) params.set('matchSearch', nextMatchFilters.matchSearch.trim());
    if (nextMatchFilters.matchStatus !== 'all') params.set('matchStatus', nextMatchFilters.matchStatus);
    if (nextMatchFilters.matchRoomId.trim()) params.set('matchRoomId', nextMatchFilters.matchRoomId.trim());
    if (nextMatchFilters.matchUserId.trim()) params.set('matchUserId', nextMatchFilters.matchUserId.trim());
    params.set('matchPage', String(nextMatchFilters.matchPage));
    params.set('matchLimit', String(nextMatchFilters.matchLimit));

    if (options?.includeSelection !== false) {
      if (nextRoomId) params.set('roomId', nextRoomId);
      if (nextMatchId) params.set('matchId', nextMatchId);
    }

    if (options?.format === 'csv' && options.scope) {
      params.set('format', 'csv');
      params.set('scope', options.scope);
      if (options.exportRoomId) params.set('roomId', options.exportRoomId);
      if (typeof options.maxRows === 'number' && Number.isFinite(options.maxRows)) {
        params.set('maxRows', String(Math.floor(options.maxRows)));
      }
    }

    return params;
  };

  const load = async (
    showRefreshing = false,
    options?: {
      roomFilters?: RoomFiltersState;
      matchFilters?: MatchFiltersState;
      roomId?: string | null;
      matchId?: string | null;
    },
  ) => {
    if (showRefreshing) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/admin/pvp?${buildSearchParams(options).toString()}`);
      const json = (await response.json()) as ApiResponse;
      if (!response.ok || json.success !== true) {
        throw new Error(json.success === false ? json.error || '读取 PVP 管理数据失败' : '读取 PVP 管理数据失败');
      }
      setData(json);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '读取 PVP 管理数据失败');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void load();
    // 仅在页面初次进入时拉取一次，后续刷新由显式操作触发。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const triggerSearch = () => {
    const nextRoomFilters = { ...roomFilters, roomPage: 1 };
    const nextMatchFilters = { ...matchFilters, matchPage: 1 };
    setRoomFilters(nextRoomFilters);
    setMatchFilters(nextMatchFilters);
    void load(false, { roomFilters: nextRoomFilters, matchFilters: nextMatchFilters });
  };

  const resetRoomFilters = () => {
    setRoomFilters(defaultRoomFilters);
    setSelectedRoomId(null);
    setSelectedMatchId(null);
    void load(false, {
      roomFilters: defaultRoomFilters,
      roomId: null,
      matchId: null,
    });
  };

  const resetMatchFilters = () => {
    setMatchFilters(defaultMatchFilters);
    setSelectedMatchId(null);
    void load(false, {
      matchFilters: defaultMatchFilters,
      matchId: null,
    });
  };

  const reloadAfterAction = async () => {
    await load(true);
  };

  const runAction = async (
    payload:
      | {
          action: 'forcePending' | 'recoverResolving' | 'restartRoom' | 'closeRoom' | 'clearRoomEphemeral';
          roomId: string;
          expectedVersion?: number;
          kind?: 'submit' | 'choose' | 'confirm';
          cleanupMode?: 'preserve' | 'runtime' | 'ephemeral';
        }
      | null,
  ) => {
    if (!payload) return;
    setActionMessage(null);
    setActionError(null);
    setBusyAction(`${payload.action}:${payload.roomId}`);

    try {
      const response = await fetch('/api/admin/pvp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = (await response.json()) as ActionResponse;
      if (!response.ok || json.success !== true) {
        throw new Error(json.success === false ? json.error || '执行房间干预失败' : '执行房间干预失败');
      }
      setActionMessage(json.result.message);
      await reloadAfterAction();
    } catch (runError) {
      setActionError(runError instanceof Error ? runError.message : '执行房间干预失败');
    } finally {
      setBusyAction(null);
    }
  };

  const exportCsv = (scope: 'rooms' | 'matches' | 'roomChats' | 'roomRounds', roomId?: string | null) => {
    const params = buildSearchParams({
      format: 'csv',
      scope,
      exportRoomId: roomId ?? null,
      maxRows: scope === 'rooms' || scope === 'matches' ? 200 : 300,
    });
    window.open(`/api/admin/pvp?${params.toString()}`, '_blank', 'noopener');
  };

  const successData = data?.success === true ? data : null;
  const overview = successData?.overview;
  const roomDetail = successData?.roomDetail ?? null;
  const matchDetail = successData?.matchDetail ?? null;

  const forceActionPayload = (detail: AdminPvpRoomDetail) => {
    const pending = detail.diagnostics.pendingAction;
    if (!pending || !pending.canForce) return null;
    return {
      action: 'forcePending' as const,
      roomId: detail.room.id,
      expectedVersion: detail.room.version,
      kind: pending.kind,
    };
  };

  const applyRoomPage = (nextPage: number) => {
    const nextRoomFilters = { ...roomFilters, roomPage: Math.max(1, nextPage) };
    setRoomFilters(nextRoomFilters);
    void load(false, { roomFilters: nextRoomFilters });
  };

  const applyMatchPage = (nextPage: number) => {
    const nextMatchFilters = { ...matchFilters, matchPage: Math.max(1, nextPage) };
    setMatchFilters(nextMatchFilters);
    void load(false, { matchFilters: nextMatchFilters });
  };

  return (
    <>
      <Head>
        <title>PVP 管理台 - Admin</title>
      </Head>

      <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(245,158,11,0.16),_transparent_28%),radial-gradient(circle_at_top_right,_rgba(14,165,233,0.14),_transparent_24%),linear-gradient(180deg,_#f8fafc_0%,_#f5f3ff_100%)] p-4 sm:p-6">
        <div className="mx-auto max-w-7xl">
          <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
            <div>
              <Link href="/admin" className="text-sm text-slate-600 hover:text-slate-900 hover:underline">
                ← 返回管理后台主页
              </Link>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">PVP 管理台</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
                从“只读概览”升级为可操作工作台：支持房间巡检、历史对局检索、聊天审计、CSV 导出，以及房间重开、结算锁恢复、清理临时态等干预动作。
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => exportCsv('rooms')}
                className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm hover:bg-slate-50"
              >
                <Download className="h-4 w-4" />
                导出房间检索
              </button>
              <button
                type="button"
                onClick={() => exportCsv('matches')}
                className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm hover:bg-slate-50"
              >
                <History className="h-4 w-4" />
                导出对局检索
              </button>
              <button
                type="button"
                onClick={() => void load(true)}
                className="inline-flex items-center gap-2 rounded-2xl border border-slate-900 bg-slate-900 px-3 py-2 text-sm text-white shadow-sm hover:bg-slate-800"
              >
                <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
                刷新
              </button>
            </div>
          </div>

          {error ? (
            <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
          ) : null}
          {actionMessage ? (
            <div className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{actionMessage}</div>
          ) : null}
          {actionError ? (
            <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{actionError}</div>
          ) : null}

          {loading && !data ? (
            <div className="rounded-3xl border border-white/70 bg-white/85 px-4 py-14 text-center text-sm text-slate-500 shadow-sm backdrop-blur">
              正在读取 PVP 管理数据…
            </div>
          ) : null}

          {overview ? (
            <div className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-6">
              <SummaryCard title="开放房间" value={formatNumber(overview.openRooms)} icon={Users} tone="bg-emerald-600" />
              <SummaryCard title="活跃房间" value={formatNumber(overview.activeRooms)} icon={ShieldCheck} tone="bg-cyan-600" />
              <SummaryCard title="进行中对局" value={formatNumber(overview.activeMatches)} icon={Activity} tone="bg-slate-800" />
              <SummaryCard title="卡住信号" value={formatNumber(overview.stalledRooms)} icon={AlertTriangle} tone="bg-amber-500" />
              <SummaryCard title="近 7 天对局" value={formatNumber(overview.matches7d)} icon={History} tone="bg-indigo-600" />
              <SummaryCard title="近 7 天聊天" value={formatNumber(overview.chatMessages7d)} icon={MessageSquareText} tone="bg-rose-600" />
            </div>
          ) : null}

          <div className="grid gap-6 xl:grid-cols-2">
            <section className="rounded-3xl border border-white/70 bg-white/90 p-4 shadow-sm backdrop-blur">
              <SectionHeader
                title="房间巡检"
                note="筛选异常房间，进入详情后可执行重开、清理和恢复操作。"
                action={
                  <button
                    type="button"
                    onClick={triggerSearch}
                    className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
                  >
                    <Search className="h-4 w-4" />
                    查询
                  </button>
                }
              />

              <div className="mb-4 grid gap-3 md:grid-cols-2">
                <input
                  value={roomFilters.roomSearch}
                  onChange={(event) => setRoomFilters((prev) => ({ ...prev, roomSearch: event.target.value }))}
                  placeholder="房间 ID / 房主 / matchId"
                  className="rounded-2xl border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-slate-400"
                />
                <select
                  value={roomFilters.roomStatus}
                  onChange={(event) => setRoomFilters((prev) => ({ ...prev, roomStatus: event.target.value as RoomFiltersState['roomStatus'] }))}
                  className="rounded-2xl border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-slate-400"
                >
                  <option value="all">全部状态</option>
                  <option value="open">仅开放</option>
                  <option value="closed">仅关闭</option>
                </select>
                <select
                  value={roomFilters.roomPhase}
                  onChange={(event) => setRoomFilters((prev) => ({ ...prev, roomPhase: event.target.value }))}
                  className="rounded-2xl border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-slate-400"
                >
                  <option value="all">全部 phase</option>
                  <option value="waiting">waiting</option>
                  <option value="submitting">submitting</option>
                  <option value="choosing">choosing</option>
                  <option value="voting">voting</option>
                  <option value="reviewing">reviewing</option>
                  <option value="resolving">resolving</option>
                  <option value="advancing">advancing</option>
                  <option value="finished">finished</option>
                  <option value="aborted">aborted</option>
                  <option value="closed">closed</option>
                </select>
                <label className="flex items-center gap-2 rounded-2xl border border-slate-200 px-3 py-2 text-sm text-slate-600">
                  <input
                    type="checkbox"
                    checked={roomFilters.roomStalledOnly}
                    onChange={(event) => setRoomFilters((prev) => ({ ...prev, roomStalledOnly: event.target.checked }))}
                  />
                  仅看长时间无活动
                </label>
              </div>

              <div className="mb-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={triggerSearch}
                  className="inline-flex items-center gap-2 rounded-2xl border border-slate-900 bg-slate-900 px-3 py-2 text-sm text-white hover:bg-slate-800"
                >
                  <Search className="h-4 w-4" />
                  应用筛选
                </button>
                <button
                  type="button"
                  onClick={resetRoomFilters}
                  className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                >
                  <RotateCcw className="h-4 w-4" />
                  重置房间筛选
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-4 py-3">房间</th>
                      <th className="px-4 py-3">状态</th>
                      <th className="px-4 py-3">人数</th>
                      <th className="px-4 py-3">空闲</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {successData?.rooms.items.length ? (
                      successData.rooms.items.map((room) => (
                        <tr
                          key={room.id}
                          className={`cursor-pointer transition hover:bg-slate-50 ${selectedRoomId === room.id ? 'bg-amber-50/70' : ''}`}
                          onClick={() => {
                            setSelectedRoomId(room.id);
                            setSelectedMatchId(null);
                            void load(true, { roomId: room.id, matchId: null });
                          }}
                        >
                          <td className="px-4 py-3 align-top">
                            <div className="font-medium text-slate-900">{room.id}</div>
                            <div className="mt-1 text-xs text-slate-500">
                              房主：{room.hostUsername ?? '—'}#{room.hostUserId}
                              {room.hostPrefix ? ` · ${room.hostPrefix}` : ''}
                            </div>
                            <div className="mt-2 flex flex-wrap gap-1">
                              <TinyBadge label={room.hasPassword ? '私密房' : '公开房'} />
                              {room.issueTags.map((tag) => (
                                <TinyBadge key={tag} label={tag} tone="border-amber-200 bg-amber-50 text-amber-700" />
                              ))}
                            </div>
                          </td>
                          <td className="px-4 py-3 align-top text-xs text-slate-600">
                            <div className="mb-1">
                              <TinyBadge label={`status: ${room.status}`} tone={statusTone(room.status)} />
                            </div>
                            <div className="mb-1">
                              <TinyBadge label={`phase: ${room.phase}`} tone={phaseTone(room.phase)} />
                            </div>
                            <div>match: {room.currentMatchId ?? '—'}</div>
                            <div>round: {room.latestRoundIndex ?? '—'}</div>
                          </td>
                          <td className="px-4 py-3 align-top text-xs text-slate-600">
                            <div>成员 {formatNumber(room.playerCount)}</div>
                            <div>玩家 {formatNumber(room.participantCount)}</div>
                            <div>观众 {formatNumber(room.spectatorCount)}</div>
                            <div>聊天 {formatNumber(room.chatMessageCount)}</div>
                          </td>
                          <td className="px-4 py-3 align-top text-xs text-slate-600">
                            <div className={room.isStalled ? 'font-medium text-amber-700' : ''}>{formatDurationMinutes(room.idleMinutes)}</div>
                            <div>last: {formatDateTime(room.lastActivityAt)}</div>
                            <div>updated: {formatDateTime(room.updatedAt)}</div>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={4} className="px-4 py-8">
                          <EmptyState text="当前筛选条件下没有房间。" />
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {successData?.rooms ? (
                <div className="mt-4 flex items-center justify-between text-sm text-slate-500">
                  <span>
                    共 {formatNumber(successData.rooms.total)} 条，当前第 {successData.rooms.page} 页
                  </span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={successData.rooms.page <= 1}
                      onClick={() => applyRoomPage(successData.rooms.page - 1)}
                      className="rounded-xl border border-slate-200 px-3 py-1.5 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      上一页
                    </button>
                    <button
                      type="button"
                      disabled={successData.rooms.page * successData.rooms.limit >= successData.rooms.total}
                      onClick={() => applyRoomPage(successData.rooms.page + 1)}
                      className="rounded-xl border border-slate-200 px-3 py-1.5 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      下一页
                    </button>
                  </div>
                </div>
              ) : null}
            </section>

            <section className="rounded-3xl border border-white/70 bg-white/90 p-4 shadow-sm backdrop-blur">
              <SectionHeader
                title="历史对局检索"
                note="支持按 matchId / roomId / 玩家检索，对卡住对局可回看上下文。"
                action={
                  <button
                    type="button"
                    onClick={triggerSearch}
                    className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
                  >
                    <Search className="h-4 w-4" />
                    查询
                  </button>
                }
              />

              <div className="mb-4 grid gap-3 md:grid-cols-2">
                <input
                  value={matchFilters.matchSearch}
                  onChange={(event) => setMatchFilters((prev) => ({ ...prev, matchSearch: event.target.value }))}
                  placeholder="matchId / roomId / 玩家"
                  className="rounded-2xl border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-slate-400"
                />
                <select
                  value={matchFilters.matchStatus}
                  onChange={(event) => setMatchFilters((prev) => ({ ...prev, matchStatus: event.target.value as MatchFiltersState['matchStatus'] }))}
                  className="rounded-2xl border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-slate-400"
                >
                  <option value="all">全部状态</option>
                  <option value="active">active</option>
                  <option value="completed">completed</option>
                  <option value="aborted">aborted</option>
                </select>
                <input
                  value={matchFilters.matchRoomId}
                  onChange={(event) => setMatchFilters((prev) => ({ ...prev, matchRoomId: event.target.value }))}
                  placeholder="限定 roomId"
                  className="rounded-2xl border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-slate-400"
                />
                <input
                  value={matchFilters.matchUserId}
                  onChange={(event) => setMatchFilters((prev) => ({ ...prev, matchUserId: event.target.value }))}
                  placeholder="限定 userId"
                  className="rounded-2xl border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-slate-400"
                />
              </div>

              <div className="mb-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={triggerSearch}
                  className="inline-flex items-center gap-2 rounded-2xl border border-slate-900 bg-slate-900 px-3 py-2 text-sm text-white hover:bg-slate-800"
                >
                  <Search className="h-4 w-4" />
                  应用筛选
                </button>
                <button
                  type="button"
                  onClick={resetMatchFilters}
                  className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                >
                  <RotateCcw className="h-4 w-4" />
                  重置对局筛选
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-4 py-3">对局</th>
                      <th className="px-4 py-3">状态</th>
                      <th className="px-4 py-3">参与人数</th>
                      <th className="px-4 py-3">时间</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {successData?.matches.items.length ? (
                      successData.matches.items.map((match) => (
                        <tr
                          key={match.id}
                          className={`cursor-pointer transition hover:bg-slate-50 ${selectedMatchId === match.id ? 'bg-cyan-50/70' : ''}`}
                          onClick={() => {
                            setSelectedMatchId(match.id);
                            setSelectedRoomId(match.roomId);
                            void load(true, { roomId: match.roomId, matchId: match.id });
                          }}
                        >
                          <td className="px-4 py-3 align-top">
                            <div className="font-medium text-slate-900">{match.id}</div>
                            <div className="mt-1 text-xs text-slate-500">room: {match.roomId}</div>
                            <div className="mt-1 text-xs text-slate-500">winner: {match.winnerUsername ?? '—'}</div>
                          </td>
                          <td className="px-4 py-3 align-top text-xs text-slate-600">
                            <div className="mb-1">
                              <TinyBadge label={match.status} tone={statusTone(match.status)} />
                            </div>
                            <div>room: {match.roomPhase ?? '—'}</div>
                            <div>rounds: {formatNumber(match.roundsCount)}</div>
                          </td>
                          <td className="px-4 py-3 align-top text-xs text-slate-600">{formatNumber(match.participants)}</td>
                          <td className="px-4 py-3 align-top text-xs text-slate-600">
                            <div>start: {formatDateTime(match.startedAt)}</div>
                            <div>end: {formatDateTime(match.endedAt)}</div>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={4} className="px-4 py-8">
                          <EmptyState text="当前筛选条件下没有对局记录。" />
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {successData?.matches ? (
                <div className="mt-4 flex items-center justify-between text-sm text-slate-500">
                  <span>
                    共 {formatNumber(successData.matches.total)} 条，当前第 {successData.matches.page} 页
                  </span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={successData.matches.page <= 1}
                      onClick={() => applyMatchPage(successData.matches.page - 1)}
                      className="rounded-xl border border-slate-200 px-3 py-1.5 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      上一页
                    </button>
                    <button
                      type="button"
                      disabled={successData.matches.page * successData.matches.limit >= successData.matches.total}
                      onClick={() => applyMatchPage(successData.matches.page + 1)}
                      className="rounded-xl border border-slate-200 px-3 py-1.5 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      下一页
                    </button>
                  </div>
                </div>
              ) : null}
            </section>
          </div>

          <div className="mt-6 grid gap-6">
            <section className="rounded-3xl border border-white/70 bg-white/92 p-5 shadow-sm backdrop-blur">
              <SectionHeader
                title="房间详情与干预"
                note={selectedRoomId ? '聚焦房间运行时、成员、回合与聊天审计。' : '从上方房间表中选中一条房间记录后，可在这里查看详情并执行干预。'}
                action={
                  roomDetail ? (
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => exportCsv('roomChats', roomDetail.room.id)}
                        className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                      >
                        <MessageSquareText className="h-4 w-4" />
                        导出聊天审计
                      </button>
                      <button
                        type="button"
                        onClick={() => exportCsv('roomRounds', roomDetail.room.id)}
                        className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                      >
                        <History className="h-4 w-4" />
                        导出回合轨迹
                      </button>
                    </div>
                  ) : null
                }
              />

              {roomDetail ? (
                <>
                  <div className="mb-5 grid gap-4 xl:grid-cols-[1.6fr_1fr]">
                    <div className="rounded-3xl border border-slate-200 bg-slate-50/70 p-4">
                      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="text-xl font-semibold text-slate-900">{roomDetail.room.id}</div>
                          <div className="mt-1 text-sm text-slate-500">
                            房主：{roomDetail.room.hostUsername ?? '—'}#{roomDetail.room.hostUserId}
                            {roomDetail.room.hostPrefix ? ` · ${roomDetail.room.hostPrefix}` : ''}
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <TinyBadge label={`status: ${roomDetail.room.status}`} tone={statusTone(roomDetail.room.status)} />
                          <TinyBadge label={`phase: ${roomDetail.room.phase}`} tone={phaseTone(roomDetail.room.phase)} />
                          <TinyBadge label={`version: ${roomDetail.room.version}`} />
                        </div>
                      </div>

                      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                        <div className="rounded-2xl border border-white bg-white px-3 py-3">
                          <div className="text-xs uppercase tracking-wide text-slate-500">当前对局</div>
                          <div className="mt-2 text-sm font-medium text-slate-900">{roomDetail.room.currentMatchId ?? '—'}</div>
                          <div className="mt-1 text-xs text-slate-500">{roomDetail.room.currentMatchStatus ?? '无进行中对局'}</div>
                        </div>
                        <div className="rounded-2xl border border-white bg-white px-3 py-3">
                          <div className="text-xs uppercase tracking-wide text-slate-500">成员结构</div>
                          <div className="mt-2 text-sm font-medium text-slate-900">
                            玩家 {roomDetail.room.participantCount} / 观众 {roomDetail.room.spectatorCount}
                          </div>
                          <div className="mt-1 text-xs text-slate-500">总成员 {roomDetail.room.playerCount}</div>
                        </div>
                        <div className="rounded-2xl border border-white bg-white px-3 py-3">
                          <div className="text-xs uppercase tracking-wide text-slate-500">最近活动</div>
                          <div className="mt-2 text-sm font-medium text-slate-900">{formatDurationMinutes(roomDetail.diagnostics.idleMinutes)}</div>
                          <div className="mt-1 text-xs text-slate-500">{formatDateTime(roomDetail.room.lastActivityAt)}</div>
                        </div>
                        <div className="rounded-2xl border border-white bg-white px-3 py-3">
                          <div className="text-xs uppercase tracking-wide text-slate-500">聊天累计</div>
                          <div className="mt-2 text-sm font-medium text-slate-900">{formatNumber(roomDetail.room.chatMessageCount)}</div>
                          <div className="mt-1 text-xs text-slate-500">最新更新时间 {formatDateTime(roomDetail.room.updatedAt)}</div>
                        </div>
                      </div>

                      <div className="mt-4 flex flex-wrap gap-2">
                        {roomDetail.diagnostics.issueTags.length ? (
                          roomDetail.diagnostics.issueTags.map((tag) => (
                            <TinyBadge key={tag} label={tag} tone="border-amber-200 bg-amber-50 text-amber-700" />
                          ))
                        ) : (
                          <TinyBadge label="当前未发现明显异常" tone="border-emerald-200 bg-emerald-50 text-emerald-700" />
                        )}
                      </div>

                      {roomDetail.rulesSummary ? (
                        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                          <div className="rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-600">
                            <div className="text-xs uppercase tracking-wide text-slate-500">模式</div>
                            <div className="mt-2 font-medium text-slate-900">{roomDetail.rulesSummary.mode}</div>
                            <div className="mt-1">participants: {roomDetail.rulesSummary.participants}</div>
                          </div>
                          <div className="rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-600">
                            <div className="text-xs uppercase tracking-wide text-slate-500">发牌规则</div>
                            <div className="mt-2">submission: {roomDetail.rulesSummary.submissionMode}</div>
                            <div>cards/player: {roomDetail.rulesSummary.cardsPerPlayer}</div>
                            <div>deal/player: {roomDetail.rulesSummary.dealPerPlayer}</div>
                          </div>
                          <div className="rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-600">
                            <div className="text-xs uppercase tracking-wide text-slate-500">生成控制</div>
                            <div className="mt-2">generation: {roomDetail.rulesSummary.generationMode}</div>
                            <div>storyLength: {roomDetail.rulesSummary.storyLength}</div>
                            <div>language: {roomDetail.rulesSummary.language || '默认'}</div>
                          </div>
                          <div className="rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-600">
                            <div className="text-xs uppercase tracking-wide text-slate-500">权限</div>
                            <div className="mt-2">观战: {roomDetail.rulesSummary.allowSpectators ? '开启' : '关闭'}</div>
                            <div>观众聊天: {roomDetail.rulesSummary.allowSpectatorChat ? '允许' : '禁止'}</div>
                            <div>非房主控制: {roomDetail.rulesSummary.allowNonHostControl ? '允许' : '禁止'}</div>
                          </div>
                        </div>
                      ) : null}
                    </div>

                    <div className="rounded-3xl border border-slate-200 bg-white p-4">
                      <div className="mb-3 flex items-center gap-2 text-slate-900">
                        <Wrench className="h-4 w-4" />
                        <span className="font-semibold">干预动作</span>
                      </div>

                      {roomDetail.diagnostics.pendingAction ? (
                        <div className="mb-3 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-800">
                          最后一名玩家未{pendingActionLabel(roomDetail.diagnostics.pendingAction.kind)}：
                          {roomDetail.diagnostics.pendingAction.pendingUsername ?? `#${roomDetail.diagnostics.pendingAction.pendingUserId}`}
                          ，剩余 {roomDetail.diagnostics.pendingAction.secondsLeft} 秒
                          {roomDetail.diagnostics.pendingAction.canForce
                            ? `（已超时 ${roomDetail.diagnostics.pendingAction.overdueSeconds} 秒，可强制）`
                            : '（倒计时未结束）'}
                        </div>
                      ) : null}

                      {roomDetail.diagnostics.resolvingStuck ? (
                        <div className="mb-3 rounded-2xl border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-700">
                          房间处于 resolving 且已空转 {formatDurationMinutes(roomDetail.diagnostics.idleMinutes)}，建议先执行“解除结算锁”。
                        </div>
                      ) : null}

                      <div className="flex flex-col gap-2">
                        <button
                          type="button"
                          disabled={!forceActionPayload(roomDetail) || busyAction !== null}
                          onClick={() => void runAction(forceActionPayload(roomDetail))}
                          className="inline-flex items-center justify-center gap-2 rounded-2xl border border-amber-300 bg-amber-500 px-3 py-2 text-sm text-white hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <Zap className="h-4 w-4" />
                          强制推进最后一步
                        </button>
                        <button
                          type="button"
                          disabled={!roomDetail.diagnostics.resolvingStuck || busyAction !== null}
                          onClick={() =>
                            void runAction({
                              action: 'recoverResolving',
                              roomId: roomDetail.room.id,
                              expectedVersion: roomDetail.room.version,
                            })
                          }
                          className="inline-flex items-center justify-center gap-2 rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <AlertTriangle className="h-4 w-4" />
                          解除结算锁
                        </button>
                        <button
                          type="button"
                          disabled={busyAction !== null}
                          onClick={() =>
                            void runAction({
                              action: 'restartRoom',
                              roomId: roomDetail.room.id,
                              expectedVersion: roomDetail.room.version,
                            })
                          }
                          className="inline-flex items-center justify-center gap-2 rounded-2xl border border-cyan-200 bg-cyan-50 px-3 py-2 text-sm text-cyan-700 hover:bg-cyan-100"
                        >
                          <RotateCcw className="h-4 w-4" />
                          强制重开房间
                        </button>
                        <button
                          type="button"
                          disabled={busyAction !== null}
                          onClick={() =>
                            void runAction({
                              action: 'closeRoom',
                              roomId: roomDetail.room.id,
                              expectedVersion: roomDetail.room.version,
                              cleanupMode: 'runtime',
                            })
                          }
                          className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-300 bg-slate-900 px-3 py-2 text-sm text-white hover:bg-slate-800"
                        >
                          <XCircle className="h-4 w-4" />
                          关闭房间并清理运行时
                        </button>
                        <button
                          type="button"
                          disabled={busyAction !== null}
                          onClick={() =>
                            void runAction({
                              action: 'clearRoomEphemeral',
                              roomId: roomDetail.room.id,
                            })
                          }
                          className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                        >
                          <Eraser className="h-4 w-4" />
                          清理聊天与临时态
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const nextMatchFilters = { ...matchFilters, matchRoomId: roomDetail.room.id, matchPage: 1 };
                            setMatchFilters(nextMatchFilters);
                            void load(true, {
                              matchFilters: nextMatchFilters,
                              roomId: roomDetail.room.id,
                              matchId: selectedMatchId,
                            });
                          }}
                          className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                        >
                          <History className="h-4 w-4" />
                          带入该房间检索历史
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-6 xl:grid-cols-3">
                    <section className="rounded-3xl border border-slate-200 bg-slate-50/60 p-4 xl:col-span-1">
                      <SectionHeader title="成员与提交" note="快速观察谁在房间、谁已提交。" />
                      <div className="space-y-3">
                        {roomDetail.members.length ? (
                          roomDetail.members.map((member) => {
                            const submission = roomDetail.submissions.find((item) => item.userId === member.userId);
                            return (
                              <div key={`${member.roomId}-${member.userId}`} className="rounded-2xl border border-white bg-white px-3 py-3 text-sm text-slate-600">
                                <div className="flex items-center justify-between gap-2">
                                  <div className="font-medium text-slate-900">
                                    {member.username ?? '—'}#{member.userId}
                                  </div>
                                  <div className="flex gap-1">
                                    <TinyBadge label={member.role} tone={member.role === 'player' ? 'border-cyan-200 bg-cyan-50 text-cyan-700' : 'border-slate-200 bg-slate-100 text-slate-600'} />
                                    {member.seat !== null ? <TinyBadge label={`seat ${member.seat}`} /> : null}
                                  </div>
                                </div>
                                <div className="mt-2 text-xs text-slate-500">joined: {formatDateTime(member.joinedAt)}</div>
                                <div className="mt-2 text-xs text-slate-600">
                                  提交：
                                  {submission ? `${submission.cardCount} 张 · ${submission.cardNames.join(' / ') || '无预览'}` : '未提交'}
                                </div>
                              </div>
                            );
                          })
                        ) : (
                          <EmptyState text="没有成员数据。" />
                        )}
                      </div>
                    </section>

                    <section className="rounded-3xl border border-slate-200 bg-slate-50/60 p-4 xl:col-span-1">
                      <SectionHeader title="手牌与快照" note="用于排查发牌异常、卡牌快照缺失。" />
                      <div className="space-y-3">
                        {roomDetail.hands.length ? (
                          roomDetail.hands.map((hand) => (
                            <div key={hand.userId} className="rounded-2xl border border-white bg-white px-3 py-3 text-sm text-slate-600">
                              <div className="font-medium text-slate-900">{hand.username ?? `#${hand.userId}`}</div>
                              <div className="mt-2 text-xs text-slate-500">updated: {formatDateTime(hand.updatedAt)}</div>
                              <div className="mt-2">hand {hand.handCount} / discard {hand.discardedCount} / drawPile {hand.drawPileCount}</div>
                              <div className="mt-2 break-all text-xs text-slate-500">{hand.snapshotIds.slice(0, 6).join(', ') || '无当前手牌'}</div>
                            </div>
                          ))
                        ) : (
                          <EmptyState text="当前没有手牌缓存。" />
                        )}

                        <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-3 py-3 text-sm text-slate-600">
                          <div className="font-medium text-slate-900">快照缓存</div>
                          <div className="mt-2">共 {formatNumber(roomDetail.snapshots.length)} 条</div>
                          <div className="mt-2 space-y-1 text-xs text-slate-500">
                            {roomDetail.snapshots.slice(0, 6).map((snapshot) => (
                              <div key={snapshot.id}>
                                {snapshot.name} · {snapshot.cardType} · {snapshot.refLabel ?? '无 ref'}
                              </div>
                            ))}
                            {roomDetail.snapshots.length > 6 ? <div>…仅展示前 6 条</div> : null}
                          </div>
                        </div>
                      </div>
                    </section>

                    <section className="rounded-3xl border border-slate-200 bg-slate-50/60 p-4 xl:col-span-1">
                      <SectionHeader title="该房间最近对局" note="快速跳转到该房间历史。" />
                      <div className="space-y-3">
                        {roomDetail.recentMatches.length ? (
                          roomDetail.recentMatches.map((match) => (
                            <button
                              key={match.id}
                              type="button"
                              onClick={() => {
                                setSelectedMatchId(match.id);
                                setSelectedRoomId(roomDetail.room.id);
                                void load(true, { roomId: roomDetail.room.id, matchId: match.id });
                              }}
                              className="w-full rounded-2xl border border-white bg-white px-3 py-3 text-left text-sm text-slate-600 hover:bg-slate-50"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <div className="font-medium text-slate-900">{match.id}</div>
                                <TinyBadge label={match.status} tone={statusTone(match.status)} />
                              </div>
                              <div className="mt-2 text-xs text-slate-500">
                                participants {match.participants} · rounds {match.roundsCount}
                              </div>
                              <div className="mt-1 text-xs text-slate-500">
                                start {formatDateTime(match.startedAt)} · winner {match.winnerUsername ?? '—'}
                              </div>
                            </button>
                          ))
                        ) : (
                          <EmptyState text="该房间暂无历史对局。" />
                        )}
                      </div>
                    </section>
                  </div>

                  <div className="mt-6 grid gap-6 xl:grid-cols-[1.3fr_0.9fr]">
                    <section className="rounded-3xl border border-slate-200 bg-white p-4">
                      <SectionHeader title="回合轨迹" note="查看 round 状态、选择与结果体积，可用于定位卡在何处。" />
                      {roomDetail.rounds.length ? (
                        <div className="overflow-x-auto">
                          <table className="min-w-full text-left text-sm">
                            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                              <tr>
                                <th className="px-4 py-3">回合</th>
                                <th className="px-4 py-3">状态</th>
                                <th className="px-4 py-3">选择</th>
                                <th className="px-4 py-3">结果</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {roomDetail.rounds.map((round) => (
                                <tr key={round.id}>
                                  <td className="px-4 py-3 align-top">
                                    <div className="font-medium text-slate-900">#{round.roundIndex}</div>
                                    <div className="mt-1 text-xs break-all text-slate-500">{round.id}</div>
                                    <div className="mt-1 text-xs text-slate-500">created: {formatDateTime(round.createdAt)}</div>
                                  </td>
                                  <td className="px-4 py-3 align-top text-xs text-slate-600">
                                    <div className="mb-1">
                                      <TinyBadge label={round.status} tone={phaseTone(round.status)} />
                                    </div>
                                    <div>winner: {round.winnerName ?? '—'}</div>
                                    <div>generation: {round.battleGenerationId ?? '—'}</div>
                                  </td>
                                  <td className="px-4 py-3 align-top text-xs text-slate-600">
                                    <div>{formatNumber(round.choiceCount)} 条</div>
                                    <div className="mt-1 space-y-1">
                                      {round.choices.slice(0, 3).map((choice) => (
                                        <div key={`${round.id}-${choice.userId}`}>
                                          {choice.username ?? `#${choice.userId}`}: {choice.snapshotName ?? choice.snapshotId ?? '—'}
                                        </div>
                                      ))}
                                      {round.choices.length > 3 ? <div>…更多 {round.choices.length - 3} 条</div> : null}
                                    </div>
                                  </td>
                                  <td className="px-4 py-3 align-top text-xs text-slate-600">
                                    <div>result: {resultBytesLabel(round.resultJson)}</div>
                                    <div>publicSnapshot: {resultBytesLabel(round.publicSnapshotJson)}</div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <EmptyState text="该房间暂无回合数据。" />
                      )}
                    </section>

                    <section className="rounded-3xl border border-slate-200 bg-white p-4">
                      <SectionHeader title="聊天审计" note="查看房间消息流，便于处理纠纷或异常聊天。" />
                      {roomDetail.chatMessages.length ? (
                        <div className="space-y-3">
                          {roomDetail.chatMessages.map((message) => (
                            <div key={message.id} className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-600">
                              <div className="flex items-center justify-between gap-2">
                                <div className="font-medium text-slate-900">
                                  {message.senderUsername ?? `#${message.senderUserId}`} · {message.senderRole}
                                </div>
                                <div className="text-xs text-slate-500">{formatDateTime(message.createdAt)}</div>
                              </div>
                              <div className="mt-2 text-sm text-slate-700">{message.renderedText ?? '—'}</div>
                              <div className="mt-2 text-xs text-slate-500">
                                sticker: {message.stickerId ?? '—'} · emoji: {message.emojiText ?? '—'}
                              </div>
                              <details className="mt-2 text-xs text-slate-500">
                                <summary className="cursor-pointer">查看原始 content_json</summary>
                                <pre className="mt-2 overflow-x-auto rounded-xl bg-white p-2 text-[11px] leading-5 text-slate-600">
                                  {message.contentJson}
                                </pre>
                              </details>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <EmptyState text="该房间暂无聊天消息。" />
                      )}
                    </section>
                  </div>

                  <details className="mt-6 rounded-3xl border border-slate-200 bg-slate-50 px-4 py-4">
                    <summary className="cursor-pointer text-sm font-medium text-slate-700">查看原始 rules_json</summary>
                    <pre className="mt-3 overflow-x-auto rounded-2xl bg-white p-3 text-xs leading-6 text-slate-600">
                      {roomDetail.rulesJson}
                    </pre>
                  </details>
                </>
              ) : (
                <EmptyState text="未选择房间。先从左侧房间列表中选择一条记录。" />
              )}
            </section>

            <section className="rounded-3xl border border-white/70 bg-white/92 p-5 shadow-sm backdrop-blur">
              <SectionHeader
                title="对局详情"
                note={selectedMatchId ? '回看某场对局的参与者和回合结果。' : '从上方对局表中选择一条记录后，这里会展示该场对局详情。'}
              />

              {matchDetail ? (
                <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
                  <div className="rounded-3xl border border-slate-200 bg-slate-50/70 p-4">
                    <div className="mb-3 flex items-start justify-between gap-3">
                      <div>
                        <div className="text-xl font-semibold text-slate-900">{matchDetail.match.id}</div>
                        <div className="mt-1 text-sm text-slate-500">room: {matchDetail.match.roomId}</div>
                      </div>
                      <TinyBadge label={matchDetail.match.status} tone={statusTone(matchDetail.match.status)} />
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="rounded-2xl border border-white bg-white px-3 py-3 text-sm text-slate-600">
                        <div className="text-xs uppercase tracking-wide text-slate-500">时间</div>
                        <div className="mt-2">start: {formatDateTime(matchDetail.match.startedAt)}</div>
                        <div>end: {formatDateTime(matchDetail.match.endedAt)}</div>
                      </div>
                      <div className="rounded-2xl border border-white bg-white px-3 py-3 text-sm text-slate-600">
                        <div className="text-xs uppercase tracking-wide text-slate-500">结果</div>
                        <div className="mt-2">participants: {matchDetail.match.participants}</div>
                        <div>rounds: {matchDetail.match.roundsCount}</div>
                        <div>winner: {matchDetail.match.winnerUsername ?? '—'}</div>
                      </div>
                    </div>

                    <div className="mt-4">
                      <div className="mb-2 text-sm font-medium text-slate-900">参战者</div>
                      <div className="space-y-2">
                        {matchDetail.players.map((player) => (
                          <div key={`${player.matchId}-${player.userId}`} className="rounded-2xl border border-white bg-white px-3 py-3 text-sm text-slate-600">
                            <div className="font-medium text-slate-900">
                              seat {player.seat} · {player.username ?? '—'}#{player.userId}
                            </div>
                            <div className="mt-1 text-xs text-slate-500">joined: {formatDateTime(player.joinedAt)}</div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {matchDetail.matchRulesJson ? (
                      <details className="mt-4 rounded-2xl border border-slate-200 bg-white px-3 py-3">
                        <summary className="cursor-pointer text-sm font-medium text-slate-700">查看 match rules_json</summary>
                        <pre className="mt-3 overflow-x-auto text-xs leading-6 text-slate-600">{matchDetail.matchRulesJson}</pre>
                      </details>
                    ) : null}
                  </div>

                  <div className="rounded-3xl border border-slate-200 bg-white p-4">
                    <SectionHeader title="该场回合结果" note="用于回放对局推进顺序和结果落库情况。" />
                    {matchDetail.rounds.length ? (
                      <div className="overflow-x-auto">
                        <table className="min-w-full text-left text-sm">
                          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                            <tr>
                              <th className="px-4 py-3">回合</th>
                              <th className="px-4 py-3">状态</th>
                              <th className="px-4 py-3">胜者</th>
                              <th className="px-4 py-3">结果大小</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {matchDetail.rounds.map((round) => (
                              <tr key={round.id}>
                                <td className="px-4 py-3 align-top">
                                  <div className="font-medium text-slate-900">#{round.roundIndex}</div>
                                  <div className="mt-1 text-xs break-all text-slate-500">{round.id}</div>
                                </td>
                                <td className="px-4 py-3 align-top text-xs text-slate-600">
                                  <div className="mb-1">
                                    <TinyBadge label={round.status} tone={phaseTone(round.status)} />
                                  </div>
                                  <div>generation: {round.battleGenerationId ?? '—'}</div>
                                </td>
                                <td className="px-4 py-3 align-top text-xs text-slate-600">{round.winnerName ?? '—'}</td>
                                <td className="px-4 py-3 align-top text-xs text-slate-600">
                                  <div>result: {resultBytesLabel(round.resultJson)}</div>
                                  <div>snapshot: {resultBytesLabel(round.publicSnapshotJson)}</div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <EmptyState text="该场对局暂无回合记录。" />
                    )}
                  </div>
                </div>
              ) : (
                <EmptyState text="未选择对局。先从右侧对局列表中选择一条记录。" />
              )}
            </section>
          </div>
        </div>
      </div>
    </>
  );
}
