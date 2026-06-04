'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { RefreshCcw, Zap, X } from 'lucide-react';

import { authStorage } from '@/lib/auth';
import { useClientRouteAdapter } from '@/lib/client-route-adapter';
import type { PvpRoomRules } from '@/lib/pvp/types';
import { describePvpRoomCardRange, normalizePvpRoomCardRange } from '@/lib/pvp/card-range';
import { formatPvpDisplayName } from '@/lib/pvp/displayName';

type BrowseRoom = {
  roomId: string;
  host: { userId: number; username: string; prefix?: string | null };
  status: string;
  phase: string;
  hasPassword: boolean;
  players: { humans: number; bots: number; total: number; max: number; slotsLeft: number };
  mode: string;
  rules: PvpRoomRules;
  scenarioTitle?: string | null;
  updatedAt: string;
  lastActivityAt: string | null;
  expiresAt: string | null;
  joinable: boolean;
  spectatable: boolean;
  allowSpectators: boolean;
};

type Props = {
  isOpen: boolean;
  onClose: () => void;
};

const PASSWORD_CACHE_PREFIX = 'pvp-room-password:';

const saveRoomPassword = (roomId: string, password: string) => {
  if (typeof window === 'undefined') return;
  const trimmed = password.trim();
  if (!trimmed) return;
  sessionStorage.setItem(`${PASSWORD_CACHE_PREFIX}${roomId}`, trimmed);
};

const loadRoomPassword = (roomId: string): string => {
  if (typeof window === 'undefined') return '';
  return sessionStorage.getItem(`${PASSWORD_CACHE_PREFIX}${roomId}`) || '';
};

const formatMode = (mode: string): string => {
  if (mode === 'classic') return '经典';
  if (mode === 'scenario') return '情景';
  if (mode === 'daily') return '每日';
  if (mode === 'kizuna') return '羁绊';
  return mode || '未知';
};

const formatPhase = (phase: string): string => {
  if (phase === 'waiting') return '等待加入';
  if (phase === 'submitting') return '提交中';
  if (phase === 'dealing') return '发牌中';
  if (phase === 'choosing') return '选牌中';
  if (phase === 'voting') return '胜者投票';
  if (phase === 'reviewing') return '阅读确认';
  if (phase === 'resolving') return '结算中';
  if (phase === 'advancing') return '推进中';
  if (phase === 'finished') return '已结束';
  if (phase === 'aborted') return '已中止';
  if (phase === 'closed') return '已关闭';
  return phase || '未知';
};

const formatTimeAgo = (iso: string | null): string => {
  if (!iso) return '未知';
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '未知';
  const delta = Date.now() - ms;
  if (delta < 15_000) return '刚刚';
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  return `${days} 天前`;
};

export function PvpRoomBrowserModal({ isOpen, onClose }: Props) {
  const router = useClientRouteAdapter();
  const abortRef = useRef<AbortController | null>(null);
  const refreshTimerRef = useRef<number | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const [rooms, setRooms] = useState<BrowseRoom[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isQuickMatching, setIsQuickMatching] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastFetchedAt, setLastFetchedAt] = useState<number | null>(null);

  const [showJoinable, setShowJoinable] = useState(true);
  const [showSpectatable, setShowSpectatable] = useState(true);
  const [q, setQ] = useState('');
  const [mode, setMode] = useState<'all' | 'classic' | 'scenario' | 'daily' | 'kizuna'>('all');
  const [phase, setPhase] = useState<'any' | 'waiting' | 'submitting' | 'playing' | 'ended'>('any');
  const [password, setPassword] = useState<'any' | 'yes' | 'no'>('any');
  const [includeUnavailable, setIncludeUnavailable] = useState(false);

  const [joinPasswords, setJoinPasswords] = useState<Record<string, string>>({});
  const [joinBusyRoomId, setJoinBusyRoomId] = useState<string | null>(null);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (q.trim()) params.set('q', q.trim());
    if (mode !== 'all') params.set('mode', mode);
    if (password !== 'any') params.set('password', password);
    if (includeUnavailable) params.set('includeUnavailable', '1');
    params.set('limit', '80');
    return params.toString();
  }, [q, mode, password, includeUnavailable]);

  const fetchRooms = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setIsLoading(true);
    setError(null);

    try {
      const res = await authStorage.fetch(`/api/pvp/rooms/browse?${queryString}`, {
        signal: controller.signal,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || '加载房间列表失败');
      setRooms(Array.isArray(data?.rooms) ? (data.rooms as BrowseRoom[]) : []);
      setLastFetchedAt(Date.now());
    } catch (e: any) {
      if (e?.name === 'AbortError') return;
      setError(e instanceof Error ? e.message : '加载房间列表失败');
    } finally {
      setIsLoading(false);
    }
  }, [queryString]);

  useEffect(() => {
    if (!isOpen) return;
    void fetchRooms();
  }, [isOpen, fetchRooms]);

  useEffect(() => {
    if (!isOpen) return;
    const t = window.setTimeout(() => searchInputRef.current?.focus(), 50);
    return () => window.clearTimeout(t);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) return;
    if (!autoRefresh) return;
    if (refreshTimerRef.current) window.clearInterval(refreshTimerRef.current);
    refreshTimerRef.current = window.setInterval(() => void fetchRooms(), 5000);
    return () => {
      if (refreshTimerRef.current) window.clearInterval(refreshTimerRef.current);
      refreshTimerRef.current = null;
    };
  }, [isOpen, autoRefresh, fetchRooms]);

  useEffect(() => {
    if (!isOpen) return;
    const t = window.setTimeout(() => void fetchRooms(), 300);
    return () => window.clearTimeout(t);
  }, [isOpen, q, mode, password, includeUnavailable, fetchRooms]);

  useEffect(() => {
    if (!isOpen) return;
    if (!rooms.length) return;
    setJoinPasswords((prev) => {
      let changed = false;
      const next: Record<string, string> = { ...prev };
      for (const room of rooms) {
        if (!room?.roomId) continue;
        if (!room.hasPassword) continue;
        if (typeof next[room.roomId] === 'string' && next[room.roomId].trim()) continue;
        const cached = loadRoomPassword(room.roomId);
        if (cached && cached !== next[room.roomId]) {
          next[room.roomId] = cached;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [isOpen, rooms]);

  const joinRoom = useCallback(
    async (room: BrowseRoom) => {
      if (!room?.roomId) return;
      setError(null);
      setJoinBusyRoomId(room.roomId);

      try {
        const pwd = (joinPasswords[room.roomId] || '').trim();
        if (room.hasPassword && !pwd) {
          throw new Error('该房间需要口令，请先输入口令。');
        }

        const res = await authStorage.fetch(`/api/pvp/rooms/${room.roomId}/join`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: pwd || undefined }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || '加入房间失败');

        if (pwd) saveRoomPassword(room.roomId, pwd);
        await router.push(`/pvp/${room.roomId}`);
      } catch (e) {
        setError(e instanceof Error ? e.message : '加入房间失败');
      } finally {
        setJoinBusyRoomId(null);
      }
    },
    [joinPasswords, router]
  );

  const quickMatch = useCallback(async () => {
    setError(null);
    setIsQuickMatching(true);
    try {
      const res = await authStorage.fetch('/api/pvp/rooms/quick-match', {
        method: 'POST',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || '快速匹配失败');
      const roomId = typeof data?.roomId === 'string' ? data.roomId : '';
      if (!roomId) throw new Error('快速匹配失败：缺少 roomId');
      await router.push(`/pvp/${roomId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : '快速匹配失败');
    } finally {
      setIsQuickMatching(false);
    }
  }, [router]);

  const filteredRooms = useMemo(() => {
    const wantsJoinable = showJoinable;
    const wantsSpectatable = showSpectatable;
    const wantsUnavailable = includeUnavailable;
    if (!wantsJoinable && !wantsSpectatable && !wantsUnavailable) return [];

    const phaseFilter = phase;
    const isInPlayingPhase = (p: string): boolean =>
      p === 'dealing' ||
      p === 'choosing' ||
      p === 'voting' ||
      p === 'reviewing' ||
      p === 'resolving' ||
      p === 'advancing';

    return rooms.filter((room) => {
      const okJoinable = wantsJoinable && room.joinable;
      const okSpectate = wantsSpectatable && room.spectatable;
      const okUnavailable = wantsUnavailable && !room.joinable && !room.spectatable;
      if (!okJoinable && !okSpectate && !okUnavailable) return false;

      if (phaseFilter === 'any') return true;
      if (phaseFilter === 'waiting') return room.phase === 'waiting';
      if (phaseFilter === 'submitting') return room.phase === 'submitting';
      if (phaseFilter === 'playing') return isInPlayingPhase(room.phase);
      if (phaseFilter === 'ended') return room.phase === 'finished' || room.phase === 'aborted';
      return true;
    });
  }, [rooms, showJoinable, showSpectatable, includeUnavailable, phase]);

  if (!isOpen) return null;

  const lastFetchedLabel = lastFetchedAt ? formatTimeAgo(new Date(lastFetchedAt).toISOString()) : '—';

  const modal = (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg p-6 w-[96vw] max-w-[90rem] h-[85vh] max-h-[90vh] overflow-hidden flex flex-col relative">
        <button onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 z-10">
          <X className="w-6 h-6" />
        </button>

        <div className="flex flex-wrap items-start gap-2 pr-8 mb-4">
          <div className="flex-1 min-w-[220px]">
            <h2 className="text-xl font-bold">房间浏览器</h2>
            <div className="text-xs text-gray-600 mt-1">
              可搜索房主/房间ID，筛选模式与口令，并按“可观战/可加入”快速查找房间（自动刷新：5 秒）。
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void fetchRooms()}
              className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-60"
              disabled={isLoading}
            >
              <RefreshCcw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
              {isLoading ? '刷新中…' : '刷新'}
            </button>
            <button
              onClick={() => void quickMatch()}
              className="generate-button w-auto mb-0 px-4 py-2 text-sm inline-flex items-center gap-2"
              style={{ backgroundColor: '#3b82f6', backgroundImage: 'linear-gradient(to right, #3b82f6, #2563eb)' }}
              disabled={isQuickMatching}
            >
              <Zap className="w-4 h-4" />
              {isQuickMatching ? '匹配中…' : '快速匹配'}
            </button>
          </div>
        </div>

        <div className="p-3 rounded-xl bg-gray-50 border mb-3 space-y-2">
          <div className="flex flex-wrap gap-2 items-center">
            <div className="flex-1 min-w-[260px]">
              <input
                ref={searchInputRef}
                className="w-full input-field px-3 py-2 text-sm"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="搜索：房主 / 房间ID"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
              />
            </div>
            <select
              className="border rounded-lg px-3 py-2 text-sm bg-white"
              value={mode}
              onChange={(e) => setMode(e.target.value as any)}
            >
              <option value="all">全部模式</option>
              <option value="classic">经典</option>
              <option value="scenario">情景</option>
              <option value="daily">每日</option>
              <option value="kizuna">羁绊</option>
            </select>
            <select
              className="border rounded-lg px-3 py-2 text-sm bg-white"
              value={phase}
              onChange={(e) => setPhase(e.target.value as any)}
            >
              <option value="any">任意阶段</option>
              <option value="waiting">等待加入</option>
              <option value="submitting">提交中</option>
              <option value="playing">对局中</option>
              <option value="ended">已结束</option>
            </select>
            <select
              className="border rounded-lg px-3 py-2 text-sm bg-white"
              value={password}
              onChange={(e) => setPassword(e.target.value as any)}
            >
              <option value="any">口令：不限</option>
              <option value="no">口令：无</option>
              <option value="yes">口令：有</option>
            </select>
          </div>
          <div className="flex flex-wrap gap-3 items-center">
            <label className="inline-flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={showSpectatable} onChange={(e) => setShowSpectatable(e.target.checked)} className="accent-purple-600" />
              可观战
            </label>
            <label className="inline-flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={showJoinable} onChange={(e) => setShowJoinable(e.target.checked)} className="accent-purple-600" />
              可加入
            </label>
            <label className="inline-flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={includeUnavailable}
                onChange={(e) => setIncludeUnavailable(e.target.checked)}
                className="accent-purple-600"
              />
              显示无法进入
            </label>
            <label className="inline-flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} className="accent-purple-600" />
              自动刷新
            </label>
            <div className="text-xs text-gray-500 ml-auto">
              {isLoading ? '正在加载…' : `显示 ${filteredRooms.length} / ${rooms.length} 个房间`} · 更新：{lastFetchedLabel}
            </div>
          </div>
        </div>

        {error && <div className="p-3 rounded-md bg-red-100 text-red-800 text-sm mb-3 whitespace-pre-wrap">{error}</div>}

        <div className="flex-1 min-h-0 overflow-y-auto space-y-3">
          {rooms.length === 0 && !isLoading && <div className="text-center text-gray-500 py-10">暂无可用房间</div>}
          {rooms.length > 0 && filteredRooms.length === 0 && !isLoading && (
            <div className="text-center text-gray-500 py-10">暂无符合筛选条件的房间</div>
          )}

          {filteredRooms.map((room) => {
            const seatText = `${room.players.total}/${room.players.max}${room.players.slotsLeft > 0 ? `（空位 ${room.players.slotsLeft}）` : ''}`;
            const passwordHint = room.hasPassword ? '需要口令' : '无口令';
            const phaseLabel = formatPhase(room.phase);
            const modeLabel = formatMode(room.mode);
            const activityText = formatTimeAgo(room.lastActivityAt || room.updatedAt);
            const isBusy = joinBusyRoomId === room.roomId;
            const canEnter = room.joinable || room.spectatable;

            return (
              <div
                key={room.roomId}
                className={`border rounded-xl p-4 bg-white ${canEnter ? 'shadow-sm' : 'opacity-70'} ${canEnter ? 'border-emerald-200' : ''}`}
              >
                <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-4 items-start">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs px-2 py-1 rounded bg-purple-100 text-purple-800">{modeLabel}</span>
                      <span className="text-xs px-2 py-1 rounded bg-gray-100 text-gray-700">{phaseLabel}</span>
                      <span
                        className={`text-xs px-2 py-1 rounded ${room.allowSpectators ? 'bg-purple-100 text-purple-800' : 'bg-slate-100 text-slate-700'}`}
                        title={room.allowSpectators ? '该房间允许观战，新进入默认观众。' : '该房间关闭观战，仅玩家可进入。'}
                      >
                        {room.allowSpectators ? '可观战' : '禁观战'}
                      </span>
                      <span
                        className={`text-xs px-2 py-1 rounded ${room.hasPassword ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}
                      >
                        {passwordHint}
                      </span>
                      <span className="text-xs px-2 py-1 rounded bg-blue-100 text-blue-800">人数 {seatText}</span>
                      {room.mode === 'scenario' && room.scenarioTitle && (
                        <span className="text-xs px-2 py-1 rounded bg-pink-100 text-pink-800">情景：{room.scenarioTitle}</span>
                      )}
                    </div>
                    <div className="text-sm text-gray-900 mt-2 truncate">
                      房主：{formatPvpDisplayName({ userId: room.host.userId, username: room.host.username, isBot: false })}
                    </div>
                    <div className="text-xs text-gray-500 mt-1 break-all">
                      房间ID：<span className="font-mono">{room.roomId}</span> · 活跃：{activityText}
                    </div>
                  </div>

                  <div className="flex flex-col gap-2">
                    {room.hasPassword && (
                      <div className="space-y-1">
                        <div className="text-xs text-gray-600">房间口令</div>
                        <input
                          className="w-full input-field px-3 py-2 text-sm"
                          value={joinPasswords[room.roomId] || ''}
                          onChange={(e) => setJoinPasswords((prev) => ({ ...prev, [room.roomId]: e.target.value }))}
                          placeholder="输入口令后进入"
                        />
                      </div>
                    )}
                    <button
                      onClick={() => void joinRoom(room)}
                      disabled={!canEnter || isBusy}
                      className="generate-button w-full mb-0 py-2 text-sm"
                      style={{
                        backgroundColor: canEnter ? '#22c55e' : '#94a3b8',
                        backgroundImage: canEnter ? 'linear-gradient(to right, #22c55e, #16a34a)' : 'none',
                      }}
                    >
                      {isBusy ? '进入中…' : canEnter ? '进入房间' : '无法进入'}
                    </button>
                    {room.hasPassword && !canEnter && (
                      <div className="text-xs text-gray-500">提示：该房间不允许观战且已进入对局阶段，无法进入。</div>
                    )}
                  </div>
                </div>

                <details className="mt-3">
                  <summary className="cursor-pointer text-xs text-gray-600 select-none">查看规则与详情</summary>
                  <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2 text-xs text-gray-700">
                    <div className="p-3 rounded-lg bg-gray-50 border">
                      <div>
                        提交模式：
                        {room.rules?.submissionMode === 'hostOnly'
                          ? '仅房主提交牌堆'
                          : `每人提交 ${room.rules?.cardsPerPlayer ?? '—'} 张`}
                      </div>
                      <div>初始手牌：{room.rules?.dealPerPlayer ?? '—'}</div>
                      <div>手牌为空补发：{room.rules?.dealWhenEmpty ?? '—'}</div>
                      <div>抽取来源：{room.rules?.drawSource ?? 'public'}</div>
                      <div>去重：{room.rules?.dedupe ? '开启' : '关闭'}</div>
                      <div>洗牌合池：{room.rules?.shuffleDecks ? '开启' : '关闭'}</div>
                      {room.rules ? (
                        <div>卡牌范围：{describePvpRoomCardRange(normalizePvpRoomCardRange(room.rules as PvpRoomRules))}</div>
                      ) : (
                        <div>卡牌范围：—</div>
                      )}
                    </div>
                    <div className="p-3 rounded-lg bg-gray-50 border">
                      <div>多局制：{room.rules?.bestOf?.enabled ? `开启（最多 ${room.rules.bestOf.maxRounds} 轮）` : '关闭'}</div>
                      <div>展示全部提交：{room.rules?.showAllSubmissions ? '开启' : '关闭'}</div>
                      <div>允许非房主结算：{room.rules?.allowNonHostControl ? '开启' : '关闭'}</div>
                      <div>机器人：{room.players.bots}</div>
                      <div>过期时间：{room.expiresAt ? new Date(room.expiresAt).toLocaleString() : '—'}</div>
                    </div>
                  </div>
                </details>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );

  if (typeof document !== 'undefined') {
    return createPortal(modal, document.body);
  }
  return modal;
}
