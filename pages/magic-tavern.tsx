import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import AiProviderSelector, { type UserAIProviderConfig } from '@/components/AiProviderSelector';
import BattleDataModal from '@/components/BattleDataModal';
import Footer from '@/components/Footer';
import { MarkdownBlock } from '@/components/MarkdownBlock';

import { persistArrestedBackup } from '@/lib/arrested-backup';
import { getSensitiveWordRedirectTarget } from '@/lib/content-safety/client';
import { inferTemplate } from '@/lib/data-card-converter';
import { parseMagicTavernJsonl } from '@/lib/magic-tavern/jsonl';
import { DEFAULT_MAGIC_TAVERN_PREFERENCES, patchMagicTavernPreferences, readMagicTavernPreferences } from '@/lib/magic-tavern/preferences';
import { MAGIC_TAVERN_PRESETS, type MagicTavernPresetId, getMagicTavernPreset } from '@/lib/magic-tavern/presets';
import {
  deleteMagicTavernSession,
  getMagicTavernSession,
  listMagicTavernMessages,
  listMagicTavernSessions,
  putMagicTavernMessage,
  putMagicTavernSession,
} from '@/lib/magic-tavern/storage';
import { deriveMagicTavernTitle } from '@/lib/magic-tavern/title';
import type { MagicTavernMessage, MagicTavernRole, MagicTavernScenario, MagicTavernSession } from '@/lib/magic-tavern/types';
import { applyShieldWords } from '@/lib/shield-word-filter';
import { quickCheck } from '@/lib/sensitive-word-filter';
import { readTextStreamFromResponse } from '@/lib/stream/read-text-stream';
import { useAuth } from '@/lib/useAuth';

const STORAGE_RECENT_SESSION = 'magic-tavern:recent-session';

const createUuid = (): string => {
  if (typeof crypto !== 'undefined' && typeof (crypto as any).randomUUID === 'function') {
    return (crypto as any).randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const readLocalStorageString = (key: string): string | null => {
  if (typeof window === 'undefined') return null;
  try {
    const value = window.localStorage.getItem(key);
    return value && value.trim() ? value : null;
  } catch {
    return null;
  }
};

const writeLocalStorageString = (key: string, value: string): void => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // ignore
  }
};

const stripMetaKeys = (payload: Record<string, unknown>): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (key.startsWith('_')) continue;
    out[key] = value;
  }
  return out;
};

const buildRoleFromDataCardPayload = (payload: any): MagicTavernRole => {
  const cardId = typeof payload?._cardId === 'string' ? payload._cardId : createUuid();
  const cardName = typeof payload?._cardName === 'string' ? payload._cardName : '角色';
  const isPublic = Boolean(payload?._isPublic);
  const card = stripMetaKeys(payload && typeof payload === 'object' ? payload : {});
  const template = inferTemplate(card);

  const name =
    template === 'magical-girl'
      ? (typeof (card as any).codename === 'string' ? (card as any).codename.trim() : '') || cardName
      : template === 'canshou'
        ? (typeof (card as any).name === 'string' ? (card as any).name.trim() : '') || cardName
        : (typeof (card as any).name === 'string' ? (card as any).name.trim() : '') || cardName;

  return {
    id: cardId,
    name,
    template: template === 'magical-girl' || template === 'canshou' || template === 'general' ? template : undefined,
    templateId: typeof (card as any).templateId === 'string' ? (card as any).templateId : undefined,
    dataCardId: cardId,
    source: isPublic ? 'public' : 'cloud',
    signature: typeof (card as any).signature === 'string' ? (card as any).signature : undefined,
    card,
  };
};

const buildScenarioFromDataCardPayload = (payload: any): MagicTavernScenario => {
  const cardId = typeof payload?._cardId === 'string' ? payload._cardId : createUuid();
  const cardName = typeof payload?._cardName === 'string' ? payload._cardName : '情景';
  const isPublic = Boolean(payload?._isPublic);
  const card = stripMetaKeys(payload && typeof payload === 'object' ? payload : {});

  const title = typeof (card as any).title === 'string' ? (card as any).title.trim() : '';

  return {
    id: cardId,
    title: title || cardName,
    templateId: typeof (card as any).templateId === 'string' ? (card as any).templateId : undefined,
    dataCardId: cardId,
    source: isPublic ? 'public' : 'cloud',
    signature: typeof (card as any).signature === 'string' ? (card as any).signature : undefined,
    card,
  };
};

const buildRoleFromLocalJson = (card: Record<string, unknown>, meta: { fileName?: string; importedAt: number }): MagicTavernRole | null => {
  const template = inferTemplate(card);
  if (template !== 'magical-girl' && template !== 'canshou' && template !== 'general') return null;

  const name =
    template === 'magical-girl'
      ? (typeof (card as any).codename === 'string' ? (card as any).codename.trim() : '') || '魔法少女'
      : (typeof (card as any).name === 'string' ? (card as any).name.trim() : '') || '角色';

  return {
    id: createUuid(),
    name,
    template,
    templateId: typeof (card as any).templateId === 'string' ? (card as any).templateId : undefined,
    source: 'local',
    signature: typeof (card as any).signature === 'string' ? (card as any).signature : undefined,
    card,
    origin: { fileName: meta.fileName, importedAt: meta.importedAt },
  };
};

const buildScenarioFromLocalJson = (card: Record<string, unknown>, meta: { fileName?: string; importedAt: number }): MagicTavernScenario | null => {
  const template = inferTemplate(card);
  if (template !== 'scenario' && template !== 'general-scenario') return null;

  const title =
    typeof (card as any).title === 'string'
      ? (card as any).title.trim()
      : typeof (card as any).name === 'string'
        ? (card as any).name.trim()
        : '';

  return {
    id: createUuid(),
    title: title || '情景',
    templateId: typeof (card as any).templateId === 'string' ? (card as any).templateId : undefined,
    source: 'local',
    signature: typeof (card as any).signature === 'string' ? (card as any).signature : undefined,
    card,
    origin: { fileName: meta.fileName, importedAt: meta.importedAt },
  };
};

const sortSessionsByUpdatedAtDesc = (items: MagicTavernSession[]): MagicTavernSession[] => {
  return [...items].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
};

export default function MagicTavernPage() {
  const router = useRouter();
  const { user } = useAuth();

  const [sessions, setSessions] = useState<MagicTavernSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [activeSession, setActiveSession] = useState<MagicTavernSession | null>(null);
  const [messages, setMessages] = useState<MagicTavernMessage[]>([]);
  const [globalError, setGlobalError] = useState<string | null>(null);

  const [userProviderConfig, setUserProviderConfig] = useState<UserAIProviderConfig | null>(null);
  const [preferences, setPreferences] = useState(() => DEFAULT_MAGIC_TAVERN_PREFERENCES);

  const [isGenerating, setIsGenerating] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const [showRoleModal, setShowRoleModal] = useState(false);
  const [showScenarioModal, setShowScenarioModal] = useState(false);

  const [draft, setDraft] = useState('');

  useEffect(() => {
    const prefs = readMagicTavernPreferences();
    setPreferences(prefs);
  }, []);

  useEffect(() => {
    if (!user?.username) return;
    if (typeof window === 'undefined') return;
    setPreferences((prev) => {
      if (prev.userDisplayName !== DEFAULT_MAGIC_TAVERN_PREFERENCES.userDisplayName) return prev;
      const next = patchMagicTavernPreferences({ userDisplayName: user.username });
      return next;
    });
  }, [user?.username]);

  const refreshSessions = useCallback(async (): Promise<MagicTavernSession[]> => {
    const next = await listMagicTavernSessions({ limit: 50 });
    setSessions(next);
    return next;
  }, []);

  const refreshActiveSession = useCallback(async (sessionId: string) => {
    const session = await getMagicTavernSession(sessionId);
    setActiveSession(session);
    const nextMessages = await listMagicTavernMessages(sessionId);
    setMessages(nextMessages);
  }, []);

  useEffect(() => {
    let canceled = false;
    void (async () => {
      try {
        const loadedSessions = await refreshSessions();
        if (canceled) return;

        const recent = readLocalStorageString(STORAGE_RECENT_SESSION);
        const initialId =
          recent && loadedSessions.some((s) => s.id === recent) ? recent : loadedSessions[0]?.id ?? null;
        setActiveSessionId(initialId);
      } catch (error) {
        const message = error instanceof Error ? error.message : '加载会话失败';
        setGlobalError(message);
      }
    })();
    return () => {
      canceled = true;
    };
  }, [refreshSessions]);

  useEffect(() => {
    if (!activeSessionId) {
      setActiveSession(null);
      setMessages([]);
      return;
    }

    writeLocalStorageString(STORAGE_RECENT_SESSION, activeSessionId);
    void refreshActiveSession(activeSessionId).catch((error) => {
      const message = error instanceof Error ? error.message : '加载会话失败';
      setGlobalError(message);
    });
  }, [activeSessionId, refreshActiveSession]);

  const persistSession = useCallback(
    async (next: MagicTavernSession) => {
      await putMagicTavernSession(next);
      setActiveSession(next);
      setSessions((prev) => sortSessionsByUpdatedAtDesc([next, ...prev.filter((item) => item.id !== next.id)]));
    },
    []
  );

  const createSession = useCallback(
    async (presetId?: MagicTavernPresetId | null) => {
      const now = Date.now();
      const id = createUuid();
      const preset = getMagicTavernPreset(presetId ?? preferences.lastPresetId);

      const baseSettings = {
        providerId: userProviderConfig?.providerId || 'unknown',
        modelId: userProviderConfig?.modelId || '',
        temperature: 0.75,
        outputFormat: preferences.outputFormat,
        language: preferences.language,
        enableChoices: preferences.enableChoices,
        choiceCount: preferences.choiceCount,
        userDisplayName: preferences.userDisplayName,
      } satisfies MagicTavernSession['settings'];

      const session: MagicTavernSession = {
        id,
        title: '新会话',
        createdAt: now,
        updatedAt: now,
        roles: [],
        scenario: preset
          ? {
            id: 'preset-scenario',
            title: preset.defaultScenario.title,
            presetId: preset.id,
            source: 'preset',
            card: {
              title: preset.defaultScenario.title,
              content: preset.defaultScenario.content,
              templateId: '通用情景卡（Markdown）',
            },
          }
          : undefined,
        auxScenarios: [],
        playerRoleId: null,
        settings: {
          ...baseSettings,
          ...(preset
            ? {
              presetId: preset.id,
              worldbookPresetId: preset.worldbookPresetId,
              outputFormat: preset.defaultSettings.outputFormat,
              enableChoices: preset.defaultSettings.enableChoices,
              choiceCount: preset.defaultSettings.choiceCount,
            }
            : {}),
        },
      };

      await putMagicTavernSession(session);
      setSessions((prev) => sortSessionsByUpdatedAtDesc([session, ...prev]));
      setActiveSessionId(session.id);
      writeLocalStorageString(STORAGE_RECENT_SESSION, session.id);
    },
    [preferences, userProviderConfig]
  );

  const deleteSession = useCallback(
    async (sessionId: string) => {
      await deleteMagicTavernSession(sessionId);
      const next = await refreshSessions();
      const fallback = next[0]?.id ?? null;
      setActiveSessionId((current) => (current === sessionId ? fallback : current));
    },
    [refreshSessions]
  );

  const updateActiveSessionSettings = useCallback(
    async (patch: Partial<MagicTavernSession['settings']>) => {
      if (!activeSession) return;
      const next: MagicTavernSession = {
        ...activeSession,
        updatedAt: Date.now(),
        settings: { ...activeSession.settings, ...patch },
      };
      await persistSession(next);
    },
    [activeSession, persistSession]
  );

  const updateActiveSessionRoles = useCallback(
    async (nextRoles: MagicTavernRole[]) => {
      if (!activeSession) return;
      const next: MagicTavernSession = { ...activeSession, roles: nextRoles, updatedAt: Date.now() };
      await persistSession(next);
    },
    [activeSession, persistSession]
  );

  const updateActiveSessionScenarios = useCallback(
    async (nextScenario: MagicTavernScenario | undefined, nextAux: MagicTavernScenario[]) => {
      if (!activeSession) return;
      const next: MagicTavernSession = { ...activeSession, scenario: nextScenario, auxScenarios: nextAux, updatedAt: Date.now() };
      await persistSession(next);
    },
    [activeSession, persistSession]
  );

  const onToggleRoleCard = useCallback(
    async (payload: any, nextSelected: boolean) => {
      if (!activeSession) return;
      const dataCardId = typeof payload?._cardId === 'string' ? payload._cardId : '';
      const current = activeSession.roles ?? [];
      const exists = dataCardId ? current.some((r) => r.dataCardId === dataCardId) : false;

      if (nextSelected && !exists) {
        await updateActiveSessionRoles([...current, buildRoleFromDataCardPayload(payload)]);
        return;
      }
      if (!nextSelected && dataCardId) {
        await updateActiveSessionRoles(current.filter((r) => r.dataCardId !== dataCardId));
      }
    },
    [activeSession, updateActiveSessionRoles]
  );

  const onToggleScenarioCard = useCallback(
    async (payload: any, nextSelected: boolean) => {
      if (!activeSession) return;
      const dataCardId = typeof payload?._cardId === 'string' ? payload._cardId : '';
      if (!dataCardId) return;

      const currentMain = activeSession.scenario;
      const currentAux = Array.isArray(activeSession.auxScenarios) ? activeSession.auxScenarios : [];
      const existsInMain = currentMain?.dataCardId === dataCardId;
      const existsInAux = currentAux.some((s) => s.dataCardId === dataCardId);

      if (nextSelected && !existsInMain && !existsInAux) {
        const next = buildScenarioFromDataCardPayload(payload);
        if (!currentMain) {
          await updateActiveSessionScenarios(next, currentAux);
        } else {
          await updateActiveSessionScenarios(currentMain, [...currentAux, next]);
        }
        return;
      }

      if (!nextSelected) {
        if (existsInMain) {
          const nextMain = currentAux[0];
          const rest = currentAux.slice(1);
          await updateActiveSessionScenarios(nextMain, rest);
          return;
        }
        if (existsInAux) {
          await updateActiveSessionScenarios(currentMain, currentAux.filter((s) => s.dataCardId !== dataCardId));
        }
      }
    },
    [activeSession, updateActiveSessionScenarios]
  );

  const selectedRoleCardIds = useMemo(() => {
    return (activeSession?.roles ?? []).map((role) => role.dataCardId).filter((id): id is string => Boolean(id));
  }, [activeSession?.roles]);

  const selectedScenarioCardIds = useMemo(() => {
    const ids: string[] = [];
    if (activeSession?.scenario?.dataCardId) ids.push(activeSession.scenario.dataCardId);
    for (const item of activeSession?.auxScenarios ?? []) {
      if (item.dataCardId) ids.push(item.dataCardId);
    }
    return ids;
  }, [activeSession?.scenario, activeSession?.auxScenarios]);

  const onUploadRoles = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      if (!activeSession) return;
      const files = event.target.files;
      if (!files || files.length === 0) return;

      const importedAt = Date.now();
      const nextRoles: MagicTavernRole[] = [...(activeSession.roles ?? [])];

      for (const file of Array.from(files)) {
        try {
          const text = await file.text();
          const parsed = JSON.parse(text);
          const card = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
          if (!card) continue;
          const role = buildRoleFromLocalJson(card, { fileName: file.name, importedAt });
          if (!role) continue;
          nextRoles.push(role);
        } catch {
          // ignore invalid file
        }
      }

      await updateActiveSessionRoles(nextRoles);
      event.target.value = '';
    },
    [activeSession, updateActiveSessionRoles]
  );

  const onUploadScenarios = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      if (!activeSession) return;
      const files = event.target.files;
      if (!files || files.length === 0) return;

      const importedAt = Date.now();
      let nextMain = activeSession.scenario;
      const nextAux = Array.isArray(activeSession.auxScenarios) ? [...activeSession.auxScenarios] : [];

      for (const file of Array.from(files)) {
        try {
          const text = await file.text();
          const parsed = JSON.parse(text);
          const card = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
          if (!card) continue;
          const scenario = buildScenarioFromLocalJson(card, { fileName: file.name, importedAt });
          if (!scenario) continue;
          if (!nextMain) {
            nextMain = scenario;
          } else {
            nextAux.push(scenario);
          }
        } catch {
          // ignore
        }
      }

      await updateActiveSessionScenarios(nextMain, nextAux);
      event.target.value = '';
    },
    [activeSession, updateActiveSessionScenarios]
  );

  const stopGenerating = useCallback(() => {
    abortControllerRef.current?.abort('user');
  }, []);

  const ensureProviderReady = useCallback((): { ok: true } | { ok: false; message: string } => {
    if (!userProviderConfig) return { ok: false, message: '请先配置模型与 API Key。' };
    if (userProviderConfig.providerId === 'system') return { ok: false, message: '魔法酒馆已禁用 system，请使用自备 Key。' };
    if (!userProviderConfig.apiKey?.trim()) return { ok: false, message: 'API Key 不能为空。' };
    if (!userProviderConfig.modelId?.trim()) return { ok: false, message: '请先选择模型。' };
    return { ok: true };
  }, [userProviderConfig]);

  const sendMessage = useCallback(
    async (text: string) => {
      if (!activeSession) return;
      if (isGenerating) return;
      const trimmed = text.trim();
      if (!trimmed) return;

      const providerCheck = ensureProviderReady();
      if (!providerCheck.ok) {
        setGlobalError(providerCheck.message);
        return;
      }

      setGlobalError(null);

      const redirectTarget = await getSensitiveWordRedirectTarget(trimmed, { reason: '使用危险符文' });
      if (redirectTarget) {
        persistArrestedBackup({
          triggerSource: 'input',
          reason: '使用危险符文',
          origin: '/magic-tavern',
          items: [
            {
              label: '魔法酒馆输入',
              filename: 'magic-tavern-input.txt',
              mimeType: 'text/plain',
              content: trimmed,
            },
          ],
        });
        await router.push(redirectTarget as any);
        return;
      }

      const now = Date.now();
      const userMessage: MagicTavernMessage = {
        id: createUuid(),
        sessionId: activeSession.id,
        role: 'user',
        content: trimmed,
        createdAt: now,
        status: 'done',
      };

      const assistantMessageId = createUuid();
      const assistantMessage: MagicTavernMessage = {
        id: assistantMessageId,
        sessionId: activeSession.id,
        role: 'assistant',
        content: '',
        createdAt: now + 1,
        status: 'streaming',
        sourceMessageId: userMessage.id,
      };

      const nextMessages = [...messages, userMessage, assistantMessage];
      setMessages(nextMessages);
      setDraft('');

      await putMagicTavernMessage(userMessage);
      await putMagicTavernMessage(assistantMessage);

      const updatedSession: MagicTavernSession = { ...activeSession, updatedAt: now };
      await persistSession(updatedSession);

      const historyForRequest = [...messages, userMessage]
        .filter((m) => m.role === 'user' || (m.role === 'assistant' && m.status !== 'blocked' && m.status !== 'error'))
        .map((m) => ({ id: m.id, role: m.role, content: m.content }));

      const controller = new AbortController();
      abortControllerRef.current = controller;
      setIsGenerating(true);

      let streamedSoFar = '';
      try {
        const response = await fetch('/api/magic-tavern/generate-stream', {
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
            persistArrestedBackup({
              triggerSource: 'input',
              reason: typeof payload?.reason === 'string' ? payload.reason : '使用危险符文',
              origin: '/magic-tavern',
              items: [
                {
                  label: '魔法酒馆输入',
                  filename: 'magic-tavern-input.txt',
                  mimeType: 'text/plain',
                  content: trimmed,
                },
              ],
            });
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
          await putMagicTavernMessage({
            ...assistantMessage,
            status: 'error',
            error: { code: `${response.status}`, message: errorMessage },
          });
          return;
        }

        setMessages((prev) => prev.map((m) => (m.id === assistantMessageId ? { ...m, content: '', status: 'streaming' } : m)));

        const streamedText = await readTextStreamFromResponse(response, {
          label: '魔法酒馆',
          onText: (accumulated) => {
            streamedSoFar = accumulated;
            setMessages((prev) => prev.map((m) => (m.id === assistantMessageId ? { ...m, content: accumulated } : m)));
          },
        });

        let safeText = applyShieldWords(streamedText).filteredText;
        const sensitive = await quickCheck(safeText);
        let status: MagicTavernMessage['status'] = 'done';
        if (sensitive.hasSensitiveWords) {
          status = 'blocked';
          safeText = sensitive.filteredText;
        }

        const outputFormat = activeSession.settings.outputFormat ?? 'jsonl';
        const parsed = outputFormat === 'jsonl' ? parseMagicTavernJsonl(safeText) : { segments: undefined, choices: null };

        const finalAssistant: MagicTavernMessage = {
          ...assistantMessage,
          content: safeText,
          status,
          ...(outputFormat === 'jsonl' && parsed.segments ? { segments: parsed.segments, choices: parsed.choices ?? undefined } : {}),
          ...(status === 'blocked'
            ? { safety: { status: 'blocked', blockedBy: 'output', blockedAt: Date.now(), action: 'soft-block' } }
            : { safety: { status: 'ok' } }),
        };

        setMessages((prev) => prev.map((m) => (m.id === assistantMessageId ? finalAssistant : m)));
        await putMagicTavernMessage(finalAssistant);

        const shouldAutoTitle = !activeSession.titleMeta || activeSession.titleMeta.source === 'auto';
        if (shouldAutoTitle && (activeSession.title === '新会话' || activeSession.title === '未命名会话')) {
          const nextTitle = deriveMagicTavernTitle({
            outputFormat,
            content: safeText,
            segments: outputFormat === 'jsonl' ? parsed.segments : undefined,
            scenarioTitle: activeSession.scenario?.title,
            roleNames: (activeSession.roles ?? []).map((r) => r.name),
          });
          const titleFiltered = applyShieldWords(nextTitle).filteredText;

          await persistSession({
            ...updatedSession,
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
          await persistSession({ ...updatedSession, updatedAt: Date.now() });
        }
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          setMessages((prev) => prev.map((m) => (m.id === assistantMessageId ? { ...m, status: 'done' } : m)));
          const currentText = streamedSoFar || messages.find((m) => m.id === assistantMessageId)?.content || '';
          await putMagicTavernMessage({ ...assistantMessage, content: currentText, status: 'done' });
          return;
        }

        const message = error instanceof Error ? error.message : '生成失败';
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantMessageId ? { ...m, status: 'error', error: { code: 'exception', message } } : m))
        );
        await putMagicTavernMessage({ ...assistantMessage, status: 'error', error: { code: 'exception', message } });
      } finally {
        abortControllerRef.current = null;
        setIsGenerating(false);
      }
    },
    [activeSession, ensureProviderReady, isGenerating, messages, persistSession, router, userProviderConfig]
  );

  const playerOptions = useMemo(() => {
    const roles = activeSession?.roles ?? [];
    return [
      { value: '', label: `{{user}}（${activeSession?.settings.userDisplayName || preferences.userDisplayName || '旅人'}）` },
      ...roles.map((role) => ({ value: role.id, label: role.name })),
    ];
  }, [activeSession?.roles, activeSession?.settings.userDisplayName, preferences.userDisplayName]);

  const renderMessage = (message: MagicTavernMessage) => {
    const isUser = message.role === 'user';
    const bubbleClass = isUser ? 'bg-pink-600 text-white' : 'bg-white border border-pink-100 text-gray-800';

    if (message.role === 'assistant' && activeSession?.settings.outputFormat === 'markdown') {
      return (
        <div className={`rounded-xl px-4 py-3 ${bubbleClass}`}>
          <MarkdownBlock content={message.content || ''} variant="light" mode="article" />
        </div>
      );
    }

    if (message.role === 'assistant' && Array.isArray(message.segments) && message.segments.length > 0) {
      return (
        <div className={`rounded-xl px-4 py-3 ${bubbleClass} space-y-2`}>
          {message.segments.map((seg, idx) => {
            if (seg.type === 'narration') {
              return (
                <p key={`${message.id}-n-${idx}`} className="whitespace-pre-wrap leading-relaxed">
                  {seg.text}
                </p>
              );
            }
            if (seg.type === 'dialogue') {
              const speakerName =
                seg.speakerName ||
                (activeSession?.roles ?? []).find((r) => r.id === seg.speakerId)?.name ||
                seg.speakerId;
              return (
                <div key={`${message.id}-d-${idx}`} className="rounded-lg bg-pink-50 px-3 py-2">
                  <div className="text-xs font-semibold text-pink-700">{speakerName}</div>
                  <div className="whitespace-pre-wrap leading-relaxed text-gray-800">{seg.text}</div>
                </div>
              );
            }
            if (seg.type === 'choices') {
              return (
                <div key={`${message.id}-c-${idx}`} className="grid gap-2 sm:grid-cols-2">
                  {seg.items.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className="rounded-xl border border-pink-200 bg-white px-4 py-2 text-left text-sm font-semibold text-pink-700 hover:bg-pink-50 disabled:opacity-50 disabled:cursor-not-allowed"
                      disabled={isGenerating}
                      onClick={() => void sendMessage(item.text)}
                      title="选择该行动"
                    >
                      {item.text}
                    </button>
                  ))}
                </div>
              );
            }
            return null;
          })}
          {message.status === 'blocked' && (
            <div className="text-xs text-amber-700">本轮输出被安全策略截断（可尝试修改输入或重新生成）。</div>
          )}
          {message.status === 'error' && (
            <div className="text-xs text-red-600">
              生成失败：{message.error?.message || '未知错误'}
            </div>
          )}
        </div>
      );
    }

    return (
      <div className={`rounded-xl px-4 py-3 ${bubbleClass}`}>
        <div className="whitespace-pre-wrap leading-relaxed">{message.content}</div>
        {message.status === 'blocked' && (
          <div className="mt-2 text-xs text-amber-700">本轮输出被安全策略截断（可尝试修改输入或重新生成）。</div>
        )}
        {message.status === 'error' && (
          <div className="mt-2 text-xs text-red-600">生成失败：{message.error?.message || '未知错误'}</div>
        )}
      </div>
    );
  };

  return (
    <>
      <Head>
        <title>魔法酒馆</title>
        <meta name="description" content="基于角色卡/情景卡的长期对话与剧情体验（本地存储，自备 API Key）" />
      </Head>

      <div className="magic-background-white">
        <div className="container !max-w-[1200px]">
          <div className="card !max-w-none">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h1 className="text-2xl font-bold text-pink-800">魔法酒馆</h1>
                <p className="mt-1 text-sm text-gray-600">聊天记录保存在本地浏览器；魔法酒馆仅支持自备 API Key。</p>
              </div>
              <Link href="/" className="text-sm text-pink-700 hover:underline">
                返回首页
              </Link>
            </div>

            {globalError && (
              <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{globalError}</div>
            )}

            <div className="mt-6 grid gap-6 lg:grid-cols-[320px_1fr]">
              <aside className="space-y-4">
                <div className="rounded-xl border border-pink-100 bg-white p-4">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold text-gray-800">会话列表</div>
                    <button
                      type="button"
                      className="rounded-lg bg-pink-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-pink-700"
                      onClick={() => void createSession(preferences.lastPresetId as any)}
                    >
                      新建
                    </button>
                  </div>
                  <div className="mt-3 space-y-2">
                    {sessions.length === 0 ? (
                      <div className="text-sm text-gray-500">还没有会话，先新建一个吧。</div>
                    ) : (
                      sessions.map((session) => (
                        <div
                          key={session.id}
                          className={`rounded-lg border px-3 py-2 transition-colors ${session.id === activeSessionId
                            ? 'border-pink-300 bg-pink-50'
                            : 'border-pink-100 bg-white hover:bg-pink-50/50'
                            }`}
                        >
                          <button
                            type="button"
                            className="block w-full text-left"
                            onClick={() => setActiveSessionId(session.id)}
                          >
                            <div className="text-sm font-semibold text-gray-800 line-clamp-1">{session.title}</div>
                            <div className="mt-0.5 text-xs text-gray-500">
                              {new Date(session.updatedAt).toLocaleString()}
                            </div>
                          </button>
                          <div className="mt-2 flex justify-end">
                            <button
                              type="button"
                              className="text-xs text-red-600 hover:underline"
                              onClick={() => void deleteSession(session.id)}
                            >
                              删除
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div className="rounded-xl border border-pink-100 bg-white p-4">
                  <div className="text-sm font-semibold text-gray-800">预设情景</div>
                  <div className="mt-3 grid gap-2">
                    {MAGIC_TAVERN_PRESETS.map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        className="rounded-xl border border-pink-200 bg-white px-4 py-3 text-left hover:bg-pink-50"
                        onClick={() => {
                          if (!activeSession) {
                            void createSession(preset.id);
                            return;
                          }
                          void updateActiveSessionSettings({
                            presetId: preset.id,
                            worldbookPresetId: preset.worldbookPresetId,
                            outputFormat: preset.defaultSettings.outputFormat,
                            enableChoices: preset.defaultSettings.enableChoices,
                            choiceCount: preset.defaultSettings.choiceCount,
                          });
                          void updateActiveSessionScenarios(
                            {
                              id: 'preset-scenario',
                              title: preset.defaultScenario.title,
                              presetId: preset.id,
                              source: 'preset',
                              card: {
                                title: preset.defaultScenario.title,
                                content: preset.defaultScenario.content,
                                templateId: '通用情景卡（Markdown）',
                              },
                            },
                            []
                          );
                          setPreferences(() =>
                            patchMagicTavernPreferences({
                              lastPresetId: preset.id,
                              lastWorldbookPresetId: preset.worldbookPresetId,
                              outputFormat: preset.defaultSettings.outputFormat,
                              enableChoices: preset.defaultSettings.enableChoices,
                              choiceCount: preset.defaultSettings.choiceCount,
                            })
                          );
                        }}
                      >
                        <div className="text-sm font-semibold text-pink-800">{preset.title}</div>
                        <div className="mt-1 text-xs text-gray-600">{preset.description}</div>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="rounded-xl border border-pink-100 bg-white p-4">
                  <AiProviderSelector
                    onConfigChange={setUserProviderConfig}
                    storageNamespace="magic-tavern.customProvider"
                    allowSystemProvider={false}
                    label="自备 API Key（必填）"
                  />
                </div>

                <div className="rounded-xl border border-pink-100 bg-white p-4 space-y-3">
                  <div className="text-sm font-semibold text-gray-800">输出偏好</div>
                  <div className="grid gap-3">
                    <div className="grid gap-1">
                      <label className="text-xs font-semibold text-gray-600">你的称呼（{'{{user}}'}）</label>
                      <input
                        className="input-field"
                        value={activeSession?.settings.userDisplayName ?? preferences.userDisplayName}
                        onChange={(event) => {
                          const value = event.target.value.trim().slice(0, 20);
                          setPreferences(() => patchMagicTavernPreferences({ userDisplayName: value || '旅人' }));
                          void updateActiveSessionSettings({ userDisplayName: value || '旅人' });
                        }}
                        placeholder="例如：旅人 / 记者 / 观众"
                      />
                    </div>

                    <div className="grid gap-1">
                      <label className="text-xs font-semibold text-gray-600">输出模式</label>
                      <select
                        className="input-field"
                        value={activeSession?.settings.outputFormat ?? preferences.outputFormat}
                        onChange={(event) => {
                          const value = event.target.value === 'markdown' ? 'markdown' : 'jsonl';
                          setPreferences(() => patchMagicTavernPreferences({ outputFormat: value }));
                          void updateActiveSessionSettings({ outputFormat: value });
                        }}
                      >
                        <option value="jsonl">结构化 JSONL</option>
                        <option value="markdown">Markdown 故事</option>
                      </select>
                    </div>

                    <div className="grid gap-1">
                      <label className="text-xs font-semibold text-gray-600">语言</label>
                      <select
                        className="input-field"
                        value={activeSession?.settings.language ?? preferences.language}
                        onChange={(event) => {
                          const value = event.target.value as any;
                          setPreferences(() => patchMagicTavernPreferences({ language: value }));
                          void updateActiveSessionSettings({ language: value });
                        }}
                      >
                        <option value="zh-CN">中文</option>
                        <option value="ja-JP">日本語</option>
                        <option value="en-US">English</option>
                      </select>
                    </div>

                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-xs font-semibold text-gray-600">启用选项</div>
                        <div className="text-xs text-gray-500">仅对 JSONL 模式有效</div>
                      </div>
                      <input
                        type="checkbox"
                        checked={Boolean(activeSession?.settings.enableChoices ?? preferences.enableChoices)}
                        onChange={(event) => {
                          const enableChoices = Boolean(event.target.checked);
                          setPreferences(() => patchMagicTavernPreferences({ enableChoices }));
                          void updateActiveSessionSettings({ enableChoices });
                        }}
                      />
                    </div>

                    <div className="grid gap-1">
                      <label className="text-xs font-semibold text-gray-600">选项数量</label>
                      <select
                        className="input-field"
                        value={String(activeSession?.settings.choiceCount ?? preferences.choiceCount)}
                        onChange={(event) => {
                          const value = Number(event.target.value);
                          const choiceCount = (value === 2 || value === 4) ? (value as 2 | 4) : 3;
                          setPreferences(() => patchMagicTavernPreferences({ choiceCount }));
                          void updateActiveSessionSettings({ choiceCount });
                        }}
                      >
                        <option value="2">2</option>
                        <option value="3">3</option>
                        <option value="4">4</option>
                      </select>
                    </div>
                  </div>
                </div>
              </aside>

              <main className="space-y-4">
                <div className="rounded-xl border border-pink-100 bg-white p-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold text-gray-800">会话设置</div>
                    <button
                      type="button"
                      className="text-xs text-gray-600 hover:underline"
                      onClick={() => {
                        if (!activeSession) return;
                        void persistSession({
                          ...activeSession,
                          title: activeSession.title,
                          titleMeta: { source: 'manual' },
                          updatedAt: Date.now(),
                        });
                      }}
                      title="标记为手动标题（阻止自动覆盖）"
                    >
                      锁定标题
                    </button>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="text-xs font-semibold text-gray-600">角色</div>
                        <button
                          type="button"
                          className="text-xs text-pink-700 hover:underline"
                          onClick={() => setShowRoleModal(true)}
                          disabled={!activeSession}
                        >
                          浏览在线角色库
                        </button>
                      </div>
                      <input type="file" accept=".json" multiple className="input-field" onChange={onUploadRoles} disabled={!activeSession} />
                      <div className="flex flex-wrap gap-2">
                        {(activeSession?.roles ?? []).length === 0 ? (
                          <div className="text-xs text-gray-500">未选择角色（可选）</div>
                        ) : (
                          (activeSession?.roles ?? []).map((role) => (
                            <span key={role.id} className="inline-flex items-center gap-2 rounded-full bg-pink-50 px-3 py-1 text-xs text-pink-800">
                              {role.name}
                              <button
                                type="button"
                                className="text-pink-700 hover:text-pink-900"
                                onClick={() => void updateActiveSessionRoles((activeSession?.roles ?? []).filter((r) => r.id !== role.id))}
                              >
                                ×
                              </button>
                            </span>
                          ))
                        )}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="text-xs font-semibold text-gray-600">情景</div>
                        <button
                          type="button"
                          className="text-xs text-pink-700 hover:underline"
                          onClick={() => setShowScenarioModal(true)}
                          disabled={!activeSession}
                        >
                          浏览在线情景库
                        </button>
                      </div>
                      <input type="file" accept=".json" multiple className="input-field" onChange={onUploadScenarios} disabled={!activeSession} />
                      <div className="space-y-2">
                        {activeSession?.scenario ? (
                          <div className="rounded-lg border border-pink-100 bg-pink-50 px-3 py-2">
                            <div className="text-xs font-semibold text-pink-800">主情景：{activeSession.scenario.title}</div>
                          </div>
                        ) : (
                          <div className="text-xs text-gray-500">未选择主情景（可选）</div>
                        )}
                        {(activeSession?.auxScenarios ?? []).length > 0 && (
                          <div className="flex flex-wrap gap-2">
                            {(activeSession?.auxScenarios ?? []).map((s) => (
                              <span key={s.id} className="inline-flex items-center gap-2 rounded-full bg-gray-50 px-3 py-1 text-xs text-gray-700">
                                {s.title}
                                <button
                                  type="button"
                                  className="text-gray-500 hover:text-gray-700"
                                  onClick={() => void updateActiveSessionScenarios(activeSession?.scenario, (activeSession?.auxScenarios ?? []).filter((x) => x.id !== s.id))}
                                >
                                  ×
                                </button>
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="grid gap-1">
                      <label className="text-xs font-semibold text-gray-600">扮演方式</label>
                      <select
                        className="input-field"
                        value={activeSession?.playerRoleId ?? ''}
                        onChange={(event) => {
                          if (!activeSession) return;
                          const value = event.target.value;
                          void persistSession({ ...activeSession, playerRoleId: value ? value : null, updatedAt: Date.now() });
                        }}
                      >
                        {playerOptions.map((opt) => (
                          <option key={opt.value || 'user'} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="grid gap-1">
                      <label className="text-xs font-semibold text-gray-600">会话标题</label>
                      <input
                        className="input-field"
                        value={activeSession?.title ?? ''}
                        onChange={(event) => {
                          if (!activeSession) return;
                          void persistSession({ ...activeSession, title: event.target.value, titleMeta: { source: 'manual' }, updatedAt: Date.now() });
                        }}
                        placeholder="输入会话标题"
                      />
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-pink-100 bg-white p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <div className="text-sm font-semibold text-gray-800">对话</div>
                    {isGenerating ? (
                      <button
                        type="button"
                        className="rounded-lg border border-pink-200 bg-white px-3 py-1.5 text-xs font-semibold text-pink-700 hover:bg-pink-50"
                        onClick={stopGenerating}
                      >
                        停止生成
                      </button>
                    ) : null}
                  </div>

                  <div className="space-y-3">
                    {messages.length === 0 ? (
                      <div className="rounded-lg bg-pink-50 px-4 py-3 text-sm text-pink-800">
                        还没有对话。输入你的行动、对白或叙事，例如：我推开酒馆的大门……
                      </div>
                    ) : (
                      messages.map((message) => (
                        <div
                          key={message.id}
                          className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                        >
                          <div className="max-w-[720px] w-full sm:w-auto">{renderMessage(message)}</div>
                        </div>
                      ))
                    )}
                  </div>

                  <div className="mt-4 grid gap-2">
                    <textarea
                      className="input-field h-24 resize-y"
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      placeholder="输入你的行动、对白或叙事，例如：我推开酒馆的大门……"
                      disabled={!activeSession || isGenerating}
                    />
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-xs text-gray-500">
                        {activeSession?.settings.outputFormat === 'markdown'
                          ? '提示：Markdown 模式不会稳定解析选项/角色分段。'
                          : '提示：JSONL 模式可解析旁白/对白/选项。'}
                      </div>
                      <button
                        type="button"
                        className="generate-button m-0"
                        disabled={!activeSession || isGenerating || !draft.trim()}
                        onClick={() => void sendMessage(draft)}
                      >
                        发送
                      </button>
                    </div>
                  </div>
                </div>

                <Footer className="footer mt-4" />
              </main>
            </div>
          </div>
        </div>

        <BattleDataModal
          isOpen={showRoleModal}
          onClose={() => setShowRoleModal(false)}
          selectedType="character"
          selectionMode="multi"
          selectedCardIds={selectedRoleCardIds}
          onToggleCard={(payload, nextSelected) => void onToggleRoleCard(payload, nextSelected)}
          titleOverride="选择登场角色（多选）"
        />

        <BattleDataModal
          isOpen={showScenarioModal}
          onClose={() => setShowScenarioModal(false)}
          selectedType="scenario"
          selectionMode="multi"
          selectedCardIds={selectedScenarioCardIds}
          onToggleCard={(payload, nextSelected) => void onToggleScenarioCard(payload, nextSelected)}
          titleOverride="选择发生场景（多选）"
        />
      </div>
    </>
  );
}
