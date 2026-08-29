'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { buildCustomProviderRequestPayload } from '@/lib/ai/custom-provider';
import {
  createBattleStoryCheckpointRecord,
  createBattleStoryChapterRecord,
  createBattleStorySessionRecord,
  deleteBattleStoryChaptersFromIndex,
  deleteBattleStoryCheckpointsFromBoundary,
  deleteBattleStorySession,
  getBattleStorySession,
  listBattleStoryChaptersBySession,
  listBattleStoryCheckpointsBySession,
  listBattleStorySessions,
  markBattleStoryChapterSuperseded,
  putBattleStoryChapter,
  putBattleStoryCheckpoint,
  putBattleStoryCheckpoints,
  putBattleStorySession,
  updateBattleStorySession,
} from '@/lib/ai-session/battle-story/storage';
import { buildBattleStoryDeterministicDigest } from '@/lib/ai-session/battle-story/digest';
import {
  BattleStoryDraftChapterPlanMode,
  formatBattleStoryChapterPlanSource,
  formatBattleStoryChapterProgress,
  isBattleStoryChapterPlanLimitReached,
  normalizeBattleStoryTotalChapters,
  resolveBattleStoryInitialChapterPlan,
  willBattleStoryChapterExceedPlan,
} from '@/lib/ai-session/battle-story/plan';
import type {
  BattleStoryCheckpointRecord,
  BattleStoryChapterPlan,
  BattleStoryChapterCardSnapshot,
  BattleStoryChapterRecord,
  BattleStoryCharacterGuidance,
  BattleStoryDeterministicDigest,
  BattleStorySessionAction,
  BattleStorySessionRecord,
  BattleStorySessionSeed,
  BattleStorySessionSource,
} from '@/lib/ai-session/battle-story/types';
import { authStorage } from '@/lib/auth';
import { createGenerationApiIntent } from '@/lib/hono-api-client';
import { readJsonOrTextFromResponse, resolveApiErrorMessage } from '@/lib/client/apiError';
import { formatHttpErrorMessage } from '@/lib/client/httpError';
import { useProviderModeCooldown } from '@/lib/cooldown';
import { extractHeadlineFromMarkdown, extractWinnerFromText } from '@/lib/arena/battle-report-log-utils';
import {
  captureArenaGenerationActorToken,
  withArenaGenerationActorToken,
} from '@/lib/arena/resumable-generation-client';
import { readScenarioBattleStoryConfig } from '@/lib/scenario-battle-story';
import { readTextAndReasoningStreamFromResponse } from '@/lib/stream/read-text-and-reasoning-stream';
import { STREAM_ABORT_REASON_USER } from '@/lib/stream/abort';
import { buildStreamSoftTimeoutMessage } from '@/lib/stream/timeout';
import { hashArenaCombatantBaseRevision } from '@mahoshojo/domain/arena-reconciliation';

import { useBattleStore } from '../stores/useBattleStore';
import { BattleStoreState, Combatant, CombatantData } from '../types';
import { useBattleActions } from './useBattleActions';
import {
  BATTLE_STORY_SUMMARY_REFRESH_MIN_INTERVAL_MS,
  buildBattleStoryBranchLabel,
  buildBattleStoryExportMarkdown,
  buildBattleStorySessionSeedSnapshot,
  cloneBattleStoryActiveChaptersForNewSession,
  cloneBattleStoryCheckpointsForNewSession,
  mergeUpdatedCombatantsIntoWorkingCombatants,
  parseBattleStoryStreamMetaHeader,
  remapBattleStorySummaryMeta,
  resolveBattleStoryRequestCooldownMs,
  resolveBattleStorySummaryRefreshPlan,
} from '../utils/battleStorySession';
import {
  ARENA_PROVIDER_COOLDOWN_BASE_KEY,
  resolveArenaProviderCooldownConfig,
} from '../utils/providerCooldown';

const ACTIVE_SESSION_STORAGE_KEY = 'arena.battleStory.activeSessionId';
const PENDING_CHAPTER_PLAN_STORAGE_KEY = 'arena.battleStory.pendingChapterPlan.v1';
const SUMMARY_REFRESH_MIN_PENDING_CHAPTERS = 3;

const normalizeErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  return fallback;
};

const readLocalStorageString = (key: string): string | null => {
  if (typeof window === 'undefined') return null;
  try {
    const value = window.localStorage.getItem(key);
    return value && value.trim() ? value.trim() : null;
  } catch {
    return null;
  }
};

const writeLocalStorageString = (key: string, value: string | null): void => {
  if (typeof window === 'undefined') return;
  try {
    if (!value) {
      window.localStorage.removeItem(key);
      return;
    }
    window.localStorage.setItem(key, value);
  } catch {
    // ignore
  }
};

const parsePendingChapterPlanPreference = (
  raw: string | null
): { mode: BattleStoryDraftChapterPlanMode; totalChaptersInput: string } => {
  if (!raw) {
    return {
      mode: 'auto',
      totalChaptersInput: '',
    };
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const mode =
      parsed.mode === 'none'
        ? 'none'
        : parsed.mode === 'custom'
          ? 'custom'
          : 'auto';
    const totalChaptersInput =
      typeof parsed.totalChaptersInput === 'string' ? parsed.totalChaptersInput : '';
    return { mode, totalChaptersInput };
  } catch {
    return {
      mode: 'auto',
      totalChaptersInput: '',
    };
  }
};

const toReadableCombatants = (combatants: Combatant[]): CombatantData[] => {
  return combatants.filter((item): item is CombatantData => 'data' in item);
};

const readRetryAfterMs = (response: Response, fallbackMs = 15_000): number => {
  const raw = response.headers.get('retry-after');
  if (!raw) return fallbackMs;
  const seconds = Number.parseInt(raw, 10);
  if (!Number.isFinite(seconds) || seconds <= 0) return fallbackMs;
  return seconds * 1000;
};

const buildProviderSource = (
  currentSource: BattleStorySessionSource,
  customProviderPayload: ReturnType<typeof buildCustomProviderRequestPayload>
): BattleStorySessionSource => {
  if (!customProviderPayload) {
    return {
      ...currentSource,
      providerMode: 'system',
      providerId: 'system',
      modelId: undefined,
    };
  }

  return {
    ...currentSource,
    providerMode: customProviderPayload.providerId === 'system' ? 'system' : 'custom',
    providerId: customProviderPayload.providerId,
    modelId: customProviderPayload.modelId ?? undefined,
  };
};

const buildChapterRequestWindow = (chapters: BattleStoryChapterRecord[]) => {
  return chapters
    .filter((chapter) => chapter.status !== 'superseded')
    .sort((left, right) => left.index - right.index)
    .slice(-12)
    .map((chapter) => ({
      id: chapter.id,
      index: chapter.index,
      title: chapter.title,
      markdown: chapter.markdown,
      deterministicDigest: chapter.deterministicDigest,
    }));
};

const sortBattleStoryChapters = (chapters: BattleStoryChapterRecord[]): BattleStoryChapterRecord[] =>
  [...chapters].sort((left, right) => left.index - right.index);

const getActiveBattleStoryChapters = (chapters: BattleStoryChapterRecord[]): BattleStoryChapterRecord[] =>
  sortBattleStoryChapters(chapters.filter((chapter) => chapter.status !== 'superseded'));

const getLatestBattleStoryChapter = (chapters: BattleStoryChapterRecord[]): BattleStoryChapterRecord | null =>
  [...chapters].sort((left, right) => right.index - left.index)[0] ?? null;

const sortBattleStoryCheckpoints = (
  checkpoints: BattleStoryCheckpointRecord[]
): BattleStoryCheckpointRecord[] => [...checkpoints].sort((left, right) => left.boundaryIndex - right.boundaryIndex);

const getBattleStoryCheckpointForBoundary = (
  checkpoints: BattleStoryCheckpointRecord[],
  boundaryIndex: number
): BattleStoryCheckpointRecord | null =>
  checkpoints.find((checkpoint) => checkpoint.boundaryIndex === boundaryIndex) ?? null;

const buildAnchoredChapterRequestWindow = (
  chapters: BattleStoryChapterRecord[],
  maxChapterIndex: number
) => buildChapterRequestWindow(chapters.filter((chapter) => chapter.index <= maxChapterIndex));

const resolveAnchoredSummaryState = (input: {
  sessionSummary?: string;
  summaryMeta?: BattleStorySessionRecord['summaryMeta'];
  maxCoveredChapterIndex: number;
  invalidateWhenCoveredAtOrBeyond?: boolean;
}): {
  sessionSummary?: string;
  summaryMeta?: BattleStorySessionRecord['summaryMeta'];
} => {
  const coveredUntil = input.summaryMeta?.coveredUntilChapterIndex ?? 0;
  const isUnsafe = input.invalidateWhenCoveredAtOrBeyond
    ? coveredUntil >= input.maxCoveredChapterIndex
    : coveredUntil > input.maxCoveredChapterIndex;
  if (isUnsafe) {
    return {
      sessionSummary: undefined,
      summaryMeta: undefined,
    };
  }
  return {
    sessionSummary: input.sessionSummary,
    summaryMeta: input.summaryMeta,
  };
};

const toRecordCombatantArray = (value: unknown): Array<Record<string, unknown>> | null => {
  if (!Array.isArray(value)) return null;
  const normalized = value.filter(
    (item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object'
  );
  return normalized.length > 0 ? normalized : null;
};

const resolveChapterInputCombatants = (input: {
  session: BattleStorySessionRecord;
  checkpoints: BattleStoryCheckpointRecord[];
  chapter: BattleStoryChapterRecord;
  latestChapter: BattleStoryChapterRecord | null;
}): Array<Record<string, unknown>> | null => {
  const fromCheckpoint = toRecordCombatantArray(
    getBattleStoryCheckpointForBoundary(input.checkpoints, Math.max(0, input.chapter.index - 1))?.combatants
  );
  if (fromCheckpoint) return fromCheckpoint;
  if (input.chapter.index === 1) {
    return toRecordCombatantArray(input.session.seed.combatants);
  }
  if (input.latestChapter && input.latestChapter.id === input.chapter.id) {
    return toRecordCombatantArray(input.session.lastChapterInputCombatants);
  }
  return null;
};

const resolveChapterOutputCombatants = (input: {
  session: BattleStorySessionRecord;
  checkpoints: BattleStoryCheckpointRecord[];
  chapter: BattleStoryChapterRecord;
  latestChapter: BattleStoryChapterRecord | null;
}): Array<Record<string, unknown>> | null => {
  const fromCheckpoint = toRecordCombatantArray(
    getBattleStoryCheckpointForBoundary(input.checkpoints, input.chapter.index)?.combatants
  );
  if (fromCheckpoint) return fromCheckpoint;
  if (input.latestChapter && input.latestChapter.id === input.chapter.id) {
    return toRecordCombatantArray(input.session.workingCombatants);
  }
  return null;
};

const isFatalStatus = (status: number): boolean => {
  return status >= 500 || status === 429 || status === 401 || status === 403;
};

const readStringField = (record: Record<string, unknown> | null, key: string): string | null => {
  const value = record?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
};

const readNumberField = (record: Record<string, unknown> | null, key: string): number | null => {
  const value = record?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};

const extractChapterGuidancesFromWorkingCombatants = (
  workingCombatants: Array<Record<string, unknown>>
): BattleStoryCharacterGuidance[] | null => {
  const normalized = workingCombatants
    .map((combatant) => {
      const data = combatant.data && typeof combatant.data === 'object'
        ? (combatant.data as Record<string, unknown>)
        : null;
      const characterName =
        (typeof data?.codename === 'string' && data.codename.trim() ? data.codename.trim() : '') ||
        (typeof data?.name === 'string' && data.name.trim() ? data.name.trim() : '');
      const guidance =
        typeof combatant.characterGuidance === 'string' && combatant.characterGuidance.trim()
          ? combatant.characterGuidance.trim()
          : '';
      if (!characterName || !guidance) return null;
      return { characterName, guidance };
    })
    .filter((item): item is BattleStoryCharacterGuidance => Boolean(item));

  return normalized.length > 0 ? normalized : null;
};

export function useBattleStorySession() {
  const useBattleSelector = <T,>(selector: (state: BattleStoreState) => T) => useBattleStore(selector);
  const combatants = useBattleSelector((state) => state.combatants);
  const battleMode = useBattleSelector((state) => state.battleMode);
  const scenario = useBattleSelector((state) => state.scenario);
  const userProviderConfig = useBattleSelector((state) => state.userProviderConfig);
  const { handleResolveRandomPlaceholders } = useBattleActions();

  const [isReady, setIsReady] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sessions, setSessions] = useState<BattleStorySessionRecord[]>([]);
  const [activeSession, setActiveSession] = useState<BattleStorySessionRecord | null>(null);
  const [chapters, setChapters] = useState<BattleStoryChapterRecord[]>([]);
  const [checkpoints, setCheckpoints] = useState<BattleStoryCheckpointRecord[]>([]);
  const [pendingStartSession, setPendingStartSession] = useState<BattleStorySessionRecord | null>(null);
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatingAction, setGeneratingAction] = useState<BattleStorySessionAction | null>(null);
  const [streamingMarkdown, setStreamingMarkdown] = useState('');
  const [streamSoftTimeoutWarning, setStreamSoftTimeoutWarning] = useState<string | null>(null);
  const [streamCardSnapshot, setStreamCardSnapshot] = useState<BattleStoryChapterCardSnapshot | null>(null);
  const [streamChapterIndex, setStreamChapterIndex] = useState<number | null>(null);
  const [isRefreshingSummary, setIsRefreshingSummary] = useState(false);
  const [isDeletingSession, setIsDeletingSession] = useState(false);
  const [draftChapterPlanMode, setDraftChapterPlanMode] = useState<BattleStoryDraftChapterPlanMode>('auto');
  const [draftChapterPlanInput, setDraftChapterPlanInput] = useState('');

  const activeSessionRef = useRef<BattleStorySessionRecord | null>(null);
  const chaptersRef = useRef<BattleStoryChapterRecord[]>([]);
  const checkpointsRef = useRef<BattleStoryCheckpointRecord[]>([]);
  const summaryRetryAtRef = useRef<Record<string, number>>({});
  const generationAbortControllerRef = useRef<AbortController | null>(null);

  const customProviderPayload = useMemo(
    () => buildCustomProviderRequestPayload(userProviderConfig),
    [userProviderConfig]
  );
  const providerCooldownConfig = useMemo(
    () => resolveArenaProviderCooldownConfig(userProviderConfig),
    [userProviderConfig]
  );
  const { currentMode: providerCooldownMode } = providerCooldownConfig;
  const cooldownMs =
    providerCooldownMode === 'custom'
      ? providerCooldownConfig.customDurationMs
      : providerCooldownConfig.systemDurationMs;
  const { isCooldown, remainingTime, startCooldown, otherRemainingTime } = useProviderModeCooldown({
    baseKey: ARENA_PROVIDER_COOLDOWN_BASE_KEY,
    ...providerCooldownConfig,
  });

  useEffect(() => {
    activeSessionRef.current = activeSession;
  }, [activeSession]);

  useEffect(() => {
    chaptersRef.current = chapters;
  }, [chapters]);

  useEffect(() => {
    checkpointsRef.current = checkpoints;
  }, [checkpoints]);

  useEffect(() => {
    const persisted = parsePendingChapterPlanPreference(
      readLocalStorageString(PENDING_CHAPTER_PLAN_STORAGE_KEY)
    );
    setDraftChapterPlanMode(persisted.mode);
    setDraftChapterPlanInput(persisted.totalChaptersInput);
  }, []);

  useEffect(() => {
    writeLocalStorageString(
      PENDING_CHAPTER_PLAN_STORAGE_KEY,
      JSON.stringify({
        mode: draftChapterPlanMode,
        totalChaptersInput: draftChapterPlanInput,
      })
    );
  }, [draftChapterPlanInput, draftChapterPlanMode]);

  const latestActiveChapter = useMemo(() => {
    return getLatestBattleStoryChapter(getActiveBattleStoryChapters(chapters));
  }, [chapters]);

  const selectedChapter = useMemo(() => {
    if (!selectedChapterId) return latestActiveChapter;
    return chapters.find((chapter) => chapter.id === selectedChapterId) ?? latestActiveChapter;
  }, [chapters, latestActiveChapter, selectedChapterId]);

  const displayActiveSession = pendingStartSession ?? activeSession;
  const displayChapters = pendingStartSession ? [] : chapters;
  const displayCheckpoints = useMemo(
    () => (pendingStartSession ? [] : checkpoints),
    [checkpoints, pendingStartSession]
  );
  const displayLatestActiveChapter = pendingStartSession ? null : latestActiveChapter;
  const displaySelectedChapter = pendingStartSession ? null : selectedChapter;
  const selectedChapterIsLatest = Boolean(
    displaySelectedChapter && displayLatestActiveChapter && displaySelectedChapter.id === displayLatestActiveChapter.id
  );
  const selectedChapterInputCheckpoint = useMemo(
    () =>
      displaySelectedChapter
        ? getBattleStoryCheckpointForBoundary(displayCheckpoints, Math.max(0, displaySelectedChapter.index - 1))
        : null,
    [displayCheckpoints, displaySelectedChapter]
  );
  const selectedChapterOutputCheckpoint = useMemo(
    () =>
      displaySelectedChapter
        ? getBattleStoryCheckpointForBoundary(displayCheckpoints, displaySelectedChapter.index)
        : null,
    [displayCheckpoints, displaySelectedChapter]
  );
  const scenarioChapterPlanConfig = useMemo(
    () => (battleMode === 'scenario' ? readScenarioBattleStoryConfig(scenario.content) : null),
    [battleMode, scenario.content]
  );
  const draftChapterPlan = useMemo(
    () =>
      resolveBattleStoryInitialChapterPlan({
        scenario: battleMode === 'scenario' ? scenario.content : null,
        userSelectionMode: draftChapterPlanMode,
        userDesiredTotalChapters: draftChapterPlanInput,
      }),
    [battleMode, draftChapterPlanInput, draftChapterPlanMode, scenario.content]
  );
  const draftChapterPlanInputError = useMemo(() => {
    if (scenarioChapterPlanConfig?.planMode === 'fixed') return null;
    if (draftChapterPlanMode !== 'custom') return null;
    return normalizeBattleStoryTotalChapters(draftChapterPlanInput)
      ? null
      : '章节规划总数需为 1-20 的整数。';
  }, [draftChapterPlanInput, draftChapterPlanMode, scenarioChapterPlanConfig?.planMode]);
  const activeChapterPlanSourceLabel = useMemo(
    () => formatBattleStoryChapterPlanSource(displayActiveSession?.chapterPlan),
    [displayActiveSession?.chapterPlan]
  );
  const activeChapterProgressText = useMemo(
    () =>
      formatBattleStoryChapterProgress({
        completedChapterCount: displayChapters.length,
        chapterPlan: displayActiveSession?.chapterPlan,
      }),
    [displayActiveSession?.chapterPlan, displayChapters.length]
  );
  const hasReachedActiveChapterPlanLimit = useMemo(
    () =>
      isBattleStoryChapterPlanLimitReached({
        chapterPlan: displayActiveSession?.chapterPlan,
        completedChapterCount: displayChapters.length,
      }),
    [displayActiveSession?.chapterPlan, displayChapters.length]
  );

  const arenaStartCheck = useMemo(() => {
    const minParticipants = battleMode === 'daily' || battleMode === 'scenario' ? 1 : 2;
    const totalCombatants = combatants.length;

    if (totalCombatants < minParticipants) {
      return {
        canStart: false,
        reason: `当前模式至少需要 ${minParticipants} 位有效角色。`,
      };
    }

    if (battleMode === 'scenario' && !scenario.content) {
      return {
        canStart: false,
        reason: '情景模式下需要先选择主情景。',
      };
    }

    if (userProviderConfig && userProviderConfig.providerId !== 'system' && !userProviderConfig.apiKey?.trim()) {
      return {
        canStart: false,
        reason: '当前已选择自定义 AI 供应商，但尚未填写 API Key。',
      };
    }

    return {
      canStart: true,
      reason: null,
    };
  }, [battleMode, combatants, scenario.content, userProviderConfig]);
  const startSessionCheck = useMemo(() => {
    if (!arenaStartCheck.canStart) {
      return arenaStartCheck;
    }
    if (draftChapterPlanInputError) {
      return {
        canStart: false,
        reason: draftChapterPlanInputError,
      };
    }
    return {
      canStart: true,
      reason: null,
    };
  }, [arenaStartCheck, draftChapterPlanInputError]);
  const continueDisabledReason = useMemo(() => {
    if (!displayActiveSession) return '请先选择或创建会话';
    if (!displayLatestActiveChapter) return '请先生成首章';
    if (hasReachedActiveChapterPlanLimit) {
      return `该会话已达到计划章节上限（共 ${displayActiveSession.chapterPlan?.totalChapters} 章）`;
    }
    return null;
  }, [displayActiveSession, displayLatestActiveChapter, hasReachedActiveChapterPlanLimit]);
  const branchDisabledReason = useMemo(() => {
    if (!displayActiveSession) return '请先选择或创建会话';
    if (!displayLatestActiveChapter) return '请先生成首章';
    if (hasReachedActiveChapterPlanLimit) {
      return `该会话已达到计划章节上限（共 ${displayActiveSession.chapterPlan?.totalChapters} 章）`;
    }
    return null;
  }, [displayActiveSession, displayLatestActiveChapter, hasReachedActiveChapterPlanLimit]);
  const selectedBranchDisabledReason = useMemo(() => {
    if (!displayActiveSession) return '请先选择或创建会话';
    if (!displaySelectedChapter) return '请先选择章节';
    if (
      willBattleStoryChapterExceedPlan({
        chapterPlan: displayActiveSession.chapterPlan,
        nextChapterIndex: displaySelectedChapter.index + 1,
      })
    ) {
      return `该章节之后已达到计划章节上限（共 ${displayActiveSession.chapterPlan?.totalChapters} 章）`;
    }
    if (!selectedChapterIsLatest && !selectedChapterOutputCheckpoint) {
      return '该章节缺少“章末状态”快照，暂不支持从这里创建分支。';
    }
    return null;
  }, [displayActiveSession, displaySelectedChapter, selectedChapterIsLatest, selectedChapterOutputCheckpoint]);
  const selectedRewriteDisabledReason = useMemo(() => {
    if (!displayActiveSession) return '请先选择或创建会话';
    if (!displaySelectedChapter) return '请先选择章节';
    if (!selectedChapterIsLatest && !selectedChapterInputCheckpoint) {
      return '该章节缺少“章前输入状态”快照，暂不支持从这里重写。';
    }
    return null;
  }, [displayActiveSession, displaySelectedChapter, selectedChapterInputCheckpoint, selectedChapterIsLatest]);
  const selectedDeleteDisabledReason = useMemo(() => {
    if (!displayActiveSession) return '请先选择或创建会话';
    if (!displaySelectedChapter) return '请先选择章节';
    if (!selectedChapterIsLatest && !selectedChapterInputCheckpoint) {
      return '该章节缺少“回退状态”快照，暂不支持从这里删除。';
    }
    return null;
  }, [displayActiveSession, displaySelectedChapter, selectedChapterInputCheckpoint, selectedChapterIsLatest]);

  const buildRequestHeaders = useCallback(
    async (acceptSse = false): Promise<Record<string, string>> => {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (acceptSse) {
        headers.Accept = 'text/event-stream';
      }

      const authHeader = await authStorage.getAuthHeader();
      if (authHeader) {
        headers.Authorization = authHeader;
      }
      Object.assign(headers, await authStorage.getActivityHeaders());
      return headers;
    },
    []
  );

  const refreshSessionList = useCallback(async (): Promise<BattleStorySessionRecord[]> => {
    const nextSessions = await listBattleStorySessions({
      limit: 100,
      direction: 'prev',
    });
    setSessions(nextSessions);
    return nextSessions;
  }, []);

  const loadSession = useCallback(
    async (sessionId: string | null): Promise<void> => {
      if (!sessionId) {
        setActiveSession(null);
        setChapters([]);
        setCheckpoints([]);
        setSelectedChapterId(null);
        writeLocalStorageString(ACTIVE_SESSION_STORAGE_KEY, null);
        return;
      }

      const [sessionRecord, chapterRecords, checkpointRecords] = await Promise.all([
        getBattleStorySession(sessionId),
        listBattleStoryChaptersBySession(sessionId, {
          direction: 'next',
          limit: 200,
          includeSuperseded: false,
        }),
        listBattleStoryCheckpointsBySession(sessionId, {
          direction: 'next',
          limit: 400,
        }),
      ]);

      if (!sessionRecord) {
        setActiveSession(null);
        setChapters([]);
        setCheckpoints([]);
        setSelectedChapterId(null);
        writeLocalStorageString(ACTIVE_SESSION_STORAGE_KEY, null);
        return;
      }

      const sortedChapters = sortBattleStoryChapters(chapterRecords);
      const sortedCheckpoints = sortBattleStoryCheckpoints(checkpointRecords);
      setActiveSession(sessionRecord);
      setChapters(sortedChapters);
      setCheckpoints(sortedCheckpoints);
      setSelectedChapterId(sessionRecord.lastChapterId ?? sortedChapters[sortedChapters.length - 1]?.id ?? null);
      writeLocalStorageString(ACTIVE_SESSION_STORAGE_KEY, sessionRecord.id);
    },
    []
  );

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const nextSessions = await refreshSessionList();
        if (cancelled) return;

        const preferredId = readLocalStorageString(ACTIVE_SESSION_STORAGE_KEY);
        const fallbackId = nextSessions[0]?.id ?? null;
        await loadSession(preferredId ?? fallbackId);
      } catch (error) {
        if (cancelled) return;
        setStorageError(normalizeErrorMessage(error, '读取本地连续战报会话失败。'));
      } finally {
        if (!cancelled) {
          setIsReady(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loadSession, refreshSessionList]);

  const refreshSummaryIfNeeded = useCallback(
    async (sessionRecord: BattleStorySessionRecord, chapterRecords: BattleStoryChapterRecord[]) => {
      const plan = resolveBattleStorySummaryRefreshPlan({
        session: sessionRecord,
        chapters: chapterRecords,
        minPendingChapters: SUMMARY_REFRESH_MIN_PENDING_CHAPTERS,
      });
      if (!plan) return;

      const now = Date.now();
      const retryAt = summaryRetryAtRef.current[sessionRecord.id] ?? 0;
      if (retryAt > now) return;
      summaryRetryAtRef.current[sessionRecord.id] = now + BATTLE_STORY_SUMMARY_REFRESH_MIN_INTERVAL_MS;

      try {
        setIsRefreshingSummary(true);
        const response = await fetch('/api/arena/session/refresh-summary', {
          method: 'POST',
          headers: await buildRequestHeaders(false),
          body: JSON.stringify({
            sessionId: sessionRecord.id,
            previousSummary: plan.previousSummary,
            language: sessionRecord.source.language,
            digests: plan.digests.map((digest) => ({
              chapterId: digest.chapterId,
              index: digest.index,
              chapterTitle: digest.chapterTitle,
              ...(digest.winner ? { winner: digest.winner } : {}),
              ...(digest.officialConclusion ? { officialConclusion: digest.officialConclusion } : {}),
              ...(digest.bodyExcerpt ? { bodyExcerpt: digest.bodyExcerpt } : {}),
              ...(digest.impactDigest ? { impactDigest: digest.impactDigest } : {}),
            })),
            ...(customProviderPayload ? { customProvider: customProviderPayload } : {}),
          }),
        });

        if (response.status === 429) {
          summaryRetryAtRef.current[sessionRecord.id] = Math.max(
            summaryRetryAtRef.current[sessionRecord.id] ?? 0,
            Date.now() + readRetryAfterMs(response, 15_000)
          );
          return;
        }

        if (!response.ok) {
          return;
        }

        const payload = (await response.json()) as {
          summary?: string;
          coveredChapterIds?: string[];
          fallback?: boolean;
        };
        const nextSummary = typeof payload.summary === 'string' ? payload.summary.trim() : '';
        if (!nextSummary) return;

        const updatedSession = await updateBattleStorySession(sessionRecord.id, (current) => ({
          ...current,
          sessionSummary: nextSummary,
          summaryMeta: {
            coveredUntilChapterIndex: plan.coveredUntilChapterIndex,
            coveredChapterIds:
              Array.isArray(payload.coveredChapterIds) && payload.coveredChapterIds.length > 0
                ? payload.coveredChapterIds
                : plan.digests.map((digest) => digest.chapterId),
            refreshedAt: Date.now(),
            mode: payload.fallback ? 'deterministic-fallback' : 'ai',
          },
          updatedAt: Date.now(),
        }));

        await refreshSessionList();
        if (activeSessionRef.current?.id === updatedSession.id) {
          setActiveSession(updatedSession);
        }
      } catch {
        // 摘要刷新失败不阻断主流程
      } finally {
        setIsRefreshingSummary(false);
      }
    },
    [buildRequestHeaders, customProviderPayload, refreshSessionList]
  );

  const applyWorkingCombatantUpdates = useCallback(
    async (input: {
      markdown: string;
      digest: BattleStoryDeterministicDigest;
      mode: BattleStorySessionSource['mode'];
      seed: BattleStorySessionSeed;
      workingCombatants: Array<Record<string, unknown>>;
    userGuidance: string;
    generationId: string | null;
    meta?: Record<string, unknown> | null;
    }): Promise<{ workingCombatants: Array<Record<string, unknown>>; warning?: string }> => {
      if (!input.seed.settings.writeArenaHistory && !input.seed.settings.writeCurrentState) {
        return { workingCombatants: input.workingCombatants };
      }

      const headline =
        (typeof input.meta?.report === 'object' && typeof (input.meta.report as any)?.headline === 'string'
          ? (input.meta.report as any).headline.trim()
          : '') ||
        input.digest.chapterTitle.trim() ||
        extractHeadlineFromMarkdown(input.markdown) ||
        '魔法少女速报';

      const winner =
        input.digest.winner?.trim() ||
        extractWinnerFromText(input.markdown) ||
        '未知';

      if (input.seed.settings.writeArenaHistory && (!headline || headline === '魔法少女速报' || !winner || winner === '未知')) {
        return {
          workingCombatants: input.workingCombatants,
          warning: '⚠️ 本章正文已保存，但未能稳定识别标题或胜利者，角色状态未同步到连续会话。',
        };
      }

      const impacts =
        Array.isArray(input.meta?.impacts) && input.meta?.impacts.length > 0
          ? input.meta.impacts
          : (input.digest.impactDigest ?? []);

      const baseRevisionHash = await hashArenaCombatantBaseRevision(input.workingCombatants);
      const response = await fetch('/api/arena/update-combatants-after-stream', {
        method: 'POST',
        headers: withArenaGenerationActorToken({
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({
          generationId: input.generationId,
          baseRevisionHash,
          combatants: input.workingCombatants,
          report: {
            headline,
            mode: input.mode,
            officialReport: {
              winner,
            },
          },
          impacts,
          userGuidance: input.userGuidance || null,
          scenario: input.seed.scenario ?? null,
          writeArenaHistory: input.seed.settings.writeArenaHistory,
          writeCurrentState: input.seed.settings.writeCurrentState,
        }),
      });

      if (!response.ok) {
        const { payload } = await readJsonOrTextFromResponse(response);
        return {
          workingCombatants: input.workingCombatants,
          warning: `⚠️ 本章正文已保存，但角色状态同步失败：${resolveApiErrorMessage({
            payload,
            fallback: '角色更新失败',
          })}`,
        };
      }

      const payload = (await response.json()) as {
        updatedCombatants?: Array<Record<string, unknown>>;
      };

      return {
        workingCombatants: mergeUpdatedCombatantsIntoWorkingCombatants(
          input.workingCombatants,
          Array.isArray(payload.updatedCombatants) ? payload.updatedCombatants : []
        ),
      };
    },
    []
  );

  const runGeneration = useCallback(
    async (input: {
      sessionId: string;
      action: BattleStorySessionAction;
      sourceChapterId?: string;
      source: BattleStorySessionSource;
      seed: BattleStorySessionSeed;
      chapterPlan?: BattleStoryChapterPlan;
      workingCombatants: Array<Record<string, unknown>>;
      sessionSummary?: string;
      recentChapters: ReturnType<typeof buildChapterRequestWindow>;
      chapterIndexHint?: number;
      userGuidance: string;
    }): Promise<
      | {
          aborted: true;
        }
      | {
          aborted?: false;
          markdown: string;
          reportJson: Record<string, unknown>;
          digest: BattleStoryDeterministicDigest;
          chapterIndex: number;
          generationId?: string | null;
          cardSnapshot: BattleStoryChapterCardSnapshot | null;
          nextWorkingCombatants: Array<Record<string, unknown>>;
          warning?: string;
        }
    > => {
      if (isCooldown) {
        throw new Error(`冷却中，请等待 ${remainingTime} 秒后再继续。`);
      }

      setActionError(null);
      setNotice(null);
      setIsGenerating(true);
      setGeneratingAction(input.action);
      setStreamingMarkdown('');
      setStreamSoftTimeoutWarning(null);
      setStreamChapterIndex(input.chapterIndexHint ?? null);
      const fallbackCharacterGuidances = extractChapterGuidancesFromWorkingCombatants(
        input.workingCombatants
      );
      const fallbackCardSnapshot: BattleStoryChapterCardSnapshot = {
        ...(input.userGuidance.trim() ? { userGuidance: input.userGuidance.trim() } : {}),
        ...(fallbackCharacterGuidances ? { characterGuidances: fallbackCharacterGuidances } : {}),
      };
      setStreamCardSnapshot(Object.keys(fallbackCardSnapshot).length > 0 ? fallbackCardSnapshot : null);
      const generationController = new AbortController();
      generationAbortControllerRef.current?.abort(STREAM_ABORT_REASON_USER);
      generationAbortControllerRef.current = generationController;
      let responseStatus: number | null = null;
      let requestAccepted = false;
      let cooldownHandled = false;

      try {
        const generationIntent = createGenerationApiIntent();
        const response = await generationIntent.dispatch('/api/arena/session/generate-next', {
          method: 'POST',
          headers: withArenaGenerationActorToken(await buildRequestHeaders(true)),
          signal: generationController.signal,
          body: JSON.stringify({
            sessionId: input.sessionId,
            generationRequestId: crypto.randomUUID(),
            action: input.action,
            ...(input.sourceChapterId ? { sourceChapterId: input.sourceChapterId } : {}),
            ...(typeof input.chapterIndexHint === 'number' ? { chapterIndex: input.chapterIndexHint } : {}),
            ...(input.chapterPlan ? { chapterPlan: { totalChapters: input.chapterPlan.totalChapters } } : {}),
            chapterContext: {
              sessionSummary: input.sessionSummary,
              recentChapters: input.recentChapters,
              workingCombatants: input.workingCombatants,
            },
            seed: {
              combatants: input.seed.combatants,
              scenario: input.seed.scenario ?? null,
              auxScenarios: input.seed.auxScenarios ?? [],
              materials: input.seed.materials ?? [],
              questionnaires: input.seed.questionnaires ?? [],
              mode: input.source.mode,
              storyLength: input.source.storyLength,
              customStoryLength: input.source.customStoryLength,
              language: input.source.language,
              settings: input.seed.settings,
            },
            userGuidance: input.userGuidance,
            ...(customProviderPayload ? { customProvider: customProviderPayload } : {}),
          }),
        });
        captureArenaGenerationActorToken(response);
        responseStatus = response.status;

        if (response.status === 429) {
          const retryAfterMs = readRetryAfterMs(response, cooldownMs);
          startCooldown(retryAfterMs);
          cooldownHandled = true;
          const { payload } = await readJsonOrTextFromResponse(response);
          throw new Error(
            resolveApiErrorMessage({
              payload,
              fallback: `请求过于频繁，请等待 ${Math.ceil(retryAfterMs / 1000)} 秒后再试。`,
            })
          );
        }

        if (!response.ok) {
          startCooldown(
            resolveBattleStoryRequestCooldownMs({
              fullCooldownMs: cooldownMs,
              requestAccepted,
              status: responseStatus,
            })
          );
          cooldownHandled = true;
          const { payload } = await readJsonOrTextFromResponse(response);
          const serverMessage = resolveApiErrorMessage({
            payload,
            fallback: '连续战报生成失败',
          });
          throw new Error(
            isFatalStatus(response.status)
              ? formatHttpErrorMessage({
                  serverMessage,
                  status: response.status,
                  fallback: '连续战报生成失败',
                })
              : serverMessage
          );
        }

        requestAccepted = true;

        let sessionMeta: Record<string, unknown> | null = null;
        let digestPayload: Record<string, unknown> | null = null;
        let metaPayload: Record<string, unknown> | null = null;
        let donePayload: Record<string, unknown> | null = null;
        let sawDone = false;
        let responseGenerationId: string | null = null;
        let latestCardSnapshot: BattleStoryChapterCardSnapshot = { ...fallbackCardSnapshot };

        const patchStreamCardSnapshot = (patch: Partial<BattleStoryChapterCardSnapshot>) => {
          latestCardSnapshot = {
            ...latestCardSnapshot,
            ...patch,
          };
          setStreamCardSnapshot(
            Object.keys(latestCardSnapshot).length > 0
              ? { ...latestCardSnapshot }
              : null
          );
        };

        const headerMeta = parseBattleStoryStreamMetaHeader(
          response.headers.get('x-mahoshojo-stream-meta')
        );
        responseGenerationId = response.headers.get('x-mahoshojo-generation-id')?.trim()
          || headerMeta.generationId;
        if (Object.keys(headerMeta.snapshot).length > 0) {
          patchStreamCardSnapshot(headerMeta.snapshot);
        }

        const result = await readTextAndReasoningStreamFromResponse(response, {
          label: '连续战报章节生成',
          timeoutMode: 'soft',
          onSoftTimeout: (event) => {
            setStreamSoftTimeoutWarning(buildStreamSoftTimeoutMessage(event));
          },
          onText: (text) => setStreamingMarkdown(text),
          onReasoning: (reasoning) => {
            patchStreamCardSnapshot({ aiReasoning: reasoning });
          },
          onTelemetry: (payload) => {
            patchStreamCardSnapshot({
              aiModel: typeof payload.aiModel === 'string' ? payload.aiModel.trim() : null,
              aiUsage:
                payload.usage && typeof payload.usage === 'object'
                  ? (payload.usage as BattleStoryChapterCardSnapshot['aiUsage'])
                  : null,
              narrativeHistoryReadCount:
                typeof payload.narrativeHistoryReadCount === 'number'
                  ? payload.narrativeHistoryReadCount
                  : null,
            });
          },
          onMeta: (payload) => {
            patchStreamCardSnapshot({
              streamUpdateMetaDebug: {
                source: 'sse',
                parseOk: payload.parseOk === true,
                ...(typeof payload.error === 'string' ? { error: payload.error } : {}),
                ...(typeof payload.raw === 'string' ? { raw: payload.raw } : {}),
                ...(typeof payload.rawTruncated === 'boolean'
                  ? { rawTruncated: payload.rawTruncated }
                  : {}),
                ...(payload.meta && typeof payload.meta === 'object'
                  ? { meta: payload.meta as NonNullable<
                      BattleStoryChapterCardSnapshot['streamUpdateMetaDebug']
                    >['meta'] }
                  : {}),
              },
            });
            if (payload.parseOk && payload.meta && typeof payload.meta === 'object') {
              metaPayload = payload.meta as Record<string, unknown>;
            }
          },
          onEvent: (event, payload) => {
            if (event === 'session_meta' && payload && typeof payload === 'object') {
              sessionMeta = payload as Record<string, unknown>;
              const generationId = readStringField(sessionMeta, 'generationId');
              if (generationId) {
                responseGenerationId = generationId;
              }
              const chapterIndex = readNumberField(sessionMeta, 'chapterIndex');
              if (chapterIndex) {
                setStreamChapterIndex(chapterIndex);
              }
              return;
            }
            if (event === 'chapter_digest' && payload && typeof payload === 'object') {
              digestPayload = payload as Record<string, unknown>;
              return;
            }
            if (event === 'done') {
              sawDone = true;
              donePayload = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : null;
            }
          },
        });

        if (!sawDone) {
          throw new Error('连接结束但未收到 done 事件，请稍后重试。');
        }

        const doneOk = donePayload ? donePayload['ok'] : undefined;
        if (doneOk === false) {
          const doneError = String(donePayload ? donePayload['error'] ?? '' : '').trim();
          const message = doneError || '服务端在完成阶段返回了失败状态。';
          throw new Error(message);
        }

        const markdown = result.text.trim();
        if (!markdown) {
          throw new Error('未收到有效的章节正文。');
        }

        const chapterIndex =
          readNumberField(digestPayload, 'chapterIndex') ||
          readNumberField(sessionMeta, 'chapterIndex') ||
          input.chapterIndexHint ||
          Math.max(1, input.recentChapters.length + (input.action === 'rewrite' ? 0 : 1));
        const metaReport = metaPayload ? metaPayload['report'] : undefined;
        const metaImpacts = metaPayload ? metaPayload['impacts'] : undefined;

        const digest = buildBattleStoryDeterministicDigest({
          markdown,
          reportJson: metaReport ? { report: metaReport } : null,
          impacts: metaImpacts,
          chapterIndex,
        });

        if (digestPayload) {
          const chapterTitle = readStringField(digestPayload, 'chapterTitle');
          if (chapterTitle) {
            digest.chapterTitle = chapterTitle;
          }
          const winner = readStringField(digestPayload, 'winner');
          if (winner) {
            digest.winner = winner;
          }
          const officialConclusion = readStringField(digestPayload, 'officialConclusion');
          if (officialConclusion) {
            digest.officialConclusion = officialConclusion;
          }
          const bodyExcerpt = readStringField(digestPayload, 'bodyExcerpt');
          if (bodyExcerpt) {
            digest.bodyExcerpt = bodyExcerpt;
          }
          const impactDigest = Array.isArray(digestPayload['impactDigest'])
            ? (digestPayload['impactDigest'] as unknown[])
            : null;
          if (impactDigest && impactDigest.length > 0) {
            digest.impactDigest = impactDigest as BattleStoryDeterministicDigest['impactDigest'];
          }
        }

        const reportJson: Record<string, unknown> = {
          ...(metaReport && typeof metaReport === 'object'
            ? { report: metaReport }
            : {}),
          ...(Array.isArray(metaImpacts) ? { impacts: metaImpacts } : {}),
        };

        const updateResult = await applyWorkingCombatantUpdates({
          markdown,
          digest,
          mode: input.source.mode,
          seed: input.seed,
          workingCombatants: input.workingCombatants,
          userGuidance: input.userGuidance,
          generationId: responseGenerationId ?? readStringField(sessionMeta, 'generationId'),
          meta: metaPayload,
        });

        startCooldown();
        cooldownHandled = true;

        return {
          markdown,
          reportJson,
          digest,
          chapterIndex,
          generationId: responseGenerationId ?? readStringField(sessionMeta, 'generationId'),
          cardSnapshot:
            Object.keys(latestCardSnapshot).length > 0 ? latestCardSnapshot : null,
          nextWorkingCombatants: updateResult.workingCombatants,
          ...(updateResult.warning ? { warning: updateResult.warning } : {}),
        };
      } catch (error) {
        if (generationController.signal.aborted) {
          startCooldown();
          cooldownHandled = true;
          setNotice(
            generationController.signal.reason === STREAM_ABORT_REASON_USER
              ? '已手动停止连续战报生成。当前预览可能不完整，本次不会写入章节。'
              : '连续战报流已中断。当前预览可能不完整，本次不会写入章节。'
          );
          return { aborted: true };
        }
        const errorMessage = error instanceof Error ? error.message.trim() : '';
        const isLocalCooldownError = Boolean(errorMessage) && errorMessage.includes('冷却中');
        if (!isLocalCooldownError && !cooldownHandled) {
          startCooldown(
            resolveBattleStoryRequestCooldownMs({
              fullCooldownMs: cooldownMs,
              requestAccepted,
              status: responseStatus,
            })
          );
        }
        throw error;
      } finally {
        if (generationAbortControllerRef.current === generationController) {
          generationAbortControllerRef.current = null;
        }
        setIsGenerating(false);
        setGeneratingAction(null);
        setStreamSoftTimeoutWarning(null);
      }
    },
    [
      applyWorkingCombatantUpdates,
      buildRequestHeaders,
      cooldownMs,
      customProviderPayload,
      isCooldown,
      remainingTime,
      startCooldown,
    ]
  );

  const handleStartSession = useCallback(async () => {
    if (!startSessionCheck.canStart) {
      setActionError(startSessionCheck.reason);
      return;
    }

    try {
      await handleResolveRandomPlaceholders();
      const state = useBattleStore.getState();
      const readableCombatants = toReadableCombatants(state.combatants);
      const snapshot = buildBattleStorySessionSeedSnapshot({
        combatants: readableCombatants,
        battleMode: state.battleMode,
        scenario: state.scenario,
        auxScenarios: state.auxScenarios,
        materials: state.materials,
        selectedQuestionnaires: state.selectedQuestionnaires,
        adjudicationEvents: state.adjudicationEvents,
        selectedLanguage: state.selectedLanguage,
        storyLength: state.storyLength,
        customStoryLength: state.customStoryLength,
        settings: state.settings,
        providerMode: customProviderPayload?.providerId === 'system' || !customProviderPayload ? 'system' : 'custom',
        providerId: customProviderPayload?.providerId ?? 'system',
        modelId: customProviderPayload?.modelId,
      });

      const sessionDraft = createBattleStorySessionRecord({
        title: snapshot.titleHint,
        source: snapshot.source,
        seed: snapshot.seed,
        workingCombatants: snapshot.workingCombatants,
        lastChapterInputCombatants: snapshot.workingCombatants,
        chapterPlan: draftChapterPlan ?? undefined,
      });
      setPendingStartSession(sessionDraft);

      const generated = await runGeneration({
        sessionId: sessionDraft.id,
        action: 'start',
        source: snapshot.source,
        seed: snapshot.seed,
        chapterPlan: sessionDraft.chapterPlan,
        workingCombatants: snapshot.workingCombatants,
        recentChapters: [],
        sessionSummary: undefined,
        chapterIndexHint: 1,
        userGuidance: state.settings.userGuidance,
      });
      if (generated.aborted) {
        setPendingStartSession(null);
        return;
      }

      const chapter = createBattleStoryChapterRecord({
        sessionId: sessionDraft.id,
        index: generated.chapterIndex,
        action: 'start',
        title: generated.digest.chapterTitle,
        markdown: generated.markdown,
        reportJson: generated.reportJson,
        cardSnapshot: generated.cardSnapshot ?? undefined,
        deterministicDigest: generated.digest,
        generationId: generated.generationId ?? undefined,
      });
      const initialCheckpoint = createBattleStoryCheckpointRecord({
        sessionId: sessionDraft.id,
        boundaryIndex: 0,
        combatants: snapshot.workingCombatants,
      });
      const postChapterCheckpoint = createBattleStoryCheckpointRecord({
        sessionId: sessionDraft.id,
        boundaryIndex: generated.chapterIndex,
        chapterId: chapter.id,
        combatants: generated.nextWorkingCombatants,
      });

      const sessionToSave: BattleStorySessionRecord = {
        ...sessionDraft,
        title: generated.digest.chapterTitle || sessionDraft.title,
        source: snapshot.source,
        workingCombatants: generated.nextWorkingCombatants,
        lastChapterInputCombatants: snapshot.workingCombatants,
        lastChapterId: chapter.id,
        chapterCount: 1,
        updatedAt: Date.now(),
      };

      await putBattleStorySession(sessionToSave);
      await putBattleStoryChapter(chapter);
      await putBattleStoryCheckpoints([initialCheckpoint, postChapterCheckpoint]);
      await refreshSessionList();
      await loadSession(sessionToSave.id);
      setPendingStartSession(null);
      if (generated.warning) {
        setNotice(generated.warning);
      }
      void refreshSummaryIfNeeded(sessionToSave, [chapter]);
    } catch (error) {
      setActionError(normalizeErrorMessage(error, '创建连续战报会话失败。'));
      setPendingStartSession(null);
    }
  }, [
    customProviderPayload,
    draftChapterPlan,
    handleResolveRandomPlaceholders,
    loadSession,
    refreshSessionList,
    refreshSummaryIfNeeded,
    runGeneration,
    startSessionCheck,
  ]);

  const handleContinueSession = useCallback(async () => {
    const sessionRecord = activeSessionRef.current;
    const activeChapters = getActiveBattleStoryChapters(chaptersRef.current);
    const latestChapter = getLatestBattleStoryChapter(activeChapters);
    if (!sessionRecord || activeChapters.length === 0) {
      setActionError('当前没有可续写的连续战报会话。');
      return;
    }
    if (willBattleStoryChapterExceedPlan({
      chapterPlan: sessionRecord.chapterPlan,
      nextChapterIndex: (latestChapter?.index ?? 0) + 1,
    })) {
      setActionError(`该会话已达到计划章节上限（共 ${sessionRecord.chapterPlan?.totalChapters} 章）`);
      return;
    }

    try {
      const nextSource = buildProviderSource(sessionRecord.source, customProviderPayload);
      const generated = await runGeneration({
        sessionId: sessionRecord.id,
        action: 'continue',
        sourceChapterId: sessionRecord.lastChapterId ?? undefined,
        source: nextSource,
        seed: sessionRecord.seed,
        chapterPlan: sessionRecord.chapterPlan,
        workingCombatants:
          Array.isArray(sessionRecord.workingCombatants) && sessionRecord.workingCombatants.length > 0
            ? (sessionRecord.workingCombatants as Array<Record<string, unknown>>)
            : (sessionRecord.seed.combatants as Array<Record<string, unknown>>),
        recentChapters: buildChapterRequestWindow(activeChapters),
        sessionSummary: sessionRecord.sessionSummary,
        chapterIndexHint: (latestChapter?.index ?? 0) + 1,
        userGuidance: useBattleStore.getState().settings.userGuidance,
      });
      if (generated.aborted) {
        return;
      }

      const previousWorkingCombatants =
        Array.isArray(sessionRecord.workingCombatants) && sessionRecord.workingCombatants.length > 0
          ? (sessionRecord.workingCombatants as Array<Record<string, unknown>>)
          : (sessionRecord.seed.combatants as Array<Record<string, unknown>>);

      const chapter = createBattleStoryChapterRecord({
        sessionId: sessionRecord.id,
        index: generated.chapterIndex,
        action: 'continue',
        title: generated.digest.chapterTitle,
        markdown: generated.markdown,
        reportJson: generated.reportJson,
        cardSnapshot: generated.cardSnapshot ?? undefined,
        deterministicDigest: generated.digest,
        sourceChapterId: sessionRecord.lastChapterId ?? undefined,
        generationId: generated.generationId ?? undefined,
      });

      await putBattleStoryChapter(chapter);
      await putBattleStoryCheckpoint(
        createBattleStoryCheckpointRecord({
          sessionId: sessionRecord.id,
          boundaryIndex: generated.chapterIndex,
          chapterId: chapter.id,
          combatants: generated.nextWorkingCombatants,
        })
      );

      const sessionToSave = await updateBattleStorySession(sessionRecord.id, (current) => ({
        ...current,
        source: nextSource,
        title:
          current.title === '未命名连续战报' && generated.digest.chapterTitle
            ? generated.digest.chapterTitle
            : current.title,
        workingCombatants: generated.nextWorkingCombatants,
        lastChapterInputCombatants: previousWorkingCombatants,
        lastChapterId: chapter.id,
        chapterCount: activeChapters.length + 1,
        updatedAt: Date.now(),
      }));
      const nextChapters = sortBattleStoryChapters([...activeChapters, chapter]);

      await refreshSessionList();
      await loadSession(sessionRecord.id);
      if (generated.warning) {
        setNotice(generated.warning);
      }
      void refreshSummaryIfNeeded(sessionToSave, nextChapters);
    } catch (error) {
      setActionError(normalizeErrorMessage(error, '续写连续战报失败。'));
    }
  }, [
    customProviderPayload,
    loadSession,
    refreshSessionList,
    refreshSummaryIfNeeded,
    runGeneration,
  ]);

  const handleBranchFromChapter = useCallback(async (targetChapterId?: string | null) => {
    const sessionRecord = activeSessionRef.current;
    const activeChapters = getActiveBattleStoryChapters(chaptersRef.current);
    const checkpointRecords = sortBattleStoryCheckpoints(checkpointsRef.current);
    const latestChapter = getLatestBattleStoryChapter(activeChapters);
    const targetChapter = targetChapterId
      ? activeChapters.find((chapter) => chapter.id === targetChapterId) ?? null
      : latestChapter;

    if (!sessionRecord || !targetChapter || !latestChapter) {
      setActionError('当前没有可分支的章节。');
      return;
    }
    if (
      willBattleStoryChapterExceedPlan({
        chapterPlan: sessionRecord.chapterPlan,
        nextChapterIndex: targetChapter.index + 1,
      })
    ) {
      setActionError(`该章节之后已达到计划章节上限（共 ${sessionRecord.chapterPlan?.totalChapters} 章）`);
      return;
    }

    const branchInputCombatants = resolveChapterOutputCombatants({
      session: sessionRecord,
      checkpoints: checkpointRecords,
      chapter: targetChapter,
      latestChapter,
    });
    if (!branchInputCombatants) {
      setActionError('该章节缺少“章末状态”快照，暂不支持从这里创建分支。');
      return;
    }

    try {
      const nextSource = buildProviderSource(sessionRecord.source, customProviderPayload);
      const prefixChapters = activeChapters.filter((chapter) => chapter.index <= targetChapter.index);
      const summaryState = resolveAnchoredSummaryState({
        sessionSummary: sessionRecord.sessionSummary,
        summaryMeta: sessionRecord.summaryMeta,
        maxCoveredChapterIndex: targetChapter.index,
      });
      const branchDraft = createBattleStorySessionRecord({
        title: `${sessionRecord.title || targetChapter.title}（分支）`,
        branchLabel: buildBattleStoryBranchLabel({
          chapterIndex: targetChapter.index,
          chapterTitle: targetChapter.title,
        }),
        source: nextSource,
        seed: sessionRecord.seed,
        workingCombatants: branchInputCombatants,
        lastChapterInputCombatants: branchInputCombatants,
        sessionSummary: summaryState.sessionSummary,
        summaryMeta: summaryState.summaryMeta,
        chapterPlan: sessionRecord.chapterPlan,
        branchOf: {
          sessionId: sessionRecord.id,
          chapterId: targetChapter.id,
          chapterIndex: targetChapter.index,
          ...(targetChapter.title ? { chapterTitle: targetChapter.title } : {}),
          createdAt: Date.now(),
        },
      });

      const generated = await runGeneration({
        sessionId: branchDraft.id,
        action: 'branch',
        sourceChapterId: targetChapter.id,
        source: nextSource,
        seed: sessionRecord.seed,
        chapterPlan: branchDraft.chapterPlan,
        workingCombatants: branchInputCombatants,
        recentChapters: buildAnchoredChapterRequestWindow(prefixChapters, targetChapter.index),
        sessionSummary: summaryState.sessionSummary,
        chapterIndexHint: targetChapter.index + 1,
        userGuidance: useBattleStore.getState().settings.userGuidance,
      });
      if (generated.aborted) {
        return;
      }

      const { chapters: clonedChapters, chapterIdMap } = cloneBattleStoryActiveChaptersForNewSession({
        chapters: prefixChapters,
        newSessionId: branchDraft.id,
      });
      const clonedTargetChapterId = chapterIdMap.get(targetChapter.id) ?? null;
      const clonedCheckpoints = cloneBattleStoryCheckpointsForNewSession({
        checkpoints: checkpointRecords,
        newSessionId: branchDraft.id,
        chapterIdMap,
        maxBoundaryIndex: targetChapter.index,
      });
      if (!getBattleStoryCheckpointForBoundary(clonedCheckpoints, 0)) {
        clonedCheckpoints.unshift(
          createBattleStoryCheckpointRecord({
            sessionId: branchDraft.id,
            boundaryIndex: 0,
            combatants: sessionRecord.seed.combatants,
          })
        );
      }
      if (!getBattleStoryCheckpointForBoundary(clonedCheckpoints, targetChapter.index)) {
        clonedCheckpoints.push(
          createBattleStoryCheckpointRecord({
            sessionId: branchDraft.id,
            boundaryIndex: targetChapter.index,
            chapterId: clonedTargetChapterId ?? undefined,
            combatants: branchInputCombatants,
          })
        );
      }

      const branchChapter = createBattleStoryChapterRecord({
        sessionId: branchDraft.id,
        index: generated.chapterIndex,
        action: 'branch',
        title: generated.digest.chapterTitle,
        markdown: generated.markdown,
        reportJson: generated.reportJson,
        cardSnapshot: generated.cardSnapshot ?? undefined,
        deterministicDigest: generated.digest,
        sourceChapterId: clonedTargetChapterId ?? undefined,
        generationId: generated.generationId ?? undefined,
      });
      const branchCheckpoint = createBattleStoryCheckpointRecord({
        sessionId: branchDraft.id,
        boundaryIndex: generated.chapterIndex,
        chapterId: branchChapter.id,
        combatants: generated.nextWorkingCombatants,
      });

      const branchSession: BattleStorySessionRecord = {
        ...branchDraft,
        title: branchDraft.title,
        summaryMeta: remapBattleStorySummaryMeta(branchDraft.summaryMeta, chapterIdMap),
        workingCombatants: generated.nextWorkingCombatants,
        lastChapterInputCombatants: branchInputCombatants,
        lastChapterId: branchChapter.id,
        chapterCount: clonedChapters.length + 1,
        updatedAt: Date.now(),
      };

      await putBattleStorySession(branchSession);
      await Promise.all([
        ...clonedChapters.map((chapter) => putBattleStoryChapter(chapter)),
        putBattleStoryChapter(branchChapter),
      ]);
      await putBattleStoryCheckpoints(sortBattleStoryCheckpoints([...clonedCheckpoints, branchCheckpoint]));

      const nextChapters = sortBattleStoryChapters([...clonedChapters, branchChapter]);
      delete summaryRetryAtRef.current[branchSession.id];
      await refreshSessionList();
      await loadSession(branchSession.id);
      if (generated.warning) {
        setNotice(generated.warning);
      }
      void refreshSummaryIfNeeded(branchSession, nextChapters);
    } catch (error) {
      setActionError(normalizeErrorMessage(error, '创建分支会话失败。'));
    }
  }, [customProviderPayload, loadSession, refreshSessionList, refreshSummaryIfNeeded, runGeneration]);

  const handleBranchSession = useCallback(async () => {
    const latestChapter = getLatestBattleStoryChapter(getActiveBattleStoryChapters(chaptersRef.current));
    await handleBranchFromChapter(latestChapter?.id ?? null);
  }, [handleBranchFromChapter]);

  const handleBranchSelectedChapter = useCallback(async () => {
    await handleBranchFromChapter(selectedChapterId);
  }, [handleBranchFromChapter, selectedChapterId]);

  const handleRewriteChapter = useCallback(async (targetChapterId?: string | null) => {
    const sessionRecord = activeSessionRef.current;
    const activeChapters = getActiveBattleStoryChapters(chaptersRef.current);
    const checkpointRecords = sortBattleStoryCheckpoints(checkpointsRef.current);
    const latestChapter = getLatestBattleStoryChapter(activeChapters);
    const targetChapter = targetChapterId
      ? activeChapters.find((chapter) => chapter.id === targetChapterId) ?? null
      : latestChapter;

    if (!sessionRecord || !targetChapter || !latestChapter) {
      setActionError('当前没有可重写的章节。');
      return;
    }

    const rewriteInputCombatants = resolveChapterInputCombatants({
      session: sessionRecord,
      checkpoints: checkpointRecords,
      chapter: targetChapter,
      latestChapter,
    });
    if (!rewriteInputCombatants) {
      setActionError('该章节缺少“章前输入状态”快照，暂时无法安全重写。');
      return;
    }

    try {
      const nextSource = buildProviderSource(sessionRecord.source, customProviderPayload);
      const anchoredChapters = activeChapters.filter((chapter) => chapter.index <= targetChapter.index);
      const summaryState = resolveAnchoredSummaryState({
        sessionSummary: sessionRecord.sessionSummary,
        summaryMeta: sessionRecord.summaryMeta,
        maxCoveredChapterIndex: targetChapter.index,
        invalidateWhenCoveredAtOrBeyond: true,
      });
      const generated = await runGeneration({
        sessionId: sessionRecord.id,
        action: 'rewrite',
        sourceChapterId: targetChapter.id,
        source: nextSource,
        seed: sessionRecord.seed,
        chapterPlan: sessionRecord.chapterPlan,
        workingCombatants: rewriteInputCombatants,
        recentChapters: buildAnchoredChapterRequestWindow(anchoredChapters, targetChapter.index),
        sessionSummary: summaryState.sessionSummary,
        chapterIndexHint: targetChapter.index,
        userGuidance: useBattleStore.getState().settings.userGuidance,
      });
      if (generated.aborted) {
        return;
      }

      const rewrittenChapter = createBattleStoryChapterRecord({
        sessionId: sessionRecord.id,
        index: targetChapter.index,
        action: 'rewrite',
        title: generated.digest.chapterTitle,
        markdown: generated.markdown,
        reportJson: generated.reportJson,
        cardSnapshot: generated.cardSnapshot ?? undefined,
        deterministicDigest: generated.digest,
        sourceChapterId: targetChapter.id,
        generationId: generated.generationId ?? undefined,
      });

      await markBattleStoryChapterSuperseded({
        chapterId: targetChapter.id,
        supersededByChapterId: rewrittenChapter.id,
      });
      if (targetChapter.index < latestChapter.index) {
        await deleteBattleStoryChaptersFromIndex({
          sessionId: sessionRecord.id,
          startIndex: targetChapter.index + 1,
        });
      }
      await deleteBattleStoryCheckpointsFromBoundary({
        sessionId: sessionRecord.id,
        startBoundaryIndex: targetChapter.index,
      });
      await putBattleStoryChapter(rewrittenChapter);
      await putBattleStoryCheckpoint(
        createBattleStoryCheckpointRecord({
          sessionId: sessionRecord.id,
          boundaryIndex: rewrittenChapter.index,
          chapterId: rewrittenChapter.id,
          combatants: generated.nextWorkingCombatants,
        })
      );

      const nextSession = await updateBattleStorySession(sessionRecord.id, (current) => ({
        ...current,
        source: nextSource,
        workingCombatants: generated.nextWorkingCombatants,
        lastChapterInputCombatants: rewriteInputCombatants,
        lastChapterId: rewrittenChapter.id,
        chapterCount: rewrittenChapter.index,
        sessionSummary: summaryState.sessionSummary,
        summaryMeta: summaryState.summaryMeta,
        updatedAt: Date.now(),
      }));

      const nextChapters = sortBattleStoryChapters([
        ...activeChapters.filter((chapter) => chapter.index < targetChapter.index),
        rewrittenChapter,
      ]);

      delete summaryRetryAtRef.current[sessionRecord.id];
      await refreshSessionList();
      await loadSession(sessionRecord.id);
      if (generated.warning) {
        setNotice(generated.warning);
      }
      void refreshSummaryIfNeeded(nextSession, nextChapters);
    } catch (error) {
      setActionError(normalizeErrorMessage(error, '重写章节失败。'));
    }
  }, [customProviderPayload, loadSession, refreshSessionList, refreshSummaryIfNeeded, runGeneration]);

  const handleRewriteLastChapter = useCallback(async () => {
    const latestChapter = getLatestBattleStoryChapter(getActiveBattleStoryChapters(chaptersRef.current));
    await handleRewriteChapter(latestChapter?.id ?? null);
  }, [handleRewriteChapter]);

  const handleRewriteSelectedChapter = useCallback(async () => {
    await handleRewriteChapter(selectedChapterId);
  }, [handleRewriteChapter, selectedChapterId]);

  const handleDeleteSelectedChapter = useCallback(async () => {
    const sessionRecord = activeSessionRef.current;
    const activeChapters = getActiveBattleStoryChapters(chaptersRef.current);
    const checkpointRecords = sortBattleStoryCheckpoints(checkpointsRef.current);
    const latestChapter = getLatestBattleStoryChapter(activeChapters);
    const targetChapter = selectedChapterId
      ? activeChapters.find((chapter) => chapter.id === selectedChapterId) ?? null
      : latestChapter;

    if (!sessionRecord || !targetChapter || !latestChapter) {
      setActionError('当前没有可删除的章节。');
      return;
    }

    const remainingCount = Math.max(0, latestChapter.index - targetChapter.index + 1);
    if (typeof window !== 'undefined') {
      const confirmed = window.confirm(
        targetChapter.index === 1
          ? `确定删除第 1 章并清空整个会话吗？这会移除当前会话下的全部章节，本地章节会被删除，但服务端历史战报记录不会删除。`
          : `确定删除第 ${targetChapter.index} 章及其后续 ${remainingCount - 1} 章吗？当前会话会回退到第 ${targetChapter.index - 1} 章结束状态。本地章节会被删除，但服务端历史战报记录不会删除。`
      );
      if (!confirmed) return;
    }

    if (targetChapter.index === 1) {
      setIsDeletingSession(true);
      try {
        await deleteBattleStorySession(sessionRecord.id);
        delete summaryRetryAtRef.current[sessionRecord.id];
        const nextSessions = await refreshSessionList();
        await loadSession(nextSessions[0]?.id ?? null);
        setNotice(`已删除连续战报会话《${sessionRecord.title || '未命名连续战报'}》。`);
      } catch (error) {
        setActionError(normalizeErrorMessage(error, '删除连续战报会话失败。'));
      } finally {
        setIsDeletingSession(false);
      }
      return;
    }

    const revertCombatants = resolveChapterInputCombatants({
      session: sessionRecord,
      checkpoints: checkpointRecords,
      chapter: targetChapter,
      latestChapter,
    });
    if (!revertCombatants) {
      setActionError('该章节缺少“回退状态”快照，暂时无法安全删除。');
      return;
    }

    const previousChapter = activeChapters.find((chapter) => chapter.index === targetChapter.index - 1) ?? null;
    if (!previousChapter) {
      setActionError('未找到删除后的目标结尾章节。');
      return;
    }

    const nextLastChapterInputCombatants = resolveChapterInputCombatants({
      session: sessionRecord,
      checkpoints: checkpointRecords,
      chapter: previousChapter,
      latestChapter,
    });
    const nextSummaryState = resolveAnchoredSummaryState({
      sessionSummary: sessionRecord.sessionSummary,
      summaryMeta: sessionRecord.summaryMeta,
      maxCoveredChapterIndex: targetChapter.index,
      invalidateWhenCoveredAtOrBeyond: true,
    });

    setIsDeletingSession(true);
    try {
      await deleteBattleStoryChaptersFromIndex({
        sessionId: sessionRecord.id,
        startIndex: targetChapter.index,
      });
      await deleteBattleStoryCheckpointsFromBoundary({
        sessionId: sessionRecord.id,
        startBoundaryIndex: targetChapter.index,
      });

      const nextSession = await updateBattleStorySession(sessionRecord.id, (current) => ({
        ...current,
        workingCombatants: revertCombatants,
        lastChapterInputCombatants: nextLastChapterInputCombatants ?? undefined,
        lastChapterId: previousChapter.id,
        chapterCount: previousChapter.index,
        sessionSummary: nextSummaryState.sessionSummary,
        summaryMeta: nextSummaryState.summaryMeta,
        updatedAt: Date.now(),
      }));

      const nextChapters = activeChapters.filter((chapter) => chapter.index < targetChapter.index);
      delete summaryRetryAtRef.current[sessionRecord.id];
      await refreshSessionList();
      await loadSession(sessionRecord.id);
      setNotice(
        targetChapter.id === latestChapter.id
          ? `已删除第 ${targetChapter.index} 章，当前会话回退到第 ${previousChapter.index} 章。`
          : `已删除第 ${targetChapter.index} 章及其后续章节，当前会话回退到第 ${previousChapter.index} 章。`
      );
      void refreshSummaryIfNeeded(nextSession, nextChapters);
    } catch (error) {
      setActionError(normalizeErrorMessage(error, '删除章节失败。'));
    } finally {
      setIsDeletingSession(false);
    }
  }, [loadSession, refreshSessionList, refreshSummaryIfNeeded, selectedChapterId]);

  const handleSelectSession = useCallback(
    async (sessionId: string) => {
      setActionError(null);
      setNotice(null);
      try {
        await loadSession(sessionId);
      } catch (error) {
        setActionError(normalizeErrorMessage(error, '加载连续战报会话失败。'));
      }
    },
    [loadSession]
  );

  const handleDeleteSession = useCallback(
    async (sessionId?: string) => {
      const targetId =
        typeof sessionId === 'string' && sessionId.trim()
          ? sessionId.trim()
          : activeSessionRef.current?.id ?? null;
      if (!targetId) {
        setActionError('当前没有可删除的连续战报会话。');
        return;
      }

      const targetSession =
        sessions.find((session) => session.id === targetId) ??
        (activeSessionRef.current?.id === targetId ? activeSessionRef.current : null);
      const targetTitle = targetSession?.title?.trim() || '未命名连续战报';
      if (typeof window !== 'undefined') {
        const confirmed = window.confirm(
          `确定删除《${targetTitle}》吗？这会一并删除该会话下的全部章节，且无法恢复。`
        );
        if (!confirmed) return;
      }

      setActionError(null);
      setNotice(null);
      setIsDeletingSession(true);

      try {
        await deleteBattleStorySession(targetId);
        delete summaryRetryAtRef.current[targetId];

        const nextSessions = await refreshSessionList();
        if (activeSessionRef.current?.id === targetId) {
          await loadSession(nextSessions[0]?.id ?? null);
        }

        setNotice(`已删除连续战报会话《${targetTitle}》。`);
      } catch (error) {
        setActionError(normalizeErrorMessage(error, '删除连续战报会话失败。'));
      } finally {
        setIsDeletingSession(false);
      }
    },
    [loadSession, refreshSessionList, sessions]
  );

  const handleExportMarkdown = useCallback(() => {
    const sessionRecord = activeSessionRef.current;
    const chapterRecords = chaptersRef.current;
    if (!sessionRecord || chapterRecords.length === 0) {
      setActionError('当前没有可导出的连续战报。');
      return;
    }

    const content = buildBattleStoryExportMarkdown(sessionRecord, chapterRecords);
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${sessionRecord.title || 'battle-story-session'}.md`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, []);

  const stopGeneration = useCallback(() => {
    generationAbortControllerRef.current?.abort(STREAM_ABORT_REASON_USER);
  }, []);

  return {
    isReady,
    storageError,
    actionError,
    notice,
    sessions,
    activeSession: displayActiveSession,
    chapters: displayChapters,
    latestActiveChapter: displayLatestActiveChapter,
    selectedChapter: displaySelectedChapter,
    selectedChapterIsLatest,
    selectedChapterId,
    setSelectedChapterId,
    isGenerating,
    generatingAction,
    streamingMarkdown,
    streamSoftTimeoutWarning,
    streamCardSnapshot,
    streamChapterIndex,
    isRefreshingSummary,
    isDeletingSession,
    isCooldown,
    remainingTime,
    providerCooldownMode,
    otherRemainingTime,
    draftChapterPlanMode,
    setDraftChapterPlanMode,
    draftChapterPlanInput,
    setDraftChapterPlanInput,
    draftChapterPlan,
    scenarioChapterPlanConfig,
    activeChapterProgressText,
    activeChapterPlanSourceLabel,
    hasReachedActiveChapterPlanLimit,
    canStartFromArena: startSessionCheck.canStart,
    startDisabledReason: startSessionCheck.reason,
    continueDisabledReason,
    branchDisabledReason,
    selectedBranchDisabledReason,
    selectedRewriteDisabledReason,
    selectedDeleteDisabledReason,
    stopGeneration,
    handleStartSession,
    handleContinueSession,
    handleBranchSession,
    handleBranchSelectedChapter,
    handleRewriteLastChapter,
    handleRewriteSelectedChapter,
    handleDeleteSelectedChapter,
    handleSelectSession,
    handleDeleteSession,
    handleExportMarkdown,
  };
}
