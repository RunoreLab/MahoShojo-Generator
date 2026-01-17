import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { NextRouter } from 'next/router';

import type { UserAIProviderConfig } from '@/components/AiProviderSelector';
import { persistArrestedBackup } from '@/lib/arrested-backup';
import { getSensitiveWordRedirectTarget } from '@/lib/content-safety/client';
import { randomUUID } from '@/lib/crypto';
import { estimateMagicTeaPartyTokens, resolveMagicTeaPartyTokenBudget } from '@/lib/magic-tea-party/budget';
import {
  buildMagicTeaPartyHistory,
  estimateMagicTeaPartyHistoryTokens,
  trimMagicTeaPartyHistory,
} from '@/lib/magic-tea-party/history';
import { extractMagicTeaPartySideChannelsFromJsonl, parseMagicTeaPartyJsonl } from '@/lib/magic-tea-party/jsonl';
import { extractMagicTeaPartyNoticesFromMarkdown } from '@/lib/magic-tea-party/notice';
import { buildMagicTeaPartyMainPrompt, buildWorldbookText } from '@/lib/magic-tea-party/prompts';
import { getMagicTeaPartyPreset } from '@/lib/magic-tea-party/presets';
import { createMagicTeaPartyStreamPreview } from '@/lib/magic-tea-party/stream-preview';
import { createMagicTeaPartyStreamSafety } from '@/lib/magic-tea-party/stream-safety';
import { appendMagicTeaPartySystemInstruction } from '@/lib/magic-tea-party/system-instruction';
import { deleteMagicTeaPartyMessages, putMagicTeaPartyMessage } from '@/lib/magic-tea-party/storage';
import { deriveMagicTeaPartyTitle } from '@/lib/magic-tea-party/title';
import type {
  MagicTeaPartyHistoryMessage,
  MagicTeaPartyMessage,
  MagicTeaPartyNotice,
  MagicTeaPartyPreferences,
  MagicTeaPartyOutputSummary,
  MagicTeaPartySession,
  MagicTeaPartyUpdateDraft,
} from '@/lib/magic-tea-party/types';
import { applyShieldWords } from '@/lib/shield-word-filter';
import { readTextStreamFromResponse } from '@/lib/stream/read-text-stream';

type MagicTeaPartyOutputFormat = NonNullable<MagicTeaPartySession['settings']['outputFormat']>;

export type UseMagicTeaPartyChatOptions = {
  activeSession: MagicTeaPartySession | null;
  activeSessionId: string | null;
  messages: MagicTeaPartyMessage[];
  setMessages: Dispatch<SetStateAction<MagicTeaPartyMessage[]>>;
  persistSession: (session: MagicTeaPartySession) => Promise<void>;
  preferences: MagicTeaPartyPreferences;
  userProviderConfig: UserAIProviderConfig | null;
  onGlobalError?: (message: string | null) => void;
  onNotices?: (notices: MagicTeaPartyNotice[]) => void;
  onSideChannels?: (payload: {
    summary: MagicTeaPartyOutputSummary | null;
    updates: MagicTeaPartyUpdateDraft[] | null;
    updatesMeta: Record<string, unknown> | null;
    outputFormat: MagicTeaPartyOutputFormat;
    sourceMessageId: string;
  }) => void | Promise<void>;
  router: NextRouter;
};

export type UseMagicTeaPartyChatResult = {
  isGenerating: boolean;
  isSummarizing: boolean;
  summaryError: string | null;
  stopGenerating: () => void;
  sendMessage: (text: string) => Promise<boolean>;
  continueGeneration: () => Promise<void>;
  generateChoices: () => Promise<void>;
  regenerateMessage: (target: MagicTeaPartyMessage) => Promise<void>;
  generateSummary: () => Promise<void>;
  clearSummary: () => Promise<void>;
};

export function useMagicTeaPartyChat(options: UseMagicTeaPartyChatOptions): UseMagicTeaPartyChatResult {
  const {
    activeSession,
    activeSessionId,
    messages,
    setMessages,
    persistSession,
    preferences,
    userProviderConfig,
    onGlobalError,
    onNotices,
    onSideChannels,
    router,
  } = options;

  const [isGenerating, setIsGenerating] = useState(false);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const summarizeAbortControllerRef = useRef<AbortController | null>(null);
  const autoSummaryRunningRef = useRef(false);
  const messagesRef = useRef<MagicTeaPartyMessage[]>(messages);
  const dropTrackerRef = useRef<Record<string, { consecutive: number; lastRatio: number }>>({});

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    summarizeAbortControllerRef.current?.abort('session-switch');
    summarizeAbortControllerRef.current = null;
    setIsSummarizing(false);
    setSummaryError(null);
  }, [activeSessionId]);

  const stopGenerating = useCallback(() => {
    abortControllerRef.current?.abort('user');
  }, []);

  const ensureProviderReady = useCallback((): { ok: true } | { ok: false; message: string } => {
    if (!userProviderConfig) return { ok: false, message: '请先配置模型与 API Key。' };
    if (userProviderConfig.providerId === 'system') return { ok: false, message: '魔法茶会已禁用 system，请使用自备 Key。' };
    if (!userProviderConfig.apiKey?.trim()) return { ok: false, message: 'API Key 不能为空。' };
    if (!userProviderConfig.modelId?.trim()) return { ok: false, message: '请先选择模型。' };
    return { ok: true };
  }, [userProviderConfig]);

  const buildRequestSettings = useCallback(
    (session: MagicTeaPartySession) => ({
      ...session.settings,
      readArenaHistory:
        typeof session.settings.readArenaHistory === 'boolean' ? session.settings.readArenaHistory : preferences.readArenaHistory,
      readArenaHistoryLimit:
        typeof session.settings.readArenaHistoryLimit === 'number'
          ? session.settings.readArenaHistoryLimit
          : preferences.readArenaHistoryLimit,
      isArenaHistoryUnlimited:
        typeof session.settings.isArenaHistoryUnlimited === 'boolean'
          ? session.settings.isArenaHistoryUnlimited
          : preferences.isArenaHistoryUnlimited,
      readCurrentState:
        typeof session.settings.readCurrentState === 'boolean' ? session.settings.readCurrentState : preferences.readCurrentState,
      writeArenaHistory:
        typeof session.settings.writeArenaHistory === 'boolean' ? session.settings.writeArenaHistory : preferences.writeArenaHistory,
      writeCurrentState:
        typeof session.settings.writeCurrentState === 'boolean' ? session.settings.writeCurrentState : preferences.writeCurrentState,
      enableSummary:
        typeof session.settings.enableSummary === 'boolean' ? session.settings.enableSummary : preferences.enableSummary,
      outputPlan: session.settings.outputPlan ?? preferences.outputPlan,
      updateApplyMode: session.settings.updateApplyMode ?? preferences.updateApplyMode,
    }),
    [preferences]
  );

  const resolvePromptSettings = useCallback(
    (session: MagicTeaPartySession, outputFormatOverride?: MagicTeaPartyOutputFormat) => {
      const outputFormat =
        outputFormatOverride ?? ((session.settings.outputFormat ?? preferences.outputFormat) as MagicTeaPartyOutputFormat);
      const language = session.settings.language ?? preferences.language;
      const enableChoices =
        typeof session.settings.enableChoices === 'boolean' ? session.settings.enableChoices : preferences.enableChoices;
      const choiceCount = session.settings.choiceCount ?? preferences.choiceCount;
      const userDisplayName =
        typeof session.settings.userDisplayName === 'string' && session.settings.userDisplayName.trim()
          ? session.settings.userDisplayName.trim().slice(0, 20)
          : preferences.userDisplayName;

      return {
        ...buildRequestSettings(session),
        outputFormat,
        language,
        enableChoices,
        choiceCount,
        userDisplayName,
      };
    },
    [buildRequestSettings, preferences]
  );

  const buildHistoryForRequest = useCallback(
    (params: { session: MagicTeaPartySession; messages: MagicTeaPartyMessage[]; outputFormat?: MagicTeaPartyOutputFormat }) => {
      const outputFormat =
        params.outputFormat ??
        ((params.session.settings.outputFormat ?? preferences.outputFormat) as MagicTeaPartyOutputFormat);
      const promptSettings = resolvePromptSettings(params.session, outputFormat);
      const rawHistory = buildMagicTeaPartyHistory(params.messages, { includeEmptyContent: false });
      if (rawHistory.length === 0) {
        return {
          history: [],
          trimStats: { rawCount: 0, trimmedCount: 0, droppedCount: 0, droppedRatio: 0 },
        };
      }

      const providerId = userProviderConfig?.providerId ?? params.session.settings.providerId;
      const tokenBudget = resolveMagicTeaPartyTokenBudget(params.session.settings, providerId);
      const preset = getMagicTeaPartyPreset(params.session.settings.presetId ?? null);
      const worldbookText = preset ? buildWorldbookText(preset.worldbook) : '';
      const stylePrompt = preset ? preset.systemPrompt : '';

      const basePrompt = buildMagicTeaPartyMainPrompt({
        session: {
          playerRoleId: params.session.playerRoleId ?? null,
          summary: params.session.summary,
          protocolShadow: params.session.protocolShadow,
          settings: promptSettings,
        },
        roles: params.session.roles ?? [],
        scenario: params.session.scenario,
        auxScenarios: params.session.auxScenarios ?? [],
        worldbookText,
        messages: [],
        requestChoices: false,
        stylePrompt,
      });

      const baseTokens = estimateMagicTeaPartyTokens(basePrompt, providerId);
      const availableTokens = Math.max(0, tokenBudget.historyBudgetTokens - baseTokens);

      const trimmed = trimMagicTeaPartyHistory(rawHistory, {
        maxMessages: tokenBudget.maxContextMessages,
        tokenBudget: availableTokens,
        providerId,
        userDisplayName: promptSettings.userDisplayName,
        minKeep: 2,
      });
      const rawCount = rawHistory.length;
      const trimmedCount = trimmed.length;
      const droppedCount = Math.max(0, rawCount - trimmedCount);
      const droppedRatio = rawCount > 0 ? droppedCount / rawCount : 0;

      return {
        history: trimmed,
        trimStats: { rawCount, trimmedCount, droppedCount, droppedRatio },
      };
    },
    [preferences.outputFormat, resolvePromptSettings, userProviderConfig?.providerId]
  );

  const recordDropStats = useCallback((sessionId: string, droppedRatio: number) => {
    if (!sessionId) return;
    const prev = dropTrackerRef.current[sessionId];
    const overLimit = droppedRatio > 0.3;
    const consecutive = overLimit ? (prev?.consecutive ?? 0) + 1 : 0;
    dropTrackerRef.current[sessionId] = { consecutive, lastRatio: droppedRatio };
  }, []);

  const buildChoiceNotices = useCallback(
    (params: {
      choices: { id: string; text: string }[] | undefined;
      expectedCount?: number | null;
      enableChoices: boolean;
      stage: string;
    }): MagicTeaPartyNotice[] => {
      const { choices, expectedCount, enableChoices, stage } = params;
      if (!choices || choices.length === 0) return [];
      const notices: MagicTeaPartyNotice[] = [];
      if (!enableChoices) {
        notices.push({
          type: 'notice',
          level: 'warning',
          code: 'choices_forced',
          message: '协议要求选项已临时输出，可在设置中开启选项功能。',
          meta: { stage },
        });
      }
      if (typeof expectedCount === 'number' && Number.isFinite(expectedCount) && choices.length !== expectedCount) {
        notices.push({
          type: 'notice',
          level: 'info',
          code: 'choices_count_adjusted',
          message: `选项数量已调整为 ${choices.length} 条（原设置 ${expectedCount} 条）。`,
          meta: { stage },
        });
      }
      return notices;
    },
    []
  );

  const emitNotices = useCallback(
    (notices: MagicTeaPartyNotice[]) => {
      if (!onNotices || notices.length === 0) return;
      const sanitized = notices.map((notice) => ({
        ...notice,
        message: applyShieldWords(notice.message).filteredText,
      }));
      onNotices(sanitized);
    },
    [onNotices]
  );

  const runGenerateStream = useCallback(
    async (params: {
      session: MagicTeaPartySession;
      historyForRequest: MagicTeaPartyHistoryMessage[];
      outputFormat: MagicTeaPartyOutputFormat;
      assistantMessageId: string;
      assistantMessage: MagicTeaPartyMessage;
      arrestedBackupInput?: string;
    }): Promise<MagicTeaPartySession | null> => {
      let finalSession: MagicTeaPartySession | null = null;
      const controller = new AbortController();
      abortControllerRef.current = controller;
      setIsGenerating(true);

      const preview = createMagicTeaPartyStreamPreview({
        outputFormat: params.outputFormat,
        onUpdate: (update) => {
          setMessages((prev) =>
            prev.map((m) => {
              if (m.id !== params.assistantMessageId) return m;
              const patch: Partial<MagicTeaPartyMessage> = {
                content: update.content,
                ...(typeof update.status === 'string' ? { status: update.status } : {}),
                ...(update.includeJsonl ? { segments: update.segments, choices: update.choices } : {}),
              };
              return { ...m, ...patch };
            })
          );
        },
      });

      const safety = createMagicTeaPartyStreamSafety({
        outputFormat: params.outputFormat,
        onSafePreview: (safeText) => {
          preview.applySafeText(safeText);
        },
        onBlocked: (safeText) => {
          preview.applySafeText(safeText, 'blocked');
          controller.abort('output-safety');
        },
      });

      try {
        const response = await fetch('/api/magic-tea-party/generate-stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            sessionId: params.session.id,
            summary: params.session.summary,
            messages: params.historyForRequest,
            roles: params.session.roles ?? [],
            scenario: params.session.scenario ?? null,
            auxScenarios: params.session.auxScenarios ?? [],
            protocolShadow: params.session.protocolShadow,
            playerRoleId: params.session.playerRoleId ?? null,
            settings: {
              ...buildRequestSettings(params.session),
              providerId: userProviderConfig?.providerId,
              modelId: userProviderConfig?.modelId,
              userDisplayName: params.session.settings.userDisplayName,
            },
            customProvider: {
              providerId: userProviderConfig?.providerId,
              modelId: userProviderConfig?.modelId,
              apiKey: userProviderConfig?.apiKey,
            },
          }),
        });

        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          const shouldRedirect = Boolean(payload?.shouldRedirect);
          if (shouldRedirect) {
            const reason = typeof payload?.reason === 'string' ? payload.reason : '使用危险符文';

            if (params.arrestedBackupInput) {
              persistArrestedBackup({
                triggerSource: 'input',
                reason,
                origin: '/magic-tea-party',
                items: [
                  {
                    label: '魔法茶会输入',
                    filename: 'magic-tea-party-input.txt',
                    mimeType: 'text/plain',
                    content: params.arrestedBackupInput,
                  },
                ],
              });
            }

            const blockedMessage: MagicTeaPartyMessage = {
              ...params.assistantMessage,
              status: 'blocked',
              safety: { status: 'blocked', blockedBy: 'server', blockedAt: Date.now(), action: 'redirect' },
              error: { code: `${response.status}`, message: reason },
            };

            setMessages((prev) => prev.map((m) => (m.id === params.assistantMessageId ? blockedMessage : m)));
            await putMagicTeaPartyMessage(blockedMessage);

            await router.push('/arrested');
            return finalSession;
          }

          const errorMessage =
            typeof payload?.error === 'string'
              ? payload.error
              : typeof payload?.message === 'string'
                ? payload.message
                : `请求失败（${response.status}）`;

          const errorMessageRecord: MagicTeaPartyMessage = {
            ...params.assistantMessage,
            status: 'error',
            error: { code: `${response.status}`, message: errorMessage },
          };

          setMessages((prev) => prev.map((m) => (m.id === params.assistantMessageId ? errorMessageRecord : m)));
          await putMagicTeaPartyMessage(errorMessageRecord);
          return finalSession;
        }

        setMessages((prev) => prev.map((m) => (m.id === params.assistantMessageId ? { ...m, content: '', status: 'streaming' } : m)));

        const streamedText = await readTextStreamFromResponse(response, {
          label: '魔法茶会',
          onText: (accumulated) => {
            safety.ingest(accumulated);
          },
        });

        const { safeText, status, blockedAt, truncatedAt } = await safety.finalize(streamedText);

        const isJsonl = params.outputFormat === 'jsonl';
        const parsed = isJsonl
          ? parseMagicTeaPartyJsonl(safeText)
          : { segments: undefined, choices: null, notices: [], summary: null, updates: null, updatesMeta: null };
        const sideChannelBundle = isJsonl
          ? extractMagicTeaPartySideChannelsFromJsonl(safeText)
          : { cleanedText: safeText, notices: [], summary: null, updates: null, updatesMeta: null };
        const noticeBundle = isJsonl ? sideChannelBundle : extractMagicTeaPartyNoticesFromMarkdown(safeText);
        const promptSettings = resolvePromptSettings(params.session, params.outputFormat);
        const extraNotices = isJsonl
          ? buildChoiceNotices({
              choices: parsed.choices ?? undefined,
              expectedCount: promptSettings.enableChoices ? promptSettings.choiceCount : undefined,
              enableChoices: promptSettings.enableChoices,
              stage: String(params.assistantMessage.meta?.kind ?? 'narration'),
            })
          : [];
        const allNotices = [...noticeBundle.notices, ...extraNotices];
        emitNotices(allNotices);

        const hasErrorNotice = allNotices.some((notice) => notice.level === 'error');
        const finalContent = hasErrorNotice ? '' : (noticeBundle.cleanedText ?? '');
        const finalAssistant: MagicTeaPartyMessage = {
          ...params.assistantMessage,
          content: finalContent,
          status,
          ...(isJsonl && parsed.segments && !hasErrorNotice ? { segments: parsed.segments, choices: parsed.choices ?? undefined } : {}),
          ...(hasErrorNotice ? { meta: { ...(params.assistantMessage.meta ?? {}), noticeSuppressed: true } } : {}),
          ...(status === 'blocked'
            ? { safety: { status: 'blocked', blockedBy: 'output', blockedAt: blockedAt ?? Date.now(), action: 'soft-block' } }
            : { safety: { status: 'ok' } }),
          ...(status === 'blocked' && typeof truncatedAt === 'number' ? { truncatedAt } : {}),
        };

        setMessages((prev) => prev.map((m) => (m.id === params.assistantMessageId ? finalAssistant : m)));
        await putMagicTeaPartyMessage(finalAssistant);

        const shouldAutoTitle = !params.session.titleMeta || params.session.titleMeta.source === 'auto';
        const hasChoices = Boolean(parsed.choices && parsed.choices.length > 0 && !hasErrorNotice);
        if (shouldAutoTitle && !hasErrorNotice && (params.session.title === '新会话' || params.session.title === '未命名会话')) {
          const nextTitle = deriveMagicTeaPartyTitle({
            outputFormat: params.outputFormat,
            content: finalContent,
            segments: isJsonl ? parsed.segments : undefined,
            scenarioTitle: params.session.scenario?.title,
            roleNames: (params.session.roles ?? []).map((r) => r.name),
          });
          const titleFiltered = applyShieldWords(nextTitle).filteredText;

          const nextSession: MagicTeaPartySession = {
            ...params.session,
            title: titleFiltered,
            ...(hasChoices ? { lastChoices: parsed.choices ?? undefined } : {}),
            titleMeta: {
              source: 'auto',
              generatedAt: Date.now(),
              providerId: userProviderConfig?.providerId,
              modelId: userProviderConfig?.modelId,
              reason: 'first-message',
            },
          };
          await persistSession(nextSession);
          finalSession = nextSession;
        } else {
          const nextSession: MagicTeaPartySession = {
            ...params.session,
            ...(hasChoices ? { lastChoices: parsed.choices ?? undefined } : {}),
            updatedAt: Date.now(),
          };
          await persistSession(nextSession);
          finalSession = nextSession;
        }

        if (onSideChannels && isJsonl && !hasErrorNotice && status !== 'blocked') {
          const summary = sideChannelBundle.summary ?? null;
          const updates = sideChannelBundle.updates ?? null;
          const updatesMeta = sideChannelBundle.updatesMeta ?? null;
          if (summary || updates) {
            await onSideChannels({
              summary,
              updates,
              updatesMeta,
              outputFormat: params.outputFormat,
              sourceMessageId: params.assistantMessageId,
            });
          }
        }
      } catch (error) {
        safety.clearTimer();
        if (error instanceof Error && error.name === 'AbortError') {
          const { safeText, status, blockedAt, truncatedAt } = await safety.finalizeAfterAbort(controller.signal.reason);
          const isJsonl = params.outputFormat === 'jsonl';
          const parsed = isJsonl
            ? parseMagicTeaPartyJsonl(safeText)
            : { segments: undefined, choices: null, notices: [], summary: null, updates: null, updatesMeta: null };
          const sideChannelBundle = isJsonl
            ? extractMagicTeaPartySideChannelsFromJsonl(safeText)
            : { cleanedText: safeText, notices: [], summary: null, updates: null, updatesMeta: null };
          const noticeBundle = isJsonl ? sideChannelBundle : extractMagicTeaPartyNoticesFromMarkdown(safeText);
          const promptSettings = resolvePromptSettings(params.session, params.outputFormat);
          const extraNotices = isJsonl
            ? buildChoiceNotices({
                choices: parsed.choices ?? undefined,
                expectedCount: promptSettings.enableChoices ? promptSettings.choiceCount : undefined,
                enableChoices: promptSettings.enableChoices,
                stage: String(params.assistantMessage.meta?.kind ?? 'narration'),
              })
            : [];
          const allNotices = [...noticeBundle.notices, ...extraNotices];
          emitNotices(allNotices);

          const hasErrorNotice = allNotices.some((notice) => notice.level === 'error');
          const finalContent = hasErrorNotice ? '' : (noticeBundle.cleanedText ?? '');
          const finalAssistant: MagicTeaPartyMessage = {
            ...params.assistantMessage,
            content: finalContent,
            status,
            ...(isJsonl && parsed.segments && !hasErrorNotice ? { segments: parsed.segments, choices: parsed.choices ?? undefined } : {}),
            ...(hasErrorNotice ? { meta: { ...(params.assistantMessage.meta ?? {}), noticeSuppressed: true } } : {}),
            ...(status === 'blocked'
              ? { safety: { status: 'blocked', blockedBy: 'output', blockedAt: blockedAt ?? Date.now(), action: 'soft-block' } }
              : { safety: { status: 'ok' } }),
            ...(status === 'blocked' && typeof truncatedAt === 'number' ? { truncatedAt } : {}),
          };
          setMessages((prev) => prev.map((m) => (m.id === params.assistantMessageId ? finalAssistant : m)));
          await putMagicTeaPartyMessage(finalAssistant);
          if (onSideChannels && isJsonl && !hasErrorNotice && status !== 'blocked') {
            const summary = sideChannelBundle.summary ?? null;
            const updates = sideChannelBundle.updates ?? null;
            const updatesMeta = sideChannelBundle.updatesMeta ?? null;
            if (summary || updates) {
              await onSideChannels({
                summary,
                updates,
                updatesMeta,
                outputFormat: params.outputFormat,
                sourceMessageId: params.assistantMessageId,
              });
            }
          }
          return finalSession;
        }

        const message = error instanceof Error ? error.message : '生成失败';
        const errorRecord: MagicTeaPartyMessage = { ...params.assistantMessage, status: 'error', error: { code: 'exception', message } };
        setMessages((prev) => prev.map((m) => (m.id === params.assistantMessageId ? errorRecord : m)));
        await putMagicTeaPartyMessage(errorRecord);
      } finally {
        abortControllerRef.current = null;
        setIsGenerating(false);
      }
      return finalSession;
    },
    [
      buildChoiceNotices,
      buildRequestSettings,
      emitNotices,
      onSideChannels,
      persistSession,
      resolvePromptSettings,
      router,
      setMessages,
      userProviderConfig,
    ]
  );

  const maybeAutoSummarize = useCallback(
    async (session: MagicTeaPartySession) => {
      if (!session) return;
      const enableSummary =
        typeof session.settings.enableSummary === 'boolean' ? session.settings.enableSummary : preferences.enableSummary;
      if (!enableSummary) return;
      if (autoSummaryRunningRef.current || isSummarizing) return;

      const providerId = userProviderConfig?.providerId ?? session.settings.providerId;
      const providerReady =
        userProviderConfig &&
        userProviderConfig.providerId !== 'system' &&
        userProviderConfig.apiKey?.trim() &&
        userProviderConfig.modelId?.trim();
      if (!providerReady) return;

      const history = buildMagicTeaPartyHistory(messagesRef.current, { includeEmptyContent: false });
      if (history.length === 0) return;

      const tokenBudget = resolveMagicTeaPartyTokenBudget(session.settings, providerId);
      const userDisplayName = session.settings.userDisplayName ?? preferences.userDisplayName;
      const historyTokens = estimateMagicTeaPartyHistoryTokens(history, { providerId, userDisplayName });

      const triggerByTokens = historyTokens > tokenBudget.historyBudgetTokens * tokenBudget.summaryTriggerRatio;
      const triggerByCount = history.length > tokenBudget.maxContextMessages;
      const dropStats = dropTrackerRef.current[session.id];
      const triggerByDropRatio = (dropStats?.consecutive ?? 0) >= 2;
      if (!triggerByTokens && !triggerByCount && !triggerByDropRatio) return;

      const summaryGap = tokenBudget.summaryMinGapMessages;
      if (session.summaryMeta?.toMessageId) {
        const summaryIndex = history.findIndex((message) => message.id === session.summaryMeta?.toMessageId);
        if (summaryIndex >= 0) {
          const gap = history.length - summaryIndex - 1;
          if (gap < summaryGap) return;
        }
      } else if (history.length < summaryGap) {
        return;
      }

      const keepRatio = 0.35;
      const keepCount = Math.max(2, Math.ceil(history.length * keepRatio));
      if (history.length <= keepCount) return;

      const summarizedHistory = history.slice(0, history.length - keepCount);
      if (summarizedHistory.length < 2) return;

      autoSummaryRunningRef.current = true;
      setIsSummarizing(true);
      setSummaryError(null);

      const MAX_SUMMARY_MESSAGES = 200;
      const MAX_MESSAGE_CHARS = 8_000;
      const summarySeed = session.summary?.trim() || '';

      const normalizedHistory = summarizedHistory.map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content.slice(0, MAX_MESSAGE_CHARS),
      }));

      const withSeed = summarySeed
        ? [
            {
              id: randomUUID(),
              role: 'system' as const,
              content: `【既有摘要】\n${summarySeed.slice(0, 12_000)}`,
            },
            ...normalizedHistory,
          ]
        : normalizedHistory;

      let summaryMessages = withSeed;
      if (summaryMessages.length > MAX_SUMMARY_MESSAGES) {
        const headCount = Math.max(1, Math.floor(MAX_SUMMARY_MESSAGES * 0.7));
        const tailCount = MAX_SUMMARY_MESSAGES - headCount;
        summaryMessages = [...withSeed.slice(0, headCount), ...withSeed.slice(-tailCount)];
      }

      const controller = new AbortController();
      summarizeAbortControllerRef.current = controller;

      try {
        const response = await fetch('/api/magic-tea-party/summarize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            sessionId: session.id,
            mode: 'summary',
            language: session.settings.language ?? preferences.language,
            userDisplayName,
            messages: summaryMessages,
            customProvider: {
              providerId: userProviderConfig?.providerId,
              modelId: userProviderConfig?.modelId,
              apiKey: userProviderConfig?.apiKey,
            },
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
          setSummaryError(errorMessage);
          return;
        }

        const summaryRaw = typeof payload?.summary === 'string' ? payload.summary.trim() : '';
        if (!summaryRaw) {
          setSummaryError('模型返回空摘要。');
          return;
        }

        if (activeSessionId !== session.id) return;

        const now = Date.now();
        const safeText = applyShieldWords(summaryRaw).filteredText;
        const summaryMeta: MagicTeaPartySession['summaryMeta'] = {
          updatedAt: now,
          fromMessageId: summarizedHistory[0]?.id,
          toMessageId: summarizedHistory[summarizedHistory.length - 1]?.id,
          tokenCount: estimateMagicTeaPartyHistoryTokens(summarizedHistory, { providerId, userDisplayName }),
        };

        const nextSession: MagicTeaPartySession = { ...session, summary: safeText, summaryMeta, updatedAt: now };
        await persistSession(nextSession);
        dropTrackerRef.current[session.id] = { consecutive: 0, lastRatio: 0 };

        const latestMessages = messagesRef.current;
        const cutoffId = summarizedHistory[summarizedHistory.length - 1]?.id;
        if (!cutoffId) return;
        const cutoffIndex = latestMessages.findIndex((message) => message.id === cutoffId);
        if (cutoffIndex < 0) return;

        const removed = latestMessages.slice(0, cutoffIndex + 1);
        const remaining = latestMessages.slice(cutoffIndex + 1);
        if (removed.length > 0) {
          setMessages(remaining);
          await deleteMagicTeaPartyMessages(removed.map((message) => message.id));
        }
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') return;
        const message = error instanceof Error ? error.message : '自动摘要失败';
        setSummaryError(message);
      } finally {
        if (summarizeAbortControllerRef.current === controller) {
          summarizeAbortControllerRef.current = null;
        }
        autoSummaryRunningRef.current = false;
        setIsSummarizing(false);
      }
    },
    [
      activeSessionId,
      isSummarizing,
      persistSession,
      preferences.enableSummary,
      preferences.language,
      preferences.userDisplayName,
      setMessages,
      userProviderConfig,
    ]
  );

  const sendMessage = useCallback(
    async (text: string) => {
      if (!activeSession) return false;
      if (isGenerating) return false;
      const trimmed = text.trim();
      if (!trimmed) return false;

      const providerCheck = ensureProviderReady();
      if (!providerCheck.ok) {
        onGlobalError?.(providerCheck.message);
        return false;
      }

      onGlobalError?.(null);

      const redirectTarget = await getSensitiveWordRedirectTarget(trimmed, { reason: '使用危险符文' });
      if (redirectTarget) {
        persistArrestedBackup({
          triggerSource: 'input',
          reason: '使用危险符文',
          origin: '/magic-tea-party',
          items: [
            {
              label: '魔法茶会输入',
              filename: 'magic-tea-party-input.txt',
              mimeType: 'text/plain',
              content: trimmed,
            },
          ],
        });
        await router.push(redirectTarget as any);
        return false;
      }

      const now = Date.now();
      const sessionOutputFormat = (activeSession.settings.outputFormat ?? 'jsonl') as MagicTeaPartyOutputFormat;
      const playerRoleIdAtSend = activeSession.playerRoleId ?? null;
      const userDisplayNameAtSend =
        (activeSession.settings.userDisplayName || preferences.userDisplayName || '旅人').trim() || '旅人';
      const playerRoleNameAtSend = playerRoleIdAtSend
        ? (activeSession.roles ?? []).find((role) => role.id === playerRoleIdAtSend)?.name ?? ''
        : '';
      const userMessage: MagicTeaPartyMessage = {
        id: randomUUID(),
        sessionId: activeSession.id,
        role: 'user',
        content: trimmed,
        createdAt: now,
        status: 'done',
        ...(playerRoleIdAtSend ? { speakerId: playerRoleIdAtSend } : {}),
        meta: { speakerName: playerRoleIdAtSend ? playerRoleNameAtSend || playerRoleIdAtSend : userDisplayNameAtSend },
      };

      const assistantMessageId = randomUUID();
      const assistantMessage: MagicTeaPartyMessage = {
        id: assistantMessageId,
        sessionId: activeSession.id,
        role: 'assistant',
        content: '',
        createdAt: now + 1,
        status: 'streaming',
        sourceMessageId: userMessage.id,
        meta: { kind: 'reply', outputFormat: sessionOutputFormat },
      };

      const nextMessages = [...messages, userMessage, assistantMessage];
      setMessages(nextMessages);

      await putMagicTeaPartyMessage(userMessage);
      await putMagicTeaPartyMessage(assistantMessage);

      const updatedSession: MagicTeaPartySession = { ...activeSession, updatedAt: now };
      await persistSession(updatedSession);

      const { history: historyForRequest, trimStats } = buildHistoryForRequest({
        session: updatedSession,
        messages: [...messages, userMessage],
        outputFormat: sessionOutputFormat,
      });
      recordDropStats(updatedSession.id, trimStats.droppedRatio);

      const finalSession = await runGenerateStream({
        session: updatedSession,
        historyForRequest,
        outputFormat: sessionOutputFormat,
        assistantMessageId,
        assistantMessage,
        arrestedBackupInput: trimmed,
      });
      if (finalSession) void maybeAutoSummarize(finalSession);
      return true;
    },
    [
      activeSession,
      buildHistoryForRequest,
      ensureProviderReady,
      isGenerating,
      messages,
      onGlobalError,
      preferences.userDisplayName,
      persistSession,
      router,
      runGenerateStream,
      setMessages,
      maybeAutoSummarize,
      recordDropStats,
    ]
  );

  const continueGeneration = useCallback(async () => {
    if (!activeSession) return;
    if (isGenerating) return;

    const providerCheck = ensureProviderReady();
    if (!providerCheck.ok) {
      onGlobalError?.(providerCheck.message);
      return;
    }

    onGlobalError?.(null);

    const now = Date.now();
    const sessionOutputFormat = (activeSession.settings.outputFormat ?? 'jsonl') as MagicTeaPartyOutputFormat;

    const assistantMessageId = randomUUID();
    const lastUserMessageId = [...messages].reverse().find((message) => message.role === 'user')?.id;
    const kind = messages.length === 0 ? 'opening' : 'continue';

    const assistantMessage: MagicTeaPartyMessage = {
      id: assistantMessageId,
      sessionId: activeSession.id,
      role: 'assistant',
      content: '',
      createdAt: now,
      status: 'streaming',
      ...(lastUserMessageId ? { sourceMessageId: lastUserMessageId } : {}),
      meta: { kind, outputFormat: sessionOutputFormat },
    };

    const nextMessages = [...messages, assistantMessage];
    setMessages(nextMessages);
    await putMagicTeaPartyMessage(assistantMessage);

    const updatedSession: MagicTeaPartySession = { ...activeSession, updatedAt: now };
    await persistSession(updatedSession);

    const { history: baseHistory, trimStats } = buildHistoryForRequest({
      session: updatedSession,
      messages,
      outputFormat: sessionOutputFormat,
    });
    recordDropStats(updatedSession.id, trimStats.droppedRatio);

    const finalSession = await runGenerateStream({
      session: updatedSession,
      historyForRequest: appendMagicTeaPartySystemInstruction(baseHistory, kind, randomUUID()),
      outputFormat: sessionOutputFormat,
      assistantMessageId,
      assistantMessage,
    });
    if (finalSession) void maybeAutoSummarize(finalSession);
  }, [
    activeSession,
    buildHistoryForRequest,
    ensureProviderReady,
    isGenerating,
    messages,
    onGlobalError,
    persistSession,
    runGenerateStream,
    setMessages,
    maybeAutoSummarize,
    recordDropStats,
  ]);

  const generateChoices = useCallback(async () => {
    if (!activeSession) return;
    if (isGenerating) return;

    const providerCheck = ensureProviderReady();
    if (!providerCheck.ok) {
      onGlobalError?.(providerCheck.message);
      return;
    }

    onGlobalError?.(null);

    const now = Date.now();
    const assistantMessageId = randomUUID();
    const lastUserMessageId = [...messages].reverse().find((message) => message.role === 'user')?.id;
    const assistantMessage: MagicTeaPartyMessage = {
      id: assistantMessageId,
      sessionId: activeSession.id,
      role: 'assistant',
      content: '',
      createdAt: now,
      status: 'streaming',
      ...(lastUserMessageId ? { sourceMessageId: lastUserMessageId } : {}),
      meta: { kind: 'choices', outputFormat: 'jsonl' },
    };

    const nextMessages = [...messages, assistantMessage];
    setMessages(nextMessages);
    await putMagicTeaPartyMessage(assistantMessage);

    const updatedSession: MagicTeaPartySession = { ...activeSession, updatedAt: now };
    await persistSession(updatedSession);

    const { history: historyForRequest } = buildHistoryForRequest({
      session: updatedSession,
      messages,
      outputFormat: 'jsonl',
    });

    const controller = new AbortController();
    abortControllerRef.current = controller;
    setIsGenerating(true);

    const preview = createMagicTeaPartyStreamPreview({
      outputFormat: 'jsonl',
      onUpdate: (update) => {
        setMessages((prev) =>
          prev.map((m) => {
            if (m.id !== assistantMessageId) return m;
            const patch: Partial<MagicTeaPartyMessage> = {
              content: update.content,
              ...(typeof update.status === 'string' ? { status: update.status } : {}),
              ...(update.includeJsonl ? { segments: update.segments, choices: update.choices } : {}),
            };
            return { ...m, ...patch };
          })
        );
      },
    });
    const safety = createMagicTeaPartyStreamSafety({
      outputFormat: 'jsonl',
      onSafePreview: (safeText) => {
        preview.applySafeText(safeText);
      },
      onBlocked: (safeText) => {
        preview.applySafeText(safeText, 'blocked');
        controller.abort('output-safety');
      },
    });
    try {
      const response = await fetch('/api/magic-tea-party/generate-choices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          sessionId: activeSession.id,
          summary: activeSession.summary,
          messages: historyForRequest,
          roles: activeSession.roles ?? [],
          scenario: activeSession.scenario ?? null,
          auxScenarios: activeSession.auxScenarios ?? [],
          protocolShadow: activeSession.protocolShadow,
          playerRoleId: activeSession.playerRoleId ?? null,
          settings: {
            ...buildRequestSettings(activeSession),
            providerId: userProviderConfig?.providerId,
            modelId: userProviderConfig?.modelId,
            choiceCount: activeSession.settings.choiceCount ?? preferences.choiceCount,
            userDisplayName: activeSession.settings.userDisplayName,
          },
          customProvider: {
            providerId: userProviderConfig?.providerId,
            modelId: userProviderConfig?.modelId,
            apiKey: userProviderConfig?.apiKey,
          },
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        const shouldRedirect = Boolean(payload?.shouldRedirect);
        if (shouldRedirect) {
          const reason = typeof payload?.reason === 'string' ? payload.reason : '使用危险符文';
          const blockedMessage: MagicTeaPartyMessage = {
            ...assistantMessage,
            status: 'blocked',
            safety: { status: 'blocked', blockedBy: 'server', blockedAt: Date.now(), action: 'redirect' },
            error: { code: `${response.status}`, message: reason },
          };
          setMessages((prev) => prev.map((m) => (m.id === assistantMessageId ? blockedMessage : m)));
          await putMagicTeaPartyMessage(blockedMessage);
          await router.push('/arrested');
          return;
        }

        const errorMessage =
          typeof payload?.error === 'string'
            ? payload.error
            : typeof payload?.message === 'string'
              ? payload.message
              : `请求失败（${response.status}）`;

        setMessages((prev) =>
          prev.map((m) => (m.id === assistantMessageId ? { ...m, status: 'error', error: { code: `${response.status}`, message: errorMessage } } : m))
        );
        await putMagicTeaPartyMessage({
          ...assistantMessage,
          status: 'error',
          error: { code: `${response.status}`, message: errorMessage },
        });
        return;
      }

      const streamedText = await readTextStreamFromResponse(response, {
        label: '魔法茶会选项',
        onText: (accumulated) => {
          safety.ingest(accumulated);
        },
      });

      const { safeText, status, blockedAt, truncatedAt } = await safety.finalize(streamedText);

      const parsed = parseMagicTeaPartyJsonl(safeText);
      const sideChannelBundle = extractMagicTeaPartySideChannelsFromJsonl(safeText);
      const expectedCount = activeSession.settings.choiceCount ?? preferences.choiceCount;
      const extraNotices = buildChoiceNotices({
        choices: parsed.choices ?? undefined,
        expectedCount,
        enableChoices: true,
        stage: 'choices',
      });
      const allNotices = [...sideChannelBundle.notices, ...extraNotices];
      emitNotices(allNotices);
      const hasErrorNotice = allNotices.some((notice) => notice.level === 'error');
      const finalAssistant: MagicTeaPartyMessage = {
        ...assistantMessage,
        content: hasErrorNotice ? '' : sideChannelBundle.cleanedText,
        status,
        ...(parsed.segments && !hasErrorNotice ? { segments: parsed.segments, choices: parsed.choices ?? undefined } : {}),
        ...(hasErrorNotice ? { meta: { ...(assistantMessage.meta ?? {}), noticeSuppressed: true } } : {}),
        ...(status === 'blocked'
          ? { safety: { status: 'blocked', blockedBy: 'output', blockedAt: blockedAt ?? Date.now(), action: 'soft-block' } }
          : { safety: { status: 'ok' } }),
        ...(status === 'blocked' && typeof truncatedAt === 'number' ? { truncatedAt } : {}),
      };

      setMessages((prev) => prev.map((m) => (m.id === assistantMessageId ? finalAssistant : m)));
      await putMagicTeaPartyMessage(finalAssistant);
      await persistSession({
        ...updatedSession,
        ...(parsed.choices && parsed.choices.length > 0 && !hasErrorNotice ? { lastChoices: parsed.choices } : {}),
        updatedAt: Date.now(),
      });
    } catch (error) {
      safety.clearTimer();
      if (error instanceof Error && error.name === 'AbortError') {
        const { safeText, status, blockedAt, truncatedAt } = await safety.finalizeAfterAbort(controller.signal.reason);
        const parsed = parseMagicTeaPartyJsonl(safeText);
        const sideChannelBundle = extractMagicTeaPartySideChannelsFromJsonl(safeText);
        const expectedCount = activeSession.settings.choiceCount ?? preferences.choiceCount;
        const extraNotices = buildChoiceNotices({
          choices: parsed.choices ?? undefined,
          expectedCount,
          enableChoices: true,
          stage: 'choices',
        });
        const allNotices = [...sideChannelBundle.notices, ...extraNotices];
        emitNotices(allNotices);
        const hasErrorNotice = allNotices.some((notice) => notice.level === 'error');
        const finalAssistant: MagicTeaPartyMessage = {
          ...assistantMessage,
          content: hasErrorNotice ? '' : sideChannelBundle.cleanedText,
          status,
          ...(parsed.segments && !hasErrorNotice ? { segments: parsed.segments, choices: parsed.choices ?? undefined } : {}),
          ...(hasErrorNotice ? { meta: { ...(assistantMessage.meta ?? {}), noticeSuppressed: true } } : {}),
          ...(status === 'blocked'
            ? { safety: { status: 'blocked', blockedBy: 'output', blockedAt: blockedAt ?? Date.now(), action: 'soft-block' } }
            : { safety: { status: 'ok' } }),
          ...(status === 'blocked' && typeof truncatedAt === 'number' ? { truncatedAt } : {}),
        };
        setMessages((prev) => prev.map((m) => (m.id === assistantMessageId ? finalAssistant : m)));
        await putMagicTeaPartyMessage(finalAssistant);
        return;
      }

      const message = error instanceof Error ? error.message : '生成失败';
      setMessages((prev) =>
        prev.map((m) => (m.id === assistantMessageId ? { ...m, status: 'error', error: { code: 'exception', message } } : m))
      );
      await putMagicTeaPartyMessage({ ...assistantMessage, status: 'error', error: { code: 'exception', message } });
    } finally {
      abortControllerRef.current = null;
      setIsGenerating(false);
    }
  }, [
    activeSession,
    buildChoiceNotices,
    buildHistoryForRequest,
    buildRequestSettings,
    emitNotices,
    ensureProviderReady,
    isGenerating,
    messages,
    onGlobalError,
    persistSession,
    preferences.choiceCount,
    router,
    setMessages,
    userProviderConfig,
  ]);

  const clearSummary = useCallback(async () => {
    if (!activeSession) return;
    setSummaryError(null);
    const now = Date.now();
    await persistSession({ ...activeSession, summary: undefined, summaryMeta: undefined, updatedAt: now });
  }, [activeSession, persistSession]);

  const generateSummary = useCallback(async () => {
    if (!activeSession) return;
    if (isGenerating || isSummarizing) return;

    const providerCheck = ensureProviderReady();
    if (!providerCheck.ok) {
      onGlobalError?.(providerCheck.message);
      return;
    }

    if (!userProviderConfig) {
      onGlobalError?.('请先配置模型与 API Key。');
      return;
    }

    onGlobalError?.(null);
    setSummaryError(null);

    const historyForRequest = buildMagicTeaPartyHistory(messages, { includeEmptyContent: false });

    if (historyForRequest.length === 0) {
      setSummaryError('还没有可用于摘要的对话。');
      return;
    }

    const controller = new AbortController();
    summarizeAbortControllerRef.current = controller;
    setIsSummarizing(true);

    try {
      const response = await fetch('/api/magic-tea-party/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          sessionId: activeSession.id,
          mode: 'summary',
          language: activeSession.settings.language ?? preferences.language,
          userDisplayName: activeSession.settings.userDisplayName ?? preferences.userDisplayName,
          messages: historyForRequest,
          customProvider: {
            providerId: userProviderConfig.providerId,
            modelId: userProviderConfig.modelId,
            apiKey: userProviderConfig.apiKey,
          },
        }),
      });

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        const shouldRedirect = Boolean(payload?.shouldRedirect);
        const reason = typeof payload?.reason === 'string' ? payload.reason : '';
        const errorMessage =
          typeof payload?.error === 'string'
            ? payload.error
            : typeof payload?.message === 'string'
              ? payload.message
              : `请求失败（${response.status}）`;
        setSummaryError((shouldRedirect ? reason : errorMessage) || errorMessage);
        return;
      }

      const summaryRaw = typeof payload?.summary === 'string' ? payload.summary.trim() : '';
      if (!summaryRaw) {
        setSummaryError('模型返回空摘要。');
        return;
      }

      const now = Date.now();
      const safeText = applyShieldWords(summaryRaw).filteredText;
      const summaryMeta: MagicTeaPartySession['summaryMeta'] = {
        updatedAt: now,
        fromMessageId: historyForRequest[0]?.id,
        toMessageId: historyForRequest[historyForRequest.length - 1]?.id,
      };

      const nextSession: MagicTeaPartySession = { ...activeSession, summary: safeText, summaryMeta, updatedAt: now };
      await persistSession(nextSession);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      const message = error instanceof Error ? error.message : '生成摘要失败';
      setSummaryError(message);
    } finally {
      if (summarizeAbortControllerRef.current === controller) {
        summarizeAbortControllerRef.current = null;
      }
      setIsSummarizing(false);
    }
  }, [
    activeSession,
    ensureProviderReady,
    isGenerating,
    isSummarizing,
    messages,
    onGlobalError,
    persistSession,
    preferences.language,
    preferences.userDisplayName,
    userProviderConfig,
  ]);

  const regenerateMessage = useCallback(
    async (targetMessage: MagicTeaPartyMessage) => {
      if (!activeSession) return;
      if (isGenerating) return;
      if (targetMessage.role !== 'assistant') return;

      const providerCheck = ensureProviderReady();
      if (!providerCheck.ok) {
        onGlobalError?.(providerCheck.message);
        return;
      }

      onGlobalError?.(null);

      const meta = targetMessage.meta && typeof targetMessage.meta === 'object' ? (targetMessage.meta as Record<string, unknown>) : null;
      const kindRaw = typeof meta?.kind === 'string' ? String(meta.kind) : 'reply';
      if (kindRaw === 'choices') {
        onGlobalError?.('选项消息请使用“生成选项”重新获取。');
        return;
      }
      const kind = kindRaw === 'opening' || kindRaw === 'continue' ? kindRaw : 'reply';

      const targetIndex = messages.findIndex((message) => message.id === targetMessage.id);
      if (targetIndex < 0) return;

      const historyBefore = messages.slice(0, targetIndex);
      const sessionOutputFormat = (activeSession.settings.outputFormat ?? 'jsonl') as MagicTeaPartyOutputFormat;
      const { history: historyForRequestBase, trimStats } = buildHistoryForRequest({
        session: activeSession,
        messages: historyBefore,
        outputFormat: sessionOutputFormat,
      });
      recordDropStats(activeSession.id, trimStats.droppedRatio);

      let arrestedBackupInput: string | undefined;
      let sourceMessageId: string | undefined;
      const lastUserMessage = [...historyBefore].reverse().find((message) => message.role === 'user' && message.content.trim());

      if (kind === 'reply') {
        const sourceMessage =
          (targetMessage.sourceMessageId
            ? historyBefore.find((message) => message.id === targetMessage.sourceMessageId && message.role === 'user')
            : null) || lastUserMessage;
        if (!sourceMessage || !sourceMessage.content?.trim()) {
          onGlobalError?.('找不到关联的用户输入，无法重新生成。');
          return;
        }
        sourceMessageId = sourceMessage.id;
        arrestedBackupInput = sourceMessage.content;
      } else if (lastUserMessage) {
        sourceMessageId = lastUserMessage.id;
      }

      const now = Date.now();
      const supersededMessage: MagicTeaPartyMessage = {
        ...targetMessage,
        meta: { ...(targetMessage.meta ?? {}), superseded: true },
      };
      setMessages((prev) => prev.map((message) => (message.id === targetMessage.id ? supersededMessage : message)));
      await putMagicTeaPartyMessage(supersededMessage);

      const assistantMessageId = randomUUID();
      const assistantMessage: MagicTeaPartyMessage = {
        id: assistantMessageId,
        sessionId: activeSession.id,
        role: 'assistant',
        content: '',
        createdAt: now,
        status: 'streaming',
        ...(sourceMessageId ? { sourceMessageId } : {}),
        revisionOf: targetMessage.id,
        meta: { ...(targetMessage.meta ?? {}), kind, outputFormat: sessionOutputFormat },
      };

      setMessages((prev) => [...prev, assistantMessage]);
      await putMagicTeaPartyMessage(assistantMessage);

      const updatedSession: MagicTeaPartySession = { ...activeSession, updatedAt: now };
      await persistSession(updatedSession);

      const historyForRequest: MagicTeaPartyHistoryMessage[] =
        kind === 'opening' || kind === 'continue'
          ? appendMagicTeaPartySystemInstruction(historyForRequestBase, kind, randomUUID())
          : historyForRequestBase;

      const finalSession = await runGenerateStream({
        session: updatedSession,
        historyForRequest,
        outputFormat: sessionOutputFormat,
        assistantMessageId,
        assistantMessage,
        arrestedBackupInput,
      });
      if (finalSession) void maybeAutoSummarize(finalSession);
    },
    [
      activeSession,
      buildHistoryForRequest,
      ensureProviderReady,
      isGenerating,
      messages,
      onGlobalError,
      persistSession,
      runGenerateStream,
      setMessages,
      maybeAutoSummarize,
      recordDropStats,
    ]
  );

  return {
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
  };
}
