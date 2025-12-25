'use client';

import { useMemo, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useMutation, useQuery } from '@tanstack/react-query';

import BattleReportCard, { type NewsReport } from '@/components/BattleReportCard';
import Footer from '@/components/Footer';
import { authStorage } from '@/lib/auth';
import { useAuth } from '@/lib/useAuth';

type BattleReportRecord = {
  id: string;
  startedAt: string;
  status: 'completed' | 'aborted' | 'failed' | string;
  endpoint: string;
  generationMode: 'stream' | 'non-stream' | string;
  mode: string;
  headline: string | null;
  winner: string | null;
  outputPreview: string | null;
  pvpRoomId: string | null;
  pvpMatchId: string | null;
  pvpRoundId: string | null;
};

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
  status: 'active' | 'completed' | 'aborted' | string;
  startedAt: string;
  endedAt: string | null;
  winnerUserId: number | null;
  players: Array<{ userId: number; seat: number; username: string | null; prefix: string | null }>;
};

const formatUserLabel = (p: { userId: number; username: string | null; prefix: string | null }) => {
  const prefix = p.prefix ? `${p.prefix} ` : '';
  const username = p.username ? p.username : `用户${p.userId}`;
  return `${prefix}${username}`;
};

export function MePage() {
  const { user, isAuthenticated, loading } = useAuth();
  const [tab, setTab] = useState<'reports' | 'pvp' | 'settings'>('reports');
  const [generated, setGenerated] = useState<{ report: NewsReport; generationId?: string } | null>(null);

  const reportsQuery = useQuery({
    queryKey: ['me', 'battle-reports'],
    enabled: Boolean(isAuthenticated),
    queryFn: async (): Promise<{ records: BattleReportRecord[] }> => {
      const authHeader = await authStorage.getAuthHeader();
      if (!authHeader) throw new Error('未登录');
      const res = await fetch('/api/me/battle-reports', { headers: { Authorization: authHeader } });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '加载战报记录失败');
      return data;
    },
  });

  const pvpQuery = useQuery({
    queryKey: ['me', 'pvp'],
    enabled: Boolean(isAuthenticated),
    queryFn: async (): Promise<{ summary: PvpUserSummary; recentMatches: PvpMatchItem[] }> => {
      const authHeader = await authStorage.getAuthHeader();
      if (!authHeader) throw new Error('未登录');
      const res = await fetch('/api/me/pvp', { headers: { Authorization: authHeader } });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '加载 PVP 战绩失败');
      return data;
    },
  });

  const regenerateMutation = useMutation({
    mutationFn: async (generationId: string) => {
      const authHeader = await authStorage.getAuthHeader();
      if (!authHeader) throw new Error('未登录');
      const res = await fetch(`/api/me/battle-reports/${generationId}/regenerate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: authHeader },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '重新生成失败');
      return data as { report: NewsReport; generationId?: string };
    },
    onSuccess: (data) => {
      setGenerated({ report: data.report, generationId: data.generationId });
      setTab('reports');
    },
  });

  const retentionNotice = (
    <div className="p-3 rounded-md bg-yellow-50 border border-yellow-200 text-sm text-yellow-900">
      提示：受资源限制，战报记录与 PVP 记录 <span className="font-semibold">随时可能被清理</span>，不保证长期保存。建议你及时保存战报卡片图片/Markdown 作为留档。
    </div>
  );

  const winRate = useMemo(() => {
    const summary = pvpQuery.data?.summary;
    if (!summary) return null;
    const total = summary.wins + summary.losses + summary.draws;
    if (total <= 0) return '0%';
    return `${Math.round((summary.wins / total) * 100)}%`;
  }, [pvpQuery.data?.summary]);

  return (
    <>
      <Head>
        <title>个人页 - MahoShojo Generator</title>
        <meta name="description" content="查看战报记录、PVP 战绩与个人设置" />
      </Head>

      <div className="magic-background-white">
        <div className="container">
          <div className="card">
            <div className="flex items-center justify-between gap-2 mb-3">
              <h1 className="text-xl font-bold">个人页</h1>
              <Link href="/" className="text-sm text-blue-600 hover:underline">
                返回首页
              </Link>
            </div>

            {retentionNotice}

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                className={`px-3 py-1 rounded border text-sm ${tab === 'reports' ? 'bg-gray-900 text-white' : 'bg-white hover:bg-gray-50'}`}
                onClick={() => setTab('reports')}
              >
                战报记录
              </button>
              <button
                className={`px-3 py-1 rounded border text-sm ${tab === 'pvp' ? 'bg-gray-900 text-white' : 'bg-white hover:bg-gray-50'}`}
                onClick={() => setTab('pvp')}
              >
                PVP 战绩
              </button>
              <button
                className={`px-3 py-1 rounded border text-sm ${tab === 'settings' ? 'bg-gray-900 text-white' : 'bg-white hover:bg-gray-50'}`}
                onClick={() => setTab('settings')}
              >
                个人设置（预留）
              </button>
            </div>

            {!loading && !isAuthenticated && (
              <div className="mt-3 p-3 rounded-md bg-red-50 border border-red-200 text-sm text-red-800">
                你尚未登录。请先前往 <Link href="/character-manager" className="underline">档案馆</Link> 完成登录后再查看个人页。
              </div>
            )}

            {!loading && isAuthenticated && (
              <div className="mt-3 text-sm text-gray-700">
                当前用户：<span className="font-semibold">{user?.prefix ? `${user.prefix} ` : ''}{user?.username}</span>
              </div>
            )}

            {tab === 'reports' && (
              <div className="mt-4">
                <div className="font-semibold mb-2">我的战报记录</div>
                {reportsQuery.isLoading && <div className="text-sm text-gray-600">加载中…</div>}
                {reportsQuery.error && <div className="text-sm text-red-700">加载失败：{(reportsQuery.error as Error).message}</div>}
                {!reportsQuery.isLoading && (reportsQuery.data?.records?.length ?? 0) <= 0 && (
                  <div className="text-sm text-gray-600">暂无记录（仅会显示已登录状态下产生的战报）。</div>
                )}

                <div className="space-y-3">
                  {(reportsQuery.data?.records || []).map((r) => (
                    <div key={r.id} className="p-3 rounded-md bg-white border">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-sm">
                          <span className="font-semibold">{r.headline || '（无标题）'}</span>
                          <span className="text-gray-500 ml-2">{new Date(r.startedAt).toLocaleString()}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs px-2 py-0.5 rounded border bg-gray-50">
                            {r.mode} / {r.status}
                          </span>
                          <button
                            className="px-2 py-1 rounded border bg-gray-50 hover:bg-gray-100 text-xs"
                            onClick={() => regenerateMutation.mutate(r.id)}
                            disabled={regenerateMutation.isPending}
                            title={r.pvpRoundId ? '将基于 PVP 对局素材重新生成一份战报' : '仅部分记录可重生（缺少素材的记录会失败）'}
                          >
                            {regenerateMutation.isPending ? '生成中…' : '重新生成'}
                          </button>
                        </div>
                      </div>
                      <div className="mt-1 text-xs text-gray-600">
                        Winner：{r.winner || '（未知）'}；来源：{r.endpoint} / {r.generationMode}
                        {r.pvpMatchId ? <span className="ml-2">PVP：{r.pvpMatchId}</span> : null}
                      </div>
                      {r.outputPreview && (
                        <div className="mt-2 text-sm text-gray-800 whitespace-pre-wrap">
                          {r.outputPreview}
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {regenerateMutation.error && (
                  <div className="mt-3 p-3 rounded-md bg-red-50 border border-red-200 text-sm text-red-800">
                    重新生成失败：{(regenerateMutation.error as Error).message}
                  </div>
                )}

                {generated && (
                  <div className="mt-4">
                    <div className="font-semibold mb-2">最新重新生成结果</div>
                    <div className="text-xs text-gray-600 mb-2">
                      {generated.generationId ? `generationId：${generated.generationId}` : null}
                    </div>
                    <BattleReportCard report={generated.report} mode={(generated.report.mode as any) || undefined} />
                  </div>
                )}
              </div>
            )}

            {tab === 'pvp' && (
              <div className="mt-4">
                <div className="font-semibold mb-2">我的 PVP 战绩</div>
                {pvpQuery.isLoading && <div className="text-sm text-gray-600">加载中…</div>}
                {pvpQuery.error && <div className="text-sm text-red-700">加载失败：{(pvpQuery.error as Error).message}</div>}
                {pvpQuery.data && (
                  <>
                    <div className="p-3 rounded-md bg-white border text-sm">
                      <div>已完赛：{pvpQuery.data.summary.completedMatches} 场（胜 {pvpQuery.data.summary.wins} / 负 {pvpQuery.data.summary.losses} / 平 {pvpQuery.data.summary.draws}，胜率 {winRate}）</div>
                      <div className="text-xs text-gray-600 mt-1">
                        中止：{pvpQuery.data.summary.abortedMatches}；最近一场：{pvpQuery.data.summary.lastPlayedAt ? new Date(pvpQuery.data.summary.lastPlayedAt).toLocaleString() : '暂无'}
                      </div>
                    </div>

                    <div className="mt-3 font-semibold text-sm">最近对局</div>
                    <div className="space-y-2 mt-2">
                      {pvpQuery.data.recentMatches.length <= 0 && (
                        <div className="text-sm text-gray-600">暂无 PVP 对局记录。</div>
                      )}
                      {pvpQuery.data.recentMatches.map((m) => {
                        const myId = user?.id ?? 0;
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
                          <div key={m.id} className="p-3 rounded-md bg-white border text-sm">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="font-semibold">{resultText}</div>
                              <div className="text-xs text-gray-600">{new Date(m.startedAt).toLocaleString()}</div>
                            </div>
                            <div className="text-xs text-gray-600 mt-1">
                              Match：{m.id}；我的座位：{mySeat ?? '？'}；对手：{opponentLabels || '（未知）'}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            )}

            {tab === 'settings' && (
              <div className="mt-4">
                <div className="font-semibold mb-2">个人设置（预留）</div>
                <div className="p-3 rounded-md bg-white border text-sm text-gray-700">
                  <div className="mb-2">此区域将用于后续实现：</div>
                  <ul className="list-disc list-inside space-y-1">
                    <li>改绑邮箱</li>
                    <li>修改密码</li>
                    <li>修改用户名</li>
                  </ul>
                  <div className="text-xs text-gray-500 mt-2">当前版本仅预留入口，功能后续逐步上线。</div>
                </div>
              </div>
            )}
          </div>

          <Footer />
        </div>
      </div>
    </>
  );
}

