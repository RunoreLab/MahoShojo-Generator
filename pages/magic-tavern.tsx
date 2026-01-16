import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { ChangeEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import AiProviderSelector, { type UserAIProviderConfig } from '@/components/AiProviderSelector';
import BattleDataModal from '@/components/BattleDataModal';
import { ErrorMessage } from '@/components/ErrorMessage';
import Footer from '@/components/Footer';
import { MarkdownBlock } from '@/components/MarkdownBlock';
import { MagicTavernTachiePanel } from '@/components/magic-tavern/TachiePanel';

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

const LoadingSpinner = ({ className = 'h-3 w-3' }: { className?: string }) => (
  <span
    className={`inline-block ${className} animate-spin rounded-full border-2 border-pink-200 border-t-pink-600`}
    aria-hidden="true"
  />
);

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

  useEffect(() => {
    const prefs = readMagicTavernPreferences();
    setPreferences(prefs);
  }, []);

  useEffect(() => {
    setTachieReferenceText('');
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
    setTachieReferenceText((prev) => {
      if (prev.trim()) return prev;
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
      if (lastAssistant) return toPlainText(lastAssistant).slice(0, 2000);
      const lastUser = [...messages].reverse().find((m) => m.role === 'user' && (m.content || '').trim());
      if (lastUser) return toPlainText(lastUser).slice(0, 2000);
      return '';
    });
  }, [activeSession, messages]);

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
            streamedSafeSoFar = safePreview;
            setMessages((prev) => prev.map((m) => (m.id === params.assistantMessageId ? { ...m, content: safePreview } : m)));
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
        .filter((m) => m.role === 'user' || (m.role === 'assistant' && m.status !== 'blocked' && m.status !== 'error'))
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
      .filter((m) => m.role === 'user' || (m.role === 'assistant' && m.status !== 'blocked' && m.status !== 'error'))
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
      .filter((m) => m.role === 'user' || (m.role === 'assistant' && m.status !== 'blocked' && m.status !== 'error'))
      .map((m) => ({ id: m.id, role: m.role, content: m.content }));

    const controller = new AbortController();
    abortControllerRef.current = controller;
    setIsGenerating(true);

    let streamedRawSoFar = '';
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

      const streamedText = await readTextStreamFromResponse(response, {
        label: '魔法酒馆选项',
        onText: (accumulated) => {
          streamedRawSoFar = accumulated;
          const preview = applyShieldWords(accumulated).filteredText;
          setMessages((prev) => prev.map((m) => (m.id === assistantMessageId ? { ...m, content: preview } : m)));
        },
      });

      const sensitive = await quickCheck(streamedText);
      let status: MagicTavernMessage['status'] = 'done';
      let safeText = applyShieldWords(streamedText).filteredText;
      let blockedAt: number | null = null;
      let truncatedAt: number | null = null;
      if (sensitive.hasSensitiveWords) {
        const truncated = truncateUnsafeOutputText(streamedText, sensitive, 'jsonl');
        safeText = applyShieldWords(truncated.safeRaw).filteredText;
        status = 'blocked';
        blockedAt = Date.now();
        truncatedAt = truncated.truncatedAt;
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
      if (error instanceof Error && error.name === 'AbortError') {
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
      .filter((m) => m.role === 'user' || (m.role === 'assistant' && m.status !== 'blocked' && m.status !== 'error'))
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

  const playerOptions = useMemo(() => {
    const roles = activeSession?.roles ?? [];
    return [
      { value: '', label: `{{user}}（${activeSession?.settings.userDisplayName || preferences.userDisplayName || '旅人'}）` },
      ...roles.map((role) => ({ value: role.id, label: role.name })),
    ];
  }, [activeSession?.roles, activeSession?.settings.userDisplayName, preferences.userDisplayName]);

  const renderAssistantFooter = (message: MagicTavernMessage) => {
    if (message.role !== 'assistant') return null;

    if (message.status === 'streaming') {
      return (
        <div className="mt-2 flex items-center gap-2 text-xs text-gray-500">
          <LoadingSpinner />
          <span>生成中…</span>
        </div>
      );
    }

    if (message.status === 'blocked') {
      const blockedBy = message.safety?.blockedBy;
      const hint =
        blockedBy === 'server'
          ? '该内容不符合安全策略，已被拦截。'
          : '本轮输出被安全策略截断（可尝试修改输入或重新生成）。';
      return (
        <div className="mt-2 text-xs text-amber-700">
          <span>{hint}</span>
          <Link href="/encyclopedia/sensitive-words" className="ml-2 underline underline-offset-2 hover:opacity-90">
            查看百科：敏感词与逮捕
          </Link>
        </div>
      );
    }

    if (message.status === 'error') {
      const rawCode = message.error?.code ?? '';
      const status = /^\d{3}$/.test(rawCode) ? Number(rawCode) : null;
      const kind =
        message.meta && typeof message.meta === 'object' && typeof (message.meta as any).kind === 'string'
          ? String((message.meta as any).kind)
          : '';

      const title =
        kind === 'choices'
          ? '生成选项失败'
          : kind === 'opening'
            ? '生成开场失败'
            : kind === 'continue'
              ? '继续生成失败'
              : '生成失败';

      const lines: string[] = [`❌ ${title}`];
      if (status) lines.push(`HTTP：${status}`);
      else if (rawCode) lines.push(`错误码：${rawCode}`);
      if (message.error?.message?.trim()) lines.push(`原因：${message.error.message.trim()}`);

      return (
        <div className="mt-2">
          <ErrorMessage
            message={lines.join('\n')}
            status={status}
            className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
            linkClassName="text-red-700 underline underline-offset-2 hover:opacity-95"
          />
        </div>
      );
    }

    return null;
  };

  const renderAssistantActions = (message: MagicTavernMessage) => {
    if (message.role !== 'assistant') return null;
    if (message.status === 'streaming') return null;

    const toPlainText = (): string => {
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
                  ? (activeSession?.roles ?? []).find((r) => r.id === String((seg as any).speakerId))?.name || String((seg as any).speakerId)
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

    const plain = toPlainText();
    if (!plain) return null;

    return (
      <div className="mt-2 flex items-center justify-end gap-2 text-xs text-gray-500">
        <button
          type="button"
          className="underline underline-offset-2 hover:text-gray-700"
          onClick={() => setTachieReferenceText(plain.slice(0, 2000))}
          title="将该条 AI 输出作为插画/立绘的参考片段"
        >
          用作插画参考
        </button>
      </div>
    );
  };

  const renderMessage = (message: MagicTavernMessage) => {
    const isUser = message.role === 'user';
    const bubbleClass = isUser ? 'bg-pink-600 text-white' : 'bg-white border border-pink-100 text-gray-800';
    const speakerName =
      message.meta && typeof message.meta === 'object' && typeof (message.meta as any).speakerName === 'string'
        ? String((message.meta as any).speakerName).trim()
        : '';
    const bubbleSpeaker =
      speakerName ||
      (message.role === 'system'
        ? 'system'
        : message.role === 'user'
        ? message.speakerId
          ? (activeSession?.roles ?? []).find((role) => role.id === message.speakerId)?.name || message.speakerId
          : (activeSession?.settings.userDisplayName || preferences.userDisplayName || '旅人').trim() || '旅人'
        : (() => {
            const presetId =
              activeSession?.settings && typeof activeSession.settings.presetId === 'string' ? activeSession.settings.presetId : '';
            const prefix = presetId.startsWith('arena-') ? 'A.R.E.N.A. 魔法酒馆' : '魔法酒馆';
            return `${prefix} · 叙述者`;
          })());
    const speakerClass = `px-1 text-xs font-semibold ${isUser ? 'text-right text-pink-700' : 'text-gray-600'}`;
    const withHeader = (bubble: ReactNode) => (
      <div className="space-y-1">
        <div className={speakerClass}>{bubbleSpeaker}</div>
        {bubble}
      </div>
    );

    if (message.role === 'assistant' && Array.isArray(message.segments) && message.segments.length > 0) {
      return withHeader(
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
            {renderAssistantFooter(message)}
            {renderAssistantActions(message)}
        </div>
      );
    }

    const metaOutputFormat =
      message.meta && typeof message.meta === 'object' && typeof message.meta.outputFormat === 'string' ? message.meta.outputFormat : null;
    const preferMarkdown = metaOutputFormat === 'markdown' || (!metaOutputFormat && activeSession?.settings.outputFormat === 'markdown');

    if (message.role === 'assistant' && preferMarkdown) {
      return withHeader(
        <div className={`rounded-xl px-4 py-3 ${bubbleClass}`}>
          <MarkdownBlock content={message.content || ''} variant="light" mode="article" />
          {renderAssistantFooter(message)}
          {renderAssistantActions(message)}
        </div>
      );
    }

    return withHeader(
      <div className={`rounded-xl px-4 py-3 ${bubbleClass}`}>
        <div className="whitespace-pre-wrap leading-relaxed">{message.content}</div>
        {renderAssistantFooter(message)}
        {renderAssistantActions(message)}
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
              <div className="mt-4">
                <ErrorMessage
                  message={globalError}
                  className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
                  linkClassName="text-red-700 underline underline-offset-2 hover:opacity-95"
                />
              </div>
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

	                <div className="rounded-xl border border-pink-100 bg-white p-4 space-y-3">
	                  <div className="flex items-center justify-between gap-3">
	                    <div className="text-sm font-semibold text-gray-800">会话摘要</div>
	                    <div className="flex flex-wrap items-center justify-end gap-2">
	                      {isSummarizing ? (
	                        <div className="flex items-center gap-2 text-xs font-semibold text-pink-700">
	                          <LoadingSpinner className="h-3 w-3" />
	                          <span>生成中…</span>
	                        </div>
	                      ) : null}
	                      <button
	                        type="button"
	                        className="rounded-lg border border-pink-200 bg-white px-3 py-1.5 text-xs font-semibold text-pink-700 hover:bg-pink-50 disabled:cursor-not-allowed disabled:opacity-50"
	                        disabled={!activeSession || isGenerating || isSummarizing || messages.length === 0}
	                        onClick={() => void generateSummary()}
	                        title="生成摘要会消耗额外 Token"
	                      >
	                        生成/更新摘要
	                      </button>
	                      {activeSession?.summary ? (
	                        <button
	                          type="button"
	                          className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
	                          disabled={!activeSession || isGenerating || isSummarizing}
	                          onClick={() => void clearSummary()}
	                        >
	                          清空
	                        </button>
	                      ) : null}
	                    </div>
	                  </div>

	                  <div className="text-xs text-gray-500">用于长对话压缩（仅保存在本地浏览器）。生成摘要会消耗额外 Token。</div>

	                  {summaryError ? (
	                    <ErrorMessage
	                      message={summaryError}
	                      className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
	                      linkClassName="text-red-700 underline underline-offset-2 hover:opacity-95"
	                    />
	                  ) : null}

	                  <textarea
	                    className="input-field h-32 resize-y"
	                    value={activeSession?.summary ?? ''}
	                    onChange={(event) => {
	                      if (!activeSession) return;
	                      const value = event.target.value.trim();
	                      const now = Date.now();
	                      void persistSession({
	                        ...activeSession,
	                        summary: value ? value : undefined,
	                        summaryMeta: value ? { ...(activeSession.summaryMeta ?? {}), updatedAt: now } : undefined,
	                        updatedAt: now,
	                      });
	                    }}
	                    placeholder="还没有摘要。点击“生成/更新摘要”自动生成，或手动填写。"
	                    disabled={!activeSession || isSummarizing}
	                  />

	                  {activeSession?.summaryMeta?.updatedAt ? (
	                    <div className="text-xs text-gray-500">更新时间：{new Date(activeSession.summaryMeta.updatedAt).toLocaleString()}</div>
	                  ) : null}
	                </div>
	
	                <div className="rounded-xl border border-pink-100 bg-white p-4">
	                  <div className="mb-3 flex items-center justify-between">
	                    <div className="flex items-center gap-3">
                      <div className="text-sm font-semibold text-gray-800">对话</div>
                      {isGenerating ? (
                        <div className="flex items-center gap-2 text-xs font-semibold text-pink-700">
                          <LoadingSpinner className="h-3 w-3" />
                          <span>生成中…</span>
                        </div>
                      ) : null}
                    </div>
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
                      <div className="min-w-0 flex-1 text-xs text-gray-500">
                        {activeSession?.settings.outputFormat === 'markdown'
                          ? '提示：Markdown 模式不会稳定解析选项/角色分段。'
                          : '提示：JSONL 模式可解析旁白/对白/选项。'}
	                      </div>
	                      <div className="flex flex-none items-center gap-2">
	                        <button
	                          type="button"
	                          className="flex-none whitespace-nowrap rounded-lg border border-pink-200 bg-white px-3 py-2 text-xs font-semibold text-pink-700 hover:bg-pink-50 disabled:cursor-not-allowed disabled:opacity-50"
	                          disabled={!activeSession || isGenerating}
	                          onClick={() => void continueGeneration()}
	                          title={messages.length === 0 ? '让 AI 根据角色/情景生成开场内容（会消耗 Token）' : '无需输入，继续推进剧情（会消耗 Token）'}
	                        >
	                          {messages.length === 0 ? '生成开场' : '继续生成'}
	                        </button>
	                        <button
	                          type="button"
	                          className="flex-none whitespace-nowrap rounded-lg border border-pink-200 bg-white px-3 py-2 text-xs font-semibold text-pink-700 hover:bg-pink-50 disabled:cursor-not-allowed disabled:opacity-50"
	                          disabled={!activeSession || isGenerating}
                          onClick={() => void generateChoices()}
                          title="根据当前剧情生成下一步行动选项"
                        >
                          生成选项
                        </button>
                        <button
                          type="button"
                          className="flex-none whitespace-nowrap rounded-lg bg-pink-600 px-4 py-2 text-xs font-semibold text-white hover:bg-pink-700 disabled:cursor-not-allowed disabled:opacity-50"
                          disabled={!activeSession || isGenerating || !draft.trim()}
                          onClick={() => void sendMessage(draft)}
                        >
                          发送
                        </button>
                      </div>
                    </div>
                  </div>
	                </div>

                  {activeSession ? (
                    <MagicTavernTachiePanel
                      session={activeSession}
                      messages={messages}
                      referenceText={tachieReferenceText}
                      onReferenceTextChange={setTachieReferenceText}
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
