import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useRef, useState } from 'react';

import type { UserAIProviderConfig } from '@/components/AiProviderSelector';
import Footer from '@/components/Footer';
import { TokenIndicator } from '@/components/shared/TokenIndicator';
import { MagicTeaPartyCardModals } from '@/components/magic-tea-party/CardModals';
import { MagicTeaPartyChatComposer } from '@/components/magic-tea-party/ChatComposer';
import { MagicTeaPartyChatTimeline } from '@/components/magic-tea-party/ChatTimeline';
import { MagicTeaPartyCharacterPanel } from '@/components/magic-tea-party/CharacterPanel';
import { MagicTeaPartyHero } from '@/components/magic-tea-party/Hero';
import { MagicTeaPartyPresetCharacterPanel } from '@/components/magic-tea-party/PresetCharacterPanel';
import { MagicTeaPartySessionSidebar } from '@/components/magic-tea-party/SessionSidebar';
import { MagicTeaPartySessionSetupPanel } from '@/components/magic-tea-party/SessionSetupPanel';
import { MagicTeaPartySummaryPanel } from '@/components/magic-tea-party/SummaryPanel';
import { MagicTeaPartyTachiePanel } from '@/components/magic-tea-party/TachiePanel';

import { estimateMagicTeaPartyTokens, resolveMagicTeaPartyTokenBudget } from '@/lib/magic-tea-party/budget';
import { readMagicTeaPartyDraft, writeMagicTeaPartyDraft } from '@/lib/magic-tea-party/drafts';
import { buildMagicTeaPartyHistory } from '@/lib/magic-tea-party/history';
import { checkMagicTeaPartySensitiveText, maskMagicTeaPartyText } from '@/lib/magic-tea-party/import-safety';
import { buildMagicTeaPartyMainPrompt, buildWorldbookText } from '@/lib/magic-tea-party/prompts';
import { getMagicTeaPartyPreset } from '@/lib/magic-tea-party/presets';
import { useMagicTeaPartyChat } from '@/lib/magic-tea-party/useMagicTeaPartyChat';
import { useMagicTeaPartySessions } from '@/lib/magic-tea-party/useMagicTeaPartySessions';
import { randomUUID } from '@/lib/crypto';
import type {
  MagicTeaPartyMessage,
  MagicTeaPartyNotice,
  MagicTeaPartyRole,
  MagicTeaPartySession,
  MagicTeaPartyTachieAsset,
  MagicTeaPartyUpdateDraft,
  MagicTeaPartyUpdateSnapshot,
} from '@/lib/magic-tea-party/types';
import { useAuth } from '@/lib/useAuth';
import { applyShieldWords } from '@/lib/shield-word-filter';
import { buildBetaAccessUrl } from '@/lib/beta-access';
import { useBetaAccessStatus } from '@/lib/beta-access-client';
import type { BetaAccessFeatureId } from '@/config/beta-access';

export default function MagicTeaPartyPage() {
  const router = useRouter();
  const { user, userBadges, isAuthenticated, loading, badgesLoading } = useAuth();
  const betaFeatureId: BetaAccessFeatureId = 'magic-tea-party';
  const betaAccess = useBetaAccessStatus({
    featureId: betaFeatureId,
    isAuthenticated,
    loading,
    badges: userBadges,
    badgesLoading,
  });

  const [globalError, setGlobalError] = useState<string | null>(null);
  const [userProviderConfig, setUserProviderConfig] = useState<UserAIProviderConfig | null>(null);

  const {
    sessions,
    activeSessionId,
    setActiveSessionId,
    activeSession,
    messages,
    setMessages,
    preferences,
    applyPreferencePatch,
    persistSession,
    createSession,
    deleteSession,
    bulkDeleteSessions,
    toggleSessionPin,
    reorderPinnedSessions,
    handleSessionImported,
    applyPreset,
    updateActiveSessionSettings,
    updateActiveSessionRoles,
    updateActiveSessionScenarios,
    onToggleRoleCard,
    onToggleScenarioCard,
    onUploadRoles,
    onUploadScenarios,
    onImportRolesText,
    onImportScenariosText,
    onDropRoles,
    onDropScenarios,
    selectedRoleCardIds,
    selectedScenarioCardIds,
    playerOptions,
    updateSessionTitle,
    lockSessionTitle,
    updatePlayerRole,
    forkSessionFromMessage,
    mergeSessionToParent,
  } = useMagicTeaPartySessions({
    username: user?.username,
    userProviderConfig,
    onGlobalError: setGlobalError,
  });

  const [notices, setNotices] = useState<MagicTeaPartyNotice[]>([]);
  const [outputView, setOutputView] = useState<'raw' | 'rendered'>('raw');

  const buildNoticeKey = (notice: MagicTeaPartyNotice): string => {
    const meta = notice.meta && typeof notice.meta === 'object' ? (notice.meta as Record<string, unknown>) : null;
    const roleId = meta && typeof meta.roleId === 'string' ? String(meta.roleId) : '';
    const scenarioId = meta && typeof meta.scenarioId === 'string' ? String(meta.scenarioId) : '';
    const stage = meta && typeof meta.stage === 'string' ? String(meta.stage) : '';
    const code = notice.code?.trim() || notice.message.trim().slice(0, 80);
    return [notice.level, code, roleId, scenarioId, stage].filter(Boolean).join(':');
  };

  const appendNotices = (incoming: MagicTeaPartyNotice[]) => {
    if (!incoming || incoming.length === 0) return;
    setNotices((prev) => {
      const keys = new Set(prev.map(buildNoticeKey));
      const next = [...prev];
      incoming.forEach((notice) => {
        const key = buildNoticeKey(notice);
        if (!key || keys.has(key)) return;
        keys.add(key);
        next.push(notice);
      });
      return next;
    });
  };

  const clearNotices = () => {
    setNotices([]);
  };

  const {
    isGenerating,
    isSummarizing,
    summaryError,
    stopGenerating,
    sendMessage,
    continueGeneration,
    generateChoices,
    regenerateMessage,
    generateSummary,
    clearSummary,
  } = useMagicTeaPartyChat({
    activeSession,
    activeSessionId,
    messages,
    setMessages,
    persistSession,
    preferences,
    userProviderConfig,
    onGlobalError: setGlobalError,
    onNotices: appendNotices,
    onSideChannels: (payload) => void handleSideChannels(payload),
    router,
  });

  const [showRoleModal, setShowRoleModal] = useState(false);
  const [showScenarioModal, setShowScenarioModal] = useState(false);

  const [draft, setDraft] = useState('');
  const draftPersistTimerRef = useRef<number | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState('');
  const [tachieReferenceText, setTachieReferenceText] = useState('');
  const [tachieAnchorMessageId, setTachieAnchorMessageId] = useState<string | null>(null);
  const [tachieAssets, setTachieAssets] = useState<MagicTeaPartyTachieAsset[]>([]);
  const [updateDrafts, setUpdateDrafts] = useState<MagicTeaPartyUpdateDraft[] | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [updateRangeSize, setUpdateRangeSize] = useState<number>(20);
  const [isGeneratingUpdates, setIsGeneratingUpdates] = useState(false);
  const [isApplyingUpdates, setIsApplyingUpdates] = useState(false);

  useEffect(() => {
    if (betaAccess.status === 'blocked' || betaAccess.status === 'error') {
      void router.replace(buildBetaAccessUrl(betaFeatureId));
    }
  }, [betaAccess.status, betaFeatureId, router]);

  useEffect(() => {
    if (!activeSessionId) {
      setDraft('');
      return;
    }
    const sessionDraft = typeof activeSession?.draft === 'string' ? activeSession.draft : null;
    const storedDraft = readMagicTeaPartyDraft(activeSessionId);
    setDraft(sessionDraft ?? storedDraft ?? '');
  }, [activeSession?.draft, activeSessionId]);

  useEffect(() => {
    if (!activeSessionId) return;
    writeMagicTeaPartyDraft(activeSessionId, draft);
  }, [activeSessionId, draft]);

  useEffect(() => {
    if (!activeSession || !activeSessionId) return;
    if (draftPersistTimerRef.current) {
      clearTimeout(draftPersistTimerRef.current);
    }
    const capped = draft.length > 20_000 ? draft.slice(0, 20_000) : draft;
    draftPersistTimerRef.current = window.setTimeout(() => {
      const trimmed = capped.trim();
      const nextDraft = trimmed ? capped : undefined;
      if (nextDraft === activeSession.draft || (!nextDraft && !activeSession.draft)) return;
      void persistSession({
        ...activeSession,
        draft: nextDraft,
        updatedAt: activeSession.updatedAt,
      });
    }, 400);
    return () => {
      if (draftPersistTimerRef.current) {
        clearTimeout(draftPersistTimerRef.current);
      }
    };
  }, [activeSession, activeSessionId, draft, persistSession]);

  useEffect(() => {
    setTachieReferenceText('');
    setTachieAnchorMessageId(null);
    setTachieAssets([]);
    setUpdateDrafts(null);
    setUpdateError(null);
    setEditingMessageId(null);
    setEditingDraft('');
    clearNotices();
  }, [activeSessionId]);

  useEffect(() => {
    if (!activeSession) return;
    const shadowDrafts = activeSession.protocolShadow?.drafts;
    if (Array.isArray(shadowDrafts) && shadowDrafts.length > 0) {
      setUpdateDrafts(shadowDrafts);
    }
  }, [activeSession]);

  const handleStartEditMessage = (message: MagicTeaPartyMessage) => {
    setEditingMessageId(message.id);
    setEditingDraft(message.content ?? '');
  };

  const handleCancelEditMessage = () => {
    setEditingMessageId(null);
    setEditingDraft('');
  };

  const handleConfirmEditMessage = async (message: MagicTeaPartyMessage) => {
    if (!message?.id) return;
    const trimmed = editingDraft.trim();
    if (!trimmed) {
      setGlobalError('编辑内容不能为空。');
      return;
    }
    const guard = await checkMagicTeaPartySensitiveText({
      text: trimmed,
      reason: '使用危险符文',
      origin: '/magic-tea-party',
      label: '魔法茶会分支编辑',
      filename: 'magic-tea-party-edit.txt',
      mimeType: 'text/plain',
    });
    if (guard.blocked) {
      if (guard.redirectTarget) {
        await router.push(guard.redirectTarget);
      }
      return;
    }
    const masked = maskMagicTeaPartyText(trimmed).value.trim();
    const nextSessionId = await forkSessionFromMessage(message.id, masked);
    if (nextSessionId) {
      setEditingMessageId(null);
      setEditingDraft('');
      setDraft('');
    }
  };

  const handleMergeSessionToParent = async (sessionId?: string | null) => {
    const confirmed =
      typeof window !== 'undefined'
        ? window.confirm('将当前分支合并回父会话会替换父会话分支点之后的内容，确定继续吗？')
        : true;
    if (!confirmed) return;
    await mergeSessionToParent(sessionId ?? activeSession?.id ?? null);
  };

  const handleSendMessage = async (text: string) => {
    clearNotices();
    return await sendMessage(text);
  };

  const handleContinueGeneration = async () => {
    clearNotices();
    await continueGeneration();
  };

  const handleGenerateChoices = async () => {
    clearNotices();
    await generateChoices();
  };

  const handleRegenerateMessage = async (message: MagicTeaPartyMessage) => {
    clearNotices();
    await regenerateMessage(message);
  };

  useEffect(() => {
    if (!activeSession) return;
    if (tachieReferenceText.trim()) return;

    const toPlainText = (message: MagicTeaPartyMessage): string => {
      const segments = Array.isArray(message.segments) ? message.segments : null;
      if (segments && segments.length > 0) {
        const lines: string[] = [];
        for (const seg of segments) {
          if (!seg) continue;
          if (seg.type === 'narration') {
            const text = typeof (seg as any).text === 'string' ? String((seg as any).text).trim() : '';
            if (text) lines.push(text);
            continue;
          }
          if (seg.type === 'dialogue') {
            const speaker =
              typeof (seg as any).speakerName === 'string' && String((seg as any).speakerName).trim()
                ? String((seg as any).speakerName).trim()
                : typeof (seg as any).speakerId === 'string'
                  ? (activeSession.roles ?? []).find((r) => r.id === String((seg as any).speakerId))?.name || String((seg as any).speakerId)
                  : '';
            const text = typeof (seg as any).text === 'string' ? String((seg as any).text).trim() : '';
            if (text) lines.push(speaker ? `${speaker}: ${text}` : text);
            continue;
          }
        }
        return lines.join('\n').trim();
      }
      return (message.content ?? '').trim();
    };

    const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant' && (m.content || '').trim() && m.status !== 'error');
    if (lastAssistant) {
      setTachieReferenceText(toPlainText(lastAssistant).slice(0, 2000));
      setTachieAnchorMessageId(lastAssistant.id);
      return;
    }

    const lastUser = [...messages].reverse().find((m) => m.role === 'user' && (m.content || '').trim());
    if (lastUser) {
      setTachieReferenceText(toPlainText(lastUser).slice(0, 2000));
      setTachieAnchorMessageId(lastUser.id);
    }
  }, [activeSession, messages, tachieReferenceText]);

  const tokenBudget = useMemo(
    () => resolveMagicTeaPartyTokenBudget(activeSession?.settings, userProviderConfig?.providerId),
    [activeSession?.settings, userProviderConfig?.providerId]
  );

  const tokenEstimate = useMemo(() => {
    if (!activeSession) return null;

    const baseHistory = buildMagicTeaPartyHistory(messages, { includeEmptyContent: false });
    const trimmedDraft = draft.trim();
    const historyForEstimate = trimmedDraft
      ? [...baseHistory, { id: 'draft', role: 'user', content: trimmedDraft }]
      : baseHistory;

    const preset = getMagicTeaPartyPreset(activeSession.settings.presetId ?? null);
    const worldbookText = preset ? buildWorldbookText(preset.worldbook) : '';
    const stylePrompt = preset ? preset.systemPrompt : '';

    const sessionForPrompt = {
      playerRoleId: activeSession.playerRoleId ?? null,
      summary: activeSession.summary,
      protocolShadow: activeSession.protocolShadow,
      settings: {
        ...activeSession.settings,
        outputFormat: activeSession.settings.outputFormat ?? preferences.outputFormat,
        outputPlan: activeSession.settings.outputPlan ?? preferences.outputPlan,
        language: activeSession.settings.language ?? preferences.language,
        enableChoices: activeSession.settings.enableChoices ?? preferences.enableChoices,
        choiceCount: activeSession.settings.choiceCount ?? preferences.choiceCount,
        userDisplayName: activeSession.settings.userDisplayName || preferences.userDisplayName || '旅人',
        enableSummary: activeSession.settings.enableSummary ?? preferences.enableSummary,
        readArenaHistory:
          typeof activeSession.settings.readArenaHistory === 'boolean' ? activeSession.settings.readArenaHistory : preferences.readArenaHistory,
        readArenaHistoryLimit:
          typeof activeSession.settings.readArenaHistoryLimit === 'number'
            ? activeSession.settings.readArenaHistoryLimit
            : preferences.readArenaHistoryLimit,
        isArenaHistoryUnlimited:
          typeof activeSession.settings.isArenaHistoryUnlimited === 'boolean'
            ? activeSession.settings.isArenaHistoryUnlimited
            : preferences.isArenaHistoryUnlimited,
        readCurrentState:
          typeof activeSession.settings.readCurrentState === 'boolean' ? activeSession.settings.readCurrentState : preferences.readCurrentState,
        writeArenaHistory:
          typeof activeSession.settings.writeArenaHistory === 'boolean' ? activeSession.settings.writeArenaHistory : preferences.writeArenaHistory,
        writeCurrentState:
          typeof activeSession.settings.writeCurrentState === 'boolean' ? activeSession.settings.writeCurrentState : preferences.writeCurrentState,
      },
    };

    const prompt = buildMagicTeaPartyMainPrompt({
      session: sessionForPrompt,
      roles: activeSession.roles ?? [],
      scenario: activeSession.scenario,
      auxScenarios: activeSession.auxScenarios ?? [],
      worldbookText,
      messages: historyForEstimate as any,
      requestChoices: false,
      stylePrompt,
    });

    const estimatedTokens = estimateMagicTeaPartyTokens(
      prompt,
      userProviderConfig?.providerId ?? activeSession.settings.providerId
    );

    return {
      estimatedTokens,
      messageCount: historyForEstimate.length,
    };
  }, [activeSession, draft, messages, preferences, userProviderConfig?.providerId]);

  const resolveWriteSettings = (session?: MagicTeaPartySession | null) => {
    const source = session ?? activeSession;
    const writeArenaHistory = source?.settings.writeArenaHistory ?? preferences.writeArenaHistory;
    const writeCurrentState = source?.settings.writeCurrentState ?? preferences.writeCurrentState;
    return { writeArenaHistory: Boolean(writeArenaHistory), writeCurrentState: Boolean(writeCurrentState) };
  };

  const resolveUpdateApplyMode = () =>
    (activeSession?.settings.updateApplyMode ?? preferences.updateApplyMode) as 'auto' | 'confirm' | 'draft';

  const normalizeMessageRange = (value: any): { fromMessageId: string; toMessageId: string; count: number } | undefined => {
    if (!value || typeof value !== 'object') return undefined;
    const record = value as Record<string, unknown>;
    const fromMessageId = typeof record.fromMessageId === 'string' ? record.fromMessageId : '';
    const toMessageId = typeof record.toMessageId === 'string' ? record.toMessageId : '';
    const count = typeof record.count === 'number' ? record.count : Number.NaN;
    if (!fromMessageId || !toMessageId || !Number.isFinite(count)) return undefined;
    return { fromMessageId, toMessageId, count: Math.max(1, Math.floor(count)) };
  };

  const extractMessageRangeFromDrafts = (drafts: MagicTeaPartyUpdateDraft[]): { fromMessageId: string; toMessageId: string; count: number } | undefined => {
    for (const draft of drafts) {
      const range = normalizeMessageRange(draft.meta?.messageRange);
      if (range) return range;
    }
    return undefined;
  };

  const ensureProviderReady = (): boolean => {
    if (!userProviderConfig) {
      setGlobalError('请先配置模型与 API Key。');
      return false;
    }
    if (userProviderConfig.providerId === 'system') {
      setGlobalError('魔法茶会已禁用 system，请使用自备 Key。');
      return false;
    }
    if (!userProviderConfig.apiKey?.trim()) {
      setGlobalError('API Key 不能为空。');
      return false;
    }
    if (!userProviderConfig.modelId?.trim()) {
      setGlobalError('请先选择模型。');
      return false;
    }
    return true;
  };

  const applyUpdateDrafts = async (params: {
    drafts: MagicTeaPartyUpdateDraft[];
    mode: 'auto' | 'confirm';
    messageRange?: { fromMessageId: string; toMessageId: string; count: number };
    sessionOverride?: MagicTeaPartySession;
  }) => {
    const session = params.sessionOverride ?? activeSession;
    if (!session) return;
    if (params.drafts.length === 0) return;
    if (isGenerating || isSummarizing || isGeneratingUpdates || isApplyingUpdates) return;

    const { writeArenaHistory, writeCurrentState } = resolveWriteSettings(session);
    if (!writeArenaHistory && !writeCurrentState) {
      setUpdateError('请先开启写入历战记录或当前状态。');
      return;
    }

    setUpdateError(null);
    setIsApplyingUpdates(true);

    try {
      const messageRange =
        params.messageRange ??
        normalizeMessageRange(session.protocolShadow?.messageRange) ??
        extractMessageRangeFromDrafts(params.drafts);
      const response = await fetch('/api/magic-tea-party/apply-updates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: session.id,
          sessionTitle: session.title,
          drafts: params.drafts,
          roles: session.roles ?? [],
          summaryMeta: messageRange ? { messageRange } : undefined,
          settings: { writeArenaHistory, writeCurrentState },
        }),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const errorMessage =
          typeof payload?.error === 'string'
            ? payload.error
            : typeof payload?.message === 'string'
              ? payload.message
              : `请求失败（${response.status}）`;
        setUpdateError(errorMessage);
        return;
      }

      const updatedRoles = Array.isArray(payload?.updatedRoles) ? (payload.updatedRoles as MagicTeaPartyRole[]) : [];
      const now = Date.now();
      const rolesBefore = session.roles ?? [];
      const rolesAfter = updatedRoles.length > 0 ? updatedRoles : rolesBefore;
      const updateSnapshot: MagicTeaPartyUpdateSnapshot | undefined =
        params.mode === 'auto'
          ? {
              id: randomUUID(),
              createdAt: now,
              mode: 'auto',
              ...(messageRange ? { messageRange } : {}),
              drafts: params.drafts,
              rolesBefore,
              rolesAfter,
            }
          : session.updateSnapshot;
      const nextSession: MagicTeaPartySession = {
        ...session,
        roles: rolesAfter,
        protocolShadow: undefined,
        updateSnapshot,
        updatedAt: now,
      };
      await persistSession(nextSession);
      setUpdateDrafts(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : '写入失败';
      setUpdateError(message);
    } finally {
      setIsApplyingUpdates(false);
    }
  };

  const handleRollbackUpdates = async () => {
    if (!activeSession?.updateSnapshot) return;
    if (activeSession.updateSnapshot.revertedAt) return;
    const confirmed =
      typeof window !== 'undefined' ? window.confirm('确定撤销上次自动写入吗？这会恢复到写入前的角色状态。') : true;
    if (!confirmed) return;
    const now = Date.now();
    const snapshot = activeSession.updateSnapshot;
    const nextSession = {
      ...activeSession,
      roles: snapshot.rolesBefore,
      updateSnapshot: { ...snapshot, revertedAt: now },
      updatedAt: now,
    };
    await persistSession(nextSession);
  };

  const handleGenerateUpdateDrafts = async () => {
    if (!activeSession) return;
    if (isGenerating || isSummarizing || isGeneratingUpdates || isApplyingUpdates) return;
    if (!ensureProviderReady()) return;

    const { writeArenaHistory, writeCurrentState } = resolveWriteSettings();
    if (!writeArenaHistory && !writeCurrentState) {
      setUpdateError('请先开启写入历战记录或当前状态。');
      return;
    }

    const history = buildMagicTeaPartyHistory(messages, { includeEmptyContent: false });
    if (history.length === 0) {
      setUpdateError('还没有可用于更新的对话。');
      return;
    }

    const rangeSize = Math.max(1, Math.min(200, updateRangeSize || 20));
    const sliced = history.slice(-rangeSize);
    const messageRange = {
      fromMessageId: sliced[0]?.id,
      toMessageId: sliced[sliced.length - 1]?.id,
      count: sliced.length,
    };
    const fallbackChoices = [...messages]
      .reverse()
      .find((message) => Array.isArray(message.choices) && message.choices.length > 0)?.choices;
    const lastChoices = activeSession.lastChoices ?? fallbackChoices;

    setUpdateError(null);
    setIsGeneratingUpdates(true);

    try {
      const response = await fetch('/api/magic-tea-party/generate-updates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: activeSession.id,
          sessionTitle: activeSession.title,
          messages: sliced,
          summary: activeSession.summary,
          roles: activeSession.roles ?? [],
          scenario: activeSession.scenario ?? null,
          auxScenarios: activeSession.auxScenarios ?? [],
          lastChoices: lastChoices ?? undefined,
          messageRange,
          settings: {
            writeArenaHistory,
            writeCurrentState,
            language: activeSession.settings.language ?? preferences.language,
            userDisplayName: activeSession.settings.userDisplayName || preferences.userDisplayName || '旅人',
          },
          customProvider: userProviderConfig,
        }),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const errorMessage =
          typeof payload?.error === 'string'
            ? payload.error
            : typeof payload?.message === 'string'
              ? payload.message
              : `请求失败（${response.status}）`;
        setUpdateError(errorMessage);
        return;
      }

      const drafts = Array.isArray(payload?.drafts) ? (payload.drafts as MagicTeaPartyUpdateDraft[]) : [];
      if (drafts.length === 0) {
        setUpdateError('未生成任何更新草案。');
        return;
      }
      setUpdateDrafts(drafts);
      const now = Date.now();
      const nextSession: MagicTeaPartySession = {
        ...activeSession,
        protocolShadow: {
          updatedAt: now,
          ...(messageRange ? { messageRange } : {}),
          drafts,
          source: 'manual',
        },
        updatedAt: now,
      };
      await persistSession(nextSession);
      if (resolveUpdateApplyMode() === 'auto') {
        await applyUpdateDrafts({ drafts, mode: 'auto', messageRange, sessionOverride: nextSession });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '生成更新草案失败';
      setUpdateError(message);
    } finally {
      setIsGeneratingUpdates(false);
    }
  };

  const handleApplyUpdates = async () => {
    if (!activeSession) return;
    if (!updateDrafts || updateDrafts.length === 0) {
      setUpdateError('没有可写入的草案。');
      return;
    }
    await applyUpdateDrafts({ drafts: updateDrafts, mode: 'confirm' });
  };

  const handleSideChannels = async (payload: {
    summary: { text: string; sections?: Record<string, string> } | null;
    updates: MagicTeaPartyUpdateDraft[] | null;
    updatesMeta: Record<string, unknown> | null;
  }) => {
    if (!activeSession) return;
    const now = Date.now();
    let nextSession = activeSession;
    let didChange = false;
    setUpdateError(null);

    const allowSummary = activeSession?.settings.enableSummary ?? preferences.enableSummary;
    if (payload.summary?.text && allowSummary) {
      const safeText = applyShieldWords(payload.summary.text).filteredText;
      if (safeText) {
        nextSession = {
          ...nextSession,
          summary: safeText,
          summarySections: payload.summary.sections ?? undefined,
          summaryMeta: { ...(nextSession.summaryMeta ?? {}), updatedAt: now },
          updatedAt: now,
        };
        didChange = true;
      }
    }

    if (payload.updates && payload.updates.length > 0) {
      const messageRange =
        normalizeMessageRange(payload.updatesMeta?.messageRange) ?? extractMessageRangeFromDrafts(payload.updates);
      setUpdateDrafts(payload.updates);
      nextSession = {
        ...nextSession,
        protocolShadow: {
          updatedAt: now,
          ...(messageRange ? { messageRange } : {}),
          drafts: payload.updates,
          source: 'stream',
        },
        updatedAt: now,
      };
      didChange = true;
    }

    if (didChange && nextSession !== activeSession) {
      await persistSession(nextSession);
    }

    if (payload.updates && payload.updates.length > 0 && resolveUpdateApplyMode() === 'auto') {
      await applyUpdateDrafts({
        drafts: payload.updates,
        mode: 'auto',
        messageRange: normalizeMessageRange(payload.updatesMeta?.messageRange),
        sessionOverride: didChange ? nextSession : activeSession,
      });
    }
  };

  if (betaAccess.status !== 'allowed') {
    return (
      <div className="magic-background-white">
        <div className="container">
          <div className="card">
            <div className="py-10 text-center text-sm text-gray-600">正在核验内测权限…</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>魔法茶会</title>
        <meta name="description" content="基于角色卡/情景卡的长期对话与剧情体验（本地存储，自备 API Key）" />
      </Head>

      <div className="magic-background-white">
        <div className="container !max-w-[1200px]">
          <div className="card !max-w-none">
            <MagicTeaPartyHero globalError={globalError} notices={notices} onClearNotices={clearNotices} />

            <div className="mt-6 grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
                <MagicTeaPartySessionSidebar
                  sessions={sessions}
                  activeSessionId={activeSessionId}
                  activeSession={activeSession}
                  preferences={preferences}
                  onCreateSession={(presetId) => void createSession(presetId)}
                  onSelectSession={setActiveSessionId}
                  onDeleteSession={(sessionId) => void deleteSession(sessionId)}
                  onCleanupSessions={(sessionIds) => bulkDeleteSessions(sessionIds)}
                  onToggleSessionPin={(sessionId) => void toggleSessionPin(sessionId)}
                  onReorderPinnedSessions={(orderedIds) => void reorderPinnedSessions(orderedIds)}
                  onSessionImported={handleSessionImported}
                  onPresetSelected={(presetId) => applyPreset(presetId)}
                  onProviderConfigChange={setUserProviderConfig}
                  onPreferenceChange={applyPreferencePatch}
                  onSessionSettingChange={updateActiveSessionSettings}
                  onMergeSession={handleMergeSessionToParent}
                />

              <main className="space-y-4 min-w-0">
                <MagicTeaPartySessionSetupPanel
                  activeSession={activeSession}
                  playerOptions={playerOptions}
                  onOpenRoleModal={() => setShowRoleModal(true)}
                  onOpenScenarioModal={() => setShowScenarioModal(true)}
                  onUploadRoles={onUploadRoles}
                  onUploadScenarios={onUploadScenarios}
                  onImportRolesText={(text) => void onImportRolesText(text)}
                  onImportScenariosText={(text) => void onImportScenariosText(text)}
                  onDropRoles={(files) => void onDropRoles(files)}
                  onDropScenarios={(files) => void onDropScenarios(files)}
                  onUpdateRoles={(roles) => void updateActiveSessionRoles(roles)}
                  onUpdateScenarios={(scenario, auxScenarios) => void updateActiveSessionScenarios(scenario, auxScenarios)}
                  onUpdatePlayerRole={updatePlayerRole}
                  onUpdateTitle={updateSessionTitle}
                  onLockTitle={lockSessionTitle}
                  onCreateSession={() => void createSession()}
                />

                <MagicTeaPartyPresetCharacterPanel
                  activeSession={activeSession}
                  preferences={preferences}
                  onPreferenceChange={applyPreferencePatch}
                  onUpdateRoles={(roles) => void updateActiveSessionRoles(roles)}
                />

                <MagicTeaPartyCharacterPanel
                  activeSession={activeSession}
                  roles={activeSession?.roles ?? []}
                  isAuthenticated={Boolean(user?.id)}
                  onUpdateRoles={(roles) => void updateActiveSessionRoles(roles)}
                  onUpdatePlayerRole={updatePlayerRole}
                  onToggleRoleCard={onToggleRoleCard}
                />
                <MagicTeaPartySummaryPanel
                  activeSession={activeSession}
                  isGenerating={isGenerating}
                  isSummarizing={isSummarizing}
                  summaryError={summaryError}
                  hasMessages={messages.length > 0}
                  onGenerateSummary={() => void generateSummary()}
                  onClearSummary={() => void clearSummary()}
                  onPersistSession={persistSession}
                  updateDrafts={updateDrafts}
                  updateRangeSize={updateRangeSize}
                  isGeneratingUpdates={isGeneratingUpdates}
                  isApplyingUpdates={isApplyingUpdates}
                  updateError={updateError}
                  updateApplyMode={resolveUpdateApplyMode()}
                  updateSnapshot={activeSession?.updateSnapshot ?? null}
                  onUpdateRangeSizeChange={setUpdateRangeSize}
                  onGenerateUpdates={() => void handleGenerateUpdateDrafts()}
                  onApplyUpdates={() => void handleApplyUpdates()}
                  onClearUpdateDrafts={() => {
                    setUpdateDrafts(null);
                    if (activeSession) {
                      void persistSession({ ...activeSession, protocolShadow: undefined, updatedAt: Date.now() });
                    }
                  }}
                  onRollbackUpdates={() => void handleRollbackUpdates()}
                />

                {activeSession ? (
                  <div className="rounded-xl border border-pink-100 bg-white p-4 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-sm font-semibold text-gray-800">
                      <span>Token 预算提示</span>
                      <span className="text-xs font-normal text-gray-500">
                        上下文 {tokenBudget.contextWindowTokens.toLocaleString()} · 预留{' '}
                        {tokenBudget.responseReserveTokens.toLocaleString()}
                      </span>
                    </div>

                    <TokenIndicator
                      text=""
                      estimatedTokens={tokenEstimate?.estimatedTokens ?? 0}
                      maxTokens={tokenBudget.historyBudgetTokens}
                      warnTokens={tokenBudget.warnTokens}
                      warningText="⚠️ 已接近上下文阈值，建议生成摘要或减少历史消息。"
                      className="!mt-1"
                    />

                    <div className="text-xs text-gray-500">
                      已计入 {tokenEstimate?.messageCount ?? 0} 条消息 / 上限 {tokenBudget.maxContextMessages} 条（估算值 ±20%）。
                    </div>

                    {tokenEstimate && tokenEstimate.messageCount > tokenBudget.maxContextMessages ? (
                      <div className="text-xs text-orange-600">⚠️ 消息条数超过上限，建议先生成摘要再继续对话。</div>
                    ) : null}
                  </div>
                ) : null}

                <div className="rounded-xl border border-pink-100 bg-white p-4">
                  <MagicTeaPartyChatTimeline
                    activeSession={activeSession}
                    preferences={preferences}
                    messages={messages}
                    isGenerating={isGenerating}
                    outputView={outputView}
                    onOutputViewChange={setOutputView}
                    tachieAssets={tachieAssets}
                    anchorMessageId={tachieAnchorMessageId}
                    editingMessageId={editingMessageId}
                    editingDraft={editingDraft}
                    onStopGenerating={stopGenerating}
                    onSelectChoice={(text) => void handleSendMessage(text)}
                    onUseAsReference={(target, plainText) => {
                      setTachieReferenceText(plainText);
                      setTachieAnchorMessageId(target.id);
                    }}
                    onRegenerate={(target) => void handleRegenerateMessage(target)}
                    onStartEdit={handleStartEditMessage}
                    onEditDraftChange={setEditingDraft}
                    onCancelEdit={handleCancelEditMessage}
                    onConfirmEdit={handleConfirmEditMessage}
                  />

                  <MagicTeaPartyChatComposer
                    activeSession={activeSession}
                    preferences={preferences}
                    draft={draft}
                    onDraftChange={setDraft}
                    onSend={(value) => {
                      if (!value.trim()) return;
                      void handleSendMessage(value).then((sent) => {
                        if (sent) setDraft('');
                      });
                    }}
                    onContinue={() => void handleContinueGeneration()}
                    onGenerateChoices={() => void handleGenerateChoices()}
                    isGenerating={isGenerating}
                    hasMessages={messages.length > 0}
                  />
                </div>

                {activeSession ? (
                  <MagicTeaPartyTachiePanel
                    preferences={preferences}
                    session={activeSession}
                    messages={messages}
                    referenceText={tachieReferenceText}
                    onReferenceTextChange={setTachieReferenceText}
                    anchorMessageId={tachieAnchorMessageId}
                    onAnchorMessageIdChange={setTachieAnchorMessageId}
                    onAssetsUpdated={setTachieAssets}
                  />
                ) : null}

                <Footer className="footer mt-4" />
              </main>
            </div>
          </div>
        </div>

        <MagicTeaPartyCardModals
          showRoleModal={showRoleModal}
          showScenarioModal={showScenarioModal}
          selectedRoleCardIds={selectedRoleCardIds}
          selectedScenarioCardIds={selectedScenarioCardIds}
          onCloseRoleModal={() => setShowRoleModal(false)}
          onCloseScenarioModal={() => setShowScenarioModal(false)}
          onToggleRoleCard={onToggleRoleCard}
          onToggleScenarioCard={onToggleScenarioCard}
        />
      </div>
    </>
  );
}
