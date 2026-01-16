import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { UserAIProviderConfig } from '@/components/AiProviderSelector';
import BattleDataModal from '@/components/BattleDataModal';
import { ErrorMessage } from '@/components/ErrorMessage';
import Footer from '@/components/Footer';
import { MagicTavernChatComposer } from '@/components/magic-tavern/ChatComposer';
import { MagicTavernChatTimeline } from '@/components/magic-tavern/ChatTimeline';
import { MagicTavernSessionSidebar } from '@/components/magic-tavern/SessionSidebar';
import { MagicTavernSessionSetupPanel } from '@/components/magic-tavern/SessionSetupPanel';
import { MagicTavernSummaryPanel } from '@/components/magic-tavern/SummaryPanel';
import { MagicTavernTachiePanel } from '@/components/magic-tavern/TachiePanel';

import { persistArrestedBackup } from '@/lib/arrested-backup';
import { getSensitiveWordRedirectTarget } from '@/lib/content-safety/client';
import { inferTemplate } from '@/lib/data-card-converter';
import { createMagicTavernJsonlStreamState, ingestMagicTavernJsonlChunk, parseMagicTavernJsonl } from '@/lib/magic-tavern/jsonl';
import { DEFAULT_MAGIC_TAVERN_PREFERENCES, patchMagicTavernPreferences, readMagicTavernPreferences } from '@/lib/magic-tavern/preferences';
import { type MagicTavernPresetId, getMagicTavernPreset } from '@/lib/magic-tavern/presets';
import {
  deleteMagicTavernSession,
  getMagicTavernSession,
  listMagicTavernMessages,
  listMagicTavernSessions,
  putMagicTavernMessage,
  putMagicTavernSession,
} from '@/lib/magic-tavern/storage';
import { deriveMagicTavernTitle } from '@/lib/magic-tavern/title';
import type {
  MagicTavernMessage,
  MagicTavernPreferences,
  MagicTavernRole,
  MagicTavernScenario,
  MagicTavernSession,
  MagicTavernTachieAsset,
} from '@/lib/magic-tavern/types';
import { applyShieldWords } from '@/lib/shield-word-filter';
import { quickCheck } from '@/lib/sensitive-word-filter';
import { readTextStreamFromResponse } from '@/lib/stream/read-text-stream';
import { useAuth } from '@/lib/useAuth';

const STORAGE_RECENT_SESSION = 'magic-tavern:recent-session';
type MagicTavernOutputFormat = NonNullable<MagicTavernSession['settings']['outputFormat']>;

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

type QuickCheckResult = Awaited<ReturnType<typeof quickCheck>>;

const getEarliestSensitiveStartIndex = (result: QuickCheckResult): number | null => {
  const details = result.matchDetails;
  if (!Array.isArray(details) || details.length === 0) return null;

  let earliest = Number.POSITIVE_INFINITY;
  for (const detail of details) {
    if (!detail || typeof detail.startIndex !== 'number') continue;
    if (detail.startIndex >= 0) earliest = Math.min(earliest, detail.startIndex);
  }

  return Number.isFinite(earliest) ? earliest : null;
};

const findOutputSafetyBoundaryIndex = (text: string, matchStartIndex: number, outputFormat: MagicTavernOutputFormat): number => {
  if (!text) return 0;
  const searchFrom = Math.min(text.length - 1, Math.max(0, matchStartIndex - 1));

  if (outputFormat === 'jsonl') {
    const newline = text.lastIndexOf('\n', searchFrom);
    return newline >= 0 ? newline + 1 : 0;
  }

  let boundary = -1;
  for (const ch of ['\n', '。', '！', '？', '.', '!', '?']) {
    boundary = Math.max(boundary, text.lastIndexOf(ch, searchFrom));
  }
  return boundary >= 0 ? boundary + 1 : 0;
};

const truncateUnsafeOutputText = (
  text: string,
  result: QuickCheckResult,
  outputFormat: MagicTavernOutputFormat
): { safeRaw: string; truncatedAt: number | null } => {
  const matchStart = getEarliestSensitiveStartIndex(result);
  if (matchStart === null) return { safeRaw: text, truncatedAt: null };

  const boundary = findOutputSafetyBoundaryIndex(text, matchStart, outputFormat);
  return { safeRaw: text.slice(0, boundary), truncatedAt: boundary };
};

const isMessageSuperseded = (message: MagicTavernMessage): boolean => {
  const meta = message.meta && typeof message.meta === 'object' ? (message.meta as Record<string, unknown>) : null;
  return Boolean(meta && meta.superseded === true);
};

const shouldIncludeInHistory = (message: MagicTavernMessage): boolean => {
  if (message.role === 'user') return true;
  if (message.role !== 'assistant') return false;
  if (message.status === 'blocked' || message.status === 'error') return false;
  if (isMessageSuperseded(message)) return false;
  return true;
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
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const summarizeAbortControllerRef = useRef<AbortController | null>(null);

  const [showRoleModal, setShowRoleModal] = useState(false);
  const [showScenarioModal, setShowScenarioModal] = useState(false);

	  const [draft, setDraft] = useState('');
	  const [tachieReferenceText, setTachieReferenceText] = useState('');
	  const [tachieAnchorMessageId, setTachieAnchorMessageId] = useState<string | null>(null);
	  const [tachieAssets, setTachieAssets] = useState<MagicTavernTachieAsset[]>([]);

  useEffect(() => {
    const prefs = readMagicTavernPreferences();
    setPreferences(prefs);
  }, []);

	  useEffect(() => {
	    setTachieReferenceText('');
	    setTachieAnchorMessageId(null);
	    setTachieAssets([]);
	  }, [activeSessionId]);

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

  const handleSessionImported = useCallback(
    async (sessionId: string) => {
      await refreshSessions();
      setActiveSessionId(sessionId);
    },
    [refreshSessions]
  );

  const refreshActiveSession = useCallback(async (sessionId: string) => {
    const session = await getMagicTavernSession(sessionId);
    setActiveSession(session);
    const nextMessagesRaw = await listMagicTavernMessages(sessionId);

    const patchedMessages = nextMessagesRaw.map((message) => {
      if (message.role !== 'assistant') return message;
      const metaOutputFormat =
        message.meta && typeof message.meta === 'object' && typeof (message.meta as any).outputFormat === 'string'
          ? String((message.meta as any).outputFormat)
          : null;
      const content = message.content || '';
      const looksJsonl =
        metaOutputFormat === 'jsonl' ||
        content.trim().startsWith('```jsonl') ||
        content.trim().startsWith('{"type"') ||
        content.includes('\n{"type"');
      if (!looksJsonl) return message;

      const parsed = parseMagicTavernJsonl(content);
      if (!Array.isArray(parsed.segments) || parsed.segments.length === 0) return message;

      const storedSegments = Array.isArray(message.segments) ? message.segments : null;
      const storedHasMeaningfulSegment = storedSegments
        ? storedSegments.some((seg) => {
          if (seg.type === 'choices') return Array.isArray(seg.items) && seg.items.length > 0;
          const text = typeof (seg as any)?.text === 'string' ? String((seg as any).text).trim() : '';
          if (!text) return false;
          if (text.startsWith('```') || text.startsWith('~~~')) return false;
          if (text.startsWith('{') || text.startsWith('[')) return false;
          return true;
        })
        : false;

      if (storedHasMeaningfulSegment) return message;

      return {
        ...message,
        segments: parsed.segments,
        ...(parsed.choices ? { choices: parsed.choices } : {}),
      };
    });

    setMessages(patchedMessages);

    const dirtyMessages = patchedMessages.filter((m, idx) => m !== nextMessagesRaw[idx]);
    if (dirtyMessages.length > 0) {
      await Promise.all(dirtyMessages.map((message) => putMagicTavernMessage(message)));
    }

    if (
      session &&
      typeof session.title === 'string' &&
      session.title.trim().toLowerCase() === 'jsonl' &&
      (!session.titleMeta || session.titleMeta.source === 'auto')
    ) {
      const firstAssistant = patchedMessages.find((message) => message.role === 'assistant' && message.content.trim());
      if (firstAssistant) {
        const outputFormat = (session.settings.outputFormat ?? 'jsonl') as MagicTavernOutputFormat;
        const nextTitle = deriveMagicTavernTitle({
          outputFormat,
          content: firstAssistant.content,
          segments: outputFormat === 'jsonl' ? firstAssistant.segments : undefined,
          scenarioTitle: session.scenario?.title,
          roleNames: (session.roles ?? []).map((role) => role.name),
        });
        const titleFiltered = applyShieldWords(nextTitle).filteredText;
        if (titleFiltered && titleFiltered !== session.title) {
          const updatedSession: MagicTavernSession = {
            ...session,
            title: titleFiltered,
            titleMeta: {
              ...(session.titleMeta ?? {}),
              source: 'auto',
              generatedAt: Date.now(),
              reason: session.titleMeta?.reason ?? 'first-message',
            },
            updatedAt: Date.now(),
          };
          await putMagicTavernSession(updatedSession);
          setActiveSession(updatedSession);
          setSessions((prev) => sortSessionsByUpdatedAtDesc([updatedSession, ...prev.filter((item) => item.id !== updatedSession.id)]));
        }
      }
    }
  }, []);

  useEffect(() => {
    if (!activeSession) return;
    if (tachieReferenceText.trim()) return;

    const toPlainText = (message: MagicTavernMessage): string => {
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
    summarizeAbortControllerRef.current?.abort('session-switch');
    summarizeAbortControllerRef.current = null;
    setIsSummarizing(false);
    setSummaryError(null);

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

  const applyPreferencePatch = useCallback((patch: Partial<MagicTavernPreferences>) => {
    setPreferences(() => patchMagicTavernPreferences(patch));
  }, []);

  const applyPreset = useCallback(
    (presetId: MagicTavernPresetId) => {
      const preset = getMagicTavernPreset(presetId);
      if (!preset) return;

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

      applyPreferencePatch({
        lastPresetId: preset.id,
        lastWorldbookPresetId: preset.worldbookPresetId,
        outputFormat: preset.defaultSettings.outputFormat,
        enableChoices: preset.defaultSettings.enableChoices,
        choiceCount: preset.defaultSettings.choiceCount,
      });
    },
    [activeSession, applyPreferencePatch, createSession, updateActiveSessionScenarios, updateActiveSessionSettings]
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

  type MagicTavernHistoryMessage = { id: string; role: 'user' | 'assistant' | 'system'; content: string };

  const runGenerateStream = useCallback(
    async (params: {
      session: MagicTavernSession;
      historyForRequest: MagicTavernHistoryMessage[];
      outputFormat: MagicTavernOutputFormat;
      assistantMessageId: string;
      assistantMessage: MagicTavernMessage;
      arrestedBackupInput?: string;
    }) => {
      const controller = new AbortController();
      abortControllerRef.current = controller;
      setIsGenerating(true);

      let streamedRawSoFar = '';
      let streamedSafeSoFar = '';
      let outputBlockedAt: number | null = null;
      let outputSafetyTruncatedAt: number | null = null;
      let safetyCheckTimer: ReturnType<typeof setTimeout> | null = null;
      let safetyCheckInFlight = false;
      const jsonlStreamState = params.outputFormat === 'jsonl' ? createMagicTavernJsonlStreamState() : null;
      let lastSafeSnapshot = '';

      const updateStreamingPreview = (safePreview: string) => {
        streamedSafeSoFar = safePreview;

        if (jsonlStreamState) {
          if (safePreview.startsWith(lastSafeSnapshot)) {
            const delta = safePreview.slice(lastSafeSnapshot.length);
            ingestMagicTavernJsonlChunk(jsonlStreamState, delta);
          } else {
            const resetState = createMagicTavernJsonlStreamState();
            ingestMagicTavernJsonlChunk(resetState, safePreview);
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

      try {
        const response = await fetch('/api/magic-tavern/generate-stream', {
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
                origin: '/magic-tavern',
                items: [
                  {
                    label: '魔法酒馆输入',
                    filename: 'magic-tavern-input.txt',
                    mimeType: 'text/plain',
                    content: params.arrestedBackupInput,
                  },
                ],
              });
            }

            const blockedMessage: MagicTavernMessage = {
              ...params.assistantMessage,
              status: 'blocked',
              safety: { status: 'blocked', blockedBy: 'server', blockedAt: Date.now(), action: 'redirect' },
              error: { code: `${response.status}`, message: reason },
            };

            setMessages((prev) => prev.map((m) => (m.id === params.assistantMessageId ? blockedMessage : m)));
            await putMagicTavernMessage(blockedMessage);

            await router.push('/arrested');
            return;
          }

          const errorMessage =
            typeof payload?.error === 'string'
              ? payload.error
              : typeof payload?.message === 'string'
                ? payload.message
                : `请求失败（${response.status}）`;

          const errorMessageRecord: MagicTavernMessage = {
            ...params.assistantMessage,
            status: 'error',
            error: { code: `${response.status}`, message: errorMessage },
          };

          setMessages((prev) => prev.map((m) => (m.id === params.assistantMessageId ? errorMessageRecord : m)));
          await putMagicTavernMessage(errorMessageRecord);
          return;
        }

        setMessages((prev) => prev.map((m) => (m.id === params.assistantMessageId ? { ...m, content: '', status: 'streaming' } : m)));

        const scheduleSafetyCheck = () => {
          if (outputBlockedAt) return;
          if (safetyCheckTimer) return;
          safetyCheckTimer = setTimeout(() => {
            safetyCheckTimer = null;
            void runSafetyCheck();
          }, 120);
        };

        const runSafetyCheck = async () => {
          if (outputBlockedAt) return;
          if (safetyCheckInFlight) {
            scheduleSafetyCheck();
            return;
          }

          safetyCheckInFlight = true;
          const snapshot = streamedRawSoFar;
          try {
            const result = await quickCheck(snapshot);
            if (outputBlockedAt) return;

            if (result.hasSensitiveWords) {
              const { safeRaw, truncatedAt } = truncateUnsafeOutputText(snapshot, result, params.outputFormat);
              const safeText = applyShieldWords(safeRaw).filteredText;
              streamedSafeSoFar = safeText;
              outputBlockedAt = Date.now();
              outputSafetyTruncatedAt = truncatedAt;
              setMessages((prev) =>
                prev.map((m) => (m.id === params.assistantMessageId ? { ...m, content: safeText, status: 'blocked' } : m))
              );
              controller.abort('output-safety');
              return;
            }

            const safePreview = applyShieldWords(snapshot).filteredText;
            updateStreamingPreview(safePreview);
          } finally {
            safetyCheckInFlight = false;
            if (!outputBlockedAt && streamedRawSoFar !== snapshot) scheduleSafetyCheck();
          }
        };

        const streamedText = await readTextStreamFromResponse(response, {
          label: '魔法酒馆',
          onText: (accumulated) => {
            streamedRawSoFar = accumulated;
            scheduleSafetyCheck();
          },
        });

        if (safetyCheckTimer) {
          clearTimeout(safetyCheckTimer);
          safetyCheckTimer = null;
        }

        let status: MagicTavernMessage['status'] = outputBlockedAt ? 'blocked' : 'done';
        let safeText = streamedSafeSoFar;

        if (!outputBlockedAt) {
          const sensitive = await quickCheck(streamedText);
          if (sensitive.hasSensitiveWords) {
            const truncated = truncateUnsafeOutputText(streamedText, sensitive, params.outputFormat);
            safeText = applyShieldWords(truncated.safeRaw).filteredText;
            status = 'blocked';
            outputBlockedAt = Date.now();
            outputSafetyTruncatedAt = truncated.truncatedAt;
          } else {
            safeText = applyShieldWords(streamedText).filteredText;
            status = 'done';
          }
        }

        const parsed = params.outputFormat === 'jsonl' ? parseMagicTavernJsonl(safeText) : { segments: undefined, choices: null };

        const finalAssistant: MagicTavernMessage = {
          ...params.assistantMessage,
          content: safeText,
          status,
          ...(params.outputFormat === 'jsonl' && parsed.segments ? { segments: parsed.segments, choices: parsed.choices ?? undefined } : {}),
          ...(status === 'blocked'
            ? { safety: { status: 'blocked', blockedBy: 'output', blockedAt: outputBlockedAt ?? Date.now(), action: 'soft-block' } }
            : { safety: { status: 'ok' } }),
          ...(status === 'blocked' && typeof outputSafetyTruncatedAt === 'number' ? { truncatedAt: outputSafetyTruncatedAt } : {}),
        };

        setMessages((prev) => prev.map((m) => (m.id === params.assistantMessageId ? finalAssistant : m)));
        await putMagicTavernMessage(finalAssistant);

        const shouldAutoTitle = !params.session.titleMeta || params.session.titleMeta.source === 'auto';
        if (shouldAutoTitle && (params.session.title === '新会话' || params.session.title === '未命名会话')) {
          const nextTitle = deriveMagicTavernTitle({
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
        if (safetyCheckTimer) {
          clearTimeout(safetyCheckTimer);
          safetyCheckTimer = null;
        }

        if (error instanceof Error && error.name === 'AbortError') {
          const reason = controller.signal.reason;
          const rawSnapshot = streamedRawSoFar;

          if (outputBlockedAt || reason === 'output-safety') {
            const currentText = streamedSafeSoFar || applyShieldWords(rawSnapshot).filteredText;
            const parsed = params.outputFormat === 'jsonl' ? parseMagicTavernJsonl(currentText) : { segments: undefined, choices: null };
            const finalAssistant: MagicTavernMessage = {
              ...params.assistantMessage,
              content: currentText,
              status: 'blocked',
              ...(params.outputFormat === 'jsonl' && parsed.segments ? { segments: parsed.segments, choices: parsed.choices ?? undefined } : {}),
              safety: { status: 'blocked', blockedBy: 'output', blockedAt: outputBlockedAt ?? Date.now(), action: 'soft-block' },
              ...(typeof outputSafetyTruncatedAt === 'number' ? { truncatedAt: outputSafetyTruncatedAt } : {}),
            };
            setMessages((prev) => prev.map((m) => (m.id === params.assistantMessageId ? finalAssistant : m)));
            await putMagicTavernMessage(finalAssistant);
            return;
          }

          const sensitive = await quickCheck(rawSnapshot);
          const safeText = sensitive.hasSensitiveWords
            ? applyShieldWords(truncateUnsafeOutputText(rawSnapshot, sensitive, params.outputFormat).safeRaw).filteredText
            : applyShieldWords(rawSnapshot).filteredText;
          const status: MagicTavernMessage['status'] = sensitive.hasSensitiveWords ? 'blocked' : 'done';
          const parsed = params.outputFormat === 'jsonl' ? parseMagicTavernJsonl(safeText) : { segments: undefined, choices: null };
          const finalAssistant: MagicTavernMessage = {
            ...params.assistantMessage,
            content: safeText,
            status,
            ...(params.outputFormat === 'jsonl' && parsed.segments ? { segments: parsed.segments, choices: parsed.choices ?? undefined } : {}),
            ...(status === 'blocked'
              ? { safety: { status: 'blocked', blockedBy: 'output', blockedAt: Date.now(), action: 'soft-block' } }
              : { safety: { status: 'ok' } }),
          };
          setMessages((prev) => prev.map((m) => (m.id === params.assistantMessageId ? finalAssistant : m)));
          await putMagicTavernMessage(finalAssistant);
          return;
        }

        const message = error instanceof Error ? error.message : '生成失败';
        const errorRecord: MagicTavernMessage = { ...params.assistantMessage, status: 'error', error: { code: 'exception', message } };
        setMessages((prev) => prev.map((m) => (m.id === params.assistantMessageId ? errorRecord : m)));
        await putMagicTavernMessage(errorRecord);
      } finally {
        abortControllerRef.current = null;
        setIsGenerating(false);
      }
    },
    [persistSession, router, userProviderConfig]
  );

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
      const sessionOutputFormat = (activeSession.settings.outputFormat ?? 'jsonl') as MagicTavernOutputFormat;
      const playerRoleIdAtSend = activeSession.playerRoleId ?? null;
      const userDisplayNameAtSend =
        (activeSession.settings.userDisplayName || preferences.userDisplayName || '旅人').trim() || '旅人';
      const playerRoleNameAtSend = playerRoleIdAtSend
        ? (activeSession.roles ?? []).find((role) => role.id === playerRoleIdAtSend)?.name ?? ''
        : '';
      const userMessage: MagicTavernMessage = {
        id: createUuid(),
        sessionId: activeSession.id,
        role: 'user',
        content: trimmed,
        createdAt: now,
        status: 'done',
        ...(playerRoleIdAtSend ? { speakerId: playerRoleIdAtSend } : {}),
        meta: { speakerName: playerRoleIdAtSend ? playerRoleNameAtSend || playerRoleIdAtSend : userDisplayNameAtSend },
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
        meta: { kind: 'reply', outputFormat: sessionOutputFormat },
      };

      const nextMessages = [...messages, userMessage, assistantMessage];
      setMessages(nextMessages);
      setDraft('');

      await putMagicTavernMessage(userMessage);
      await putMagicTavernMessage(assistantMessage);

      const updatedSession: MagicTavernSession = { ...activeSession, updatedAt: now };
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
    },
    [activeSession, ensureProviderReady, isGenerating, messages, persistSession, preferences.userDisplayName, router, runGenerateStream]
  );

  const continueGeneration = useCallback(async () => {
    if (!activeSession) return;
    if (isGenerating) return;

    const providerCheck = ensureProviderReady();
    if (!providerCheck.ok) {
      setGlobalError(providerCheck.message);
      return;
    }

    setGlobalError(null);

    const now = Date.now();
    const sessionOutputFormat = (activeSession.settings.outputFormat ?? 'jsonl') as MagicTavernOutputFormat;

    const assistantMessageId = createUuid();
    const lastUserMessageId = [...messages].reverse().find((message) => message.role === 'user')?.id;
    const kind = messages.length === 0 ? 'opening' : 'continue';

    const assistantMessage: MagicTavernMessage = {
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
    await putMagicTavernMessage(assistantMessage);

    const updatedSession: MagicTavernSession = { ...activeSession, updatedAt: now };
    await persistSession(updatedSession);

    const baseHistory = messages
      .filter(shouldIncludeInHistory)
      .map((m) => ({ id: m.id, role: m.role, content: m.content }));

    const systemInstruction: MagicTavernHistoryMessage = {
      id: createUuid(),
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
  }, [activeSession, ensureProviderReady, isGenerating, messages, persistSession, runGenerateStream]);

  const generateChoices = useCallback(async () => {
    if (!activeSession) return;
    if (isGenerating) return;

    const providerCheck = ensureProviderReady();
    if (!providerCheck.ok) {
      setGlobalError(providerCheck.message);
      return;
    }

    setGlobalError(null);

    const now = Date.now();
    const assistantMessageId = createUuid();
    const lastUserMessageId = [...messages].reverse().find((message) => message.role === 'user')?.id;
    const assistantMessage: MagicTavernMessage = {
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
    await putMagicTavernMessage(assistantMessage);

    const updatedSession: MagicTavernSession = { ...activeSession, updatedAt: now };
    await persistSession(updatedSession);

    const historyForRequest = messages
      .filter(shouldIncludeInHistory)
      .map((m) => ({ id: m.id, role: m.role, content: m.content }));

    const controller = new AbortController();
    abortControllerRef.current = controller;
    setIsGenerating(true);

    let streamedRawSoFar = '';
    let streamedSafeSoFar = '';
    let outputBlockedAt: number | null = null;
    let outputSafetyTruncatedAt: number | null = null;
    let safetyCheckTimer: ReturnType<typeof setTimeout> | null = null;
    let safetyCheckInFlight = false;
    const jsonlStreamState = createMagicTavernJsonlStreamState();
    let lastSafeSnapshot = '';

    const updateStreamingPreview = (safePreview: string, status?: MagicTavernMessage['status']) => {
      streamedSafeSoFar = safePreview;
      if (safePreview.startsWith(lastSafeSnapshot)) {
        const delta = safePreview.slice(lastSafeSnapshot.length);
        ingestMagicTavernJsonlChunk(jsonlStreamState, delta);
      } else {
        const resetState = createMagicTavernJsonlStreamState();
        ingestMagicTavernJsonlChunk(resetState, safePreview);
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
    try {
      const response = await fetch('/api/magic-tavern/generate-choices', {
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
          const blockedMessage: MagicTavernMessage = {
            ...assistantMessage,
            status: 'blocked',
            safety: { status: 'blocked', blockedBy: 'server', blockedAt: Date.now(), action: 'redirect' },
            error: { code: `${response.status}`, message: reason },
          };
          setMessages((prev) => prev.map((m) => (m.id === assistantMessageId ? blockedMessage : m)));
          await putMagicTavernMessage(blockedMessage);
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

      const scheduleSafetyCheck = () => {
        if (outputBlockedAt) return;
        if (safetyCheckTimer) return;
        safetyCheckTimer = setTimeout(() => {
          safetyCheckTimer = null;
          void runSafetyCheck();
        }, 120);
      };

      const runSafetyCheck = async () => {
        if (outputBlockedAt) return;
        if (safetyCheckInFlight) {
          scheduleSafetyCheck();
          return;
        }

        safetyCheckInFlight = true;
        const snapshot = streamedRawSoFar;
        try {
          const result = await quickCheck(snapshot);
          if (outputBlockedAt) return;

          if (result.hasSensitiveWords) {
            const { safeRaw, truncatedAt } = truncateUnsafeOutputText(snapshot, result, 'jsonl');
            const safeText = applyShieldWords(safeRaw).filteredText;
            outputBlockedAt = Date.now();
            outputSafetyTruncatedAt = truncatedAt;
            updateStreamingPreview(safeText, 'blocked');
            controller.abort('output-safety');
            return;
          }

          const safePreview = applyShieldWords(snapshot).filteredText;
          updateStreamingPreview(safePreview);
        } finally {
          safetyCheckInFlight = false;
          if (!outputBlockedAt && streamedRawSoFar !== snapshot) scheduleSafetyCheck();
        }
      };

      const streamedText = await readTextStreamFromResponse(response, {
        label: '魔法酒馆选项',
        onText: (accumulated) => {
          streamedRawSoFar = accumulated;
          scheduleSafetyCheck();
        },
      });

      if (safetyCheckTimer) {
        clearTimeout(safetyCheckTimer);
        safetyCheckTimer = null;
      }

      let status: MagicTavernMessage['status'] = outputBlockedAt ? 'blocked' : 'done';
      let safeText = streamedSafeSoFar || (outputBlockedAt ? applyShieldWords(streamedRawSoFar).filteredText : '');
      let blockedAt: number | null = outputBlockedAt;
      let truncatedAt: number | null = outputSafetyTruncatedAt;

      if (!outputBlockedAt) {
        const sensitive = await quickCheck(streamedText);
        safeText = applyShieldWords(streamedText).filteredText;
        if (sensitive.hasSensitiveWords) {
          const truncated = truncateUnsafeOutputText(streamedText, sensitive, 'jsonl');
          safeText = applyShieldWords(truncated.safeRaw).filteredText;
          status = 'blocked';
          blockedAt = Date.now();
          truncatedAt = truncated.truncatedAt;
        } else {
          status = 'done';
        }
      }

      const parsed = parseMagicTavernJsonl(safeText);
      const finalAssistant: MagicTavernMessage = {
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
      await putMagicTavernMessage(finalAssistant);
      await persistSession({ ...updatedSession, updatedAt: Date.now() });
    } catch (error) {
      if (safetyCheckTimer) {
        clearTimeout(safetyCheckTimer);
        safetyCheckTimer = null;
      }
      if (error instanceof Error && error.name === 'AbortError') {
        const reason = controller.signal.reason;
        if (outputBlockedAt || reason === 'output-safety') {
          const currentText = streamedSafeSoFar || applyShieldWords(streamedRawSoFar).filteredText;
          const parsed = parseMagicTavernJsonl(currentText);
          const finalAssistant: MagicTavernMessage = {
            ...assistantMessage,
            content: currentText,
            status: 'blocked',
            ...(parsed.segments ? { segments: parsed.segments, choices: parsed.choices ?? undefined } : {}),
            safety: { status: 'blocked', blockedBy: 'output', blockedAt: outputBlockedAt ?? Date.now(), action: 'soft-block' },
            ...(typeof outputSafetyTruncatedAt === 'number' ? { truncatedAt: outputSafetyTruncatedAt } : {}),
          };
          setMessages((prev) => prev.map((m) => (m.id === assistantMessageId ? finalAssistant : m)));
          await putMagicTavernMessage(finalAssistant);
          return;
        }

        const sensitive = await quickCheck(streamedRawSoFar);
        const safeText = sensitive.hasSensitiveWords
          ? applyShieldWords(truncateUnsafeOutputText(streamedRawSoFar, sensitive, 'jsonl').safeRaw).filteredText
          : applyShieldWords(streamedRawSoFar).filteredText;
        const status: MagicTavernMessage['status'] = sensitive.hasSensitiveWords ? 'blocked' : 'done';
        const parsed = parseMagicTavernJsonl(safeText);
        const finalAssistant: MagicTavernMessage = {
          ...assistantMessage,
          content: safeText,
          status,
          ...(parsed.segments ? { segments: parsed.segments, choices: parsed.choices ?? undefined } : {}),
          ...(status === 'blocked'
            ? { safety: { status: 'blocked', blockedBy: 'output', blockedAt: Date.now(), action: 'soft-block' } }
            : { safety: { status: 'ok' } }),
        };
        setMessages((prev) => prev.map((m) => (m.id === assistantMessageId ? finalAssistant : m)));
        await putMagicTavernMessage(finalAssistant);
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
  }, [activeSession, ensureProviderReady, isGenerating, messages, persistSession, preferences.choiceCount, router, userProviderConfig]);

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
      setGlobalError(providerCheck.message);
      return;
    }

    if (!userProviderConfig) {
      setGlobalError('请先配置模型与 API Key。');
      return;
    }

    setGlobalError(null);
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
      const response = await fetch('/api/magic-tavern/summarize', {
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
      const summaryMeta: MagicTavernSession['summaryMeta'] = {
        updatedAt: now,
        fromMessageId: historyForRequest[0]?.id,
        toMessageId: historyForRequest[historyForRequest.length - 1]?.id,
      };

      const nextSession: MagicTavernSession = { ...activeSession, summary: safeText, summaryMeta, updatedAt: now };
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
    persistSession,
    preferences.language,
    preferences.userDisplayName,
    userProviderConfig,
  ]);

  const regenerateMessage = useCallback(
    async (targetMessage: MagicTavernMessage) => {
      if (!activeSession) return;
      if (isGenerating) return;
      if (targetMessage.role !== 'assistant') return;

      const providerCheck = ensureProviderReady();
      if (!providerCheck.ok) {
        setGlobalError(providerCheck.message);
        return;
      }

      setGlobalError(null);

      const meta = targetMessage.meta && typeof targetMessage.meta === 'object' ? (targetMessage.meta as Record<string, unknown>) : null;
      const kindRaw = typeof meta?.kind === 'string' ? String(meta.kind) : 'reply';
      if (kindRaw === 'choices') {
        setGlobalError('选项消息请使用“生成选项”重新获取。');
        return;
      }
      const kind = kindRaw === 'opening' || kindRaw === 'continue' ? kindRaw : 'reply';

      const targetIndex = messages.findIndex((message) => message.id === targetMessage.id);
      if (targetIndex < 0) return;

      const historyBefore = messages.slice(0, targetIndex);
      const historyForRequestBase: MagicTavernHistoryMessage[] = historyBefore
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
          setGlobalError('找不到关联的用户输入，无法重新生成。');
          return;
        }
        sourceMessageId = sourceMessage.id;
        arrestedBackupInput = sourceMessage.content;
      } else if (lastUserMessage) {
        sourceMessageId = lastUserMessage.id;
      }

      const now = Date.now();
      const sessionOutputFormat = (activeSession.settings.outputFormat ?? 'jsonl') as MagicTavernOutputFormat;

      const supersededMessage: MagicTavernMessage = {
        ...targetMessage,
        meta: { ...(targetMessage.meta ?? {}), superseded: true },
      };
      setMessages((prev) => prev.map((message) => (message.id === targetMessage.id ? supersededMessage : message)));
      await putMagicTavernMessage(supersededMessage);

      const assistantMessageId = createUuid();
      const assistantMessage: MagicTavernMessage = {
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
      await putMagicTavernMessage(assistantMessage);

      const updatedSession: MagicTavernSession = { ...activeSession, updatedAt: now };
      await persistSession(updatedSession);

      const historyForRequest: MagicTavernHistoryMessage[] =
        kind === 'opening' || kind === 'continue'
          ? [
              ...historyForRequestBase,
              {
                id: createUuid(),
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
    [activeSession, ensureProviderReady, isGenerating, messages, persistSession, runGenerateStream]
  );

  const playerOptions = useMemo(() => {
    const roles = activeSession?.roles ?? [];
    return [
      { value: '', label: `{{user}}（${activeSession?.settings.userDisplayName || preferences.userDisplayName || '旅人'}）` },
      ...roles.map((role) => ({ value: role.id, label: role.name })),
    ];
  }, [activeSession?.roles, activeSession?.settings.userDisplayName, preferences.userDisplayName]);

  const lockSessionTitle = useCallback(() => {
    if (!activeSession) return;
    void persistSession({
      ...activeSession,
      title: activeSession.title,
      titleMeta: { source: 'manual' },
      updatedAt: Date.now(),
    });
  }, [activeSession, persistSession]);

  const updateSessionTitle = useCallback(
    (title: string) => {
      if (!activeSession) return;
      void persistSession({ ...activeSession, title, titleMeta: { source: 'manual' }, updatedAt: Date.now() });
    },
    [activeSession, persistSession]
  );

  const updatePlayerRole = useCallback(
    (roleId: string | null) => {
      if (!activeSession) return;
      void persistSession({ ...activeSession, playerRoleId: roleId, updatedAt: Date.now() });
    },
    [activeSession, persistSession]
  );



  const lastAssistantId = useMemo(() => {
    const lastAssistant = [...messages].reverse().find((message) => message.role === 'assistant');
    return lastAssistant?.id ?? null;
  }, [messages]);

  const canRegenerateMessage = useCallback(
    (message: MagicTavernMessage): boolean => {
      if (message.role !== 'assistant') return false;
      if (message.status === 'streaming') return false;
      if (!lastAssistantId || message.id !== lastAssistantId) return false;
      const meta = message.meta && typeof message.meta === 'object' ? (message.meta as Record<string, unknown>) : null;
      const kind = typeof meta?.kind === 'string' ? String(meta.kind) : '';
      if (kind === 'choices') return false;
      return true;
    },
    [lastAssistantId]
  );
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
              <div className="mt-4">
                <ErrorMessage
                  message={globalError}
                  className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
                  linkClassName="text-red-700 underline underline-offset-2 hover:opacity-95"
                />
              </div>
            )}

            <div className="mt-6 grid gap-6 lg:grid-cols-[320px_1fr]">
              <MagicTavernSessionSidebar
                sessions={sessions}
                activeSessionId={activeSessionId}
                activeSession={activeSession}
                preferences={preferences}
                onCreateSession={(presetId) => void createSession(presetId)}
                onSelectSession={setActiveSessionId}
                onDeleteSession={(sessionId) => void deleteSession(sessionId)}
                onSessionImported={handleSessionImported}
                onPresetSelected={(presetId) => applyPreset(presetId)}
                onProviderConfigChange={setUserProviderConfig}
                onPreferenceChange={applyPreferencePatch}
                onSessionSettingChange={updateActiveSessionSettings}
              />

              <main className="space-y-4">
                <MagicTavernSessionSetupPanel
                  activeSession={activeSession}
                  playerOptions={playerOptions}
                  onOpenRoleModal={() => setShowRoleModal(true)}
                  onOpenScenarioModal={() => setShowScenarioModal(true)}
                  onUploadRoles={onUploadRoles}
                  onUploadScenarios={onUploadScenarios}
                  onUpdateRoles={(roles) => void updateActiveSessionRoles(roles)}
                  onUpdateScenarios={(scenario, auxScenarios) => void updateActiveSessionScenarios(scenario, auxScenarios)}
                  onUpdatePlayerRole={updatePlayerRole}
                  onUpdateTitle={updateSessionTitle}
                  onLockTitle={lockSessionTitle}
                />
                <MagicTavernSummaryPanel
                  activeSession={activeSession}
                  isGenerating={isGenerating}
                  isSummarizing={isSummarizing}
                  summaryError={summaryError}
                  hasMessages={messages.length > 0}
                  onGenerateSummary={() => void generateSummary()}
                  onClearSummary={() => void clearSummary()}
                  onSummaryChange={(value) => {
                    if (!activeSession) return;
                    const trimmed = value.trim();
                    const now = Date.now();
                    void persistSession({
                      ...activeSession,
                      summary: trimmed ? trimmed : undefined,
                      summaryMeta: trimmed ? { ...(activeSession.summaryMeta ?? {}), updatedAt: now } : undefined,
                      updatedAt: now,
                    });
                  }}
                />

                <div className="rounded-xl border border-pink-100 bg-white p-4">
                  <MagicTavernChatTimeline
                    activeSession={activeSession}
                    preferences={preferences}
                    messages={messages}
                    isGenerating={isGenerating}
                    tachieAssets={tachieAssets}
                    onStopGenerating={stopGenerating}
                    onSelectChoice={(text) => void sendMessage(text)}
                    onUseAsReference={(target, plainText) => {
                      setTachieReferenceText(plainText);
                      setTachieAnchorMessageId(target.id);
                    }}
                    onRegenerate={(target) => void regenerateMessage(target)}
                    canRegenerateMessage={canRegenerateMessage}
                  />

                  <MagicTavernChatComposer
                    activeSession={activeSession}
                    preferences={preferences}
                    draft={draft}
                    onDraftChange={setDraft}
                    onSend={(value) => void sendMessage(value)}
                    onContinue={() => void continueGeneration()}
                    onGenerateChoices={() => void generateChoices()}
                    isGenerating={isGenerating}
                    hasMessages={messages.length > 0}
                  />
                </div>

	                  {activeSession ? (
	                    <MagicTavernTachiePanel
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
