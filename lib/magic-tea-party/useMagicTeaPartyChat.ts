import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { NextRouter } from 'next/router';

import type { UserAIProviderConfig } from '@/components/AiProviderSelector';
import { persistArrestedBackup } from '@/lib/arrested-backup';
import { getSensitiveWordRedirectTarget } from '@/lib/content-safety/client';
import { randomUUID } from '@/lib/crypto';
import { createMagicTeaPartyJsonlStreamState, ingestMagicTeaPartyJsonlChunk, parseMagicTeaPartyJsonl } from '@/lib/magic-tea-party/jsonl';
import { createMagicTeaPartyStreamSafety } from '@/lib/magic-tea-party/stream-safety';
import { putMagicTeaPartyMessage } from '@/lib/magic-tea-party/storage';
import { deriveMagicTeaPartyTitle } from '@/lib/magic-tea-party/title';
import type {
  MagicTeaPartyMessage,
  MagicTeaPartyPreferences,
  MagicTeaPartySession,
} from '@/lib/magic-tea-party/types';
import { applyShieldWords } from '@/lib/shield-word-filter';
import { readTextStreamFromResponse } from '@/lib/stream/read-text-stream';

type MagicTeaPartyOutputFormat = NonNullable<MagicTeaPartySession['settings']['outputFormat']>;

const isMessageSuperseded = (message: MagicTeaPartyMessage): boolean => {
  const meta = message.meta && typeof message.meta === 'object' ? (message.meta as Record<string, unknown>) : null;
  return Boolean(meta && meta.superseded === true);
};

const shouldIncludeInHistory = (message: MagicTeaPartyMessage): boolean => {
  if (message.role === 'user') return true;
  if (message.role !== 'assistant') return false;
  if (message.status === 'blocked' || message.status === 'error') return false;
  if (isMessageSuperseded(message)) return false;
  return true;
};

export type UseMagicTeaPartyChatOptions = {
  activeSession: MagicTeaPartySession | null;
  activeSessionId: string | null;
  messages: MagicTeaPartyMessage[];
  setMessages: Dispatch<SetStateAction<MagicTeaPartyMessage[]>>;
  persistSession: (session: MagicTeaPartySession) => Promise<void>;
  preferences: MagicTeaPartyPreferences;
  userProviderConfig: UserAIProviderConfig | null;
  onGlobalError?: (message: string | null) => void;
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
    router,
  } = options;

  const [isGenerating, setIsGenerating] = useState(false);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const summarizeAbortControllerRef = useRef<AbortController | null>(null);

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

  type MagicTeaPartyHistoryMessage = { id: string; role: 'user' | 'assistant' | 'system'; content: string };

  const runGenerateStream = useCallback(
    async (params: {
      session: MagicTeaPartySession;
      historyForRequest: MagicTeaPartyHistoryMessage[];
      outputFormat: MagicTeaPartyOutputFormat;
      assistantMessageId: string;
      assistantMessage: MagicTeaPartyMessage;
      arrestedBackupInput?: string;
    }) => {
      const controller = new AbortController();
      abortControllerRef.current = controller;
      setIsGenerating(true);

      const jsonlStreamState = params.outputFormat === 'jsonl' ? createMagicTeaPartyJsonlStreamState() : null;
      let lastSafeSnapshot = '';

      const updateStreamingPreview = (safePreview: string) => {
        if (jsonlStreamState) {
          if (safePreview.startsWith(lastSafeSnapshot)) {
            const delta = safePreview.slice(lastSafeSnapshot.length);
            ingestMagicTeaPartyJsonlChunk(jsonlStreamState, delta);
          } else {
            const resetState = createMagicTeaPartyJsonlStreamState();
            ingestMagicTeaPartyJsonlChunk(resetState, safePreview);
            jsonlStreamState.buffer = resetState.buffer;
            jsonlStreamState.segments = resetState.segments;
            jsonlStreamState.choices = resetState.choices;
          }
          lastSafeSnapshot = safePreview;
        }

        setMessages((prev) =>
          prev.map((m) =>
            m.id === params.assistantMessageId
              ? {
                  ...m,
                  content: safePreview,
                  ...(jsonlStreamState
                    ? {
                        segments: [...jsonlStreamState.segments],
                        choices: jsonlStreamState.choices ? [...jsonlStreamState.choices] : undefined,
                      }
                    : {}),
                }
              : m
          )
        );
      };

      const safety = createMagicTeaPartyStreamSafety({
        outputFormat: params.outputFormat,
        onSafePreview: updateStreamingPreview,
        onBlocked: (safeText) => {
          setMessages((prev) =>
            prev.map((m) => (m.id === params.assistantMessageId ? { ...m, content: safeText, status: 'blocked' } : m))
          );
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
            messages: params.historyForRequest,
            roles: params.session.roles ?? [],
            scenario: params.session.scenario ?? null,
            auxScenarios: params.session.auxScenarios ?? [],
            playerRoleId: params.session.playerRoleId ?? null,
            settings: {
              ...params.session.settings,
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
            return;
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
          return;
        }

        setMessages((prev) => prev.map((m) => (m.id === params.assistantMessageId ? { ...m, content: '', status: 'streaming' } : m)));

        const streamedText = await readTextStreamFromResponse(response, {
          label: '魔法茶会',
          onText: (accumulated) => {
            safety.ingest(accumulated);
          },
        });

        const { safeText, status, blockedAt, truncatedAt } = await safety.finalize(streamedText);

        const parsed = params.outputFormat === 'jsonl' ? parseMagicTeaPartyJsonl(safeText) : { segments: undefined, choices: null };

        const finalAssistant: MagicTeaPartyMessage = {
          ...params.assistantMessage,
          content: safeText,
          status,
          ...(params.outputFormat === 'jsonl' && parsed.segments ? { segments: parsed.segments, choices: parsed.choices ?? undefined } : {}),
          ...(status === 'blocked'
            ? { safety: { status: 'blocked', blockedBy: 'output', blockedAt: blockedAt ?? Date.now(), action: 'soft-block' } }
            : { safety: { status: 'ok' } }),
          ...(status === 'blocked' && typeof truncatedAt === 'number' ? { truncatedAt } : {}),
        };

        setMessages((prev) => prev.map((m) => (m.id === params.assistantMessageId ? finalAssistant : m)));
        await putMagicTeaPartyMessage(finalAssistant);

        const shouldAutoTitle = !params.session.titleMeta || params.session.titleMeta.source === 'auto';
        if (shouldAutoTitle && (params.session.title === '新会话' || params.session.title === '未命名会话')) {
          const nextTitle = deriveMagicTeaPartyTitle({
            outputFormat: params.outputFormat,
            content: safeText,
            segments: params.outputFormat === 'jsonl' ? parsed.segments : undefined,
            scenarioTitle: params.session.scenario?.title,
            roleNames: (params.session.roles ?? []).map((r) => r.name),
          });
          const titleFiltered = applyShieldWords(nextTitle).filteredText;

          await persistSession({
            ...params.session,
            title: titleFiltered,
            titleMeta: {
              source: 'auto',
              generatedAt: Date.now(),
              providerId: userProviderConfig?.providerId,
              modelId: userProviderConfig?.modelId,
              reason: 'first-message',
            },
          });
        } else {
          await persistSession({ ...params.session, updatedAt: Date.now() });
        }
      } catch (error) {
        safety.clearTimer();
        if (error instanceof Error && error.name === 'AbortError') {
          const { safeText, status, blockedAt, truncatedAt } = await safety.finalizeAfterAbort(controller.signal.reason);
          const parsed = params.outputFormat === 'jsonl' ? parseMagicTeaPartyJsonl(safeText) : { segments: undefined, choices: null };
          const finalAssistant: MagicTeaPartyMessage = {
            ...params.assistantMessage,
            content: safeText,
            status,
            ...(params.outputFormat === 'jsonl' && parsed.segments ? { segments: parsed.segments, choices: parsed.choices ?? undefined } : {}),
            ...(status === 'blocked'
              ? { safety: { status: 'blocked', blockedBy: 'output', blockedAt: blockedAt ?? Date.now(), action: 'soft-block' } }
              : { safety: { status: 'ok' } }),
            ...(status === 'blocked' && typeof truncatedAt === 'number' ? { truncatedAt } : {}),
          };
          setMessages((prev) => prev.map((m) => (m.id === params.assistantMessageId ? finalAssistant : m)));
          await putMagicTeaPartyMessage(finalAssistant);
          return;
        }

        const message = error instanceof Error ? error.message : '生成失败';
        const errorRecord: MagicTeaPartyMessage = { ...params.assistantMessage, status: 'error', error: { code: 'exception', message } };
        setMessages((prev) => prev.map((m) => (m.id === params.assistantMessageId ? errorRecord : m)));
        await putMagicTeaPartyMessage(errorRecord);
      } finally {
        abortControllerRef.current = null;
        setIsGenerating(false);
      }
    },
    [persistSession, router, setMessages, userProviderConfig]
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

      const historyForRequest = [...messages, userMessage]
        .filter(shouldIncludeInHistory)
        .map((m) => ({ id: m.id, role: m.role, content: m.content }));

      await runGenerateStream({
        session: updatedSession,
        historyForRequest,
        outputFormat: sessionOutputFormat,
        assistantMessageId,
        assistantMessage,
        arrestedBackupInput: trimmed,
      });
      return true;
    },
    [
      activeSession,
      ensureProviderReady,
      isGenerating,
      messages,
      onGlobalError,
      preferences.userDisplayName,
      persistSession,
      router,
      runGenerateStream,
      setMessages,
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

    const baseHistory = messages
      .filter(shouldIncludeInHistory)
      .map((m) => ({ id: m.id, role: m.role, content: m.content }));

    const systemInstruction: MagicTeaPartyHistoryMessage = {
      id: randomUUID(),
      role: 'system',
      content:
        kind === 'opening'
          ? '【任务】请先生成故事开场：描写场景/氛围，安排角色登场，并给出可供玩家回应的钩子。'
          : '【任务】请在不等待玩家新输入的情况下，继续推进下一小节剧情。',
    };

    await runGenerateStream({
      session: updatedSession,
      historyForRequest: [...baseHistory, systemInstruction],
      outputFormat: sessionOutputFormat,
      assistantMessageId,
      assistantMessage,
    });
  }, [activeSession, ensureProviderReady, isGenerating, messages, onGlobalError, persistSession, runGenerateStream, setMessages]);

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

    const historyForRequest = messages
      .filter(shouldIncludeInHistory)
      .map((m) => ({ id: m.id, role: m.role, content: m.content }));

    const controller = new AbortController();
    abortControllerRef.current = controller;
    setIsGenerating(true);

    const jsonlStreamState = createMagicTeaPartyJsonlStreamState();
    let lastSafeSnapshot = '';

    const updateStreamingPreview = (safePreview: string, status?: MagicTeaPartyMessage['status']) => {
      if (safePreview.startsWith(lastSafeSnapshot)) {
        const delta = safePreview.slice(lastSafeSnapshot.length);
        ingestMagicTeaPartyJsonlChunk(jsonlStreamState, delta);
      } else {
        const resetState = createMagicTeaPartyJsonlStreamState();
        ingestMagicTeaPartyJsonlChunk(resetState, safePreview);
        jsonlStreamState.buffer = resetState.buffer;
        jsonlStreamState.segments = resetState.segments;
        jsonlStreamState.choices = resetState.choices;
      }
      lastSafeSnapshot = safePreview;

      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMessageId
            ? {
                ...m,
                content: safePreview,
                ...(typeof status === 'string' ? { status } : {}),
                segments: [...jsonlStreamState.segments],
                choices: jsonlStreamState.choices ? [...jsonlStreamState.choices] : undefined,
              }
            : m
        )
      );
    };
    const safety = createMagicTeaPartyStreamSafety({
      outputFormat: 'jsonl',
      onSafePreview: (safeText) => {
        updateStreamingPreview(safeText);
      },
      onBlocked: (safeText) => {
        updateStreamingPreview(safeText, 'blocked');
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
          messages: historyForRequest,
          roles: activeSession.roles ?? [],
          scenario: activeSession.scenario ?? null,
          auxScenarios: activeSession.auxScenarios ?? [],
          playerRoleId: activeSession.playerRoleId ?? null,
          settings: {
            ...activeSession.settings,
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
      const finalAssistant: MagicTeaPartyMessage = {
        ...assistantMessage,
        content: safeText,
        status,
        ...(parsed.segments ? { segments: parsed.segments, choices: parsed.choices ?? undefined } : {}),
        ...(status === 'blocked'
          ? { safety: { status: 'blocked', blockedBy: 'output', blockedAt: blockedAt ?? Date.now(), action: 'soft-block' } }
          : { safety: { status: 'ok' } }),
        ...(status === 'blocked' && typeof truncatedAt === 'number' ? { truncatedAt } : {}),
      };

      setMessages((prev) => prev.map((m) => (m.id === assistantMessageId ? finalAssistant : m)));
      await putMagicTeaPartyMessage(finalAssistant);
      await persistSession({ ...updatedSession, updatedAt: Date.now() });
    } catch (error) {
      safety.clearTimer();
      if (error instanceof Error && error.name === 'AbortError') {
        const { safeText, status, blockedAt, truncatedAt } = await safety.finalizeAfterAbort(controller.signal.reason);
        const parsed = parseMagicTeaPartyJsonl(safeText);
        const finalAssistant: MagicTeaPartyMessage = {
          ...assistantMessage,
          content: safeText,
          status,
          ...(parsed.segments ? { segments: parsed.segments, choices: parsed.choices ?? undefined } : {}),
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

    const historyForRequest = messages
      .filter(shouldIncludeInHistory)
      .filter((m) => typeof m.content === 'string' && m.content.trim())
      .map((m) => ({ id: m.id, role: m.role, content: m.content }));

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
      const historyForRequestBase: MagicTeaPartyHistoryMessage[] = historyBefore
        .filter(shouldIncludeInHistory)
        .map((message) => ({ id: message.id, role: message.role, content: message.content }));

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
      const sessionOutputFormat = (activeSession.settings.outputFormat ?? 'jsonl') as MagicTeaPartyOutputFormat;

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
          ? [
              ...historyForRequestBase,
              {
                id: randomUUID(),
                role: 'system',
                content:
                  kind === 'opening'
                    ? '【任务】请先生成故事开场：描写场景/氛围，安排角色登场，并给出可供玩家回应的钩子。'
                    : '【任务】请在不等待玩家新输入的情况下，继续推进下一小节剧情。',
              },
            ]
          : historyForRequestBase;

      await runGenerateStream({
        session: updatedSession,
        historyForRequest,
        outputFormat: sessionOutputFormat,
        assistantMessageId,
        assistantMessage,
        arrestedBackupInput,
      });
    },
    [activeSession, ensureProviderReady, isGenerating, messages, onGlobalError, persistSession, runGenerateStream, setMessages]
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
