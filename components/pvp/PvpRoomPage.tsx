'use client';

import { useEffect, useMemo, useState, type ComponentProps } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { useMutation, useQuery } from '@tanstack/react-query';

import AiProviderSelector, { type UserAIProviderConfig } from '@/components/AiProviderSelector';
import BattleDataModal from '@/components/BattleDataModal';
import BattleReportCard from '@/components/BattleReportCard';
import DataCardDetailsModal from '@/components/DataCardDetailsModal';
import Footer from '@/components/Footer';
import { PresetGridPicker } from '@/components/PresetGridPicker';
import { UserWithTitle } from '@/components/UserTitle';
import { DatabaseSelector } from '@/components/arena/components/DatabaseSelector';
import { usePresetQuery } from '@/components/arena/hooks/useArenaData';
import { PvpHandModal, type PvpHandCardItem } from '@/components/pvp/PvpHandModal';
import { authStorage } from '@/lib/auth';
import { useCooldown } from '@/lib/cooldown';
import { useAuth } from '@/lib/useAuth';
import { buildCustomProviderPayload, isUsingUserProvidedKey } from '@/lib/ai/custom-provider';
import type { PvpRoomRules } from '@/lib/pvp/types';

import type { Preset } from '@/pages/api/get-presets';
import type { UserBadge } from '@/types/badge';

const PASSWORD_CACHE_PREFIX = 'pvp-room-password:';

const getCachedPassword = (roomId: string): string => {
  if (typeof window === 'undefined') return '';
  return sessionStorage.getItem(`${PASSWORD_CACHE_PREFIX}${roomId}`) || '';
};

type ApiErrorPayload = {
  error?: string;
  code?: string;
  traceId?: string;
  detail?: string;
};

class PvpApiError extends Error {
  status: number;
  code?: string;
  traceId?: string;
  detail?: string;

  constructor(message: string, init: { status: number; code?: string; traceId?: string; detail?: string }) {
    super(message);
    this.name = 'PvpApiError';
    this.status = init.status;
    this.code = init.code;
    this.traceId = init.traceId;
    this.detail = init.detail;
  }
}

const readJsonOrText = async (res: Response): Promise<{ data: any; rawText: string }> => {
  const rawText = await res.text();
  if (!rawText) return { data: {}, rawText: '' };
  try {
    return { data: JSON.parse(rawText), rawText };
  } catch {
    return { data: { error: rawText }, rawText };
  }
};

const formatApiErrorMessage = (payload: ApiErrorPayload, status: number): string => {
  const base = payload.error || `请求失败（HTTP ${status}）`;
  const meta: string[] = [];
  if (payload.code) meta.push(`code=${payload.code}`);
  if (payload.traceId) meta.push(`traceId=${payload.traceId}`);
  const lines = [meta.length ? `${base}\n（${meta.join(', ')}）` : base];
  if (payload.detail) lines.push(`详情：${payload.detail}`);
  return lines.join('\n');
};

type CardRef =
  | {
      kind: 'data_card';
      id: string;
      updatedAt?: string | null;
      isPublic: boolean;
      name: string;
      description: string;
      dataJson: string;
      author?: string;
      createdAt?: string;
      likeCount?: number;
      favoriteCount?: number;
      usageCount?: number;
    }
  | { kind: 'preset'; filename: string; name: string; description: string; presetType: Preset['type'] };

type PvpRoomPlayerView = {
  userId: number;
  username: string;
  prefix?: string | null;
  seat?: number | null;
  badges?: UserBadge[];
};

export function PvpRoomPage() {
  const router = useRouter();
  const { user, isAuthenticated, loading } = useAuth();
  const roomId = typeof router.query.roomId === 'string' ? router.query.roomId : '';

  const [userProviderConfig, setUserProviderConfig] = useState<UserAIProviderConfig | null>(null);

  const [joinPassword, setJoinPassword] = useState('');
  const [joined, setJoined] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  const [selected, setSelected] = useState<CardRef[]>([]);
  const [acceptPrivateDisclosure, setAcceptPrivateDisclosure] = useState(false);
  const [showBattleDataModal, setShowBattleDataModal] = useState(false);
  const [showHandModal, setShowHandModal] = useState(false);
  const [isMatching, setIsMatching] = useState<'character' | 'scenario' | null>(null);
  const [mgPage, setMgPage] = useState(1);
  const [canshouPage, setCanshouPage] = useState(1);

  const [detailsCard, setDetailsCard] = useState<ComponentProps<typeof DataCardDetailsModal>['card'] | null>(null);
  const [showDetailsModal, setShowDetailsModal] = useState(false);

  const [showImageModal, setShowImageModal] = useState(false);
  const [savedImageUrl, setSavedImageUrl] = useState<string | null>(null);

  const [roomPasswordDraft, setRoomPasswordDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  const presetsQuery = usePresetQuery();

  const joinMutation = useMutation({
    mutationFn: async (payload: { password?: string }) => {
      const authHeader = await authStorage.getAuthHeader();
      if (!authHeader) throw new Error('未登录');
      const res = await fetch(`/api/pvp/rooms/${roomId}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: authHeader },
        body: JSON.stringify({ password: payload.password || undefined }),
      });
      const { data } = await readJsonOrText(res);
      if (!res.ok) {
        const payload = (data || {}) as ApiErrorPayload;
        throw new PvpApiError(formatApiErrorMessage(payload, res.status), {
          status: res.status,
          code: payload.code,
          traceId: payload.traceId,
          detail: payload.detail,
        });
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
      const { data } = await readJsonOrText(res);
      if (!res.ok) {
        const payload = (data || {}) as ApiErrorPayload;
        throw new PvpApiError(formatApiErrorMessage(payload, res.status), {
          status: res.status,
          code: payload.code,
          traceId: payload.traceId,
          detail: payload.detail,
        });
      }
      return data;
    },
  });

  const room = roomQuery.data?.room;
  const rules: PvpRoomRules | null = room?.rules || null;
  const phase: string = room?.phase || 'unknown';
  const version: number = room?.version ?? 0;
  const lastActivityAt: string | null = typeof room?.lastActivityAt === 'string' ? room.lastActivityAt : null;
  const players = useMemo<PvpRoomPlayerView[]>(() => (Array.isArray(roomQuery.data?.players) ? (roomQuery.data.players as PvpRoomPlayerView[]) : []), [roomQuery.data?.players]);
  const isHost = Boolean(user?.id && room?.hostUserId === user.id);

  useEffect(() => {
    if (phase !== 'choosing') setShowHandModal(false);
  }, [phase]);

  const userIdsForSummary = useMemo(
    () =>
      players
        .map((p: any) => (typeof p?.userId === 'number' ? p.userId : null))
        .filter((id: any): id is number => typeof id === 'number' && Number.isFinite(id)),
    [players]
  );

  const userSummaryQuery = useQuery({
    queryKey: ['pvp', 'user-summaries', userIdsForSummary.slice().sort((a: number, b: number) => a - b).join(',')],
    enabled: Boolean(joined && isAuthenticated && userIdsForSummary.length > 0),
    staleTime: 10_000,
    queryFn: async () => {
      const authHeader = await authStorage.getAuthHeader();
      if (!authHeader) throw new Error('未登录');
      const res = await fetch('/api/pvp/users/summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: authHeader },
        body: JSON.stringify({ userIds: userIdsForSummary }),
      });
      const { data } = await readJsonOrText(res);
      if (!res.ok) {
        const payload = (data || {}) as ApiErrorPayload;
        throw new PvpApiError(formatApiErrorMessage(payload, res.status), {
          status: res.status,
          code: payload.code,
          traceId: payload.traceId,
          detail: payload.detail,
        });
      }
      return data as { users: Array<{ userId: number; wins: number; losses: number; draws: number; completedMatches: number; winRate: number }> };
    },
  });

  const pvpSummaryByUserId = useMemo(() => {
    const map = new Map<number, { wins: number; losses: number; draws: number; completedMatches: number; winRate: number }>();
    const list = userSummaryQuery.data?.users;
    if (!Array.isArray(list)) return map;
    for (const item of list) {
      if (!item || typeof item.userId !== 'number') continue;
      map.set(item.userId, {
        wins: item.wins ?? 0,
        losses: item.losses ?? 0,
        draws: item.draws ?? 0,
        completedMatches: item.completedMatches ?? 0,
        winRate: item.winRate ?? 0,
      });
    }
    return map;
  }, [userSummaryQuery.data?.users]);

  const isUserCustomKey = isUsingUserProvidedKey(userProviderConfig);
  const battleCooldownMs = isUserCustomKey ? 3000 : 120000;
  const battleCooldownStorageKey = isUserCustomKey ? 'pvp.generateBattleCooldown:custom' : 'pvp.generateBattleCooldown:system';
  const { isCooldown, startCooldown, remainingTime } = useCooldown(battleCooldownStorageKey, battleCooldownMs);

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
  const myHand = roomQuery.data?.myHand as { cards?: any[]; discarded?: any[]; drawPile?: any[] } | null | undefined;
  const choices = roomQuery.data?.choices;
  const latestRound = roomQuery.data?.latestRound;
  const latestRoundResult = roomQuery.data?.latestRoundResult;
  const score = roomQuery.data?.score;

  const myHandCards = useMemo<PvpHandCardItem[]>(() => {
    const list = Array.isArray(myHand?.cards) ? myHand?.cards : [];
    return list
      .map((c: any) => ({
        snapshotId: typeof c?.snapshotId === 'string' ? c.snapshotId : String(c?.snapshotId ?? ''),
        name: typeof c?.name === 'string' ? c.name : '未命名',
        type: typeof c?.type === 'string' ? c.type : null,
        dataJson: typeof c?.dataJson === 'string' ? c.dataJson : c?.dataJson ? JSON.stringify(c.dataJson) : null,
        ref: c?.ref ?? null,
      }))
      .filter((c) => Boolean(c.snapshotId));
  }, [myHand?.cards]);

  const hasPrivateSelected = useMemo(() => selected.some((c) => c.kind === 'data_card' && c.isPublic === false), [selected]);
  const selectedPresetFilenames = useMemo(
    () => selected.filter((c): c is Extract<CardRef, { kind: 'preset' }> => c.kind === 'preset').map((c) => c.filename),
    [selected]
  );

  useEffect(() => {
    if (!hasPrivateSelected) {
      setAcceptPrivateDisclosure(false);
    }
  }, [hasPrivateSelected]);

  const leaveMutation = useMutation({
    mutationFn: async () => {
      const authHeader = await authStorage.getAuthHeader();
      if (!authHeader) throw new Error('未登录');
      const res = await fetch(`/api/pvp/rooms/${roomId}/leave`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: authHeader },
        body: JSON.stringify({ expectedVersion: version }),
      });
      const { data } = await readJsonOrText(res);
      if (!res.ok) {
        const payload = (data || {}) as ApiErrorPayload;
        throw new PvpApiError(formatApiErrorMessage(payload, res.status), {
          status: res.status,
          code: payload.code,
          traceId: payload.traceId,
          detail: payload.detail,
        });
      }
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
      const { data } = await readJsonOrText(res);
      if (!res.ok) {
        const payload = (data || {}) as ApiErrorPayload;
        throw new PvpApiError(formatApiErrorMessage(payload, res.status), {
          status: res.status,
          code: payload.code,
          traceId: payload.traceId,
          detail: payload.detail,
        });
      }
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
      const { data } = await readJsonOrText(res);
      if (!res.ok) {
        const payload = (data || {}) as ApiErrorPayload;
        throw new PvpApiError(formatApiErrorMessage(payload, res.status), {
          status: res.status,
          code: payload.code,
          traceId: payload.traceId,
          detail: payload.detail,
        });
      }
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
      const { data } = await readJsonOrText(res);
      if (!res.ok) {
        const payload = (data || {}) as ApiErrorPayload;
        throw new PvpApiError(formatApiErrorMessage(payload, res.status), {
          status: res.status,
          code: payload.code,
          traceId: payload.traceId,
          detail: payload.detail,
        });
      }
      return data;
    },
    onSuccess: () => void roomQuery.refetch(),
    onError: (e) => setError(e instanceof Error ? e.message : '出牌失败'),
  });

  const chooseFromHandModal = async (snapshotId: string) => {
    try {
      await chooseMutation.mutateAsync(snapshotId);
      setShowHandModal(false);
    } catch {
      // error 已由 chooseMutation.onError 处理
    }
  };

  const resolveMutation = useMutation({
    mutationFn: async (payload?: { customProvider?: UserAIProviderConfig | null; force?: boolean }) => {
      if (!latestRound?.id) throw new Error('当前回合不存在，请刷新');
      const authHeader = await authStorage.getAuthHeader();
      if (!authHeader) throw new Error('未登录');

      const customProvider = buildCustomProviderPayload(payload?.customProvider ?? null);
      const res = await fetch(`/api/pvp/rooms/${roomId}/rounds/${latestRound?.id}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: authHeader },
        body: JSON.stringify({
          expectedVersion: version,
          ...(payload?.force ? { force: true } : {}),
          ...(customProvider ? { customProvider } : {}),
        }),
      });
      const { data } = await readJsonOrText(res);
      if (!res.ok) {
        const payload = (data || {}) as ApiErrorPayload;
        throw new PvpApiError(formatApiErrorMessage(payload, res.status), {
          status: res.status,
          code: payload.code,
          traceId: payload.traceId,
          detail: payload.detail,
        });
      }
      return data;
    },
    onSuccess: () => {
      startCooldown();
      void roomQuery.refetch();
    },
    onError: (e: any) => {
      if (e?.code === 'ROOM_RESOLVING' || e?.code === 'ROUND_RESOLVING') return;
      setError(e instanceof Error ? e.message : '结算失败');
    },
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
      const { data } = await readJsonOrText(res);
      if (!res.ok) {
        const payload = (data || {}) as ApiErrorPayload;
        throw new PvpApiError(formatApiErrorMessage(payload, res.status), {
          status: res.status,
          code: payload.code,
          traceId: payload.traceId,
          detail: payload.detail,
        });
      }
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
      const { data } = await readJsonOrText(res);
      if (!res.ok) {
        const payload = (data || {}) as ApiErrorPayload;
        throw new PvpApiError(formatApiErrorMessage(payload, res.status), {
          status: res.status,
          code: payload.code,
          traceId: payload.traceId,
          detail: payload.detail,
        });
      }
      return data;
    },
    onSuccess: () => void roomQuery.refetch(),
    onError: (e) => setError(e instanceof Error ? e.message : '重开失败'),
  });

  const isCustomProviderMissingKey = Boolean(
    userProviderConfig?.providerId && userProviderConfig.providerId !== 'system' && !userProviderConfig.apiKey?.trim()
  );

  const handleResolve = (options?: { force?: boolean }) => {
    if (isCooldown) {
      setError(`冷却中，请等待 ${remainingTime} 秒后再生成战报。`);
      return;
    }
    if (isCustomProviderMissingKey) {
      setError('⚠️ 已选择自定义 AI 供应商，但尚未填写 API Key。');
      return;
    }
    resolveMutation.mutate({ customProvider: userProviderConfig, ...(options?.force ? { force: true } : {}) });
  };

  const kickMutation = useMutation({
    mutationFn: async (targetUserId: number) => {
      const authHeader = await authStorage.getAuthHeader();
      if (!authHeader) throw new Error('未登录');
      const res = await fetch(`/api/pvp/rooms/${roomId}/kick`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: authHeader },
        body: JSON.stringify({ expectedVersion: version, userId: targetUserId }),
      });
      const { data } = await readJsonOrText(res);
      if (!res.ok) {
        const payload = (data || {}) as ApiErrorPayload;
        throw new PvpApiError(formatApiErrorMessage(payload, res.status), {
          status: res.status,
          code: payload.code,
          traceId: payload.traceId,
          detail: payload.detail,
        });
      }
      return data;
    },
    onSuccess: () => void roomQuery.refetch(),
    onError: (e) => setError(e instanceof Error ? e.message : '踢人失败'),
  });

  const cardKey = (c: CardRef): string => (c.kind === 'data_card' ? `data_card:${c.id}` : `preset:${c.filename}`);

  const clearSelected = () => {
    setSelected([]);
    setAcceptPrivateDisclosure(false);
  };

  const removeSelected = (ref: CardRef) => {
    const key = cardKey(ref);
    setSelected((prev) => prev.filter((c) => cardKey(c) !== key));
  };

  const openDetails = async (ref: CardRef) => {
    try {
      if (ref.kind === 'data_card') {
        setDetailsCard({
          id: ref.id,
          name: ref.name,
          description: ref.description || '',
          type: 'character',
          data: ref.dataJson,
          isPublic: ref.isPublic,
          author: ref.author,
          createdAt: ref.createdAt,
          updatedAt: ref.updatedAt ?? undefined,
          likeCount: ref.likeCount,
          favoriteCount: ref.favoriteCount,
          usageCount: ref.usageCount,
        });
        setShowDetailsModal(true);
        return;
      }

      const res = await fetch(`/presets/${ref.filename}`);
      if (!res.ok) {
        throw new Error(`无法读取预设设定：${ref.filename}（HTTP ${res.status}）`);
      }
      const data = await res.json();
      setDetailsCard({
        id: `preset:${ref.filename}`,
        name: ref.name,
        description: ref.description || '',
        type: 'character',
        data: JSON.stringify(data),
        isPublic: true,
        author: '预设角色',
      });
      setShowDetailsModal(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : '打开详情失败');
    }
  };

  const handleSelectDataCardFromModal = (cardData: any) => {
    if (!rules) {
      setError('规则未加载，暂时无法选择卡牌。');
      return;
    }

    const id = typeof cardData?._cardId === 'string' ? cardData._cardId : '';
    if (!id) {
      setError('选择失败：缺少数据卡 ID。');
      return;
    }

    const name = typeof cardData?._cardName === 'string' && cardData._cardName ? cardData._cardName : '未命名';
    const description = typeof cardData?._cardDescription === 'string' ? cardData._cardDescription : '';
    const isPublic =
      typeof cardData?._isPublic === 'boolean'
        ? cardData._isPublic
        : typeof cardData?._isPublic === 'number'
          ? cardData._isPublic === 1
          : false;
    const updatedAt = typeof cardData?._updatedAt === 'string' ? cardData._updatedAt : null;
    const createdAt = typeof cardData?._createdAt === 'string' ? cardData._createdAt : undefined;
    const author = typeof cardData?._author === 'string' ? cardData._author : undefined;

    const payload = { ...(cardData || {}) } as Record<string, unknown>;
    delete payload._cardId;
    delete payload._cardName;
    delete payload._cardDescription;
    delete payload._isPublic;
    delete payload._updatedAt;
    delete payload._createdAt;
    delete payload._author;
    delete payload._likeCount;
    delete payload._favoriteCount;
    delete payload._usageCount;

    const dataJson = JSON.stringify(payload);

    const next: CardRef = {
      kind: 'data_card',
      id,
      updatedAt,
      isPublic,
      name,
      description,
      dataJson,
      author,
      createdAt,
      likeCount: typeof cardData?._likeCount === 'number' ? cardData._likeCount : undefined,
      favoriteCount: typeof cardData?._favoriteCount === 'number' ? cardData._favoriteCount : undefined,
      usageCount: typeof cardData?._usageCount === 'number' ? cardData._usageCount : undefined,
    };

    setSelected((prev) => {
      const alreadySelected = prev.some((c) => c.kind === 'data_card' && c.id === id);
      if (alreadySelected) {
        setError('已选择过该数据卡。');
        return prev;
      }
      if (prev.length >= rules.cardsPerPlayer) {
        setError(`已达到上限：最多选择 ${rules.cardsPerPlayer} 张卡。`);
        return prev;
      }
      setError(null);
      return [...prev, next];
    });
  };

  const handleRandomMatchCharacter = async () => {
    if (!rules) {
      setError('规则未加载，暂时无法随机匹配。');
      return;
    }
    if (selected.length >= rules.cardsPerPlayer) {
      setError(`已达到上限：最多选择 ${rules.cardsPerPlayer} 张卡。`);
      return;
    }

    setIsMatching('character');
    setError('正在从数据库中随机匹配一位公开角色…');
    try {
      const res = await fetch('/api/random-public-card?type=character');
      const { data } = await readJsonOrText(res);
      if (!res.ok || !data?.success) {
        const payload = (data || {}) as ApiErrorPayload;
        throw new PvpApiError(formatApiErrorMessage(payload, res.status), {
          status: res.status,
          code: payload.code,
          traceId: payload.traceId,
          detail: payload.detail,
        });
      }

      const card = data.card;
      const parsed = JSON.parse(card.data);
      handleSelectDataCardFromModal({
        ...parsed,
        _cardId: card.id,
        _cardName: card.name,
        _cardDescription: card.description || '',
        _isPublic: Boolean(card.is_public === 1 || card.is_public === true),
        _updatedAt: card.updated_at,
        _createdAt: card.created_at,
        _author: card.username || '未知',
        _likeCount: typeof card.like_count === 'number' ? card.like_count : undefined,
        _favoriteCount: typeof card.favorite_count === 'number' ? card.favorite_count : undefined,
        _usageCount: typeof card.usage_count === 'number' ? card.usage_count : undefined,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : '随机匹配失败');
    } finally {
      setIsMatching(null);
    }
  };

  const handleTogglePreset = (preset: Preset) => {
    if (!rules) {
      setError('规则未加载，暂时无法选择预设。');
      return;
    }

    setSelected((prev) => {
      const exists = prev.some((c) => c.kind === 'preset' && c.filename === preset.filename);
      if (exists) {
        setError(null);
        return prev.filter((c) => !(c.kind === 'preset' && c.filename === preset.filename));
      }
      if (prev.length >= rules.cardsPerPlayer) {
        setError(`已达到上限：最多选择 ${rules.cardsPerPlayer} 张卡。`);
        return prev;
      }
      setError(null);
      return [...prev, { kind: 'preset', filename: preset.filename, name: preset.name, description: preset.description, presetType: preset.type }];
    });
  };

  useEffect(() => {
    if (!savedImageUrl) return;
    return () => {
      if (savedImageUrl.startsWith('blob:')) {
        URL.revokeObjectURL(savedImageUrl);
      }
    };
  }, [savedImageUrl]);

  return (
    <>
      <Head>
        <title>PVP 房间 - {roomId || '...'}</title>
      </Head>
      <div className="magic-background-white">
        <div className="container">
          <div className="card" style={{ border: '2px solid #ccc', background: '#f9f9f9' }}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <h1 className="text-2xl font-bold text-gray-900">PVP 房间</h1>
                <div className="text-sm text-gray-600 mt-1 break-all">房间ID：{roomId || '加载中…'}</div>
              </div>
              <button onClick={() => window.location.assign('/pvp')} className="text-sm text-blue-600 hover:underline">
                返回大厅
              </button>
            </div>

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
                <div className="mt-5 grid grid-cols-1 gap-4">
                  <div className="p-4 rounded-xl bg-white border text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <div className="font-semibold text-gray-900">房间信息</div>
                      <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 text-xs">阶段：{phase}</span>
                    </div>
                    <div className="mt-2 text-gray-700">版本：{version}</div>
                    {lastActivityAt ? (
                      <div className="mt-1 text-xs text-gray-600">
                        最后活动：{new Date(lastActivityAt).toLocaleString()}
                      </div>
                    ) : null}
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

                  <div className="p-4 rounded-xl bg-white border text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <div className="font-semibold text-gray-900">玩家</div>
                      <div className="text-xs text-gray-500">共 {players.length} 人</div>
                    </div>
                    <div className="mt-3 space-y-2">
                      {players.map((p) => (
                        <div key={p.userId} className="rounded-lg border bg-gray-50 p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex items-center flex-wrap gap-2">
                                <span className="px-2 py-0.5 rounded-full bg-white border text-xs text-gray-700">座位 {p.seat ?? '?'}</span>
                                <UserWithTitle
                                  username={p.username || `用户${p.userId}`}
                                  prefix={p.prefix}
                                  badges={Array.isArray(p.badges) ? p.badges : []}
                                  showBadges={true}
                                  usernameClassName="font-semibold text-gray-900"
                                  titleClassName="text-xs"
                                />
                                {p.userId === room.hostUserId ? (
                                  <span className="px-2 py-0.5 rounded-full bg-purple-50 text-purple-700 text-xs">房主</span>
                                ) : null}
                              </div>
                              <div className="mt-1 text-xs text-gray-600">
                                {(() => {
                                  const s = pvpSummaryByUserId.get(p.userId);
                                  if (!s) return '战绩：暂无';
                                  return `战绩：${s.wins}胜 ${s.losses}负 ${s.draws}平（${s.completedMatches}场，胜率 ${s.winRate}%）`;
                                })()}
                                <span className="ml-2 text-gray-500">（记录可能随时清理）</span>
                              </div>
                            </div>
                            {isHost && p.userId !== room.hostUserId ? (
                              <button
                                className="px-3 py-1.5 rounded-lg border bg-white hover:bg-gray-50 text-xs disabled:opacity-50"
                                onClick={() => kickMutation.mutate(p.userId)}
                                disabled={kickMutation.isPending}
                              >
                                踢出
                              </button>
                            ) : null}
                          </div>
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

                {phase === 'resolving' && (
                  <div className="p-4 rounded-xl border border-amber-200 bg-amber-50 text-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="inline-flex h-4 w-4 rounded-full border-2 border-amber-400 border-t-transparent animate-spin" />
                          <div className="font-semibold text-amber-900">正在结算中…</div>
                        </div>
                        <div className="text-xs text-amber-800 mt-1">
                          页面会自动轮询刷新；如果长时间停留在此状态，可手动刷新。
                        </div>
                        {lastActivityAt ? (
                          <div className="text-xs text-amber-800 mt-1">
                            最后活动：{new Date(lastActivityAt).toLocaleString()}
                          </div>
                        ) : null}
                      </div>
                      <div className="flex gap-2 shrink-0">
                        <button
                          className="px-3 py-2 rounded-lg border bg-white hover:bg-gray-50 text-sm"
                          onClick={() => void roomQuery.refetch()}
                          disabled={roomQuery.isFetching}
                        >
                          {roomQuery.isFetching ? '刷新中…' : '刷新'}
                        </button>
                        {isHost ? (
                          <button
                            className="px-3 py-2 rounded-lg text-sm text-white bg-gradient-to-r from-amber-500 to-orange-500 disabled:opacity-50 disabled:cursor-not-allowed"
                            onClick={() => handleResolve({ force: true })}
                            disabled={resolveMutation.isPending || isCooldown || isCustomProviderMissingKey}
                            title="仅房主可用：当结算请求意外中断时用于强制重试"
                          >
                            {resolveMutation.isPending ? '重试中…' : '强制重试'}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                )}

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

                      <div className="text-xs text-gray-600 mb-3">
                        注意：提交私有卡会让对手可查看完整 JSON（问卷/能力/设定全量）。
                      </div>

                      <DatabaseSelector
                        onOpenCharacterModal={() => setShowBattleDataModal(true)}
                        onRandomMatchCharacter={handleRandomMatchCharacter}
                        isAuthenticated={isAuthenticated}
                        isGenerating={submitMutation.isPending}
                        isMatching={isMatching}
                        combatantCount={selected.length}
                        maxCombatants={rules.cardsPerPlayer}
                      />

                      {presetsQuery.isLoading && <div className="text-sm text-gray-500 mb-4">正在加载预设列表…</div>}
                      {presetsQuery.error && (
                        <div className="text-sm text-red-600 mb-4">
                          无法加载预设列表：{(presetsQuery.error as Error).message}
                        </div>
                      )}
                      {presetsQuery.grouped && (
                        <>
                          <PresetGridPicker
                            title="选择预设魔法少女"
                            presets={presetsQuery.grouped.magicalGirl}
                            currentPage={mgPage}
                            onPageChange={setMgPage}
                            disabled={submitMutation.isPending}
                            maxSelected={rules.cardsPerPlayer}
                            selectedCountOverride={selected.length}
                            selectedFilenames={selectedPresetFilenames}
                            onToggle={handleTogglePreset}
                          />
                          <PresetGridPicker
                            title="选择预设残兽"
                            presets={presetsQuery.grouped.canshou}
                            currentPage={canshouPage}
                            onPageChange={setCanshouPage}
                            disabled={submitMutation.isPending}
                            maxSelected={rules.cardsPerPlayer}
                            selectedCountOverride={selected.length}
                            selectedFilenames={selectedPresetFilenames}
                            onToggle={handleTogglePreset}
                          />
                        </>
                      )}

                      {selected.length > 0 && (
                        <div className="mb-4 p-3 bg-gray-200 rounded-lg">
                          <div className="flex justify-between items-center m-0 top-0 right-0">
                            <p className="font-semibold text-sm text-gray-700">
                              已选卡组 ({selected.length}/{rules.cardsPerPlayer})
                            </p>
                            <button
                              onClick={clearSelected}
                              disabled={submitMutation.isPending}
                              className="text-sm text-red-500 hover:underline cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              清空列表
                            </button>
                          </div>

                          <ul className="list-disc list-inside text-sm text-gray-700 mt-2 space-y-2">
                            {selected.map((c) => {
                              const key = cardKey(c);
                              const title = c.kind === 'preset' ? `${c.name}（预设）` : c.name;
                              const tag =
                                c.kind === 'preset'
                                  ? c.presetType === 'canshou'
                                    ? '(残兽预设)'
                                    : '(魔法少女预设)'
                                  : c.isPublic
                                    ? '(公开数据卡)'
                                    : '(私有数据卡)';

                              return (
                                <li key={key} className="flex justify-between items-start gap-2">
                                  <div className="flex items-center flex-grow min-w-0">
                                    <span className="break-words mr-2" title={title}>
                                      {title}
                                      <span className="text-xs text-gray-500 ml-1">{tag}</span>
                                    </span>
                                  </div>
                                  <div className="flex items-center flex-shrink-0">
                                    <button
                                      onClick={() => openDetails(c)}
                                      className="text-xs bg-gray-200 text-gray-700 px-2 py-1 rounded hover:bg-gray-300 mr-2"
                                      disabled={submitMutation.isPending}
                                    >
                                      详情
                                    </button>
                                    <button
                                      onClick={() => removeSelected(c)}
                                      className={`w-5 h-5 bg-red-200 text-red-700 rounded-full flex items-center justify-center text-xs font-bold transition-colors flex-shrink-0 ${
                                        submitMutation.isPending ? 'opacity-50 cursor-not-allowed' : 'hover:bg-red-300'
                                      }`}
                                      aria-label={`移除 ${title}`}
                                      disabled={submitMutation.isPending}
                                    >
                                      X
                                    </button>
                                  </div>
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      )}

                      {hasPrivateSelected && (
                        <label className="flex items-center gap-2 text-sm mb-3">
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
                  </div>
                )}

                {phase === 'choosing' && (
                  <div className="mt-4">
                    <div className="p-4 rounded-xl bg-white border">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-semibold text-sm text-gray-900">我的手牌</div>
                          <div className="text-xs text-gray-600 mt-1">
                            手牌 {myHandCards.length} 张；弃牌 {Array.isArray(myHand?.discarded) ? myHand?.discarded.length : 0} 张；
                            牌堆 {Array.isArray(myHand?.drawPile) ? myHand?.drawPile.length : 0} 张
                          </div>
                        </div>
                        <button
                          className="px-3 py-2 rounded-lg border bg-white hover:bg-gray-50 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                          onClick={() => setShowHandModal(true)}
                          disabled={myHandCards.length <= 0}
                        >
                          打开手牌
                        </button>
                      </div>

                      {myHandCards.length <= 0 && <div className="text-sm text-gray-700 mt-3">暂无手牌数据，请刷新。</div>}

                      <div className="text-sm text-gray-700 mt-3">
                        已选人数：{choices?.chosenCount ?? 0} / {choices?.totalPlayers ?? players.length}；
                        我方已选：{choices?.hasChosenMe ? '是' : '否'}
                        {typeof choices?.hasChosenOther === 'boolean' ? ` / 对手已选：${choices.hasChosenOther ? '是' : '否'}` : ''}
                      </div>

                      {Boolean(
                        choices?.hasChosenMe &&
                        (choices?.chosenCount ?? 0) >= (choices?.totalPlayers ?? players.length)
                      ) && (
                        <>
                          <details className="mt-3 rounded-md bg-white border">
                            <summary className="cursor-pointer px-3 py-2 text-sm font-semibold">AI 设置（可选）</summary>
                            <div className="px-3 pb-3">
                              <AiProviderSelector onConfigChange={setUserProviderConfig} />
                              <div className="mt-2 text-xs text-gray-600">
                                使用自带 API Key：冷却 3 秒；使用系统默认：冷却 120 秒。
                                {isCooldown ? `（剩余 ${remainingTime} 秒）` : ''}
                              </div>
                              {isCustomProviderMissingKey && (
                                <div className="mt-2 text-xs text-red-600">已选择自定义供应商但 API Key 为空，请补齐或切回系统默认。</div>
                              )}
                            </div>
                          </details>

                          <button
                            className="generate-button mt-3 w-full"
                            style={{ backgroundColor: '#f59e0b', backgroundImage: 'linear-gradient(to right, #f59e0b, #d97706)' }}
                            onClick={() => handleResolve()}
                            disabled={resolveMutation.isPending || isCooldown || isCustomProviderMissingKey}
                          >
                            {resolveMutation.isPending
                              ? '结算中…'
                              : isCooldown
                                ? `冷却中（${remainingTime}s）`
                                : '结算（生成战报）'}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )}

                <PvpHandModal
                  isOpen={showHandModal}
                  onClose={() => setShowHandModal(false)}
                  cards={myHandCards}
                  hasChosenMe={Boolean(choices?.hasChosenMe)}
                  isChoosing={chooseMutation.isPending}
                  onOpenDetails={(c) => {
                    const refKind = typeof c?.ref?.kind === 'string' ? c.ref.kind : '';
                    const author =
                      refKind === 'preset' ? '预设角色（快照）' : refKind === 'data_card' ? '数据卡（快照）' : 'PVP 快照';
                    setDetailsCard({
                      id: String(c.snapshotId),
                      name: c.name || '未命名',
                      description: refKind ? `PVP 手牌（${refKind}）` : 'PVP 手牌（快照）',
                      type: 'character',
                      data: typeof c.dataJson === 'string' ? c.dataJson : JSON.stringify(c.dataJson ?? {}),
                      isPublic: true,
                      author,
                    });
                    setShowDetailsModal(true);
                  }}
                  onChoose={chooseFromHandModal}
                />

                {latestRoundResult?.report && (
                  <div className="mt-4">
                    <BattleReportCard
                      report={latestRoundResult.report}
                      mode={rules?.mode as any}
                      onSaveImage={(imageUrl) => {
                        setSavedImageUrl(imageUrl);
                        setShowImageModal(true);
                      }}
                    />
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
                          {playerLabelById.get(s.userId) || `用户${s.userId}`}：已提交 {s.cards?.length || 0} 张{s.hasPrivateCard ? '（含私有）' : ''}
                        </summary>
                        <div className="mt-2 space-y-2">
                          {(s.cards || []).map((c: any, idx: number) => {
                            const label = `${c.name || '未命名'} / ${c.type || 'unknown'} / ${c.source?.isPublic ? '公开' : '私有'}`;
                            return (
                              <div key={`${idx}-${c.name}`} className="text-xs border rounded p-2 bg-gray-50 flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="font-semibold break-words">{label}</div>
                                  {c.source?.authorUsername && (
                                    <div className="text-[11px] text-gray-600 mt-1">作者：{c.source.authorUsername}</div>
                                  )}
                                </div>
                                <button
                                  className="px-2 py-1 rounded border bg-white hover:bg-gray-100 flex-shrink-0"
                                  onClick={() => {
                                    setDetailsCard({
                                      id: `pvp:submission:${s.userId}:${idx}`,
                                      name: c.name || '未命名',
                                      description: `PVP 提交卡（${playerLabelById.get(s.userId) || `用户${s.userId}` }）`,
                                      type: 'character',
                                      data: typeof c.dataJson === 'string' ? c.dataJson : JSON.stringify(c.dataJson ?? {}),
                                      isPublic: Boolean(c.source?.isPublic ?? true),
                                      author: c.source?.authorUsername || (playerLabelById.get(s.userId) || `用户${s.userId}`),
                                    });
                                    setShowDetailsModal(true);
                                  }}
                                >
                                  详情
                                </button>
                              </div>
                            );
                          })}
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

      <BattleDataModal
        isOpen={showBattleDataModal}
        onClose={() => setShowBattleDataModal(false)}
        onSelectCard={handleSelectDataCardFromModal}
        selectedType="character"
      />

      {detailsCard && (
        <DataCardDetailsModal
          isOpen={showDetailsModal}
          onClose={() => {
            setShowDetailsModal(false);
            setDetailsCard(null);
          }}
          card={detailsCard}
        />
      )}

      {showImageModal && savedImageUrl && (
        <div
          className="fixed inset-0 bg-black flex items-center justify-center z-50"
          style={{ backgroundColor: 'rgba(0, 0, 0, 0.7)', paddingLeft: '2rem', paddingRight: '2rem' }}
        >
          <div className="bg-white rounded-lg max-w-lg w-full max-h-[80vh] overflow-auto relative">
            <div className="flex justify-between items-center m-0">
              <div></div>
              <button
                onClick={() => {
                  setShowImageModal(false);
                  setSavedImageUrl(null);
                }}
                className="text-gray-500 hover:text-gray-700 text-3xl leading-none"
                style={{ marginRight: '0.5rem' }}
              >
                ×
              </button>
            </div>
            <p className="text-center text-sm text-gray-600" style={{ marginTop: '0.5rem' }}>
              📱 长按图片保存到相册
            </p>
            <div className="items-center flex flex-col" style={{ padding: '0.5rem' }}>
              <img src={savedImageUrl} alt="战报" className="max-w-full h-auto rounded" />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
