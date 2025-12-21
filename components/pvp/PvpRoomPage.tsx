'use client';

import { useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { useMutation, useQuery } from '@tanstack/react-query';

import BattleReportCard from '@/components/BattleReportCard';
import Footer from '@/components/Footer';
import { authStorage } from '@/lib/auth';
import { useAuth } from '@/lib/useAuth';
import type { PvpRoomRules } from '@/lib/pvp/types';

import { useMyCharacterCardsQuery, usePresetsQuery, usePublicCharacterCardsQuery } from './hooks/usePvpCatalog';

const PASSWORD_CACHE_PREFIX = 'pvp-room-password:';

const getCachedPassword = (roomId: string): string => {
  if (typeof window === 'undefined') return '';
  return sessionStorage.getItem(`${PASSWORD_CACHE_PREFIX}${roomId}`) || '';
};

type CardRef =
  | { kind: 'data_card'; id: string; updatedAt?: string | null; isPublic?: boolean }
  | { kind: 'preset'; filename: string; isPublic?: boolean };

export function PvpRoomPage() {
  const router = useRouter();
  const { user, isAuthenticated, loading } = useAuth();
  const roomId = typeof router.query.roomId === 'string' ? router.query.roomId : '';

  const [joinPassword, setJoinPassword] = useState('');
  const [joined, setJoined] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  const [selected, setSelected] = useState<CardRef[]>([]);
  const [acceptPrivateDisclosure, setAcceptPrivateDisclosure] = useState(false);

  const [roomPasswordDraft, setRoomPasswordDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  const myCardsQuery = useMyCharacterCardsQuery();
  const publicCardsQuery = usePublicCharacterCardsQuery();
  const presetsQuery = usePresetsQuery();

  const joinMutation = useMutation({
    mutationFn: async (payload: { password?: string }) => {
      const authHeader = await authStorage.getAuthHeader();
      if (!authHeader) throw new Error('未登录');
      const res = await fetch(`/api/pvp/rooms/${roomId}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: authHeader },
        body: JSON.stringify({ password: payload.password || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const code = data.code as string | undefined;
        const message = data.error || '加入失败';
        const err = new Error(message) as any;
        err.code = code;
        throw err;
      }
      return data;
    },
    onSuccess: () => {
      setJoined(true);
      setJoinError(null);
    },
    onError: (e: any) => {
      if (e?.code === 'PASSWORD_REQUIRED') {
        setJoinError('该房间需要口令，请输入后再加入。');
        return;
      }
      if (e?.code === 'PASSWORD_INVALID') {
        setJoinError('口令错误，请重试。');
        return;
      }
      setJoinError(e instanceof Error ? e.message : '加入失败');
    },
  });

  const isJoining = joinMutation.isPending;
  const joinRoom = joinMutation.mutateAsync;

  useEffect(() => {
    if (!roomId || !isAuthenticated || joined || isJoining) return;
    const cached = getCachedPassword(roomId);
    setJoinPassword(cached);
    void joinRoom({ password: cached || undefined });
  }, [roomId, isAuthenticated, joined, isJoining, joinRoom]);

  const roomQuery = useQuery({
    queryKey: ['pvp', 'room', roomId],
    enabled: Boolean(roomId && joined && isAuthenticated),
    refetchInterval: 1500,
    queryFn: async () => {
      const authHeader = await authStorage.getAuthHeader();
      if (!authHeader) throw new Error('未登录');
      const res = await fetch(`/api/pvp/rooms/${roomId}`, { headers: { Authorization: authHeader } });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '加载房间失败');
      return data;
    },
  });

  const room = roomQuery.data?.room;
  const rules: PvpRoomRules | null = room?.rules || null;
  const phase: string = room?.phase || 'unknown';
  const version: number = room?.version ?? 0;
  const players = useMemo(() => (Array.isArray(roomQuery.data?.players) ? roomQuery.data.players : []), [roomQuery.data?.players]);
  const isHost = Boolean(user?.id && room?.hostUserId === user.id);

  const playerLabelById = useMemo(() => {
    const map = new Map<number, string>();
    for (const p of players) {
      const userId = typeof p?.userId === 'number' ? p.userId : null;
      if (!userId) continue;
      const prefix = typeof p.prefix === 'string' && p.prefix ? `${p.prefix} ` : '';
      const username = typeof p.username === 'string' && p.username ? p.username : `用户${userId}`;
      map.set(userId, `${prefix}${username}`);
    }
    return map;
  }, [players]);

  const submissions = Array.isArray(roomQuery.data?.submissions) ? roomQuery.data.submissions : [];
  const myHand = roomQuery.data?.myHand;
  const choices = roomQuery.data?.choices;
  const latestRound = roomQuery.data?.latestRound;
  const latestRoundResult = roomQuery.data?.latestRoundResult;
  const score = roomQuery.data?.score;

  const hasPrivateSelected = useMemo(() => selected.some((c) => c.kind === 'data_card' && c.isPublic === false), [selected]);

  const leaveMutation = useMutation({
    mutationFn: async () => {
      const authHeader = await authStorage.getAuthHeader();
      if (!authHeader) throw new Error('未登录');
      const res = await fetch(`/api/pvp/rooms/${roomId}/leave`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: authHeader },
        body: JSON.stringify({ expectedVersion: version }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '退出失败');
      return data;
    },
    onSuccess: async () => {
      await router.push('/pvp');
    },
  });

  const submitMutation = useMutation({
    mutationFn: async () => {
      if (!rules) throw new Error('规则未加载');
      if (selected.length !== rules.cardsPerPlayer) throw new Error(`需要选择 ${rules.cardsPerPlayer} 张卡`);
      if (hasPrivateSelected && !acceptPrivateDisclosure) throw new Error('包含私有卡时必须勾选披露确认');

      const authHeader = await authStorage.getAuthHeader();
      if (!authHeader) throw new Error('未登录');

      const cards = selected.map((c) => {
        if (c.kind === 'preset') return { kind: 'preset', filename: c.filename };
        return { kind: 'data_card', id: c.id, updatedAt: c.updatedAt || undefined };
      });

      const res = await fetch(`/api/pvp/rooms/${roomId}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: authHeader },
        body: JSON.stringify({
          expectedVersion: version,
          cards,
          acceptPrivateDisclosure: hasPrivateSelected ? acceptPrivateDisclosure : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '提交失败');
      return data;
    },
    onSuccess: () => {
      setError(null);
      void roomQuery.refetch();
    },
    onError: (e) => setError(e instanceof Error ? e.message : '提交失败'),
  });

  const startMutation = useMutation({
    mutationFn: async () => {
      const authHeader = await authStorage.getAuthHeader();
      if (!authHeader) throw new Error('未登录');
      const res = await fetch(`/api/pvp/rooms/${roomId}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: authHeader },
        body: JSON.stringify({ expectedVersion: version }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '开始失败');
      return data;
    },
    onSuccess: () => void roomQuery.refetch(),
    onError: (e) => setError(e instanceof Error ? e.message : '开始失败'),
  });

  const chooseMutation = useMutation({
    mutationFn: async (snapshotId: string) => {
      if (!latestRound?.id) throw new Error('当前回合不存在，请刷新');
      const authHeader = await authStorage.getAuthHeader();
      if (!authHeader) throw new Error('未登录');
      const res = await fetch(`/api/pvp/rooms/${roomId}/rounds/${latestRound?.id}/choose`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: authHeader },
        body: JSON.stringify({ expectedVersion: version, snapshotId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '出牌失败');
      return data;
    },
    onSuccess: () => void roomQuery.refetch(),
    onError: (e) => setError(e instanceof Error ? e.message : '出牌失败'),
  });

  const resolveMutation = useMutation({
    mutationFn: async () => {
      if (!latestRound?.id) throw new Error('当前回合不存在，请刷新');
      const authHeader = await authStorage.getAuthHeader();
      if (!authHeader) throw new Error('未登录');
      const res = await fetch(`/api/pvp/rooms/${roomId}/rounds/${latestRound?.id}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: authHeader },
        body: JSON.stringify({ expectedVersion: version }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '结算失败');
      return data;
    },
    onSuccess: () => void roomQuery.refetch(),
    onError: (e) => setError(e instanceof Error ? e.message : '结算失败'),
  });

  const passwordMutation = useMutation({
    mutationFn: async (password: string) => {
      const authHeader = await authStorage.getAuthHeader();
      if (!authHeader) throw new Error('未登录');
      const res = await fetch(`/api/pvp/rooms/${roomId}/password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: authHeader },
        body: JSON.stringify({ expectedVersion: version, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '更新口令失败');
      return data;
    },
    onSuccess: () => void roomQuery.refetch(),
    onError: (e) => setError(e instanceof Error ? e.message : '更新口令失败'),
  });

  const restartMutation = useMutation({
    mutationFn: async () => {
      const authHeader = await authStorage.getAuthHeader();
      if (!authHeader) throw new Error('未登录');
      const res = await fetch(`/api/pvp/rooms/${roomId}/restart`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: authHeader },
        body: JSON.stringify({ expectedVersion: version }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '重开失败');
      return data;
    },
    onSuccess: () => void roomQuery.refetch(),
    onError: (e) => setError(e instanceof Error ? e.message : '重开失败'),
  });

  const kickMutation = useMutation({
    mutationFn: async (targetUserId: number) => {
      const authHeader = await authStorage.getAuthHeader();
      if (!authHeader) throw new Error('未登录');
      const res = await fetch(`/api/pvp/rooms/${roomId}/kick`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: authHeader },
        body: JSON.stringify({ expectedVersion: version, userId: targetUserId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '踢人失败');
      return data;
    },
    onSuccess: () => void roomQuery.refetch(),
    onError: (e) => setError(e instanceof Error ? e.message : '踢人失败'),
  });

  const addDataCard = (card: any, isPublic: boolean) => {
    const id = String(card.id);
    if (!id) return;
    const updatedAt = card.updated_at ? String(card.updated_at) : null;
    setSelected((prev) => {
      if (prev.some((c) => c.kind === 'data_card' && c.id === id)) return prev;
      const next: CardRef = { kind: 'data_card', id, updatedAt, isPublic };
      return [...prev, next];
    });
  };

  const addPreset = (filename: string) => {
    setSelected((prev) => {
      if (prev.some((c) => c.kind === 'preset' && c.filename === filename)) return prev;
      return [...prev, { kind: 'preset', filename, isPublic: true }];
    });
  };

  const removeSelected = (ref: CardRef) => {
    setSelected((prev) => prev.filter((c) => JSON.stringify(c) !== JSON.stringify(ref)));
  };

  return (
    <>
      <Head>
        <title>PVP 房间 - {roomId || '...'}</title>
      </Head>
      <div className="magic-background-white">
        <div className="container">
          <div className="card" style={{ border: '2px solid #ccc', background: '#f9f9f9' }}>
            <div className="flex items-center justify-between">
              <h1 className="text-xl font-bold">PVP 房间</h1>
              <button onClick={() => window.location.assign('/pvp')} className="footer-link">
                返回大厅
              </button>
            </div>
            <div className="text-sm text-gray-700 mt-1 break-all">房间ID：{roomId || '加载中…'}</div>

            {!loading && !isAuthenticated && (
              <div className="p-3 rounded-md bg-yellow-100 text-yellow-800 text-sm mt-3">
                未登录状态下无法进入房间。
              </div>
            )}

            {joinError && (
              <div className="p-3 rounded-md bg-yellow-100 text-yellow-800 text-sm mt-3">
                <div className="mb-2">{joinError}</div>
                <div className="flex gap-2">
                  <input
                    className="border rounded px-2 py-1 flex-1"
                    value={joinPassword}
                    onChange={(e) => setJoinPassword(e.target.value)}
                    placeholder="输入房间口令"
                  />
                  <button
                    className="generate-button"
                    style={{ backgroundColor: '#3b82f6', backgroundImage: 'linear-gradient(to right, #3b82f6, #2563eb)' }}
                    onClick={() => joinMutation.mutate({ password: joinPassword })}
                    disabled={joinMutation.isPending}
                  >
                    加入
                  </button>
                </div>
              </div>
            )}

            {roomQuery.isLoading && joined && (
              <div className="text-sm text-gray-700 mt-3">加载房间中…</div>
            )}

            {roomQuery.data && (
              <>
                <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="p-3 rounded-md bg-white border text-sm">
                    <div>阶段：<span className="font-semibold">{phase}</span></div>
                    <div>版本：{version}</div>
                    {rules && (
                      <div className="mt-2 text-xs text-gray-600 whitespace-pre-wrap">
                        规则：人数 {rules.participants} / 提交 {rules.cardsPerPlayer} / 发牌 {rules.dealPerPlayer} / 去重 {String(rules.dedupe)} / 模式 {rules.mode}
                      </div>
                    )}
                    {score && (
                      <div className="mt-2 text-xs text-gray-600">
                        赛制：最多 {score.maxRounds} 轮；当前胜场：
                        <div className="mt-1 space-y-0.5">
                          {(score.winsByUserId || [])
                            .slice()
                            .sort((a: any, b: any) => (b.wins ?? 0) - (a.wins ?? 0))
                            .map((x: any) => (
                              <div key={x.userId}>
                                {playerLabelById.get(x.userId) || `用户${x.userId}`}：{x.wins ?? 0}
                              </div>
                            ))}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="p-3 rounded-md bg-white border text-sm">
                    <div className="font-semibold mb-1">玩家</div>
                    <div className="space-y-1">
                      {players.map((p: any) => (
                        <div key={p.userId} className="flex items-center justify-between gap-2">
                          <div>
                            [{p.seat ?? '?'}] {p.prefix ? `${p.prefix} ` : ''}{p.username} {p.userId === room.hostUserId ? '(房主)' : ''}
                          </div>
                          {isHost && p.userId !== room.hostUserId && (
                            <button
                              className="px-2 py-1 rounded border bg-gray-50 hover:bg-gray-100 text-xs"
                              onClick={() => kickMutation.mutate(p.userId)}
                              disabled={kickMutation.isPending}
                            >
                              踢出
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                    <button
                      className="generate-button mt-3 w-full"
                      style={{ backgroundColor: '#ef4444', backgroundImage: 'linear-gradient(to right, #ef4444, #dc2626)' }}
                      onClick={() => leaveMutation.mutate()}
                      disabled={leaveMutation.isPending}
                    >
                      退出房间
                    </button>
                  </div>
                </div>

                {isHost && (phase === 'waiting' || phase === 'submitting') && (
                  <div className="p-3 rounded-md bg-white border mt-3">
                    <div className="font-semibold text-sm mb-2">房主设置</div>
                    <div className="flex gap-2">
                      <input
                        className="border rounded px-2 py-1 flex-1 text-sm"
                        placeholder="设置/清空房间口令（留空即清空）"
                        value={roomPasswordDraft}
                        onChange={(e) => setRoomPasswordDraft(e.target.value)}
                      />
                      <button
                        className="generate-button"
                        style={{ backgroundColor: '#3b82f6', backgroundImage: 'linear-gradient(to right, #3b82f6, #2563eb)' }}
                        onClick={() => passwordMutation.mutate(roomPasswordDraft)}
                        disabled={passwordMutation.isPending}
                      >
                        保存
                      </button>
                    </div>
                    <div className="text-xs text-gray-500 mt-1">提示：仅在 waiting/submitting 阶段允许修改。</div>
                  </div>
                )}

                {phase === 'submitting' && rules && (
                  <div className="mt-4">
                    <div className="p-3 rounded-md bg-white border">
                      <div className="font-semibold text-sm mb-2">提交卡组（需要 {rules.cardsPerPlayer} 张）</div>

                      <div className="text-xs text-gray-600 mb-2">
                        注意：提交私有卡会让对手可查看完整 JSON（问卷/能力/设定全量）。
                      </div>

                      <div className="flex flex-wrap gap-2 mb-3">
                        {selected.map((c, idx) => (
                          <button
                            key={`${c.kind}-${idx}-${(c as any).id || (c as any).filename}`}
                            className="text-xs px-2 py-1 rounded border bg-gray-50 hover:bg-gray-100"
                            onClick={() => removeSelected(c)}
                            title="点击移除"
                          >
                            {c.kind === 'preset' ? `预设:${c.filename}` : `卡:${c.id}`} ×
                          </button>
                        ))}
                      </div>

                      {hasPrivateSelected && (
                        <label className="flex items-center gap-2 text-sm mb-2">
                          <input
                            type="checkbox"
                            checked={acceptPrivateDisclosure}
                            onChange={(e) => setAcceptPrivateDisclosure(e.target.checked)}
                          />
                          <span>我已知悉：私有卡提交后对手可查看完整 JSON</span>
                        </label>
                      )}

                      <button
                        className="generate-button w-full"
                        style={{ backgroundColor: '#22c55e', backgroundImage: 'linear-gradient(to right, #22c55e, #16a34a)' }}
                        disabled={submitMutation.isPending || selected.length !== rules.cardsPerPlayer || (hasPrivateSelected && !acceptPrivateDisclosure)}
                        onClick={() => submitMutation.mutate()}
                      >
                        {submitMutation.isPending ? '提交中…' : '提交卡组'}
                      </button>

                        {isHost && (
                          <button
                            className="generate-button w-full mt-2"
                            style={{ backgroundColor: '#a855f7', backgroundImage: 'linear-gradient(to right, #a855f7, #7c3aed)' }}
                            disabled={startMutation.isPending || submissions.length < rules.participants}
                            onClick={() => startMutation.mutate()}
                          >
                            {startMutation.isPending ? '发牌中…' : '开始对局（发牌）'}
                          </button>
                      )}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
                      <div className="p-3 rounded-md bg-white border">
                        <div className="font-semibold text-sm mb-2">我的卡库</div>
                        <div className="text-xs text-gray-500 mb-2">支持 pending；禁用 rejected / is_public=-1。</div>
                        <div className="space-y-2 max-h-[320px] overflow-auto">
                          {(myCardsQuery.data || []).map((c: any) => (
                            <div key={c.id} className="border rounded p-2 text-xs">
                              <div className="font-semibold">{c.name}</div>
                              <div className="text-gray-600">
                                {Number(c.is_public) === 1 ? '公开' : '私有'} / {c.review_status || 'pending?'}
                              </div>
                              <button
                                className="mt-2 px-2 py-1 rounded border bg-gray-50 hover:bg-gray-100"
                                onClick={() => addDataCard(c, Number(c.is_public) === 1)}
                                disabled={selected.length >= rules.cardsPerPlayer}
                              >
                                选择
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="p-3 rounded-md bg-white border">
                        <div className="font-semibold text-sm mb-2">公开库</div>
                        <div className="space-y-2 max-h-[320px] overflow-auto">
                          {(publicCardsQuery.data || []).map((c: any) => (
                            <div key={c.id} className="border rounded p-2 text-xs">
                              <div className="font-semibold">{c.name}</div>
                              <div className="text-gray-600">公开</div>
                              <button
                                className="mt-2 px-2 py-1 rounded border bg-gray-50 hover:bg-gray-100"
                                onClick={() => addDataCard(c, true)}
                                disabled={selected.length >= rules.cardsPerPlayer}
                              >
                                选择
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="p-3 rounded-md bg-white border">
                        <div className="font-semibold text-sm mb-2">预设卡</div>
                        <div className="space-y-2 max-h-[320px] overflow-auto">
                          {(presetsQuery.data || []).map((p) => (
                            <div key={p.filename} className="border rounded p-2 text-xs">
                              <div className="font-semibold">{p.name}</div>
                              <div className="text-gray-600">{p.type}</div>
                              <button
                                className="mt-2 px-2 py-1 rounded border bg-gray-50 hover:bg-gray-100"
                                onClick={() => addPreset(p.filename)}
                                disabled={selected.length >= rules.cardsPerPlayer}
                              >
                                选择
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {phase === 'choosing' && (
                  <div className="mt-4">
                    <div className="p-3 rounded-md bg-white border">
                      <div className="font-semibold text-sm mb-2">我的手牌</div>
                      {!myHand?.cards?.length && <div className="text-sm text-gray-700">暂无手牌数据，请刷新。</div>}
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                        {(myHand?.cards || []).map((c: any) => (
                          <div key={c.snapshotId} className="border rounded p-2 text-xs">
                            <div className="font-semibold">{c.name}</div>
                            <div className="text-gray-600">{c.type}</div>
                            <button
                              className="mt-2 px-2 py-1 rounded border bg-gray-50 hover:bg-gray-100"
                              onClick={() => chooseMutation.mutate(c.snapshotId)}
                              disabled={chooseMutation.isPending || choices?.hasChosenMe}
                            >
                              {choices?.hasChosenMe ? '已选择' : '出战'}
                            </button>
                          </div>
                        ))}
                      </div>

                      <div className="text-sm text-gray-700 mt-3">
                        已选人数：{choices?.chosenCount ?? 0} / {choices?.totalPlayers ?? players.length}；
                        我方已选：{choices?.hasChosenMe ? '是' : '否'}
                        {typeof choices?.hasChosenOther === 'boolean' ? ` / 对手已选：${choices.hasChosenOther ? '是' : '否'}` : ''}
                      </div>

                      {Boolean(
                        choices?.hasChosenMe &&
                        (choices?.chosenCount ?? 0) >= (choices?.totalPlayers ?? players.length)
                      ) && (
                        <button
                          className="generate-button mt-3 w-full"
                          style={{ backgroundColor: '#f59e0b', backgroundImage: 'linear-gradient(to right, #f59e0b, #d97706)' }}
                          onClick={() => resolveMutation.mutate()}
                          disabled={resolveMutation.isPending}
                        >
                          {resolveMutation.isPending ? '结算中…' : '结算（生成战报）'}
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {latestRoundResult?.report && (
                  <div className="mt-4">
                    <BattleReportCard report={latestRoundResult.report} mode={rules?.mode as any} />
                    <div className="text-sm text-gray-700 mt-2">
                      本轮胜者：<span className="font-semibold">{latestRoundResult.winnerName || '平局'}</span>
                    </div>
                  </div>
                )}

                {phase === 'finished' && (
                  <div className="p-3 rounded-md bg-green-50 text-green-800 text-sm mt-4">
                    对局已结束。
                  </div>
                )}

                {isHost && (phase === 'finished' || phase === 'aborted' || phase === 'waiting' || phase === 'submitting') && (
                  <button
                    className="generate-button mt-3 w-full"
                    style={{ backgroundColor: '#a855f7', backgroundImage: 'linear-gradient(to right, #a855f7, #7c3aed)' }}
                    onClick={() => restartMutation.mutate()}
                    disabled={restartMutation.isPending}
                  >
                    {restartMutation.isPending ? '重开中…' : '重开一局（清空对局数据）'}
                  </button>
                )}

                {error && (
                  <div className="p-3 rounded-md bg-red-100 text-red-800 text-sm mt-4 whitespace-pre-wrap">
                    {error}
                  </div>
                )}

                <div className="p-3 rounded-md bg-white border mt-4">
                  <div className="font-semibold text-sm mb-2">提交情况</div>
                  <div className="space-y-3">
                    {submissions.map((s: any) => (
                      <details key={s.userId} className="text-sm">
                        <summary className="cursor-pointer">
                          用户 {s.userId}：已提交 {s.cards?.length || 0} 张{s.hasPrivateCard ? '（含私有）' : ''}
                        </summary>
                        <div className="mt-2 space-y-2">
                          {(s.cards || []).map((c: any, idx: number) => (
                            <details key={`${idx}-${c.name}`} className="text-xs border rounded p-2 bg-gray-50">
                              <summary className="cursor-pointer">
                                {c.name} / {c.type} / {c.source?.isPublic ? '公开' : '私有'}
                              </summary>
                              <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-[11px] leading-relaxed">
                                {c.dataJson}
                              </pre>
                            </details>
                          ))}
                        </div>
                      </details>
                    ))}
                  </div>
                </div>
              </>
            )}

            <div className="text-center mt-6">
              <button onClick={() => window.location.assign('/')} className="footer-link">
                返回首页
              </button>
            </div>
          </div>
          <Footer />
        </div>
      </div>
    </>
  );
}
