import React, { useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { Activity, AlertTriangle, MessageSquareText, RefreshCw, ShieldCheck, Users } from 'lucide-react';

type AdminPvpOverview = {
  openRooms: number;
  activeRooms: number;
  stalledRooms: number;
  activeMatches: number;
  matches7d: number;
  chatMessages7d: number;
};

type AdminPvpRoomRow = {
  id: string;
  status: string;
  phase: string;
  hostUserId: number;
  hostUsername: string | null;
  hostPrefix: string | null;
  currentMatchId: string | null;
  hasPassword: boolean;
  playerCount: number;
  participantCount: number;
  spectatorCount: number;
  chatMessageCount: number;
  createdAt: string | null;
  updatedAt: string | null;
  lastActivityAt: string | null;
};

type AdminPvpMatchRow = {
  id: string;
  roomId: string;
  status: string;
  participants: number;
  roundsCount: number;
  startedAt: string | null;
  endedAt: string | null;
  winnerUserId: number | null;
  winnerUsername: string | null;
};

type ApiResponse =
  | {
      success: true;
      overview: AdminPvpOverview;
      activeRooms: AdminPvpRoomRow[];
      recentMatches: AdminPvpMatchRow[];
    }
  | { success: false; error?: string };

const formatNumber = (value: number): string => value.toLocaleString('zh-CN');

const formatDateTime = (value: string | null | undefined): string => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', { hour12: false });
};

function SummaryCard(props: {
  title: string;
  value: string;
  note?: string;
  icon: React.ElementType;
  color: string;
}) {
  const { title, value, note, icon: Icon, color } = props;
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-3">
        <div className={`flex h-10 w-10 items-center justify-center rounded-full ${color}`}>
          <Icon className="h-5 w-5 text-white" />
        </div>
        <div>
          <p className="text-sm font-medium text-slate-600">{title}</p>
          <p className="text-2xl font-semibold text-slate-900">{value}</p>
        </div>
      </div>
      {note ? <p className="text-xs text-slate-500">{note}</p> : null}
    </div>
  );
}

export default function AdminPvpPage() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async (showRefreshing = false) => {
    if (showRefreshing) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/admin/pvp');
      const json = (await response.json()) as ApiResponse;
      if (!response.ok || json.success !== true) {
        throw new Error(json.success === false ? json.error || '读取 PVP 后台数据失败' : '读取 PVP 后台数据失败');
      }
      setData(json);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '读取 PVP 后台数据失败');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const overview = data?.overview;

  return (
    <>
      <Head>
        <title>PVP 只读后台 - Admin</title>
      </Head>

      <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(16,185,129,0.12),_transparent_32%),linear-gradient(180deg,_#f8fafc_0%,_#ecfdf5_100%)] p-4 sm:p-6">
        <div className="mx-auto max-w-7xl">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <Link href="/admin" className="text-sm text-emerald-700 hover:underline">
                ← 返回管理后台主页
              </Link>
              <h1 className="mt-3 text-3xl font-semibold text-slate-900">PVP 只读后台</h1>
              <p className="mt-1 text-sm text-slate-600">
                首版仅提供观测与审计，不提供房间干预。重点看活跃房间、卡住信号、最近对局与聊天密度。
              </p>
            </div>
            <button
              type="button"
              onClick={() => void load(true)}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm hover:bg-slate-50"
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
              刷新
            </button>
          </div>

          {error ? (
            <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          ) : null}

          {loading && !data ? (
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-500">正在读取 PVP 后台数据…</div>
          ) : null}

          {overview ? (
            <div className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-6">
              <SummaryCard title="开放房间" value={formatNumber(overview.openRooms)} icon={Users} color="bg-emerald-600" />
              <SummaryCard title="活跃房间" value={formatNumber(overview.activeRooms)} icon={ShieldCheck} color="bg-teal-600" />
              <SummaryCard title="进行中对局" value={formatNumber(overview.activeMatches)} icon={Activity} color="bg-slate-700" />
              <SummaryCard title="卡住信号" value={formatNumber(overview.stalledRooms)} icon={AlertTriangle} color="bg-orange-600" />
              <SummaryCard title="近 7 天对局" value={formatNumber(overview.matches7d)} icon={Activity} color="bg-cyan-700" />
              <SummaryCard title="近 7 天聊天" value={formatNumber(overview.chatMessages7d)} icon={MessageSquareText} color="bg-indigo-700" />
            </div>
          ) : null}

          <div className="grid gap-6 xl:grid-cols-2">
            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="mb-4 text-lg font-semibold text-slate-900">活跃房间</h2>
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-4 py-3">房间</th>
                      <th className="px-4 py-3">状态</th>
                      <th className="px-4 py-3">人数</th>
                      <th className="px-4 py-3">最近活动</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data?.activeRooms.length ? (
                      data.activeRooms.map((room) => (
                        <tr key={room.id}>
                          <td className="px-4 py-3 align-top">
                            <div className="font-medium text-slate-900">{room.id}</div>
                            <div className="mt-1 text-xs text-slate-500">
                              房主：{room.hostUsername ?? '—'}#{room.hostUserId}
                              {room.hostPrefix ? ` · ${room.hostPrefix}` : ''}
                            </div>
                            <div className="mt-1 text-xs text-slate-500">{room.hasPassword ? '私密房间' : '公开房间'}</div>
                          </td>
                          <td className="px-4 py-3 align-top text-xs text-slate-600">
                            <div>status: {room.status}</div>
                            <div>phase: {room.phase}</div>
                            <div>match: {room.currentMatchId ?? '—'}</div>
                          </td>
                          <td className="px-4 py-3 align-top text-xs text-slate-600">
                            <div>总成员 {formatNumber(room.playerCount)}</div>
                            <div>玩家 {formatNumber(room.participantCount)}</div>
                            <div>旁观 {formatNumber(room.spectatorCount)}</div>
                            <div>聊天 {formatNumber(room.chatMessageCount)}</div>
                          </td>
                          <td className="px-4 py-3 align-top text-xs text-slate-600">
                            <div>last_activity {formatDateTime(room.lastActivityAt)}</div>
                            <div>updated_at {formatDateTime(room.updatedAt)}</div>
                            <div>created_at {formatDateTime(room.createdAt)}</div>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={4} className="px-4 py-8 text-center text-slate-500">
                          当前没有可展示的活跃房间
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="mb-4 text-lg font-semibold text-slate-900">最近对局</h2>
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
                    {data?.recentMatches.length ? (
                      data.recentMatches.map((match) => (
                        <tr key={match.id}>
                          <td className="px-4 py-3 align-top">
                            <div className="font-medium text-slate-900">{match.id}</div>
                            <div className="mt-1 text-xs text-slate-500">room: {match.roomId}</div>
                            <div className="mt-1 text-xs text-slate-500">winner: {match.winnerUsername ?? '—'}</div>
                          </td>
                          <td className="px-4 py-3 align-top text-xs text-slate-600">
                            <div>{match.status}</div>
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
                        <td colSpan={4} className="px-4 py-8 text-center text-slate-500">
                          当前没有可展示的对局记录
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        </div>
      </div>
    </>
  );
}
