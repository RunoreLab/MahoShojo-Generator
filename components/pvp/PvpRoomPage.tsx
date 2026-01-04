'use client';

import { useEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { useMutation, useQuery } from '@tanstack/react-query';

import AiProviderSelector, { type UserAIProviderConfig } from '@/components/AiProviderSelector';
import BattleDataModal from '@/components/BattleDataModal';
import BattleReportCard from '@/components/BattleReportCard';
import DataCardDetailsModal from '@/components/DataCardDetailsModal';
import Footer from '@/components/Footer';
import { PresetGridPicker } from '@/components/PresetGridPicker';
import StreamingBattleReportCard from '@/components/stream/StreamingBattleReportCard';
import { UserWithTitle } from '@/components/UserTitle';
import { DatabaseSelector } from '@/components/arena/components/DatabaseSelector';
import { useLanguagesQuery, usePresetQuery } from '@/components/arena/hooks/useArenaData';
import { PvpChatPanel } from '@/components/pvp/PvpChatPanel';
import { PvpHeroBanner } from '@/components/pvp/PvpHeroBanner';
import { PvpScoreboard } from '@/components/pvp/PvpScoreboard';
import { PvpUpdatedCombatantsPanel } from '@/components/pvp/PvpUpdatedCombatantsPanel';
import { AdjudicatorSettingsPanel } from '@/components/shared/AdjudicatorSettingsPanel';
import { ArenaDataSettingsPanel } from '@/components/shared/ArenaDataSettingsPanel';
import { BattleModeSelector } from '@/components/shared/BattleModeSelector';
import { ScenarioPickerPanel } from '@/components/shared/ScenarioPickerPanel';
import { StoryOptionsPanel } from '@/components/shared/StoryOptionsPanel';
import { GenerationModeSwitcher } from '@/components/shared/GenerationModeSwitcher';
import { ImagePreviewModal } from '@/components/shared/ImagePreviewModal';
import { PvpSettlementCardModal } from '@/components/pvp/PvpSettlementCardModal';
import { authStorage } from '@/lib/auth';
import { copyTextToClipboard } from '@/lib/clipboard';
import { useCooldown } from '@/lib/cooldown';
import { inferTemplate } from '@/lib/data-card-converter';
	import { config as appConfig } from '@/lib/config';
	import { useAuth } from '@/lib/useAuth';
	import { buildCustomProviderPayload, isUsingUserProvidedKey } from '@/lib/ai/custom-provider';
	import { describePvpRoomCardRange, isPvpCombatantTypeAllowedByRange, isPvpDataCardStatsAllowedByRange, normalizePvpRoomCardRange } from '@/lib/pvp/card-range';
	import { formatPvpDisplayName } from '@/lib/pvp/displayName';
	import { inferPvpCombatantTypeFromJson } from '@/lib/pvp/logic';
	import { buildPvpScenarioRulesPatch } from '@/lib/pvp/rules-patch';
	import { isLegacyAdjudicatorFormat, mergeAdjudicationEvents } from '@/lib/pvp/adjudication-events';
	import type { PvpRoomRules, PvpScenarioSelection } from '@/lib/pvp/types';
	import { canViewOtherSubmissions } from '@/lib/pvp/submission-visibility';
	import { createStreamReadWithTimeout } from '@/lib/stream/timeout';

import type { Preset } from '@/lib/presets';
import type { UserBadge } from '@/types/badge';
import { revokeBlobUrl } from '@/lib/client/blobUrl';

	const PASSWORD_CACHE_PREFIX = 'pvp-room-password:';
	const RESOLVE_REQUEST_TIMEOUT_MS = 120_000;
	const RESOLVE_STALE_WARNING_SECONDS = Math.floor(RESOLVE_REQUEST_TIMEOUT_MS / 1000);
	const RESOLVE_STREAM_IDLE_TIMEOUT_MS = 60_000;
	const RESOLVE_STREAM_TOTAL_TIMEOUT_MS = 10 * 60_000;

const getCachedPassword = (roomId: string): string => {
  if (typeof window === 'undefined') return '';
  return sessionStorage.getItem(`${PASSWORD_CACHE_PREFIX}${roomId}`) || '';
};

const removePrivateKeys = (obj: any): any => {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(removePrivateKeys);
  }
  const cleaned: any = {};
  for (const key of Object.keys(obj)) {
    if (!key.startsWith('_')) {
      cleaned[key] = removePrivateKeys(obj[key]);
    }
  }
  return cleaned;
};

const clonePvpRoomRules = (rules: PvpRoomRules): PvpRoomRules => {
  try {
    return JSON.parse(JSON.stringify(rules)) as PvpRoomRules;
  } catch {
    return {
      ...rules,
      adjudicationEvents: Array.isArray((rules as any).adjudicationEvents) ? ([...(rules as any).adjudicationEvents] as any) : [],
    };
  }
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

const looksLikeHtml = (rawText: string, contentType: string | null): boolean => {
  const ct = (contentType || '').toLowerCase();
  if (ct.includes('text/html')) return true;
  const head = rawText.trimStart().slice(0, 200).toLowerCase();
  return head.startsWith('<!doctype html') || head.startsWith('<html') || head.startsWith('<head') || head.startsWith('<body');
};

const inferCloudflareGatewayMessage = (status: number, rawText: string): string | null => {
  const text = rawText.toLowerCase();
  if (!text.includes('cloudflare')) return null;
  const codeMatch = rawText.match(/Error code\\s+(\\d{3})/i);
  const code = codeMatch ? Number(codeMatch[1]) : status;
  if (!Number.isFinite(code) || code < 500) return null;
  return `网关错误（HTTP ${code}）。这通常表示 Cloudflare 到源站/边缘函数的请求失败或超时，请稍后重试；若持续发生请截图并附上发生时间。`;
};

const summarizeNonJsonResponse = (res: Response, rawText: string): { error: string; code: string; detail?: string } => {
  const status = res.status;
  const cf = inferCloudflareGatewayMessage(status, rawText);
  if (cf) return { error: cf, code: 'CLOUDFLARE_GATEWAY_ERROR' };
  if (looksLikeHtml(rawText, res.headers.get('content-type'))) {
    return {
      error: `服务器返回了 HTML 错误页（HTTP ${status}）。请稍后重试或刷新页面。`,
      code: 'HTML_ERROR_RESPONSE',
    };
  }
  const trimmed = rawText.trim();
  const preview = trimmed.length > 240 ? `${trimmed.slice(0, 240)}…` : trimmed;
  return {
    error: preview ? `请求失败（HTTP ${status}）：${preview}` : `请求失败（HTTP ${status}）`,
    code: 'NON_JSON_RESPONSE',
  };
};

const fetchWithTimeout = async (input: RequestInfo | URL, init: RequestInit, timeoutMs: number): Promise<Response> => {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(input, { ...init, signal: controller.signal });
    return res;
  } finally {
    window.clearTimeout(timeoutId);
  }
};

const readJsonOrText = async (res: Response): Promise<{ data: any; rawText: string }> => {
  const rawText = await res.text();
  if (!rawText) return { data: {}, rawText: '' };
  const contentType = res.headers.get('content-type');
  const trimmed = rawText.trimStart();
  const shouldTryJson =
    (contentType || '').toLowerCase().includes('application/json') ||
    (contentType || '').toLowerCase().includes('+json') ||
    trimmed.startsWith('{') ||
    trimmed.startsWith('[');
  if (shouldTryJson) {
    try {
      return { data: JSON.parse(rawText), rawText };
    } catch {
      // fall through
    }
  }
  return { data: summarizeNonJsonResponse(res, rawText), rawText };
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

type PvpHandCardItem = {
  snapshotId: string;
  name: string;
  type?: string | null;
  dataJson?: string | null;
  ref?: any;
};

type WinnerVoteChoice =
  | { kind: 'seat'; seat: number }
  | { kind: 'draw' };

type PvpRoomPlayerView = {
  userId: number;
  username: string;
  prefix?: string | null;
  seat?: number | null;
  badges?: UserBadge[];
  isBot?: boolean;
  botId?: string | null;
};

type PvpRoomSpectatorView = {
  userId: number;
  username: string;
  prefix?: string | null;
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
  const [copiedKey, setCopiedKey] = useState<'id' | 'link' | null>(null);

  const [selected, setSelected] = useState<CardRef[]>([]);
  const [acceptPrivateDisclosure, setAcceptPrivateDisclosure] = useState(false);
  const [showSubmitEditor, setShowSubmitEditor] = useState(false);
  const [showBattleDataModal, setShowBattleDataModal] = useState(false);
  const [showHandModal, setShowHandModal] = useState(false);
  const [myCharacterGuidanceDraft, setMyCharacterGuidanceDraft] = useState('');
  const [isMatching, setIsMatching] = useState<'character' | 'scenario' | null>(null);
  const [mgPage, setMgPage] = useState(1);
  const [canshouPage, setCanshouPage] = useState(1);

  const [detailsCard, setDetailsCard] = useState<ComponentProps<typeof DataCardDetailsModal>['card'] | null>(null);
  const [showDetailsModal, setShowDetailsModal] = useState(false);

  const [showImageModal, setShowImageModal] = useState(false);
  const [savedImageUrl, setSavedImageUrl] = useState<string | null>(null);
  const [showSettlementCardModal, setShowSettlementCardModal] = useState(false);

  const [roomPasswordDraft, setRoomPasswordDraft] = useState('');
  const [rulesDraft, setRulesDraft] = useState<PvpRoomRules | null>(null);
  const [scenarioDraft, setScenarioDraft] = useState<PvpScenarioSelection | null>(null);
  const autoScenarioImportKeyRef = useRef<string>('');
  const [isScenarioMatching, setIsScenarioMatching] = useState(false);
  const [showScenarioModal, setShowScenarioModal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [winnerVoteDraft, setWinnerVoteDraft] = useState<WinnerVoteChoice | null>(null);
  const [streamingResolveMarkdown, setStreamingResolveMarkdown] = useState('');
  const [streamingResolveMeta, setStreamingResolveMeta] = useState<any | null>(null);
  const [isStreamingResolve, setIsStreamingResolve] = useState(false);

  const [versionConflictRetryUntil, setVersionConflictRetryUntil] = useState<number | null>(null);
  const [versionConflictSecondsLeft, setVersionConflictSecondsLeft] = useState(0);

  const clearVersionConflictRetry = () => {
    setVersionConflictRetryUntil(null);
    setVersionConflictSecondsLeft(0);
  };

  const scheduleVersionConflictRetry = (message: string) => {
    const until = Date.now() + 3000;
    setError(message);
    setVersionConflictRetryUntil(until);
    setVersionConflictSecondsLeft(3);
  };

  const handlePvpRequestError = (e: unknown, fallback: string) => {
    const err = e as any;
    const rawMessage = e instanceof Error ? e.message : fallback;
    const message = rawMessage.length > 1200 ? `${rawMessage.slice(0, 1200)}…（已截断，详见控制台）` : rawMessage;
    if (rawMessage.length > 1200) {
      console.error('[pvp] 错误信息过长（已在 UI 截断）：', rawMessage);
    }

    if (err?.name === 'AbortError') {
      clearVersionConflictRetry();
      setError(`${fallback}：请求超时，请检查网络后重试；若多次出现请刷新页面或稍后再试。`);
      return;
    }

    if (err?.code === 'VERSION_CONFLICT') {
      scheduleVersionConflictRetry(message);
      return;
    }

    clearVersionConflictRetry();
    setError(message);
  };

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!versionConflictRetryUntil) return;

    const tick = () => {
      const msLeft = versionConflictRetryUntil - Date.now();
      const secondsLeft = Math.max(0, Math.ceil(msLeft / 1000));
      setVersionConflictSecondsLeft(secondsLeft);
      if (msLeft <= 0) window.location.reload();
    };

    tick();
    const intervalId = window.setInterval(tick, 200);
    return () => window.clearInterval(intervalId);
  }, [versionConflictRetryUntil]);

  const presetsQuery = usePresetQuery();
  const languagesQuery = useLanguagesQuery();

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
      const res = await fetchWithTimeout(`/api/pvp/rooms/${roomId}`, { headers: { Authorization: authHeader } }, 8000);
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
  const roomScenario = (room as any)?.scenario ?? null;
  const scenarioAdjudicationImportedFor: string | null =
    typeof (room as any)?.scenarioAdjudicationImportedFor === 'string'
      ? String((room as any).scenarioAdjudicationImportedFor).trim() || null
      : null;
  const phase: string = room?.phase || 'unknown';
  const version: number = room?.version ?? 0;
  const lastActivityAt: string | null = typeof room?.lastActivityAt === 'string' ? room.lastActivityAt : null;
  const viewer = (roomQuery.data as any)?.viewer ?? null;
  const viewerRole: 'player' | 'spectator' = viewer?.role === 'spectator' ? 'spectator' : 'player';
  const isSpectator = viewerRole === 'spectator';
  const canSwitchToPlayer = viewer?.canSwitchToPlayer === true;
  const canSwitchToSpectator = viewer?.canSwitchToSpectator === true;

  const canSeeAllSubmissionDetails = !isSpectator && canViewOtherSubmissions(phase, rules?.showAllSubmissions === true);
  const players = useMemo<PvpRoomPlayerView[]>(() => (Array.isArray(roomQuery.data?.players) ? (roomQuery.data.players as PvpRoomPlayerView[]) : []), [roomQuery.data?.players]);
  const spectators = useMemo<PvpRoomSpectatorView[]>(
    () => (Array.isArray((roomQuery.data as any)?.spectators) ? (((roomQuery.data as any).spectators) as PvpRoomSpectatorView[]) : []),
    [roomQuery.data]
  );
  const isHost = Boolean(user?.id && room?.hostUserId === user.id);
  const allowNonHostControl = rules?.allowNonHostControl === true;
  const allowPlayerCharacterGuidance = rules?.allowPlayerCharacterGuidance === true;
  const allowSpectators = rules?.allowSpectators !== false;
  const allowSpectatorChat = rules?.allowSpectatorChat === true;
  const canControlResolve = isHost || allowNonHostControl;

  const [nowTickMs, setNowTickMs] = useState<number>(() => Date.now());
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (phase !== 'resolving' && phase !== 'advancing') return;
    const intervalId = window.setInterval(() => setNowTickMs(Date.now()), 1000);
    return () => window.clearInterval(intervalId);
  }, [phase]);

  const lastActivityAgeSeconds = useMemo(() => {
    if (!lastActivityAt) return null;
    const ms = nowTickMs - Date.parse(lastActivityAt);
    if (!Number.isFinite(ms)) return null;
    return Math.max(0, Math.floor(ms / 1000));
  }, [lastActivityAt, nowTickMs]);

  const flashCopied = (key: 'id' | 'link') => {
    setCopiedKey(key);
    window.setTimeout(() => setCopiedKey(null), 1500);
  };

  const handleCopyRoomId = async () => {
    if (!roomId) return;
    const ok = await copyTextToClipboard(roomId);
    if (ok) {
      flashCopied('id');
      return;
    }
    setError('复制失败：当前环境不支持剪贴板。');
  };

  const handleCopyRoomLink = async () => {
    if (!roomId || typeof window === 'undefined') return;
    const link = `${window.location.origin}/pvp/${roomId}`;
    const ok = await copyTextToClipboard(link);
    if (ok) {
      flashCopied('link');
      return;
    }
    setError('复制失败：当前环境不支持剪贴板。');
  };

  const winnerVote = (roomQuery.data as any)?.winnerVote ?? null;

  useEffect(() => {
    if (!roomId) {
      setRulesDraft(null);
      return;
    }
    if (!rulesDraft && rules) setRulesDraft(clonePvpRoomRules(rules));
  }, [roomId, rules, rulesDraft]);

  useEffect(() => {
    if (!isHost) return;
    if (!rules || !roomScenario || typeof roomScenario !== 'object') return;
    const id = typeof (roomScenario as any).sourceDataCardId === 'string' ? String((roomScenario as any).sourceDataCardId).trim() : '';
    if (!id) return;
    const updatedAt =
      typeof (roomScenario as any).sourceDataCardUpdatedAt === 'string' ? String((roomScenario as any).sourceDataCardUpdatedAt) : null;
    const key = `${id}|${updatedAt ?? ''}`;
    if (scenarioAdjudicationImportedFor !== key) return;
    if (autoScenarioImportKeyRef.current !== key) return;

    setRulesDraft((draft) => {
      if (!draft) return clonePvpRoomRules(rules);
      const currentEvents = Array.isArray((draft as any).adjudicationEvents) ? (draft as any).adjudicationEvents : [];
      if (currentEvents.length > 0) return draft;
      return { ...draft, adjudicationEvents: Array.isArray(rules.adjudicationEvents) ? rules.adjudicationEvents : [] };
    });
  }, [autoScenarioImportKeyRef, isHost, roomScenario, rules, scenarioAdjudicationImportedFor]);

  useEffect(() => {
    if (phase !== 'choosing') setShowHandModal(false);
  }, [phase]);

  useEffect(() => {
    if (phase !== 'choosing') setMyCharacterGuidanceDraft('');
  }, [phase]);

  useEffect(() => {
    if (!isHost && !allowPlayerCharacterGuidance) setMyCharacterGuidanceDraft('');
  }, [allowPlayerCharacterGuidance, isHost]);

  useEffect(() => {
    if (phase !== 'submitting') setShowSubmitEditor(false);
  }, [phase]);

  useEffect(() => {
    if (phase !== 'voting') {
      setWinnerVoteDraft(null);
      return;
    }
    const myChoice = (winnerVote as any)?.myChoice ?? null;
    if (myChoice && typeof myChoice === 'object' && (myChoice.kind === 'draw' || myChoice.kind === 'seat')) {
      setWinnerVoteDraft(myChoice as WinnerVoteChoice);
    }
  }, [phase, winnerVote]);

  const userIdsForSummary = useMemo(
    () =>
      players
        .filter((p: any) => !p?.isBot)
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

  const playerDisplayBySeat = useMemo(() => {
    const map = new Map<number, string>();
    for (const p of players) {
      const seat = typeof p?.seat === 'number' ? p.seat : null;
      if (seat === null) continue;
      map.set(seat, formatPvpDisplayName({ userId: p?.userId ?? null, username: p?.username ?? null, isBot: p?.isBot ?? null }));
    }
    return map;
  }, [players]);

  const usernameById = useMemo(() => {
    const map = new Map<number, string>();
    for (const p of players) {
      const userId = typeof p?.userId === 'number' ? p.userId : null;
      if (!userId) continue;
      const username = typeof p.username === 'string' && p.username ? p.username : `用户${userId}`;
      map.set(userId, username);
    }
    return map;
  }, [players]);

  const submissions = useMemo(() => (Array.isArray(roomQuery.data?.submissions) ? roomQuery.data.submissions : []), [roomQuery.data?.submissions]);
  const submissionStatus = useMemo(
    () => (Array.isArray((roomQuery.data as any)?.submissionStatus) ? (roomQuery.data as any).submissionStatus : []),
    [roomQuery.data],
  );
  const submissionStatusByUserId = useMemo(() => {
    const map = new Map<number, { hasSubmitted: boolean; submittedCount: number; hasPrivateCard: boolean }>();
    for (const item of submissionStatus as any[]) {
      const userId = typeof item?.userId === 'number' ? item.userId : null;
      if (userId === null) continue;
      map.set(userId, {
        hasSubmitted: item?.hasSubmitted === true,
        submittedCount: Number.isFinite(item?.submittedCount) ? Number(item.submittedCount) : 0,
        hasPrivateCard: item?.hasPrivateCard === true,
      });
    }
    return map;
  }, [submissionStatus]);
  const submissionStatusBySeat = useMemo(() => {
    return players.map((p) => {
      const userId = typeof p?.userId === 'number' ? p.userId : null;
      const fallback = { hasSubmitted: false, submittedCount: 0, hasPrivateCard: false };
      const status = userId === null ? fallback : (submissionStatusByUserId.get(userId) ?? fallback);
      return { userId, seat: p.seat ?? null, isBot: Boolean(p.isBot), ...status };
    });
  }, [players, submissionStatusByUserId]);
  const submittedParticipantCount = useMemo(
    () => submissionStatusBySeat.filter((s) => s.hasSubmitted).length,
    [submissionStatusBySeat],
  );

  const totalParticipants = players.length;
  const canStartNow = totalParticipants >= 2;
  const willShrinkParticipants = Boolean(rules && canStartNow && totalParticipants < rules.participants);
  const handleStartClick = () => {
    if (!rules) return;
    if (!canStartNow) return;
    if (willShrinkParticipants) {
      const needSubmission = rules.submissionMode === 'hostOnly' || rules.cardsPerPlayer > 0;
      const actionText =
        phase === 'waiting' && needSubmission
          ? (rules.submissionMode === 'hostOnly' ? '进入“房主提交牌堆”阶段' : '进入“提交卡组”阶段')
          : '立即开始发牌';
      const ok = window.confirm(`房间未满员：将把人数从 ${rules.participants} 缩减为 ${totalParticipants}，并${actionText}。继续？`);
      if (!ok) return;
    }
    startMutation.mutate();
  };
  const mySubmission = useMemo(() => {
    const myUserId = user?.id;
    if (!myUserId) return null;
    return submissions.find((s: any) => typeof s?.userId === 'number' && s.userId === myUserId) ?? null;
  }, [submissions, user?.id]);

  const myHand = roomQuery.data?.myHand as { cards?: any[]; discarded?: any[]; drawPile?: any[] } | null | undefined;
  const choices = roomQuery.data?.choices;
  const latestRound = roomQuery.data?.latestRound;
  const latestRoundResult = roomQuery.data?.latestRoundResult;
  const confirmations = roomQuery.data?.confirmations as { roundId: string; confirmedHumans: number; totalHumans: number; hasConfirmedMe: boolean } | null | undefined;
  const pendingAction = roomQuery.data?.pendingAction as
    | { kind: 'submit' | 'choose' | 'confirm' | 'vote'; pendingUserId: number; pendingUsername?: string | null; deadlineAt: string; secondsLeft?: number; canHostForce?: boolean }
    | null
    | undefined;

  const latestRoundId = typeof (latestRound as any)?.id === 'string' ? String((latestRound as any).id) : null;
  const latestRoundStatus = typeof (latestRound as any)?.status === 'string' ? String((latestRound as any).status) : null;

  const latestBattleGenerationId =
    typeof (latestRound as any)?.battleGenerationId === 'string' ? String((latestRound as any).battleGenerationId).trim() : null;

  const [loadedBattleReportGenerationId, setLoadedBattleReportGenerationId] = useState<string | null>(null);
  const [loadedBattleReportMarkdown, setLoadedBattleReportMarkdown] = useState('');
  const [loadedBattleReport, setLoadedBattleReport] = useState<any | null>(null);
  const [loadedBattleReportError, setLoadedBattleReportError] = useState<string | null>(null);

  useEffect(() => {
    setStreamingResolveMarkdown('');
    setStreamingResolveMeta(null);
    setIsStreamingResolve(false);
    setLoadedBattleReportGenerationId(null);
    setLoadedBattleReportMarkdown('');
    setLoadedBattleReport(null);
    setLoadedBattleReportError(null);
  }, [roomId, latestRound?.id]);
  const score = roomQuery.data?.score;

  const pendingActionDeadlineAt = typeof pendingAction?.deadlineAt === 'string' ? pendingAction.deadlineAt : null;
  const [pendingActionSecondsLeft, setPendingActionSecondsLeft] = useState(0);
  useEffect(() => {
    if (!pendingActionDeadlineAt) {
      setPendingActionSecondsLeft(0);
      return;
    }
    const tick = () => {
      const msLeft = Date.parse(pendingActionDeadlineAt) - Date.now();
      setPendingActionSecondsLeft(Math.max(0, Math.ceil(msLeft / 1000)));
    };
    tick();
    const id = window.setInterval(tick, 200);
    return () => window.clearInterval(id);
  }, [pendingActionDeadlineAt]);

  const latestWinnerText = useMemo(() => {
    if (!latestRoundResult) return null;
    const winnerStatus = typeof (latestRoundResult as any)?.winnerStatus === 'string' ? String((latestRoundResult as any).winnerStatus) : null;
    if (winnerStatus === 'pending_vote') return '待定（投票中）';
    const winnerName = typeof latestRoundResult?.winnerName === 'string' ? latestRoundResult.winnerName : null;
    const winnerSeat = typeof latestRoundResult?.winnerSeat === 'number' ? latestRoundResult.winnerSeat : null;
    if (winnerSeat === null || !winnerName || winnerName === '平局') return '平局';
    const playerLabel = playerDisplayBySeat.get(winnerSeat) || '未知玩家';
    return `座位 ${winnerSeat} · ${playerLabel}（角色：${winnerName}）`;
  }, [latestRoundResult, playerDisplayBySeat]);

  const latestRoundReportMarkdown = useMemo(() => {
    const raw = typeof (latestRoundResult as any)?.reportMarkdown === 'string' ? String((latestRoundResult as any).reportMarkdown) : '';
    return raw.trim();
  }, [latestRoundResult]);
  const latestRoundStreamMeta = useMemo(() => {
    const raw = (latestRoundResult as any)?.streamMeta ?? null;
    return raw && typeof raw === 'object' ? raw : null;
  }, [latestRoundResult]);

  useEffect(() => {
    const shouldStream = rules?.generationMode === 'stream';
    if (latestRoundStatus !== 'completed') return;
    if (!latestBattleGenerationId) return;
    if (loadedBattleReportGenerationId === latestBattleGenerationId) return;
    if (isStreamingResolve && streamingResolveMarkdown.trim()) return;

    if (shouldStream) {
      if (latestRoundReportMarkdown.trim()) return;
    } else {
      if ((latestRoundResult as any)?.report) return;
    }

    let cancelled = false;
    (async () => {
      try {
        setLoadedBattleReportError(null);
        const authHeader = await authStorage.getAuthHeader();
        if (!authHeader) throw new Error('未登录');
        const res = await fetch(`/api/me/battle-reports/${latestBattleGenerationId}/output`, {
          method: 'GET',
          headers: { Authorization: authHeader },
        });
        const text = await res.text().catch(() => '');
        if (!res.ok) throw new Error(text || '加载战报正文失败');
        if (cancelled) return;

        if (shouldStream) {
          setLoadedBattleReportMarkdown(text);
          setLoadedBattleReport(null);
        } else {
          try {
            const parsed = JSON.parse(text);
            setLoadedBattleReport(parsed);
          } catch {
            setLoadedBattleReport(null);
          }
          setLoadedBattleReportMarkdown('');
        }

        setLoadedBattleReportGenerationId(latestBattleGenerationId);
      } catch (error) {
        if (cancelled) return;
        setLoadedBattleReportGenerationId(latestBattleGenerationId);
        setLoadedBattleReportMarkdown('');
        setLoadedBattleReport(null);
        setLoadedBattleReportError(error instanceof Error ? error.message : '加载战报正文失败');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    latestBattleGenerationId,
    latestRoundStatus,
    latestRoundId,
    latestRoundReportMarkdown,
    latestRoundResult,
    rules?.generationMode,
    isStreamingResolve,
    streamingResolveMarkdown,
    loadedBattleReportGenerationId,
  ]);

  const reportContentForUi =
    (isStreamingResolve ? streamingResolveMarkdown : '') || latestRoundReportMarkdown || loadedBattleReportMarkdown;
  const reportMetaForUi = (isStreamingResolve ? streamingResolveMeta : null) || latestRoundStreamMeta;
  const resolvedNonStreamReport = (latestRoundResult as any)?.report ?? loadedBattleReport;
  const hasAnyReportForUi = Boolean(reportContentForUi.trim()) || Boolean(resolvedNonStreamReport);

  const rulesDraftError = useMemo(() => {
    if (!rulesDraft) return null;
    const participants = Number.isFinite(rulesDraft.participants) ? Math.floor(rulesDraft.participants) : 0;
    if (participants < 2 || participants > 6) return '人数需要在 2-6 之间';

    if (rulesDraft.submissionMode !== 'hostOnly') {
      const cardsPerPlayer = Number.isFinite(rulesDraft.cardsPerPlayer) ? Math.floor(rulesDraft.cardsPerPlayer) : 0;
      if (cardsPerPlayer < 0 || cardsPerPlayer > 50) return '每人提交数量需要在 0-50 之间';
    }

    const dealPerPlayer = Number.isFinite(rulesDraft.dealPerPlayer) ? Math.floor(rulesDraft.dealPerPlayer) : 0;
    if (dealPerPlayer < 1 || dealPerPlayer > 50) return '每人初始手牌数量需要在 1-50 之间';

    const dealWhenEmpty = Number.isFinite(rulesDraft.dealWhenEmpty) ? Math.floor(rulesDraft.dealWhenEmpty) : 0;
    if (dealWhenEmpty < 1 || dealWhenEmpty > 50) return '手牌为空时补发数量需要在 1-50 之间';

    const cardRange = normalizePvpRoomCardRange(rulesDraft);
    if (!Array.isArray(cardRange.allowedCombatantTypes) || cardRange.allowedCombatantTypes.length <= 0) {
      return '卡牌范围不合法：至少需要允许一种角色类型';
    }
    if (cardRange.minLikeCount !== null && cardRange.maxLikeCount !== null && cardRange.minLikeCount > cardRange.maxLikeCount) {
      return '卡牌范围不合法：点赞范围需满足 min<=max';
    }
    if (cardRange.minUsageCount !== null && cardRange.maxUsageCount !== null && cardRange.minUsageCount > cardRange.maxUsageCount) {
      return '卡牌范围不合法：使用量范围需满足 min<=max';
    }
    if (cardRange.minFavoriteCount !== null && cardRange.maxFavoriteCount !== null && cardRange.minFavoriteCount > cardRange.maxFavoriteCount) {
      return '卡牌范围不合法：收藏量范围需满足 min<=max';
    }

    if (rulesDraft.bestOf?.enabled) {
      const maxRounds = Number.isFinite(rulesDraft.bestOf.maxRounds) ? Math.floor(rulesDraft.bestOf.maxRounds) : 0;
      if (maxRounds < 1 || maxRounds > 10) return '最多轮次需要在 1-10 之间';
    }

    const userGuidance = typeof (rulesDraft as any).userGuidance === 'string' ? String((rulesDraft as any).userGuidance).trim() : '';
    if (userGuidance.length > 200) return '故事引导不应超过 200 字';

    const readArenaHistory = (rulesDraft as any).readArenaHistory === true;
    const isArenaHistoryUnlimited = (rulesDraft as any).isArenaHistoryUnlimited === true;
    const readArenaHistoryLimit = Number.isFinite((rulesDraft as any).readArenaHistoryLimit)
      ? Math.floor(Number((rulesDraft as any).readArenaHistoryLimit))
      : 0;
    if (readArenaHistory && !isArenaHistoryUnlimited && (readArenaHistoryLimit < 1 || readArenaHistoryLimit > 999)) {
      return '历战记录读取条数需要在 1-999 之间';
    }

    const selectedLevel = typeof (rulesDraft as any).selectedLevel === 'string' ? String((rulesDraft as any).selectedLevel).trim() : '';
    if (selectedLevel && !['种级', '芽级', '叶级', '蕾级', '花级'].includes(selectedLevel)) {
      return '等级不合法（需为 种级/芽级/叶级/蕾级/花级 或留空）';
    }

    const storyLength = typeof (rulesDraft as any).storyLength === 'string' ? String((rulesDraft as any).storyLength).trim() : 'default';
    if (!['default', 'short', 'standard', 'detailed', 'long'].includes(storyLength)) {
      return '期望字数设置不合法';
    }

    const generationMode = typeof (rulesDraft as any).generationMode === 'string' ? String((rulesDraft as any).generationMode).trim() : 'non-stream';
    if (!['non-stream', 'stream'].includes(generationMode)) {
      return '战报生成方式不合法';
    }

    const language = typeof (rulesDraft as any).language === 'string' ? String((rulesDraft as any).language).trim() : '';
    if (language.length > 32) return '生成语言不合法（过长）';

    const adjudicationEvents = Array.isArray((rulesDraft as any).adjudicationEvents) ? (rulesDraft as any).adjudicationEvents : [];
    if (adjudicationEvents.length > 50) return '随机判定器事件过多（最多 50 条根事件）';

    return null;
  }, [rulesDraft]);

  const resetRulesDraftFromRoom = () => {
    if (rules) setRulesDraft(clonePvpRoomRules(rules));
  };

  const saveRulesDraft = async () => {
    if (!rulesDraft) return;
    if (rulesDraftError) {
      setError(`规则不合法：${rulesDraftError}`);
      return;
    }
    setError(null);
    try {
      await rulesMutation.mutateAsync({ rules: rulesDraft });
    } catch (e: any) {
      if (e?.code === 'NEED_CLEAR_SUBMISSIONS') {
        const ok = typeof window !== 'undefined' && window.confirm('修改提交相关规则/卡牌范围会清空已提交卡组，是否继续？');
        if (!ok) return;
        await rulesMutation.mutateAsync({ rules: rulesDraft, clearSubmissions: true });
      }
    }
  };

  const refetchUserSummary = userSummaryQuery.refetch;
  const lastSummaryRefreshKeyRef = useRef<string>('');
  useEffect(() => {
    if (!joined || !isAuthenticated) return;
    if (userIdsForSummary.length <= 0) return;

    const roundStatus = typeof latestRound?.status === 'string' ? latestRound.status : null;
    const shouldRefresh = roundStatus === 'completed' || phase === 'finished';
    if (!shouldRefresh) return;

    const key = `${room?.currentMatchId ?? ''}|${latestRound?.id ?? ''}|${roundStatus ?? ''}|${phase}`;
    if (key === lastSummaryRefreshKeyRef.current) return;
    lastSummaryRefreshKeyRef.current = key;
    void refetchUserSummary();
  }, [
    joined,
    isAuthenticated,
    userIdsForSummary.length,
    room?.currentMatchId,
    latestRound?.id,
    latestRound?.status,
    phase,
    refetchUserSummary,
  ]);

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

  const isHandDealing = !isSpectator && phase === 'choosing' && myHand === null;
  const canOpenHand = !isSpectator && !isHandDealing && myHandCards.length > 0;

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
      const res = await fetchWithTimeout(
        `/api/pvp/rooms/${roomId}/leave`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: authHeader },
          body: JSON.stringify({}),
        },
        15000,
      );
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
    onError: (e) => handlePvpRequestError(e, '退出失败'),
  });

  const roleMutation = useMutation({
    mutationFn: async (role: 'player' | 'spectator') => {
      const authHeader = await authStorage.getAuthHeader();
      if (!authHeader) throw new Error('未登录');
      const res = await fetch(`/api/pvp/rooms/${roomId}/role`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: authHeader },
        body: JSON.stringify({ expectedVersion: version, role }),
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
    onError: (e) => handlePvpRequestError(e, '切换身份失败'),
  });

  const submitMutation = useMutation({
    mutationFn: async () => {
      if (!rules) throw new Error('规则未加载');
      if (rules.submissionMode === 'hostOnly') {
        if (!isHost) throw new Error('仅房主可提交牌堆');
        if (selected.length <= 0) throw new Error('房主提交的牌堆至少需要 1 张卡');
      } else {
        if (selected.length !== rules.cardsPerPlayer) throw new Error(`需要选择 ${rules.cardsPerPlayer} 张卡`);
      }
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
      clearVersionConflictRetry();
      setError(null);
      setShowSubmitEditor(false);
      clearSelected();
      void roomQuery.refetch();
    },
    onError: (e) => handlePvpRequestError(e, '提交失败'),
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
    onError: (e) => handlePvpRequestError(e, '开始失败'),
  });

  const chooseMutation = useMutation({
    mutationFn: async (snapshotId: string) => {
      if (!latestRound?.id) throw new Error('当前回合不存在，请刷新');
      const authHeader = await authStorage.getAuthHeader();
      if (!authHeader) throw new Error('未登录');
      const res = await fetch(`/api/pvp/rooms/${roomId}/rounds/${latestRound?.id}/choose`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: authHeader },
        body: JSON.stringify({
          expectedVersion: version,
          snapshotId,
          characterGuidance: myCharacterGuidanceDraft,
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
    onSuccess: () => void roomQuery.refetch(),
    onError: (e) => handlePvpRequestError(e, '出牌失败'),
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
      const shouldStream = rules?.generationMode === 'stream';

      if (!shouldStream) {
        const res = await fetchWithTimeout(
          `/api/pvp/rooms/${roomId}/rounds/${latestRound?.id}/resolve`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: authHeader },
            body: JSON.stringify({
              expectedVersion: version,
              ...(payload?.force ? { force: true } : {}),
              ...(customProvider ? { customProvider } : {}),
            }),
          },
          RESOLVE_REQUEST_TIMEOUT_MS,
        );
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
      }

      setStreamingResolveMarkdown('');
      setStreamingResolveMeta(null);
      setIsStreamingResolve(true);
      try {
        const res = await fetchWithTimeout(
          `/api/pvp/rooms/${roomId}/rounds/${latestRound?.id}/resolve-stream`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: authHeader },
            body: JSON.stringify({
              expectedVersion: version,
              ...(payload?.force ? { force: true } : {}),
              ...(customProvider ? { customProvider } : {}),
            }),
          },
          RESOLVE_REQUEST_TIMEOUT_MS,
        );

        // resolve-stream 成功时会返回 text/plain（Markdown stream）；失败则返回 JSON 错误
        const contentType = (res.headers.get('content-type') || '').toLowerCase();
        const looksLikeJson = contentType.includes('application/json') || contentType.includes('+json');
        if (!res.ok || looksLikeJson) {
          const { data } = await readJsonOrText(res);
          const payload = (data || {}) as ApiErrorPayload;
          throw new PvpApiError(formatApiErrorMessage(payload, res.status), {
            status: res.status,
            code: payload.code,
            traceId: payload.traceId,
            detail: payload.detail,
          });
        }

        const metaHeader = res.headers.get('x-mahoshojo-stream-meta');
        if (metaHeader) {
          try {
            setStreamingResolveMeta(JSON.parse(decodeURIComponent(metaHeader)));
          } catch {
            setStreamingResolveMeta(null);
          }
        }

        if (!res.body) throw new Error('无法读取响应流');

	        const reader = res.body.getReader();
	        const decoder = new TextDecoder();
	        let accumulated = '';
	        const shouldTerminateByTelemetry = (text: string) => {
	          const marker = '<!-- MAHOSHOJO_TELEMETRY_META';
	          const trimmed = text.trimEnd();
	          const idx = trimmed.lastIndexOf(marker);
	          if (idx < 0) return false;
	          if (!trimmed.endsWith('-->')) return false;
	          return trimmed.length - idx < 4096;
	        };
	        const readWithTimeout = createStreamReadWithTimeout({
	          label: 'PVP 结算流式',
	          idleTimeoutMs: RESOLVE_STREAM_IDLE_TIMEOUT_MS,
	          totalTimeoutMs: RESOLVE_STREAM_TOTAL_TIMEOUT_MS,
	          onTimeout: () => {
	            try {
	              void reader.cancel('timeout');
	            } catch {
	              // ignore
	            }
	          },
	        });
	        while (true) {
	          const { value, done } = await readWithTimeout(reader);
	          if (done) break;
	          if (!value) continue;
	          accumulated += decoder.decode(value, { stream: true });
	          setStreamingResolveMarkdown(accumulated);
	          if (shouldTerminateByTelemetry(accumulated)) {
	            try {
	              void reader.cancel('telemetry-meta-received');
	            } catch {
	              // ignore
	            }
	            break;
	          }
	        }
	        accumulated += decoder.decode();
	        setStreamingResolveMarkdown(accumulated);
	        return { success: true, streamed: true };
	      } finally {
        setIsStreamingResolve(false);
      }
    },
    onSuccess: () => {
      startCooldown();
      void roomQuery.refetch();
    },
    onError: (e: any) => {
      if (e?.code === 'ROOM_RESOLVING' || e?.code === 'ROUND_RESOLVING') {
        void roomQuery.refetch();
        return;
      }
      handlePvpRequestError(e, '结算失败');
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
    onError: (e) => handlePvpRequestError(e, '更新口令失败'),
  });

  const permissionsMutation = useMutation({
    mutationFn: async (payload: { allowNonHostControl?: boolean; allowPlayerCharacterGuidance?: boolean; allowSpectators?: boolean; allowSpectatorChat?: boolean }) => {
      const authHeader = await authStorage.getAuthHeader();
      if (!authHeader) throw new Error('未登录');
      const res = await fetch(`/api/pvp/rooms/${roomId}/permissions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: authHeader },
        body: JSON.stringify({ expectedVersion: version, ...payload }),
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
    onError: (e) => handlePvpRequestError(e, '更新设置失败'),
  });

  const rulesMutation = useMutation({
    mutationFn: async (payload: { rules: PvpRoomRules; clearSubmissions?: boolean }) => {
      const authHeader = await authStorage.getAuthHeader();
      if (!authHeader) throw new Error('未登录');
      const res = await fetch(`/api/pvp/rooms/${roomId}/rules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: authHeader },
        body: JSON.stringify({
          expectedVersion: version,
          rules: payload.rules,
          ...(payload.clearSubmissions ? { clearSubmissions: true } : {}),
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
    onSuccess: () => void roomQuery.refetch(),
    onError: (e) => handlePvpRequestError(e, '更新规则失败'),
  });

  const scenarioMutation = useMutation({
    mutationFn: async (payload: { selection: PvpScenarioSelection | null }) => {
      const authHeader = await authStorage.getAuthHeader();
      if (!authHeader) throw new Error('未登录');
      const res = await fetch(`/api/pvp/rooms/${roomId}/rules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: authHeader },
        body: JSON.stringify({
          expectedVersion: version,
          rules: buildPvpScenarioRulesPatch({ mode: rulesDraft?.mode, selection: payload.selection ?? null }),
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
      setScenarioDraft(null);
      void roomQuery.refetch();
    },
    onError: (e) => handlePvpRequestError(e, '更新情景失败'),
  });
  const triggerScenarioSave = scenarioMutation.mutate;
  const isScenarioSaving = scenarioMutation.isPending;

  // 修复/迁移：旧房间可能已经设置了情景，但当时未导入情景内的 adjudicationEvents。
  // 这里在房主进入房间后自动触发一次“重存情景”，由后端将情景事件导入判定器并持久化。
  useEffect(() => {
    if (!roomId || !isHost) return;
    if (scenarioDraft) return;
    if (phase !== 'waiting' && phase !== 'submitting') return;
    if (!roomScenario || typeof roomScenario !== 'object') return;
    const id = typeof (roomScenario as any).sourceDataCardId === 'string' ? String((roomScenario as any).sourceDataCardId).trim() : '';
    if (!id) return;
    const updatedAt =
      typeof (roomScenario as any).sourceDataCardUpdatedAt === 'string' ? String((roomScenario as any).sourceDataCardUpdatedAt) : null;
    const key = `${id}|${updatedAt ?? ''}`;
    if (scenarioAdjudicationImportedFor === key) return;
    if (autoScenarioImportKeyRef.current === key) return;
    if (isScenarioSaving || rulesMutation.isPending) return;

    autoScenarioImportKeyRef.current = key;
    triggerScenarioSave({
      selection: {
        kind: 'data_card',
        id,
        updatedAt,
        name: typeof (roomScenario as any).sourceDataCardName === 'string' ? String((roomScenario as any).sourceDataCardName) : null,
        isPublic: typeof (roomScenario as any).sourceIsPublic === 'boolean' ? (roomScenario as any).sourceIsPublic : null,
        author: typeof (roomScenario as any).sourceAuthor === 'string' ? String((roomScenario as any).sourceAuthor) : null,
      },
    });
  }, [
    isHost,
    phase,
    roomId,
    roomScenario,
    scenarioAdjudicationImportedFor,
    scenarioDraft,
    isScenarioSaving,
    triggerScenarioSave,
    rulesMutation.isPending,
  ]);

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
    onError: (e) => handlePvpRequestError(e, '重开失败'),
  });

  const confirmMutation = useMutation({
    mutationFn: async () => {
      if (!latestRound?.id) throw new Error('当前回合不存在，请刷新');
      const authHeader = await authStorage.getAuthHeader();
      if (!authHeader) throw new Error('未登录');
      const res = await fetchWithTimeout(
        `/api/pvp/rooms/${roomId}/rounds/${latestRound.id}/confirm`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: authHeader },
          body: JSON.stringify({ expectedVersion: version }),
        },
        15000,
      );
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
    onError: (e) => handlePvpRequestError(e, '确认失败'),
  });

  const startWinnerVoteMutation = useMutation({
    mutationFn: async () => {
      if (!latestRound?.id) throw new Error('当前回合不存在，请刷新');
      const authHeader = await authStorage.getAuthHeader();
      if (!authHeader) throw new Error('未登录');
      const res = await fetch(`/api/pvp/rooms/${roomId}/rounds/${latestRound.id}/vote/start`, {
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
    onError: (e) => handlePvpRequestError(e, '发起胜者投票失败'),
  });

  const submitWinnerVoteMutation = useMutation({
    mutationFn: async (choice: WinnerVoteChoice) => {
      if (!latestRound?.id) throw new Error('当前回合不存在，请刷新');
      const authHeader = await authStorage.getAuthHeader();
      if (!authHeader) throw new Error('未登录');
      const res = await fetch(`/api/pvp/rooms/${roomId}/rounds/${latestRound.id}/vote/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: authHeader },
        body: JSON.stringify({ expectedVersion: version, choice }),
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
    onError: (e) => handlePvpRequestError(e, '投票失败'),
  });

  const finalizeWinnerVoteMutation = useMutation({
    mutationFn: async () => {
      if (!latestRound?.id) throw new Error('当前回合不存在，请刷新');
      const authHeader = await authStorage.getAuthHeader();
      if (!authHeader) throw new Error('未登录');
      const res = await fetch(`/api/pvp/rooms/${roomId}/rounds/${latestRound.id}/vote/finalize`, {
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
    onError: (e) => handlePvpRequestError(e, '结束投票失败'),
  });

  const isCustomProviderMissingKey = Boolean(
    userProviderConfig?.providerId && userProviderConfig.providerId !== 'system' && !userProviderConfig.apiKey?.trim()
  );

  const handleSelectScenarioCard = async (cardData: any) => {
    if (!isHost) {
      setError('仅房主可设置房间情景。');
      return;
    }
    const cleaned = removePrivateKeys(cardData);
    if (inferTemplate(cleaned) !== 'scenario') {
      setError('❌ 请选择“情景”类型的数据卡。');
      return;
    }
    const cardId = typeof cardData?._cardId === 'string' ? cardData._cardId.trim() : '';
    if (!cardId) {
      setError('❌ PVP 情景仅允许使用在线数据库中的情景数据卡。');
      return;
    }
    const name = typeof cardData?._cardName === 'string'
      ? cardData._cardName.trim()
      : (typeof cleaned?.title === 'string' ? cleaned.title.trim() : '');

    // 与 /arena 逻辑保持一致：当情景卡含有 adjudicationEvents 时，将其加入判定器并展示（用户可再编辑/删除）。
    // 注意：这里仅更新本地草稿（rulesDraft）；真正持久化仍以“保存情景/保存设置”为准。
    const scenarioEvents = (cleaned as any)?.adjudicationEvents;
    let warning: string | null = null;
    if (Array.isArray(scenarioEvents) && scenarioEvents.length > 0) {
      if (isLegacyAdjudicatorFormat(scenarioEvents)) {
        warning = `⚠️ 情景 "${name || (typeof cleaned?.title === 'string' ? cleaned.title : '未命名')}" 包含旧版随机事件，已忽略。`;
      } else {
        setRulesDraft((r) => (r ? { ...r, adjudicationEvents: mergeAdjudicationEvents((r as any).adjudicationEvents, scenarioEvents) } : r));
      }
    }
    setScenarioDraft({
      kind: 'data_card',
      id: cardId,
      updatedAt: typeof cardData?._updatedAt === 'string' ? cardData._updatedAt : null,
      name: name || null,
      isPublic: typeof cardData?._isPublic === 'boolean'
        ? cardData._isPublic
        : (typeof cardData?._isPublic === 'number' ? cardData._isPublic === 1 : null),
      author: typeof cardData?._author === 'string' ? cardData._author : null,
    } satisfies PvpScenarioSelection);
    setError(warning);
  };

  const handleRandomMatchScenario = async () => {
    if (!isHost) {
      setError('仅房主可设置房间情景。');
      return;
    }
    setError(null);
    setIsScenarioMatching(true);
    setError('正在从数据库中随机寻找一份公开的情景...');
    try {
      const response = await fetch('/api/random-public-card?type=scenario');
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result?.success) {
        throw new Error(result?.error || '无法获取随机情景');
      }
      const cardData = JSON.parse(result.card.data);
      await handleSelectScenarioCard({
        ...cardData,
        _cardId: result.card.id,
        _cardName: result.card.name,
        _isPublic: result.card.is_public,
        _updatedAt: result.card.updated_at,
        _createdAt: result.card.created_at,
        _author: result.card.username || '未知',
      });
    } catch (e) {
      setError(`❌ 随机匹配失败: ${e instanceof Error ? e.message : '未知错误'}`);
    } finally {
      setIsScenarioMatching(false);
    }
  };

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
    onError: (e) => handlePvpRequestError(e, '踢人失败'),
  });

  const forceActionMutation = useMutation({
    mutationFn: async (kind: 'submit' | 'choose' | 'confirm') => {
      const authHeader = await authStorage.getAuthHeader();
      if (!authHeader) throw new Error('未登录');
      const res = await fetch(`/api/pvp/rooms/${roomId}/force`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: authHeader },
        body: JSON.stringify({ expectedVersion: version, kind }),
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
    onError: (e) => handlePvpRequestError(e, '强制操作失败'),
  });

  const addBotMutation = useMutation({
    mutationFn: async () => {
      const authHeader = await authStorage.getAuthHeader();
      if (!authHeader) throw new Error('未登录');
      const res = await fetch(`/api/pvp/rooms/${roomId}/bots/add`, {
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
    onError: (e) => handlePvpRequestError(e, '添加机器人失败'),
  });

  const removeBotMutation = useMutation({
    mutationFn: async (botId: string) => {
      const authHeader = await authStorage.getAuthHeader();
      if (!authHeader) throw new Error('未登录');
      const res = await fetch(`/api/pvp/rooms/${roomId}/bots/remove`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: authHeader },
        body: JSON.stringify({ expectedVersion: version, botId }),
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
    onError: (e) => handlePvpRequestError(e, '移除机器人失败'),
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

    const cardRange = normalizePvpRoomCardRange(rules);

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
    const likeCount = typeof cardData?._likeCount === 'number' ? Math.floor(cardData._likeCount) : 0;
    const favoriteCount = typeof cardData?._favoriteCount === 'number' ? Math.floor(cardData._favoriteCount) : 0;
    const usageCount = typeof cardData?._usageCount === 'number' ? Math.floor(cardData._usageCount) : 0;

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

    const combatantType = inferPvpCombatantTypeFromJson(payload);
    if (!isPvpCombatantTypeAllowedByRange(combatantType, cardRange)) {
      setError(`该房间禁止选择此类型卡牌（${combatantType}）。当前范围：${describePvpRoomCardRange(cardRange)}`);
      return;
    }
    if (!isPvpDataCardStatsAllowedByRange({ likeCount, usageCount, favoriteCount }, cardRange)) {
      setError(`该房间的卡牌范围限制了此数据卡的统计值。当前范围：${describePvpRoomCardRange(cardRange)}`);
      return;
    }

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
      likeCount,
      favoriteCount,
      usageCount,
    };

    setSelected((prev) => {
      const alreadySelected = prev.some((c) => c.kind === 'data_card' && c.id === id);
      if (alreadySelected) {
        setError('已选择过该数据卡。');
        return prev;
      }
      if (rules.submissionMode !== 'hostOnly' && prev.length >= rules.cardsPerPlayer) {
        setError(`已达到上限：最多选择 ${rules.cardsPerPlayer} 张卡。`);
        return prev;
      }
      setError(null);
      return [...prev, next];
    });
  };

  const handleToggleDataCardFromModal = (cardData: any, nextSelected: boolean) => {
    if (nextSelected) {
      handleSelectDataCardFromModal(cardData);
      return;
    }

    const id = typeof cardData?._cardId === 'string' ? cardData._cardId : '';
    if (!id) {
      setError('取消选择失败：缺少数据卡 ID。');
      return;
    }

    setSelected((prev) => prev.filter((c) => !(c.kind === 'data_card' && c.id === id)));
    setError(null);
  };

  const handleRandomMatchCharacter = async () => {
    if (!rules) {
      setError('规则未加载，暂时无法随机匹配。');
      return;
    }
    if (rules.submissionMode !== 'hostOnly' && selected.length >= rules.cardsPerPlayer) {
      setError(`已达到上限：最多选择 ${rules.cardsPerPlayer} 张卡。`);
      return;
    }

    setIsMatching('character');
    setError('正在从数据库中随机匹配一位公开角色…');
    try {
      const cardRange = normalizePvpRoomCardRange(rules);
      const params = new URLSearchParams({ type: 'character' });
      if (typeof cardRange.minLikeCount === 'number') params.set('minLikes', String(cardRange.minLikeCount));
      if (typeof cardRange.maxLikeCount === 'number') params.set('maxLikes', String(cardRange.maxLikeCount));
      if (typeof cardRange.minUsageCount === 'number') params.set('minUsage', String(cardRange.minUsageCount));
      if (typeof cardRange.maxUsageCount === 'number') params.set('maxUsage', String(cardRange.maxUsageCount));
      if (typeof cardRange.minFavoriteCount === 'number') params.set('minFavorites', String(cardRange.minFavoriteCount));
      if (typeof cardRange.maxFavoriteCount === 'number') params.set('maxFavorites', String(cardRange.maxFavoriteCount));

      const res = await fetch(`/api/random-public-card?${params.toString()}`);
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

    const cardRange = normalizePvpRoomCardRange(rules);
    if (!isPvpCombatantTypeAllowedByRange(preset.type as any, cardRange)) {
      setError(`该房间禁止选择此类型预设（${preset.type}）。当前范围：${describePvpRoomCardRange(cardRange)}`);
      return;
    }

    setSelected((prev) => {
      const exists = prev.some((c) => c.kind === 'preset' && c.filename === preset.filename);
      if (exists) {
        setError(null);
        return prev.filter((c) => !(c.kind === 'preset' && c.filename === preset.filename));
      }
      if (rules.submissionMode !== 'hostOnly' && prev.length >= rules.cardsPerPlayer) {
        setError(`已达到上限：最多选择 ${rules.cardsPerPlayer} 张卡。`);
        return prev;
      }
      setError(null);
      return [...prev, { kind: 'preset', filename: preset.filename, name: preset.name, description: preset.description, presetType: preset.type }];
    });
  };

  // 图片预览弹窗关闭时统一回收 blob URL（用于战报卡片导出）

  return (
    <>
      <Head>
        <title>PVP 房间 - {roomId || '...'}</title>
      </Head>
      <div className="magic-background-white">
        <div className="container !max-w-[1100px]">
          <div className="card !max-w-none !p-0">
            <PvpHeroBanner
              title="PVP 房间"
              subtitle={
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <div className="text-sm text-gray-700 break-all">
                    房间ID：<span className="font-mono font-semibold text-gray-900">{roomId || '加载中…'}</span>
                  </div>
                  {roomQuery.data ? (
                    <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 text-xs">阶段：{phase}</span>
                  ) : null}
                </div>
              }
              right={
                <>
                  <button
                    type="button"
                    onClick={handleCopyRoomId}
                    disabled={!roomId}
                    className="text-xs px-3 py-1.5 rounded-full bg-white/80 border border-white/60 hover:bg-white disabled:opacity-60"
                    title="复制房间ID"
                    aria-label="复制房间ID"
                  >
                    {copiedKey === 'id' ? '已复制 ID' : '复制 ID'}
                  </button>
                  <button
                    type="button"
                    onClick={handleCopyRoomLink}
                    disabled={!roomId}
                    className="text-xs px-3 py-1.5 rounded-full bg-white/80 border border-white/60 hover:bg-white disabled:opacity-60"
                    title="复制房间链接"
                    aria-label="复制房间链接"
                  >
                    {copiedKey === 'link' ? '已复制链接' : '复制链接'}
                  </button>
                  <button onClick={() => window.location.assign('/pvp')} className="text-sm text-blue-700 hover:underline">
                    返回大厅
                  </button>
                </>
              }
            />

            <div className="p-6">

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

            {roomQuery.isError && joined && !roomQuery.data && (
              <div className="p-3 rounded-md bg-red-100 text-red-800 text-sm mt-3">
                <div className="whitespace-pre-wrap">
                  {roomQuery.error instanceof Error ? roomQuery.error.message : '加载房间失败，请稍后重试。'}
                </div>
                <div className="flex gap-2 mt-3">
                  <button className="px-3 py-1.5 rounded border bg-white hover:bg-gray-50 text-sm" onClick={() => roomQuery.refetch()}>
                    重试
                  </button>
                  <button
                    className="px-3 py-1.5 rounded border bg-white hover:bg-gray-50 text-sm disabled:opacity-50"
                    onClick={() => leaveMutation.mutate()}
                    disabled={leaveMutation.isPending}
                  >
                    尝试退出房间
                  </button>
                  <button className="px-3 py-1.5 rounded border bg-white hover:bg-gray-50 text-sm" onClick={() => router.push('/pvp')}>
                    返回大厅
                  </button>
                </div>
              </div>
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
                    <div className="mt-2 flex items-center justify-between gap-3">
                      <div className="text-gray-700">我的身份：{isSpectator ? '观众' : '玩家'}</div>
                      {!isHost ? (
                        isSpectator ? (
                          <button
                            className="px-3 py-1.5 rounded-lg border bg-white hover:bg-gray-50 text-xs disabled:opacity-50 disabled:cursor-not-allowed"
                            onClick={() => roleMutation.mutate('player')}
                            disabled={!canSwitchToPlayer || roleMutation.isPending}
                            title={!canSwitchToPlayer ? '房间已满或当前阶段不允许' : '加入为玩家'}
                          >
                            {roleMutation.isPending ? '切换中…' : '成为玩家'}
                          </button>
                        ) : (
                          <button
                            className="px-3 py-1.5 rounded-lg border bg-white hover:bg-gray-50 text-xs disabled:opacity-50 disabled:cursor-not-allowed"
                            onClick={() => roleMutation.mutate('spectator')}
                            disabled={!canSwitchToSpectator || roleMutation.isPending}
                            title={!canSwitchToSpectator ? '当前阶段不允许或房主不可切换' : '转为观众'}
                          >
                            {roleMutation.isPending ? '切换中…' : '转为观众'}
                          </button>
                        )
                      ) : (
                        <span className="text-xs text-gray-500">房主固定为玩家</span>
                      )}
                    </div>
                    {lastActivityAt ? (
                      <div className="mt-1 text-xs text-gray-600">
                        最后活动：{new Date(lastActivityAt).toLocaleString()}
                      </div>
                    ) : null}
                    {rules && (
                      <div className="mt-2 text-xs text-gray-600 whitespace-pre-wrap">
                        规则：人数 {rules.participants} / 提交{rules.submissionMode === 'hostOnly' ? '（房主牌堆）' : ` ${rules.cardsPerPlayer}`} / 初始手牌 {rules.dealPerPlayer} / 空手补发 {rules.dealWhenEmpty} / 抽取来源 {rules.drawSource ?? 'public'} / 复用弃牌 {String(rules.recycleUsedCards)} / 去重 {String(rules.dedupe)} / 展示提交 {String(rules.showAllSubmissions)} / 洗混 {String(rules.shuffleDecks)} / 模式 {rules.mode}
                      </div>
                    )}
                    {rules && (
                      <div className="mt-1 text-xs text-gray-600 whitespace-pre-wrap">
                        生成设置：方式 {rules.generationMode === 'stream' ? '流式' : '非流式'}；历战 读 {String(rules.readArenaHistory)} / 写 {String(rules.writeArenaHistory)}；状态 读 {String(rules.readCurrentState)} / 写 {String(rules.writeCurrentState)}；等级 {rules.selectedLevel || '默认'}；引导 {rules.userGuidance?.trim() ? `“${rules.userGuidance.trim()}”` : '无'}；字数 {rules.storyLength || 'default'}；语言 {rules.language?.trim() || '默认'}
                      </div>
                    )}
                    {rules?.bestOf?.enabled && latestRound ? (
                      <div className="mt-1 text-xs text-gray-600">
                        当前回合：{latestRound.index}/{rules.bestOf.maxRounds}
                      </div>
                    ) : null}
                    {phase === 'choosing' && !isSpectator ? (
                      <div className="mt-1 text-xs text-gray-600">
                        我的手牌：{myHandCards.length} 张；弃牌：{Array.isArray(myHand?.discarded) ? myHand?.discarded.length : 0} 张
                      </div>
                    ) : null}
                  </div>

                  <PvpScoreboard score={score} players={players} />

                  <div className="p-4 rounded-xl bg-white border text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <div className="font-semibold text-gray-900">玩家</div>
                      <div className="text-xs text-gray-500">
                        {players.length} / {rules?.participants ?? players.length} 玩家；{spectators.length} 观众
                      </div>
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
                                {p.isBot ? (
                                  <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 text-xs">机器人</span>
                                ) : null}
                              </div>
                              <div className="mt-1 text-xs text-gray-600">
                                {(() => {
                                  if (p.isBot) return '战绩：机器人不记录';
                                  const s = pvpSummaryByUserId.get(p.userId);
                                  if (!s) return '战绩：暂无';
                                  return `战绩：${s.wins}胜 ${s.losses}负 ${s.draws}平（${s.completedMatches}场，胜率 ${s.winRate}%）`;
                                })()}
                                <span className="ml-2 text-gray-500">（记录可能随时清理）</span>
                              </div>
                            </div>
                            {isHost && !p.isBot && p.userId !== room.hostUserId ? (
                              <button
                                className="px-3 py-1.5 rounded-lg border bg-white hover:bg-gray-50 text-xs disabled:opacity-50"
                                onClick={() => kickMutation.mutate(p.userId)}
                                disabled={kickMutation.isPending}
                              >
                                踢出
                              </button>
                            ) : null}
                            {isHost && p.isBot && p.botId ? (
                              <button
                                className="px-3 py-1.5 rounded-lg border bg-white hover:bg-gray-50 text-xs disabled:opacity-50"
                                onClick={() => removeBotMutation.mutate(p.botId!)}
                                disabled={removeBotMutation.isPending}
                              >
                                移除
                              </button>
                            ) : null}
                          </div>
                        </div>
                      ))}
                    </div>
                    {spectators.length > 0 ? (
                      <div className="mt-4 border-t pt-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="font-semibold text-gray-900">观众</div>
                          <div className="text-xs text-gray-500">共 {spectators.length} 人</div>
                        </div>
                        <div className="mt-3 space-y-2">
                          {spectators.map((s) => (
                            <div key={s.userId} className="rounded-lg border bg-gray-50 p-3">
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <UserWithTitle
                                    username={s.username || `用户${s.userId}`}
                                    prefix={s.prefix}
                                    badges={Array.isArray(s.badges) ? s.badges : []}
                                    showBadges={true}
                                    usernameClassName="font-semibold text-gray-900"
                                    titleClassName="text-xs"
                                  />
                                </div>
                                {isHost && s.userId !== room.hostUserId ? (
                                  <button
                                    className="px-3 py-1.5 rounded-lg border bg-white hover:bg-gray-50 text-xs disabled:opacity-50"
                                    onClick={() => kickMutation.mutate(s.userId)}
                                    disabled={kickMutation.isPending}
                                  >
                                    踢出
                                  </button>
                                ) : null}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
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

                <PvpChatPanel
                  roomId={roomId}
                  viewerRole={isSpectator ? 'spectator' : 'player'}
                  allowSpectatorChat={allowSpectatorChat}
                  members={[...players, ...spectators]}
                  disabled={!joined || !roomId}
                />

                {phase === 'resolving' && (
                  <div className="p-4 rounded-xl border border-amber-200 bg-amber-50 text-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="inline-flex h-4 w-4 rounded-full border-2 border-amber-400 border-t-transparent animate-spin" />
                          <div className="font-semibold text-amber-900">正在结算中…</div>
                        </div>
                        <div className="text-xs text-amber-800 mt-1">
                          页面会自动轮询刷新；如果长时间未变化，可尝试刷新浏览器页面。
                        </div>
                        {typeof lastActivityAgeSeconds === 'number' && lastActivityAgeSeconds >= RESOLVE_STALE_WARNING_SECONDS ? (
                          <div className="text-xs text-amber-900 mt-2">
                            警告：已 {lastActivityAgeSeconds}s 未更新，结算可能已超时或服务暂不可用。建议刷新；房主可点“强制重试”；也可以先退出房间。
                          </div>
                        ) : null}
                        {lastActivityAt ? (
                          <div className="text-xs text-amber-800 mt-1">
                            最后活动：{new Date(lastActivityAt).toLocaleString()}
                          </div>
                        ) : null}
                      </div>
                      {isHost ? (
                        <div className="flex gap-2 shrink-0">
                          <button
                            className="px-3 py-2 rounded-lg text-sm text-white bg-gradient-to-r from-amber-500 to-orange-500 disabled:opacity-50 disabled:cursor-not-allowed"
                            onClick={() => handleResolve({ force: true })}
                            disabled={resolveMutation.isPending || isCooldown || isCustomProviderMissingKey}
                            title="仅房主可用：当结算请求意外中断时用于强制重试"
                          >
                            {resolveMutation.isPending ? '重试中…' : '强制重试'}
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                )}

                {isHost && (phase === 'waiting' || phase === 'submitting' || phase === 'choosing') && (
                  <div className="p-3 rounded-md bg-white border mt-3">
                    <div className="font-semibold text-sm mb-2">房主设置</div>
                    {(phase === 'waiting' || phase === 'submitting') && (
                      <div className="flex items-center justify-between gap-3 mb-3">
                        <button
                          className="px-3 py-2 rounded-lg text-sm text-white bg-gradient-to-r from-slate-600 to-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
                          onClick={() => addBotMutation.mutate()}
                          disabled={addBotMutation.isPending || !rules || players.length >= (rules?.participants ?? 0)}
                          title={rules?.submissionMode === 'hostOnly' ? '添加机器人（自动出牌）' : '添加机器人（自动提交卡组）'}
                        >
                          {addBotMutation.isPending ? '添加中…' : '添加机器人'}
                        </button>
                        <div className="text-xs text-gray-500">机器人不显示战绩，会自动出牌；在“每人提交”模式下也会自动提交卡组。</div>
                      </div>
                    )}
                    {(phase === 'waiting' || phase === 'submitting') && (
                      <>
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
                        <div className="text-xs text-gray-500 mt-1">提示：仅在 waiting/submitting 阶段允许修改口令。</div>
                      </>
                    )}

                    <div className={(phase === 'waiting' || phase === 'submitting') ? 'mt-3' : ''}>
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={allowNonHostControl}
                          onChange={(e) => permissionsMutation.mutate({ allowNonHostControl: e.target.checked })}
                          disabled={permissionsMutation.isPending}
                        />
                        <span>允许其他玩家调整 AI 设置并结算</span>
                      </label>
                      <div className="text-xs text-gray-500 mt-1">默认关闭更安全；开启后任意玩家可结算并使用其选择的 AI 设置。</div>
                    </div>

                    <div className={(phase === 'waiting' || phase === 'submitting') ? 'mt-3' : ''}>
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={allowPlayerCharacterGuidance}
                          onChange={(e) => permissionsMutation.mutate({ allowPlayerCharacterGuidance: e.target.checked })}
                          disabled={permissionsMutation.isPending}
                        />
                        <span>允许玩家填写“本回合角色行动引导”</span>
                      </label>
                      <div className="text-xs text-gray-500 mt-1">默认关闭；开启后玩家可在出牌前为自己本回合打出的角色添加引导（最多100字）。</div>
                    </div>

                    <div className={(phase === 'waiting' || phase === 'submitting') ? 'mt-3' : ''}>
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={allowSpectators}
                          onChange={(e) => permissionsMutation.mutate({ allowSpectators: e.target.checked })}
                          disabled={permissionsMutation.isPending}
                        />
                        <span>开启观战（新进房间默认观众）</span>
                      </label>
                      <div className="text-xs text-gray-500 mt-1">关闭后：非玩家将无法进入房间；已在房间内的观众不会被自动踢出。</div>
                    </div>

                    <div className={(phase === 'waiting' || phase === 'submitting') ? 'mt-3' : ''}>
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={allowSpectatorChat}
                          onChange={(e) => permissionsMutation.mutate({ allowSpectatorChat: e.target.checked })}
                          disabled={permissionsMutation.isPending || !allowSpectators}
                        />
                        <span>允许观众聊天（默认仅玩家）</span>
                      </label>
                      <div className="text-xs text-gray-500 mt-1">聊天仅支持预设文字组合与表情；关闭后观众仍可阅读但不可发送。</div>
                    </div>

                    {(phase === 'waiting' || phase === 'submitting') && rulesDraft ? (
                      <div className="mt-4 border-t pt-3">
                        <div className="font-semibold text-sm mb-2">对战规则</div>
                        <div className="grid grid-cols-2 gap-2 text-sm">
                          <label className="flex flex-col gap-1 col-span-2">
                            <span>人数（2-6）</span>
                            <input
                              className="border rounded px-2 py-1"
                              type="number"
                              min={2}
                              max={6}
                              value={rulesDraft.participants}
                              onChange={(e) => setRulesDraft((r) => (r ? { ...r, participants: Number(e.target.value) } : r))}
                              disabled={rulesMutation.isPending}
                            />
                          </label>
                          <label className="flex flex-col gap-1 col-span-2">
                            <span>卡组提交模式</span>
                            <select
                              className="border rounded px-2 py-1"
                              value={rulesDraft.submissionMode}
                              onChange={(e) => {
                                const next = e.target.value === 'hostOnly' ? 'hostOnly' : 'perPlayer';
                                setRulesDraft((r) => {
                                  if (!r) return r;
                                  return next === 'hostOnly'
                                    ? { ...r, submissionMode: 'hostOnly', cardsPerPlayer: 0, shuffleDecks: true }
                                    : { ...r, submissionMode: 'perPlayer' };
                                });
                              }}
                              disabled={rulesMutation.isPending}
                            >
                              <option value="perPlayer">每人提交（固定数量）</option>
                              <option value="hostOnly">仅房主提交牌堆（任意数量）</option>
                            </select>
                            <div className="text-xs text-gray-500">
                              {rulesDraft.submissionMode === 'hostOnly'
                                ? '该模式下仅房主提交卡牌（任意张）作为公共牌堆，其他玩家无需提交。'
                                : '每位玩家都需提交固定张数；提交阶段会隐藏他人详情，避免被针对。'}
                            </div>
                          </label>
                          {rulesDraft.submissionMode !== 'hostOnly' && (
                            <label className="flex flex-col gap-1">
                              <span>每人提交</span>
                              <input
                                className="border rounded px-2 py-1"
                                type="number"
                                min={0}
                                max={50}
                                value={rulesDraft.cardsPerPlayer}
                                onChange={(e) => setRulesDraft((r) => (r ? { ...r, cardsPerPlayer: Number(e.target.value) } : r))}
                                disabled={rulesMutation.isPending}
                              />
                            </label>
                          )}
                          <label className="flex flex-col gap-1">
                            <span>初始手牌</span>
                            <input
                              className="border rounded px-2 py-1"
                              type="number"
                              min={1}
                              max={50}
                              value={rulesDraft.dealPerPlayer}
                              onChange={(e) => setRulesDraft((r) => (r ? { ...r, dealPerPlayer: Number(e.target.value) } : r))}
                              disabled={rulesMutation.isPending}
                            />
                          </label>
                          <label className="flex flex-col gap-1">
                            <span>手牌为空时补发</span>
                            <input
                              className="border rounded px-2 py-1"
                              type="number"
                              min={1}
                              max={50}
                              value={rulesDraft.dealWhenEmpty}
                              onChange={(e) => setRulesDraft((r) => (r ? { ...r, dealWhenEmpty: Number(e.target.value) } : r))}
                              disabled={rulesMutation.isPending}
                            />
                          </label>
                          <label className="flex flex-col gap-1 col-span-2">
                            <span>抽取来源（提交牌池用尽后）</span>
                            <select
                              className="border rounded px-2 py-1"
                              value={rulesDraft.drawSource ?? 'public'}
                              onChange={(e) =>
                                setRulesDraft((r) => (r ? { ...r, drawSource: e.target.value as 'public' | 'preset' | 'preset+public' } : r))
                              }
                              disabled={rulesMutation.isPending}
                            >
                              <option value="public">公开库（默认）</option>
                              <option value="preset">预设</option>
                              <option value="preset+public">预设 + 公开库</option>
                            </select>
                            <div className="text-xs text-gray-500">
                              {rulesDraft.submissionMode === 'hostOnly'
                                ? '仅房主提交牌堆时：房主提交内容会作为公共牌堆供所有参与者抽取。'
                                : '每人提交=0 时：开局直接按“手牌为空时补发”发牌。'}
                            </div>
                          </label>
                          <label className="flex items-center gap-2 col-span-1">
                            <input
                              type="checkbox"
                              checked={rulesDraft.recycleUsedCards === true}
                              onChange={(e) => setRulesDraft((r) => (r ? { ...r, recycleUsedCards: e.target.checked } : r))}
                              disabled={rulesMutation.isPending}
                            />
                            <span>允许重复发放已使用的卡</span>
                          </label>
                          <label className="flex items-center gap-2 col-span-2">
                            <input
                              type="checkbox"
                              checked={rulesDraft.dedupe}
                              onChange={(e) => setRulesDraft((r) => (r ? { ...r, dedupe: e.target.checked } : r))}
                              disabled={rulesMutation.isPending}
                            />
                            <span>去重</span>
                          </label>
                          <label className="flex items-center gap-2 col-span-2">
                            <input
                              type="checkbox"
                              checked={rulesDraft.showAllSubmissions}
                              onChange={(e) => setRulesDraft((r) => (r ? { ...r, showAllSubmissions: e.target.checked } : r))}
                              disabled={rulesMutation.isPending}
                            />
                            <span>显示所有人提交的卡组</span>
                          </label>
                          <label className="flex items-center gap-2 col-span-2">
                            <input
                              type="checkbox"
                              checked={rulesDraft.shuffleDecks}
                              onChange={(e) => setRulesDraft((r) => (r ? { ...r, shuffleDecks: e.target.checked } : r))}
                              disabled={rulesMutation.isPending || rulesDraft.submissionMode === 'hostOnly'}
                            />
                            <span>洗混卡组后发牌（关闭则按各自提交发牌）{rulesDraft.submissionMode === 'hostOnly' ? '（房主牌堆模式下固定开启）' : ''}</span>
                          </label>
                          <div className="col-span-2 border rounded p-3 bg-gray-50">
                            <div className="font-semibold text-sm">提交卡牌范围（房间内统一）</div>
                            <div className="text-xs text-gray-600 mt-1">
                              说明：统计范围仅对“数据卡”生效；预设卡不具备点赞/使用/收藏统计，仅受“类型”开关限制。
                            </div>
                            {(() => {
                              const range = normalizePvpRoomCardRange(rulesDraft);
                              const allowed = new Set(range.allowedCombatantTypes);
                              const updateAllowed = (type: 'magical-girl' | 'canshou' | 'general-character', enabled: boolean) => {
                                setRulesDraft((r) => {
                                  if (!r) return r;
                                  const current = normalizePvpRoomCardRange(r);
                                  const next = new Set(current.allowedCombatantTypes);
                                  if (enabled) next.add(type);
                                  else next.delete(type);
                                  return { ...r, cardRange: { ...current, allowedCombatantTypes: [...next] } };
                                });
                              };
                              const updateNumber = (
                                key:
                                  | 'minLikeCount'
                                  | 'maxLikeCount'
                                  | 'minUsageCount'
                                  | 'maxUsageCount'
                                  | 'minFavoriteCount'
                                  | 'maxFavoriteCount',
                                rawValue: string,
                              ) => {
                                const nextValue = rawValue.trim() === '' ? null : Number(rawValue);
                                setRulesDraft((r) => {
                                  if (!r) return r;
                                  const current = normalizePvpRoomCardRange(r);
                                  const numeric = nextValue === null ? null : (Number.isFinite(nextValue) ? Math.max(0, Math.floor(nextValue)) : null);
                                  return { ...r, cardRange: { ...current, [key]: numeric } as any };
                                });
                              };

                              return (
                                <>
                                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2 text-sm">
                                    <label className="flex items-center gap-2">
                                      <input
                                        type="checkbox"
                                        checked={allowed.has('magical-girl')}
                                        onChange={(e) => updateAllowed('magical-girl', e.target.checked)}
                                        disabled={rulesMutation.isPending}
                                      />
                                      <span>允许魔法少女</span>
                                    </label>
                                    <label className="flex items-center gap-2">
                                      <input
                                        type="checkbox"
                                        checked={allowed.has('canshou')}
                                        onChange={(e) => updateAllowed('canshou', e.target.checked)}
                                        disabled={rulesMutation.isPending}
                                      />
                                      <span>允许残兽</span>
                                    </label>
                                    <label className="flex items-center gap-2">
                                      <input
                                        type="checkbox"
                                        checked={allowed.has('general-character')}
                                        onChange={(e) => updateAllowed('general-character', e.target.checked)}
                                        disabled={rulesMutation.isPending}
                                      />
                                      <span>允许通用角色</span>
                                    </label>
                                  </div>

                                  <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                                    <label className="flex flex-col gap-1">
                                      <span>点赞 ≥</span>
                                      <input
                                        className="border rounded px-2 py-1"
                                        type="number"
                                        min={0}
                                        value={range.minLikeCount ?? ''}
                                        onChange={(e) => updateNumber('minLikeCount', e.target.value)}
                                        disabled={rulesMutation.isPending}
                                      />
                                    </label>
                                    <label className="flex flex-col gap-1">
                                      <span>点赞 ≤</span>
                                      <input
                                        className="border rounded px-2 py-1"
                                        type="number"
                                        min={0}
                                        value={range.maxLikeCount ?? ''}
                                        onChange={(e) => updateNumber('maxLikeCount', e.target.value)}
                                        disabled={rulesMutation.isPending}
                                      />
                                    </label>
                                    <label className="flex flex-col gap-1">
                                      <span>使用 ≥</span>
                                      <input
                                        className="border rounded px-2 py-1"
                                        type="number"
                                        min={0}
                                        value={range.minUsageCount ?? ''}
                                        onChange={(e) => updateNumber('minUsageCount', e.target.value)}
                                        disabled={rulesMutation.isPending}
                                      />
                                    </label>
                                    <label className="flex flex-col gap-1">
                                      <span>使用 ≤</span>
                                      <input
                                        className="border rounded px-2 py-1"
                                        type="number"
                                        min={0}
                                        value={range.maxUsageCount ?? ''}
                                        onChange={(e) => updateNumber('maxUsageCount', e.target.value)}
                                        disabled={rulesMutation.isPending}
                                      />
                                    </label>
                                    <label className="flex flex-col gap-1">
                                      <span>收藏 ≥</span>
                                      <input
                                        className="border rounded px-2 py-1"
                                        type="number"
                                        min={0}
                                        value={range.minFavoriteCount ?? ''}
                                        onChange={(e) => updateNumber('minFavoriteCount', e.target.value)}
                                        disabled={rulesMutation.isPending}
                                      />
                                    </label>
                                    <label className="flex flex-col gap-1">
                                      <span>收藏 ≤</span>
                                      <input
                                        className="border rounded px-2 py-1"
                                        type="number"
                                        min={0}
                                        value={range.maxFavoriteCount ?? ''}
                                        onChange={(e) => updateNumber('maxFavoriteCount', e.target.value)}
                                        disabled={rulesMutation.isPending}
                                      />
                                    </label>
                                  </div>
                                </>
                              );
                            })()}
                          </div>
                          <div className="col-span-2">
                            <BattleModeSelector
                              value={rulesDraft.mode as any}
                              onChange={(next) => setRulesDraft((r) => (r ? { ...r, mode: next as any } : r))}
                              disabled={rulesMutation.isPending}
                              label="模式"
                              showHelper={true}
                            />
                          </div>
                          {rulesDraft.mode === 'scenario' && (
                            <div className="col-span-2 border rounded p-3 bg-white">
                              <div className="text-xs text-gray-600 mb-2">房间情景（所有情景模式回合都会使用该情景结算）</div>
                              <ScenarioPickerPanel
                                onOpenScenarioModal={() => setShowScenarioModal(true)}
                                onRandomMatchScenario={handleRandomMatchScenario}
                                enableLocalInput={false}
                                onActionError={(e) => handlePvpRequestError(e, '操作失败')}
                                isAuthenticated={isAuthenticated}
                                isGenerating={rulesMutation.isPending || scenarioMutation.isPending}
                                isMatchingBlocked={isScenarioMatching}
                                isMatchingScenario={isScenarioMatching}
                                scenarioFileName={scenarioDraft?.name ?? (typeof roomScenario?.title === 'string' ? roomScenario.title : null)}
                              />
                              <div className="flex gap-2">
                                <button
                                  className="px-3 py-2 rounded bg-purple-600 text-white text-sm disabled:opacity-50"
                                  disabled={!scenarioDraft || scenarioMutation.isPending || rulesMutation.isPending}
                                  onClick={() => scenarioDraft && scenarioMutation.mutate({ selection: scenarioDraft })}
                                >
                                  保存情景
                                </button>
                                <button
                                  className="px-3 py-2 rounded border text-sm disabled:opacity-50"
                                  disabled={scenarioMutation.isPending || rulesMutation.isPending || !roomScenario}
                                  onClick={() => scenarioMutation.mutate({ selection: null })}
                                >
                                  清空情景
                                </button>
                                <div className="text-xs text-gray-600 flex items-center">
                                  提示：保存情景会同时确保房间模式为“情景”；其他规则仍需点击下方“保存设置”。
                                </div>
                              </div>
                            </div>
                          )}
                          <div className="col-span-2 border rounded p-2 bg-gray-50">
                            <label className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={rulesDraft.bestOf.enabled}
                                onChange={(e) =>
                                  setRulesDraft((r) => (r ? { ...r, bestOf: { ...r.bestOf, enabled: e.target.checked } } : r))
                                }
                                disabled={rulesMutation.isPending}
                              />
                              <span>启用多局制（按轮次累计胜场）</span>
                            </label>
                            <div className="mt-2 grid grid-cols-2 gap-2">
                              <label className="flex flex-col gap-1">
                                <span>最多轮次</span>
                                <input
                                  className="border rounded px-2 py-1"
                                  type="number"
                                  min={1}
                                  max={10}
                                  value={rulesDraft.bestOf.maxRounds}
                                  disabled={!rulesDraft.bestOf.enabled || rulesMutation.isPending}
                                  onChange={(e) =>
                                    setRulesDraft((r) => (r ? { ...r, bestOf: { ...r.bestOf, maxRounds: Number(e.target.value) } } : r))
                                  }
                                />
                              </label>
                              <div className="text-xs text-gray-600 flex items-end pb-1">
                                {rulesDraft.bestOf.enabled ? '提示：多局制下若手牌为空，会按设置自动补牌' : '关闭时为单局对战'}
                              </div>
                            </div>
                          </div>
                        </div>

                        <div className="mt-4 border-t pt-3">
                          <div className="font-semibold text-sm mb-1">对局生成设置（全员一致）</div>
                          <div className="text-xs text-gray-600">
                            这些设置由房主统一保存，并在本房间的整个对局中保持一致；开始对局后不可修改。
                          </div>

                          <div className="mt-3">
                            <ArenaDataSettingsPanel
                              value={{
                                readArenaHistory: rulesDraft.readArenaHistory,
                                readArenaHistoryLimit: rulesDraft.readArenaHistoryLimit,
                                isArenaHistoryUnlimited: rulesDraft.isArenaHistoryUnlimited,
                                writeArenaHistory: rulesDraft.writeArenaHistory,
                                readCurrentState: rulesDraft.readCurrentState,
                                writeCurrentState: rulesDraft.writeCurrentState,
                              }}
                              onChange={(patch) => setRulesDraft((r) => (r ? { ...r, ...patch } : r))}
                              disabled={rulesMutation.isPending}
                              combatantCountForEstimate={rulesDraft.participants}
                              footerNote={
                                <p className="text-xs text-gray-500 mt-2">
                                  提示：在 PVP 中开启“写入”只会生成可展示的更新摘要，不会自动保存/覆盖任何角色数据卡。
                                </p>
                              }
                            />
                          </div>

                          <div className="mt-3">
                            <GenerationModeSwitcher
                              label="战报生成方式"
                              value={(rulesDraft.generationMode as any) || 'non-stream'}
                              disabled={rulesMutation.isPending}
                              onChange={(mode) => setRulesDraft((r) => (r ? { ...r, generationMode: mode as any } : r))}
                            />
                            <div className="text-xs text-gray-500 mt-2">
                              提示：流式模式会实时输出正文，但胜者解析存在不确定性；若解析失败将自动进入“胜者投票”。
                            </div>
                          </div>

                          <div className="mt-3">
                            <StoryOptionsPanel
                              battleMode={rulesDraft.mode}
                              isGenerating={rulesMutation.isPending}
                              enableUserGuidance={appConfig.ENABLE_ARENA_USER_GUIDANCE}
                              languages={languagesQuery.data}
                              allowEmptyLanguage={true}
                              selectedLevel={rulesDraft.selectedLevel}
                              onSelectedLevelChange={(value) => setRulesDraft((r) => (r ? { ...r, selectedLevel: value } : r))}
                              userGuidance={rulesDraft.userGuidance}
                              onUserGuidanceChange={(value) => setRulesDraft((r) => (r ? { ...r, userGuidance: value } : r))}
                              afterUserGuidance={
                                <div className="text-xs text-gray-500 mt-1">
                                  说明：PVP 还会自动附加“裁判规则”提示词来约束 winner 输出，该部分不会显示在战报的“故事引导”区块中。
                                </div>
                              }
                              storyLength={rulesDraft.storyLength as any}
                              onStoryLengthChange={(value) => setRulesDraft((r) => (r ? { ...r, storyLength: value as any } : r))}
                              selectedLanguage={rulesDraft.language}
                              onSelectedLanguageChange={(value) => setRulesDraft((r) => (r ? { ...r, language: value } : r))}
                            />
                          </div>

                          <div className="mt-3">
                            <AdjudicatorSettingsPanel
                              events={Array.isArray(rulesDraft.adjudicationEvents) ? rulesDraft.adjudicationEvents : []}
                              onEventsChange={(events) => setRulesDraft((r) => (r ? { ...r, adjudicationEvents: events } : r))}
                              disabled={rulesMutation.isPending}
                            />
                          </div>
                        </div>

                        <div className="text-xs text-gray-500 mt-2">提示：修改“卡组提交模式/每人提交”会清空已提交卡组。</div>
                        {rulesDraftError ? (
                          <div className="text-xs text-red-600 mt-2 whitespace-pre-wrap">规则不合法：{rulesDraftError}</div>
                        ) : null}

                        <div className="mt-3 flex gap-2">
                          <button
                            className="generate-button flex-1"
                            style={{ backgroundColor: '#3b82f6', backgroundImage: 'linear-gradient(to right, #3b82f6, #2563eb)' }}
                            onClick={() => void saveRulesDraft()}
                            disabled={rulesMutation.isPending || Boolean(rulesDraftError)}
                          >
                            {rulesMutation.isPending ? '保存中…' : '保存设置'}
                          </button>
                          <button
                            className="px-3 py-2 rounded-lg border bg-white hover:bg-gray-50 text-sm disabled:opacity-50"
                            onClick={resetRulesDraftFromRoom}
                            disabled={rulesMutation.isPending || !rules}
                          >
                            重置
                          </button>
                        </div>
                      </div>
                    ) : null}

                    {phase === 'waiting' && rules && rules.submissionMode !== 'hostOnly' && rules.cardsPerPlayer === 0 && (
                      <div className="mt-3 p-3 rounded-md border bg-purple-50">
                        <div className="text-sm font-semibold text-purple-900">本局无需提交卡组</div>
                        <div className="text-xs text-purple-800 mt-1">
                          开局将按“手牌为空时补发”发牌；抽取来源：
                          {rules.drawSource === 'preset'
                            ? '预设'
                            : rules.drawSource === 'preset+public'
                              ? '预设 + 公开库'
                              : '公开库'}
                        </div>
                        <button
                          className="generate-button w-full mt-2"
                          style={{ backgroundColor: '#a855f7', backgroundImage: 'linear-gradient(to right, #a855f7, #7c3aed)' }}
                          disabled={startMutation.isPending || !canStartNow}
                          onClick={handleStartClick}
                        >
                          {startMutation.isPending ? '发牌中…' : '开始对局（发牌）'}
                        </button>
                      </div>
                    )}

                    {phase === 'waiting' && rules && (rules.submissionMode === 'hostOnly' || rules.cardsPerPlayer > 0) && isHost && canStartNow && totalParticipants < rules.participants && (
                      <div className="mt-3 p-3 rounded-md border bg-amber-50">
                        <div className="text-sm font-semibold text-amber-900">房间未满员，也可以提前开局</div>
                        <div className="text-xs text-amber-800 mt-1">
                          继续将自动把房间人数从 {rules.participants} 缩减为 {totalParticipants}，并进入{rules.submissionMode === 'hostOnly' ? '房主提交牌堆' : '提交卡组'}阶段。
                        </div>
                        <button
                          className="generate-button w-full mt-2"
                          style={{ backgroundColor: '#f59e0b', backgroundImage: 'linear-gradient(to right, #f59e0b, #d97706)' }}
                          disabled={startMutation.isPending}
                          onClick={handleStartClick}
                        >
                          {startMutation.isPending ? '开始中…' : `提前开局（锁定人数并进入${rules.submissionMode === 'hostOnly' ? '房主提交' : '提交'}）`}
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {phase === 'submitting' && rules && !isSpectator && (
                  <div className="mt-4">
                    <div className="p-3 rounded-md bg-white border">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-semibold text-sm mb-1">
                            {rules.submissionMode === 'hostOnly' ? '房主提交牌堆（任意张）' : `提交卡组（需要 ${rules.cardsPerPlayer} 张）`}
                          </div>
                          <div className="text-xs text-gray-600">
                            注意：提交私有卡会让对手可查看完整 JSON（问卷/能力/设定全量）。
                          </div>
                          {pendingAction?.kind === 'submit' ? (
                            <div className="text-xs text-amber-700 mt-2">
                              仅剩最后一位玩家未提交：{pendingAction.pendingUsername || `用户${pendingAction.pendingUserId}`}。
                              {pendingActionSecondsLeft > 0 ? `倒计时 ${pendingActionSecondsLeft}s 后房主可强制随机提交。` : '倒计时结束，房主可强制随机提交。'}
                            </div>
                          ) : null}
                          {rules.submissionMode === 'hostOnly' && !isHost ? (
                            <div className="text-xs text-gray-600 mt-2">
                              {(() => {
                                const hostId = room?.hostUserId;
                                const status = typeof hostId === 'number' ? submissionStatusByUserId.get(hostId) : null;
                                if (!hostId || !status) return '等待房主提交牌堆…';
                                return status.hasSubmitted
                                  ? `房主已提交牌堆：${status.submittedCount} 张${status.hasPrivateCard ? '（含私有）' : ''}，请等待房主开始对局（发牌）。`
                                  : '等待房主提交牌堆…';
                              })()}
                            </div>
                          ) : null}
                        </div>
                        {mySubmission && !showSubmitEditor && (rules.submissionMode !== 'hostOnly' || isHost) ? (
                          <button
                            className="px-3 py-2 rounded-lg border bg-white hover:bg-gray-50 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                            onClick={() => {
                              setError(null);
                              clearSelected();
                              setShowSubmitEditor(true);
                            }}
                            disabled={submitMutation.isPending}
                          >
                            修改提交
                          </button>
                        ) : null}
                      </div>

                      {rules.submissionMode === 'hostOnly' && !isHost ? null : (!mySubmission || showSubmitEditor) ? (
                        <>
                          <div className="mt-3">
                            <DatabaseSelector
                              onOpenCharacterModal={() => setShowBattleDataModal(true)}
                              onRandomMatchCharacter={handleRandomMatchCharacter}
                              isAuthenticated={isAuthenticated}
                              isGenerating={submitMutation.isPending}
                              isMatching={isMatching}
                              combatantCount={selected.length}
                              maxCombatants={rules.submissionMode === 'hostOnly' ? 9999 : rules.cardsPerPlayer}
                            />
                          </div>

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
                                maxSelected={rules.submissionMode === 'hostOnly' ? 9999 : rules.cardsPerPlayer}
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
                                maxSelected={rules.submissionMode === 'hostOnly' ? 9999 : rules.cardsPerPlayer}
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
                                  {rules.submissionMode === 'hostOnly' ? `已选牌堆（${selected.length}）` : `已选卡组 (${selected.length}/${rules.cardsPerPlayer})`}
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
                              <span>我已知悉：提交阶段不会展示他人卡组；开始对局后若房间允许查看全部提交，对手可能可查看完整 JSON（含私有卡）</span>
                            </label>
                          )}

                          <button
                            className="generate-button w-full"
                            style={{ backgroundColor: '#22c55e', backgroundImage: 'linear-gradient(to right, #22c55e, #16a34a)' }}
                            disabled={
                              submitMutation.isPending ||
                              (rules.submissionMode === 'hostOnly' ? (selected.length <= 0 || !isHost) : selected.length !== rules.cardsPerPlayer) ||
                              (hasPrivateSelected && !acceptPrivateDisclosure)
                            }
                            onClick={() => submitMutation.mutate()}
                          >
                            {submitMutation.isPending ? '提交中…' : (rules.submissionMode === 'hostOnly' ? '提交牌堆' : '提交卡组')}
                          </button>
                        </>
                      ) : (
                        <div className="mt-3 rounded-md border bg-gray-50 p-3 text-sm text-gray-700">
                          {rules.submissionMode === 'hostOnly'
                            ? `你已提交牌堆：${mySubmission?.cards?.length || 0} 张卡${mySubmission?.hasPrivateCard ? '（含私有）' : ''}。`
                            : `你已提交 ${mySubmission?.cards?.length || 0} 张卡${mySubmission?.hasPrivateCard ? '（含私有）' : ''}，等待其他玩家提交。`}
                        </div>
                      )}

                      {isHost && pendingAction?.kind === 'submit' ? (
                        <button
                          className="generate-button w-full mt-3"
                          style={{ backgroundColor: '#ef4444', backgroundImage: 'linear-gradient(to right, #ef4444, #dc2626)' }}
                          disabled={forceActionMutation.isPending || pendingActionSecondsLeft > 0}
                          onClick={() => forceActionMutation.mutate('submit')}
                          title={pendingActionSecondsLeft > 0 ? '倒计时未结束' : '强制为最后一位未提交玩家随机生成并提交卡组'}
                        >
                          {forceActionMutation.isPending ? '强制中…' : pendingActionSecondsLeft > 0 ? `强制随机提交（${pendingActionSecondsLeft}s）` : '强制随机提交'}
                        </button>
                      ) : null}

                      {isHost && (
                        <button
                          className="generate-button w-full mt-3"
                          style={{ backgroundColor: '#a855f7', backgroundImage: 'linear-gradient(to right, #a855f7, #7c3aed)' }}
                          disabled={startMutation.isPending || !canStartNow || ((rules.submissionMode === 'hostOnly' || rules.cardsPerPlayer > 0) && submittedParticipantCount < totalParticipants)}
                          onClick={handleStartClick}
                        >
                          {startMutation.isPending ? '发牌中…' : '开始对局（发牌）'}
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {phase === 'choosing' && !isSpectator && (
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
                          disabled={!canOpenHand}
                        >
                          {isHandDealing ? '发牌中…' : '打开手牌'}
                        </button>
                      </div>

                      {!isHandDealing && !choices?.hasChosenMe && (isHost || allowPlayerCharacterGuidance) ? (
                        <div className="mt-3">
                          <div className="text-xs text-gray-600 mb-1">本回合角色行动引导（可选，最多100字；仅对你本回合打出的角色生效）</div>
                          <textarea
                            className="w-full border rounded px-2 py-1 text-sm"
                            rows={3}
                            maxLength={100}
                            value={myCharacterGuidanceDraft}
                            onChange={(e) => setMyCharacterGuidanceDraft(e.target.value)}
                            disabled={chooseMutation.isPending}
                            placeholder="例如：优先保护同伴、试图谈判、隐藏身份、恐惧但硬撑、专注救援等"
                          />
                          <div className="mt-1 text-xs text-gray-500">{Array.from(myCharacterGuidanceDraft).length}/100</div>
                        </div>
                      ) : null}

                      {!isHost && !allowPlayerCharacterGuidance && !choices?.hasChosenMe ? (
                        <div className="mt-3 text-xs text-gray-500">提示：房主未允许玩家填写“本回合角色行动引导”。</div>
                      ) : null}

                      {isHandDealing ? (
                        <div className="text-sm text-gray-700 mt-3 flex items-center gap-2">
                          <span className="inline-block w-4 h-4 rounded-full border-2 border-gray-400 border-t-transparent animate-spin" />
                          正在发牌/同步手牌，请稍候…
                        </div>
                      ) : myHandCards.length <= 0 ? (
                        <div className="text-sm text-gray-700 mt-3">手牌为空，暂时无法出牌。</div>
                      ) : null}

                      <div className="text-sm text-gray-700 mt-3">
                        已选人数：{choices?.chosenCount ?? 0} / {choices?.totalPlayers ?? players.length}；
                        我方已选：{choices?.hasChosenMe ? '是' : '否'}
                        {typeof choices?.hasChosenOther === 'boolean' ? ` / 对手已选：${choices.hasChosenOther ? '是' : '否'}` : ''}
                      </div>

                      {pendingAction?.kind === 'choose' ? (
                        <div className="text-xs text-amber-700 mt-2">
                          仅剩最后一位玩家未出牌：{pendingAction.pendingUsername || `用户${pendingAction.pendingUserId}`}。
                          {pendingActionSecondsLeft > 0 ? `倒计时 ${pendingActionSecondsLeft}s 后房主可强制随机出牌。` : '倒计时结束，房主可强制随机出牌。'}
                        </div>
                      ) : null}

                      {isHost && pendingAction?.kind === 'choose' ? (
                        <button
                          className="generate-button w-full mt-3"
                          style={{ backgroundColor: '#ef4444', backgroundImage: 'linear-gradient(to right, #ef4444, #dc2626)' }}
                          disabled={forceActionMutation.isPending || pendingActionSecondsLeft > 0}
                          onClick={() => forceActionMutation.mutate('choose')}
                          title={pendingActionSecondsLeft > 0 ? '倒计时未结束' : '强制为最后一位未出牌玩家随机从其手牌中出牌'}
                        >
                          {forceActionMutation.isPending ? '强制中…' : pendingActionSecondsLeft > 0 ? `强制随机出牌（${pendingActionSecondsLeft}s）` : '强制随机出牌'}
                        </button>
                      ) : null}

                      {Boolean(
                        choices?.hasChosenMe &&
                        (choices?.chosenCount ?? 0) >= (choices?.totalPlayers ?? players.length)
                      ) && (
                        canControlResolve ? (
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
                                  : rules?.generationMode === 'stream'
                                    ? '结算（流式生成）'
                                    : '结算（生成战报）'}
                            </button>
                          </>
                        ) : (
                          <div className="mt-3 rounded-md border bg-gray-50 p-3 text-sm text-gray-700">
                            已全员出牌，等待房主结算。
                          </div>
                        )
                      )}
                    </div>
                  </div>
                )}

                {phase === 'choosing' && isSpectator && (
                  <div className="mt-4">
                    <div className="p-4 rounded-xl bg-white border">
                      <div className="font-semibold text-sm text-gray-900">观战中</div>
                      <div className="text-sm text-gray-700 mt-2">
                        已选人数：{choices?.chosenCount ?? 0} / {choices?.totalPlayers ?? players.length}
                      </div>
                      <div className="text-xs text-gray-600 mt-2">提示：观战视角不会展示任何玩家手牌或出牌选择。</div>
                    </div>
                  </div>
                )}

                <BattleDataModal
                  isOpen={showHandModal}
                  onClose={() => setShowHandModal(false)}
                  onSelectCard={() => {}}
                  selectedType="character"
                  initialTab="pvpHand"
                  visibleTabs={['pvpHand']}
                  titleOverride="我的手牌"
                  pvpHandTab={{
                    cards: myHandCards,
                    hasChosenMe: Boolean(choices?.hasChosenMe),
                    isChoosing: chooseMutation.isPending,
                    onChoose: chooseFromHandModal,
                  }}
                />

                {hasAnyReportForUi && (
                  <div className="mt-4">
                    {reportContentForUi.trim() ? (
                      <StreamingBattleReportCard
                        content={reportContentForUi}
                        mode={rules?.mode as any}
                        isStreaming={isStreamingResolve}
                        reporterInfo={(reportMetaForUi as any)?.reporterInfo ?? null}
                        userGuidance={(reportMetaForUi as any)?.userGuidance ?? null}
                        characterGuidances={(reportMetaForUi as any)?.characterGuidances ?? null}
                        adjudicationResults={(reportMetaForUi as any)?.adjudicationResults ?? null}
                        aiModel={(reportMetaForUi as any)?.ai?.model ?? null}
                        onSaveImage={(imageUrl) => {
                          setSavedImageUrl(imageUrl);
                          setShowImageModal(true);
                        }}
                      />
                    ) : resolvedNonStreamReport ? (
                      <BattleReportCard
                        report={resolvedNonStreamReport}
                        mode={rules?.mode as any}
                        onSaveImage={(imageUrl) => {
                          setSavedImageUrl(imageUrl);
                          setShowImageModal(true);
                        }}
                      />
                    ) : null}
                    {loadedBattleReportError ? (
                      <div className="mt-2 text-xs text-red-600">战报正文加载失败：{loadedBattleReportError}</div>
                    ) : null}
                    <div className="text-sm text-gray-700 mt-2 flex items-center justify-between gap-2">
                      <div>
                        本轮胜者：<span className="font-semibold">{latestWinnerText || (isStreamingResolve ? '解析中…' : '平局')}</span>
                      </div>
                      {isHost && phase === 'reviewing' && latestRound ? (
                        <button
                          className="px-2 py-1 rounded border bg-white hover:bg-gray-50 text-xs disabled:opacity-50 disabled:cursor-not-allowed"
                          onClick={() => {
                            const ok = window.confirm('将发起“胜者投票”，并暂停当前回合的阅读确认。继续？');
                            if (!ok) return;
                            startWinnerVoteMutation.mutate();
                          }}
                          disabled={startWinnerVoteMutation.isPending}
                          title="当你认为 AI 判定不妥时，可让房间内成员投票决定胜者（平票则平局）"
                        >
                          {startWinnerVoteMutation.isPending ? '发起中…' : '发起胜者投票'}
                        </button>
                      ) : null}
                    </div>
                    {(rules?.writeArenaHistory || rules?.writeCurrentState) && (
                      <PvpUpdatedCombatantsPanel
                        updatedCombatants={
                          Array.isArray((latestRoundResult as any)?.updatedCombatants)
                            ? ((latestRoundResult as any).updatedCombatants as any[])
                            : []
                        }
                      />
                    )}
                  </div>
                )}

                {phase === 'voting' && winnerVote && hasAnyReportForUi && (
                  <div className="p-4 rounded-xl bg-white border mt-4">
                    <div className="font-semibold text-sm text-gray-900">胜者投票</div>
                    <div className="text-xs text-gray-600 mt-2">
                      请根据战报内容选择胜者或平局；得票最高者获胜，若出现平票则判定为平局。
                    </div>

                    <div className="mt-3 space-y-2">
                      {Array.isArray((latestRoundResult as any)?.combatants)
                        ? ((latestRoundResult as any).combatants as any[])
                            .slice()
                            .sort((a, b) => (a?.seat ?? 99) - (b?.seat ?? 99))
                            .map((c: any) => {
                              const seat = typeof c?.seat === 'number' ? c.seat : null;
                              const name = typeof c?.name === 'string' ? c.name : '未知参战者';
                              const playerLabel =
                                typeof seat === 'number'
                                  ? (playerDisplayBySeat.get(seat) || (c?.isBot ? '机器人' : '未知玩家'))
                                  : '未知玩家';
                              const checked =
                                winnerVoteDraft?.kind === 'seat' &&
                                typeof seat === 'number' &&
                                Number.isFinite(seat) &&
                                winnerVoteDraft.seat === seat;
                              return (
                                <label key={`vote-seat-${String(seat)}`} className="flex items-center gap-2 text-sm text-gray-800">
                                  <input
                                    type="radio"
                                    name="pvp-winner-vote"
                                    checked={checked}
                                    disabled={submitWinnerVoteMutation.isPending}
                                    onChange={() => {
                                      if (typeof seat !== 'number' || !Number.isFinite(seat)) return;
                                      setWinnerVoteDraft({ kind: 'seat', seat: Math.floor(seat) });
                                    }}
                                  />
                                  <span>
                                    座位 {String(seat)} · {playerLabel}（角色：{name}）
                                  </span>
                                </label>
                              );
                            })
                        : null}
                      <label className="flex items-center gap-2 text-sm text-gray-800">
                        <input
                          type="radio"
                          name="pvp-winner-vote"
                          checked={winnerVoteDraft?.kind === 'draw'}
                          disabled={submitWinnerVoteMutation.isPending}
                          onChange={() => setWinnerVoteDraft({ kind: 'draw' })}
                        />
                        <span>平局</span>
                      </label>
                    </div>

                    {pendingAction?.kind === 'vote' ? (
                      <div className="text-xs text-amber-700 mt-3">
                        仅剩最后一位用户未投票：{pendingAction.pendingUsername || `用户${pendingAction.pendingUserId}`}。
                        {pendingActionSecondsLeft > 0 ? `倒计时 ${pendingActionSecondsLeft}s 后房主可强制结束投票。` : '倒计时结束，房主可强制结束投票。'}
                      </div>
                    ) : null}

                    <div className="mt-3 flex gap-2">
                      <button
                        className="generate-button w-full"
                        style={{ backgroundColor: '#10b981', backgroundImage: 'linear-gradient(to right, #10b981, #059669)' }}
                        disabled={submitWinnerVoteMutation.isPending || !winnerVoteDraft}
                        onClick={() => {
                          if (!winnerVoteDraft) return;
                          submitWinnerVoteMutation.mutate(winnerVoteDraft);
                        }}
                        title={!winnerVoteDraft ? '请先选择一个投票选项' : '提交你的投票（可重复提交覆盖）'}
                      >
                        {submitWinnerVoteMutation.isPending ? '提交中…' : winnerVote?.hasVotedMe ? '更新投票' : '提交投票'}
                      </button>
                      {isHost && pendingAction?.kind === 'vote' ? (
                        <button
                          className="generate-button w-full"
                          style={{ backgroundColor: '#ef4444', backgroundImage: 'linear-gradient(to right, #ef4444, #dc2626)' }}
                          disabled={finalizeWinnerVoteMutation.isPending || pendingActionSecondsLeft > 0}
                          onClick={() => finalizeWinnerVoteMutation.mutate()}
                          title={pendingActionSecondsLeft > 0 ? '倒计时未结束' : '强制结束投票并按当前票数结算（平票则平局）'}
                        >
                          {finalizeWinnerVoteMutation.isPending ? '结束中…' : pendingActionSecondsLeft > 0 ? `强制结束（${pendingActionSecondsLeft}s）` : '强制结束'}
                        </button>
                      ) : null}
                    </div>

                    <div className="text-xs text-gray-600 mt-3">
                      已投票：{(winnerVote as any)?.tally?.voteCount ?? 0}/{(winnerVote as any)?.tally?.eligibleCount ?? 0}；
                      平局票：{(winnerVote as any)?.tally?.drawCount ?? 0}
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      当前票数：
                      {(() => {
                        const counts = (winnerVote as any)?.tally?.countsBySeat;
                        if (!counts || typeof counts !== 'object') return '暂无';
                        const items = Object.entries(counts as Record<string, number>)
                          .map(([seat, count]) => ({ seat: Number(seat), count }))
                          .filter((x) => Number.isFinite(x.seat))
                          .sort((a, b) => a.seat - b.seat)
                          .map((x) => `座位${x.seat}=${x.count}`);
                        return items.length ? items.join('，') : '暂无';
                      })()}
                    </div>
                  </div>
                )}

                {phase === 'reviewing' && !isSpectator ? (
                  <div className="p-3 rounded-md bg-white border mt-4 text-sm">
                    <div className="font-semibold mb-1">等待全员确认</div>
                    <div className="text-gray-700">
                      {confirmations ? (
                        <>玩家已确认：{confirmations.confirmedHumans}/{confirmations.totalHumans}</>
                      ) : (
                        '正在统计确认人数…'
                      )}
                    </div>
                    {!latestRound ? (
                      <div className="text-xs text-gray-600 mt-2">提示：回合信息尚未加载完成，请稍候或刷新页面。</div>
                    ) : null}
                    {pendingAction?.kind === 'confirm' ? (
                      <div className="text-xs text-amber-700 mt-2">
                        仅剩最后一位玩家未确认：{pendingAction.pendingUsername || `用户${pendingAction.pendingUserId}`}。
                        {pendingActionSecondsLeft > 0 ? `倒计时 ${pendingActionSecondsLeft}s 后房主可强制确认。` : '倒计时结束，房主可强制确认。'}
                      </div>
                    ) : null}
                    <button
                      className="generate-button mt-3 w-full"
                      style={{ backgroundColor: '#3b82f6', backgroundImage: 'linear-gradient(to right, #3b82f6, #2563eb)' }}
                      onClick={() => confirmMutation.mutate()}
                      disabled={confirmMutation.isPending}
                      title={confirmations?.hasConfirmedMe ? '你已确认，可再次点击尝试推进' : '确认已阅读本轮战报，推进下一回合/结束'}
                    >
                      {confirmMutation.isPending ? '确认中…' : confirmations?.hasConfirmedMe ? '已确认（尝试推进）' : '确认已阅读（推进）'}
                    </button>
                    {isHost && pendingAction?.kind === 'confirm' ? (
                      <button
                        className="generate-button mt-2 w-full"
                        style={{ backgroundColor: '#ef4444', backgroundImage: 'linear-gradient(to right, #ef4444, #dc2626)' }}
                        disabled={forceActionMutation.isPending || pendingActionSecondsLeft > 0}
                        onClick={() => forceActionMutation.mutate('confirm')}
                        title={pendingActionSecondsLeft > 0 ? '倒计时未结束' : '强制为最后一位未确认玩家执行确认'}
                      >
                        {forceActionMutation.isPending ? '强制中…' : pendingActionSecondsLeft > 0 ? `强制确认（${pendingActionSecondsLeft}s）` : '强制确认'}
                      </button>
                    ) : null}
                    <div className="text-xs text-gray-500 mt-2">
                      提示：所有玩家确认后才会进入下一回合或结束对局。
                    </div>
                  </div>
                ) : phase === 'reviewing' && isSpectator ? (
                  <div className="p-3 rounded-md bg-white border mt-4 text-sm">
                    <div className="font-semibold mb-1">观战中：等待玩家确认</div>
                    <div className="text-gray-700">战报已生成，等待玩家确认后将推进下一回合/结束对局。</div>
                    <div className="text-xs text-amber-700 mt-2">
                      提示：你当前是“观众”，不会显示“确认已阅读”按钮；且该阶段无法切换为玩家（需要等下一局/让房主重开）。
                    </div>
                  </div>
                ) : null}

                {phase === 'advancing' ? (
                  <div className="p-3 rounded-md bg-blue-50 text-blue-800 text-sm mt-4">
                    正在推进下一回合/结算对局结果，请稍候…
                    {typeof lastActivityAgeSeconds === 'number' && lastActivityAgeSeconds >= 45 ? (
                      <div className="text-xs text-blue-900 mt-2">
                        已 {lastActivityAgeSeconds}s 未更新，推进可能卡住了。建议刷新页面；如果仍无变化，可先退出房间再重新进入。
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {phase === 'finished' && (
                  <div className="p-3 rounded-md bg-green-50 text-green-800 text-sm mt-4">
                    对局已结束。
                  </div>
                )}

                <button
                  className="generate-button mt-3 w-full"
                  style={{ backgroundColor: '#ec4899', backgroundImage: 'linear-gradient(to right, #ec4899, #db2777)' }}
                  onClick={() => setShowSettlementCardModal(true)}
                  disabled={!room?.currentMatchId}
                  title={!room?.currentMatchId ? '尚未开始对局：需要房主先开局' : '生成可保存/分享的战局结算图片'}
                >
                  生成战局结算卡
                </button>

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
                  <div
                    className={[
                      'p-3 rounded-md text-sm mt-4',
                      versionConflictRetryUntil ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800',
                    ].join(' ')}
                  >
                    <div className="whitespace-pre-wrap">{error}</div>
                    {versionConflictRetryUntil ? (
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <div className="text-sm">
                          版本冲突，{versionConflictSecondsLeft} 秒后自动刷新重试…
                        </div>
                        <button
                          className="px-2 py-1 rounded border bg-white hover:bg-gray-50 text-sm"
                          onClick={() => window.location.reload()}
                        >
                          立即刷新
                        </button>
                      </div>
                    ) : null}
                  </div>
                )}

                <div className="p-3 rounded-md bg-white border mt-4">
                  <div className="font-semibold text-sm mb-2">提交情况</div>
                  {canSeeAllSubmissionDetails ? (
                    <div className="text-xs text-gray-600 mb-2">当前房间允许查看所有人的提交详情。</div>
                  ) : phase === 'submitting' ? (
                    <div className="text-xs text-gray-600 mb-2">为防止“先提交被针对”，提交阶段仅展示“谁已提交”，不展示他人卡组详情；开始对局后再按房间设置决定是否可查看。</div>
                  ) : (
                    <div className="text-xs text-gray-600 mb-2">房主已关闭“显示所有人提交的卡组”，你只能查看自己的提交详情。</div>
                  )}
                  <div className="space-y-3">
                    {submissionStatusBySeat
                      .filter((s) => typeof s.userId === 'number')
                      .map((s) => {
                        const userId = s.userId as number;
                        const username = usernameById.get(userId) || `用户${userId}`;
                        const detailed = submissions.find((x: any) => typeof x?.userId === 'number' && x.userId === userId) as any | null;
                        const hostOnly = rules?.submissionMode === 'hostOnly';
                        const isRequired = hostOnly ? userId === room?.hostUserId : true;
                        const summaryText = !isRequired
                          ? '无需提交'
                          : s.hasSubmitted
                            ? `已提交 ${s.submittedCount} 张${s.hasPrivateCard ? '（含私有）' : ''}`
                            : '未提交';

                        return (
                          <details key={userId} className="text-sm">
                            <summary className="cursor-pointer">
                              {username}：{summaryText}
                            </summary>
                            {detailed ? (
                              <div className="mt-2 space-y-2">
                                {(detailed.cards || []).map((c: any, idx: number) => {
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
                                            id: `pvp:submission:${userId}:${idx}`,
                                            name: c.name || '未命名',
                                            description: `PVP 提交卡（${username}）`,
                                            type: 'character',
                                            data: typeof c.dataJson === 'string' ? c.dataJson : JSON.stringify(c.dataJson ?? {}),
                                            isPublic: Boolean(c.source?.isPublic ?? true),
                                            author: c.source?.authorUsername || username,
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
                            ) : s.hasSubmitted ? (
                              <div className="mt-2 text-xs text-gray-600">
                                {phase === 'submitting'
                                  ? '该玩家已提交，但提交阶段不展示详情。'
                                  : canSeeAllSubmissionDetails
                                    ? '该玩家已提交，但提交详情暂不可用，请刷新后重试。'
                                    : '该玩家已提交，但详情已被房间设置隐藏。'}
                              </div>
                            ) : null}
                          </details>
                        );
                      })}
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
          </div>
          <Footer />
        </div>
      </div>

      <BattleDataModal
        isOpen={showBattleDataModal}
        onClose={() => setShowBattleDataModal(false)}
        onSelectCard={handleSelectDataCardFromModal}
        selectedType="character"
        selectionMode="multi"
        selectedCardIds={selected.filter((c) => c.kind === 'data_card').map((c) => c.id)}
        selectedCountOverride={selected.length}
        maxSelected={rules?.submissionMode === 'hostOnly' ? 9999 : rules?.cardsPerPlayer}
        onToggleCard={handleToggleDataCardFromModal}
      />

      {showScenarioModal && (
        <BattleDataModal
          isOpen={showScenarioModal}
          onClose={() => setShowScenarioModal(false)}
          onSelectCard={(card) => void handleSelectScenarioCard(card)}
          selectedType="scenario"
          titleOverride="选择情景"
        />
      )}

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

      <ImagePreviewModal
        isOpen={showImageModal}
        imageUrl={savedImageUrl}
        onClose={() => {
          setShowImageModal(false);
          setSavedImageUrl((prev) => {
            revokeBlobUrl(prev);
            return null;
          });
        }}
      />

      <PvpSettlementCardModal
        isOpen={showSettlementCardModal}
        onClose={() => setShowSettlementCardModal(false)}
        roomId={roomId}
      />
    </>
  );
}
