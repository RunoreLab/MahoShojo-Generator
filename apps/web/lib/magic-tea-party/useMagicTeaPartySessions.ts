import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, Dispatch, SetStateAction } from 'react';

import type { UserAIProviderConfig } from '@/components/AiProviderSelector';
import { useAppRouterAdapter } from '@/lib/app-router-adapter';
import { randomUUID } from '@/lib/crypto';
import { inferTemplate } from '@/lib/data-card-converter';
import { mapDataCardRuntimeSourceInfo } from '@/lib/data-card-read-mappers';
import { clearMagicTeaPartyDraft } from '@/lib/magic-tea-party/drafts';
import { checkMagicTeaPartySensitiveText, maskMagicTeaPartyJsonValue } from '@/lib/magic-tea-party/import-safety';
import { extractMagicTeaPartySideChannelsFromJsonl, parseMagicTeaPartyJsonl } from '@/lib/magic-tea-party/jsonl';
import { extractMagicTeaPartyNoticesFromMarkdown } from '@/lib/magic-tea-party/notice';
import { migrateMagicTeaPartyLocalStorage } from '@/lib/magic-tea-party/migration';
import {
  DEFAULT_MAGIC_TEA_PARTY_PREFERENCES,
  patchMagicTeaPartyPreferences,
  readMagicTeaPartyPreferences,
} from '@/lib/magic-tea-party/preferences';
import { getMagicTeaPartyPreset, type MagicTeaPartyPresetId } from '@/lib/magic-tea-party/presets';
import {
  buildMagicTeaPartyRoleCardFromTavern,
  isTavernCardPayload,
  normalizeTavernCardPayload,
} from '@/lib/magic-tea-party/tavern-import';
import {
  deleteMagicTeaPartySession,
  getMagicTeaPartySession,
  listMagicTeaPartyMessages,
  listMagicTeaPartySessions,
  putMagicTeaPartyMessage,
  putMagicTeaPartySession,
  putMagicTeaPartyTachieAsset,
  putMagicTeaPartyTachieBlob,
} from '@/lib/magic-tea-party/storage';
import { deriveMagicTeaPartyTitle } from '@/lib/magic-tea-party/title';
import {
  isMagicTeaPartySessionCurrent,
  resolveMagicTeaPartyActiveSession,
} from '@/lib/magic-tea-party/session-identity';
import type {
  MagicTeaPartyMessage,
  MagicTeaPartyPreferences,
  MagicTeaPartyRole,
  MagicTeaPartyScenario,
  MagicTeaPartySession,
} from '@/lib/magic-tea-party/types';
import {
  cleanupMagicTeaPartyTachieCache,
  resolveMagicTeaPartyCacheLimits,
  resolveMagicTeaPartyTachieExpireAt,
} from '@/lib/magic-tea-party/cache';
import { applyShieldWords } from '@/lib/shield-word-filter';
import { parseTavernCardFromPngFile } from '@/lib/tavern-card';

const STORAGE_RECENT_SESSION = 'magic-tea-party:recent-session';
type MagicTeaPartyOutputFormat = NonNullable<MagicTeaPartySession['settings']['outputFormat']>;

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

const isPinnedSession = (session: MagicTeaPartySession): boolean =>
  typeof session.pinnedAt === 'number' && Number.isFinite(session.pinnedAt) && session.pinnedAt > 0;

const getPinnedOrder = (session: MagicTeaPartySession): number =>
  typeof session.pinnedOrder === 'number' && Number.isFinite(session.pinnedOrder) ? session.pinnedOrder : 0;

const getPinnedAt = (session: MagicTeaPartySession): number =>
  typeof session.pinnedAt === 'number' && Number.isFinite(session.pinnedAt) ? session.pinnedAt : 0;

const sortSessionsByUpdatedAtDesc = (items: MagicTeaPartySession[]): MagicTeaPartySession[] => {
  return [...items].sort((a, b) => {
    const pinnedA = isPinnedSession(a);
    const pinnedB = isPinnedSession(b);
    if (pinnedA && !pinnedB) return -1;
    if (!pinnedA && pinnedB) return 1;
    if (pinnedA && pinnedB) {
      const orderA = getPinnedOrder(a);
      const orderB = getPinnedOrder(b);
      if (orderA !== orderB) return orderB - orderA;
      const pinAtA = getPinnedAt(a);
      const pinAtB = getPinnedAt(b);
      if (pinAtA !== pinAtB) return pinAtB - pinAtA;
    }
    return (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
  });
};

const stripMetaKeys = (payload: Record<string, unknown>): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (key.startsWith('_')) continue;
    out[key] = value;
  }
  return out;
};

const buildRoleFromDataCardPayload = (payload: any): MagicTeaPartyRole => {
  const sourceInfo = mapDataCardRuntimeSourceInfo(payload);
  const cardId = sourceInfo.sourceDataCardId ?? randomUUID();
  const cardName = sourceInfo.sourceDataCardName ?? '角色';
  const isPublic = sourceInfo.sourceIsPublic === true;
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

const buildScenarioFromDataCardPayload = (payload: any): MagicTeaPartyScenario => {
  const sourceInfo = mapDataCardRuntimeSourceInfo(payload);
  const cardId = sourceInfo.sourceDataCardId ?? randomUUID();
  const cardName = sourceInfo.sourceDataCardName ?? '情景';
  const isPublic = sourceInfo.sourceIsPublic === true;
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

const buildRoleFromLocalJson = (card: Record<string, unknown>, meta: { fileName?: string; importedAt: number }): MagicTeaPartyRole | null => {
  const template = inferTemplate(card);
  if (template !== 'magical-girl' && template !== 'canshou' && template !== 'general') return null;

  const name =
    template === 'magical-girl'
      ? (typeof (card as any).codename === 'string' ? (card as any).codename.trim() : '') || '魔法少女'
      : (typeof (card as any).name === 'string' ? (card as any).name.trim() : '') || '角色';

  return {
    id: randomUUID(),
    name,
    template,
    templateId: typeof (card as any).templateId === 'string' ? (card as any).templateId : undefined,
    source: 'local',
    signature: typeof (card as any).signature === 'string' ? (card as any).signature : undefined,
    card,
    origin: { fileName: meta.fileName, importedAt: meta.importedAt },
  };
};

const buildScenarioFromLocalJson = (card: Record<string, unknown>, meta: { fileName?: string; importedAt: number }): MagicTeaPartyScenario | null => {
  const template = inferTemplate(card);
  if (template !== 'scenario' && template !== 'general-scenario') return null;

  const title =
    typeof (card as any).title === 'string'
      ? (card as any).title.trim()
      : typeof (card as any).name === 'string'
        ? (card as any).name.trim()
        : '';

  return {
    id: randomUUID(),
    title: title || '情景',
    templateId: typeof (card as any).templateId === 'string' ? (card as any).templateId : undefined,
    source: 'local',
    signature: typeof (card as any).signature === 'string' ? (card as any).signature : undefined,
    card,
    origin: { fileName: meta.fileName, importedAt: meta.importedAt },
  };
};

const buildRoleFromTavernCard = (card: Record<string, unknown>, meta: { fileName?: string; importedAt: number }): MagicTeaPartyRole => {
  const name = typeof (card as any).name === 'string' ? (card as any).name.trim() : '';
  return {
    id: randomUUID(),
    name: name || '角色',
    template: 'general',
    templateId: typeof (card as any).templateId === 'string' ? (card as any).templateId : undefined,
    source: 'tavern',
    card,
    origin: { fileName: meta.fileName, importedAt: meta.importedAt },
  };
};

const isPngFile = (file: File): boolean => {
  if (!file) return false;
  if (file.type === 'image/png') return true;
  return file.name.toLowerCase().endsWith('.png');
};

const readFileAsDataUrl = async (file: File): Promise<string> =>
  await new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => resolve('');
    reader.readAsDataURL(file);
  });

export type UseMagicTeaPartySessionsOptions = {
  username?: string | null;
  userProviderConfig: UserAIProviderConfig | null;
  onGlobalError?: (message: string | null) => void;
};

export type UseMagicTeaPartySessionsResult = {
  sessions: MagicTeaPartySession[];
  activeSessionId: string | null;
  setActiveSessionId: (sessionId: string | null) => void;
  activeSession: MagicTeaPartySession | null;
  messages: MagicTeaPartyMessage[];
  setMessages: Dispatch<SetStateAction<MagicTeaPartyMessage[]>>;
  preferences: MagicTeaPartyPreferences;
  applyPreferencePatch: (patch: Partial<MagicTeaPartyPreferences>) => void;
  persistSession: (session: MagicTeaPartySession) => Promise<void>;
  createSession: (presetId?: MagicTeaPartyPresetId | null) => Promise<void>;
  deleteSession: (sessionId: string) => Promise<void>;
  bulkDeleteSessions: (sessionIds: string[]) => Promise<void>;
  toggleSessionPin: (sessionId: string) => Promise<void>;
  reorderPinnedSessions: (orderedIds: string[]) => Promise<void>;
  handleSessionImported: (sessionId: string) => Promise<void>;
  applyPreset: (presetId: MagicTeaPartyPresetId) => void;
  updateActiveSessionSettings: (patch: Partial<MagicTeaPartySession['settings']>) => Promise<void>;
  updateActiveSessionRoles: (roles: MagicTeaPartyRole[]) => Promise<void>;
  updateActiveSessionScenarios: (scenario: MagicTeaPartyScenario | undefined, aux: MagicTeaPartyScenario[]) => Promise<void>;
  onToggleRoleCard: (payload: any, nextSelected: boolean) => Promise<void>;
  onToggleScenarioCard: (payload: any, nextSelected: boolean) => Promise<void>;
  onUploadRoles: (event: ChangeEvent<HTMLInputElement>) => Promise<void>;
  onUploadScenarios: (event: ChangeEvent<HTMLInputElement>) => Promise<void>;
  onImportRolesText: (text: string) => Promise<void>;
  onImportScenariosText: (text: string) => Promise<void>;
  onDropRoles: (files: File[]) => Promise<void>;
  onDropScenarios: (files: File[]) => Promise<void>;
  selectedRoleCardIds: string[];
  selectedScenarioCardIds: string[];
  playerOptions: { value: string; label: string }[];
  updateSessionTitle: (title: string) => void;
  lockSessionTitle: () => void;
  updatePlayerRole: (roleId: string | null) => void;
  forkSessionFromMessage: (messageId: string, content: string) => Promise<string | null>;
  mergeSessionToParent: (sessionId?: string | null) => Promise<string | null>;
};

export function useMagicTeaPartySessions(options: UseMagicTeaPartySessionsOptions): UseMagicTeaPartySessionsResult {
  const { username, userProviderConfig, onGlobalError } = options;
  const router = useAppRouterAdapter();

  const [sessions, setSessions] = useState<MagicTeaPartySession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [activeSession, setActiveSession] = useState<MagicTeaPartySession | null>(null);
  const [messages, setMessages] = useState<MagicTeaPartyMessage[]>([]);
  const [preferences, setPreferences] = useState(() => DEFAULT_MAGIC_TEA_PARTY_PREFERENCES);
  const activeSessionLoadRevisionRef = useRef(0);
  const activeSessionIdRef = useRef(activeSessionId);
  activeSessionIdRef.current = activeSessionId;

  useEffect(() => {
    migrateMagicTeaPartyLocalStorage();
    const prefs = readMagicTeaPartyPreferences();
    setPreferences(prefs);
  }, []);

  useEffect(() => {
    if (!username) return;
    if (typeof window === 'undefined') return;
    setPreferences((prev) => {
      if (prev.userDisplayName !== DEFAULT_MAGIC_TEA_PARTY_PREFERENCES.userDisplayName) return prev;
      const next = patchMagicTeaPartyPreferences({ userDisplayName: username });
      return next;
    });
  }, [username]);

  const refreshSessions = useCallback(async (): Promise<MagicTeaPartySession[]> => {
    const limit = Math.max(50, preferences.maxSessions);
    const next = await listMagicTeaPartySessions({ limit });
    const sorted = sortSessionsByUpdatedAtDesc(next);
    setSessions(sorted);
    return sorted;
  }, [preferences.maxSessions]);

  const handleSessionImported = useCallback(
    async (sessionId: string) => {
      await refreshSessions();
      setActiveSessionId(sessionId);
    },
    [refreshSessions]
  );

  const refreshActiveSession = useCallback(async (sessionId: string) => {
    const loadRevision = ++activeSessionLoadRevisionRef.current;
    const session = await getMagicTeaPartySession(sessionId);
    if (
      loadRevision !== activeSessionLoadRevisionRef.current
      || !isMagicTeaPartySessionCurrent(activeSessionIdRef.current, sessionId)
    ) return;
    setActiveSession(session);
    const nextMessagesRaw = await listMagicTeaPartyMessages(sessionId);
    if (
      loadRevision !== activeSessionLoadRevisionRef.current
      || !isMagicTeaPartySessionCurrent(activeSessionIdRef.current, sessionId)
    ) return;

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

      let nextMessage = message;
      let didChange = false;

      if (metaOutputFormat === 'markdown' && content) {
        const cleaned = extractMagicTeaPartyNoticesFromMarkdown(content).cleanedText;
        if (cleaned !== content) {
          nextMessage = { ...nextMessage, content: cleaned };
          didChange = true;
        }
      }

      if (!looksJsonl) return didChange ? nextMessage : message;

      const parsed = parseMagicTeaPartyJsonl(content);
      const sideChannelBundle = extractMagicTeaPartySideChannelsFromJsonl(content);
      if (sideChannelBundle.cleanedText !== content) {
        nextMessage = { ...nextMessage, content: sideChannelBundle.cleanedText };
        didChange = true;
      }

      if (!Array.isArray(parsed.segments) || parsed.segments.length === 0) return didChange ? nextMessage : message;

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

      if (storedHasMeaningfulSegment) return didChange ? nextMessage : message;

      nextMessage = {
        ...nextMessage,
        segments: parsed.segments,
        ...(parsed.choices ? { choices: parsed.choices } : {}),
      };
      return nextMessage;
    });

    setMessages(patchedMessages);

    const dirtyMessages = patchedMessages.filter((m, idx) => m !== nextMessagesRaw[idx]);
    if (dirtyMessages.length > 0) {
      await Promise.all(dirtyMessages.map((message) => putMagicTeaPartyMessage(message)));
    }

    if (
      session &&
      typeof session.title === 'string' &&
      session.title.trim().toLowerCase() === 'jsonl' &&
      (!session.titleMeta || session.titleMeta.source === 'auto')
    ) {
      const firstAssistant = patchedMessages.find((message) => message.role === 'assistant' && message.content.trim());
      if (firstAssistant) {
        const outputFormat = (session.settings.outputFormat ?? 'jsonl') as MagicTeaPartyOutputFormat;
        const nextTitle = deriveMagicTeaPartyTitle({
          outputFormat,
          content: firstAssistant.content,
          segments: outputFormat === 'jsonl' ? firstAssistant.segments : undefined,
          scenarioTitle: session.scenario?.title,
          roleNames: (session.roles ?? []).map((role) => role.name),
        });
        const titleFiltered = applyShieldWords(nextTitle).filteredText;
        if (titleFiltered && titleFiltered !== session.title) {
          const updatedSession: MagicTeaPartySession = {
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
          await putMagicTeaPartySession(updatedSession);
          if (
            loadRevision !== activeSessionLoadRevisionRef.current
            || !isMagicTeaPartySessionCurrent(activeSessionIdRef.current, sessionId)
          ) return;
          setActiveSession(updatedSession);
          setSessions((prev) => sortSessionsByUpdatedAtDesc([updatedSession, ...prev.filter((item) => item.id !== updatedSession.id)]));
        }
      }
    }
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
        onGlobalError?.(message);
      }
    })();
    return () => {
      canceled = true;
    };
  }, [onGlobalError, refreshSessions]);

  useEffect(() => {
    activeSessionLoadRevisionRef.current += 1;
    if (!activeSessionId) {
      setActiveSession(null);
      setMessages([]);
      return;
    }

    setActiveSession(null);
    setMessages([]);
    writeLocalStorageString(STORAGE_RECENT_SESSION, activeSessionId);
    void refreshActiveSession(activeSessionId).catch((error) => {
      const message = error instanceof Error ? error.message : '加载会话失败';
      onGlobalError?.(message);
    });
  }, [activeSessionId, onGlobalError, refreshActiveSession]);

  const persistSession = useCallback(async (next: MagicTeaPartySession) => {
    // 先同步更新 React 状态，避免受控输入在异步落盘后重放 value 导致光标跳到末尾。
    if (isMagicTeaPartySessionCurrent(activeSessionIdRef.current, next.id)) {
      setActiveSession(next);
    }
    setSessions((prev) => sortSessionsByUpdatedAtDesc([next, ...prev.filter((item) => item.id !== next.id)]));
    await putMagicTeaPartySession(next);
  }, []);

  const createSession = useCallback(
    async (presetId?: MagicTeaPartyPresetId | null) => {
      const now = Date.now();
      const id = randomUUID();
      const preset = getMagicTeaPartyPreset(presetId ?? preferences.lastPresetId);

      const baseSettings = {
        providerId: userProviderConfig?.providerId || 'unknown',
        modelId: userProviderConfig?.modelId || '',
        temperature: 0.75,
        outputFormat: preferences.outputFormat,
        outputPlan: preferences.outputPlan,
        updateApplyMode: preferences.updateApplyMode,
        language: preferences.language,
        enableChoices: preferences.enableChoices,
        choiceCount: preferences.choiceCount,
        userDisplayName: preferences.userDisplayName,
        enableSummary: preferences.enableSummary,
        readArenaHistory: preferences.readArenaHistory,
        readArenaHistoryLimit: preferences.readArenaHistoryLimit,
        isArenaHistoryUnlimited: preferences.isArenaHistoryUnlimited,
        readCurrentState: preferences.readCurrentState,
        writeArenaHistory: preferences.writeArenaHistory,
        writeCurrentState: preferences.writeCurrentState,
      } satisfies MagicTeaPartySession['settings'];

      const session: MagicTeaPartySession = {
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

      await putMagicTeaPartySession(session);
      setSessions((prev) => sortSessionsByUpdatedAtDesc([session, ...prev]));
      setActiveSessionId(session.id);
      writeLocalStorageString(STORAGE_RECENT_SESSION, session.id);
    },
    [preferences, userProviderConfig]
  );

  const deleteSession = useCallback(
    async (sessionId: string) => {
      clearMagicTeaPartyDraft(sessionId);
      await deleteMagicTeaPartySession(sessionId);
      const next = await refreshSessions();
      const fallback = next[0]?.id ?? null;
      setActiveSessionId((current) => (current === sessionId ? fallback : current));
    },
    [refreshSessions]
  );

  const bulkDeleteSessions = useCallback(
    async (sessionIds: string[]) => {
      if (!Array.isArray(sessionIds) || sessionIds.length === 0) return;
      const uniqueIds = Array.from(new Set(sessionIds.filter(Boolean)));
      if (uniqueIds.length === 0) return;
      uniqueIds.forEach((sessionId) => clearMagicTeaPartyDraft(sessionId));
      await Promise.all(uniqueIds.map((sessionId) => deleteMagicTeaPartySession(sessionId)));
      const next = await refreshSessions();
      const fallback = next[0]?.id ?? null;
      setActiveSessionId((current) => (current && uniqueIds.includes(current) ? fallback : current));
    },
    [refreshSessions]
  );

  const toggleSessionPin = useCallback(
    async (sessionId: string) => {
      const target =
        sessions.find((item) => item.id === sessionId) ??
        (activeSession?.id === sessionId ? activeSession : null);
      if (!target) return;
      const isPinned = isPinnedSession(target);
      const nextUpdates: MagicTeaPartySession[] = [];
      if (isPinned) {
        nextUpdates.push({
          ...target,
          pinnedAt: undefined,
          pinnedOrder: undefined,
          updatedAt: target.updatedAt,
        });
      } else {
        const now = Date.now();
        const pinnedSessions = sessions.filter((session) => isPinnedSession(session));
        const hasOrderMissing = pinnedSessions.some((session) => !getPinnedOrder(session));
        if (hasOrderMissing) {
          const normalizedPinned = [...pinnedSessions]
            .sort((a, b) => getPinnedAt(b) - getPinnedAt(a))
            .map((session, index, list) => ({
              ...session,
              pinnedOrder: list.length - index,
              updatedAt: session.updatedAt,
            }));
          nextUpdates.push(...normalizedPinned);
        }
        const maxOrder = Math.max(0, ...pinnedSessions.map((session) => getPinnedOrder(session)));
        nextUpdates.push({
          ...target,
          pinnedAt: now,
          pinnedOrder: maxOrder + 1,
          updatedAt: target.updatedAt,
        });
      }
      if (nextUpdates.length === 0) return;
      await Promise.all(nextUpdates.map((session) => putMagicTeaPartySession(session)));
      setSessions((prev) => {
        const nextMap = new Map(nextUpdates.map((session) => [session.id, session]));
        const merged = prev.map((session) => nextMap.get(session.id) ?? session);
        return sortSessionsByUpdatedAtDesc(merged);
      });
      if (activeSession && nextUpdates.some((session) => session.id === activeSession.id)) {
        const updated = nextUpdates.find((session) => session.id === activeSession.id) ?? activeSession;
        setActiveSession(updated);
      }
    },
    [activeSession, sessions]
  );

  const reorderPinnedSessions = useCallback(
    async (orderedIds: string[]) => {
      if (!Array.isArray(orderedIds) || orderedIds.length === 0) return;
      const pinnedMap = new Map(sessions.filter((session) => isPinnedSession(session)).map((session) => [session.id, session]));
      if (pinnedMap.size === 0) return;
      const normalizedIds = orderedIds.filter((id) => pinnedMap.has(id));
      if (normalizedIds.length === 0) return;
      const total = normalizedIds.length;
      const updates: MagicTeaPartySession[] = [];
      normalizedIds.forEach((id, index) => {
        const session = pinnedMap.get(id);
        if (!session) return;
        const nextOrder = total - index;
        if (getPinnedOrder(session) === nextOrder) return;
        updates.push({
          ...session,
          pinnedOrder: nextOrder,
          updatedAt: session.updatedAt,
        });
      });
      if (updates.length === 0) return;
      await Promise.all(updates.map((session) => putMagicTeaPartySession(session)));
      setSessions((prev) => {
        const updateMap = new Map(updates.map((session) => [session.id, session]));
        const merged = prev.map((session) => updateMap.get(session.id) ?? session);
        return sortSessionsByUpdatedAtDesc(merged);
      });
      if (activeSession && updates.some((session) => session.id === activeSession.id)) {
        const updated = updates.find((session) => session.id === activeSession.id) ?? activeSession;
        setActiveSession(updated);
      }
    },
    [activeSession, sessions]
  );

  const updateActiveSessionSettings = useCallback(
    async (patch: Partial<MagicTeaPartySession['settings']>) => {
      if (!activeSession) return;
      const next: MagicTeaPartySession = {
        ...activeSession,
        updatedAt: Date.now(),
        settings: { ...activeSession.settings, ...patch },
      };
      await persistSession(next);
    },
    [activeSession, persistSession]
  );

  const updateActiveSessionRoles = useCallback(
    async (nextRoles: MagicTeaPartyRole[]) => {
      if (!activeSession) return;
      const next: MagicTeaPartySession = { ...activeSession, roles: nextRoles, updatedAt: Date.now() };
      await persistSession(next);
    },
    [activeSession, persistSession]
  );

  const updateActiveSessionScenarios = useCallback(
    async (nextScenario: MagicTeaPartyScenario | undefined, nextAux: MagicTeaPartyScenario[]) => {
      if (!activeSession) return;
      const next: MagicTeaPartySession = { ...activeSession, scenario: nextScenario, auxScenarios: nextAux, updatedAt: Date.now() };
      await persistSession(next);
    },
    [activeSession, persistSession]
  );

  const applyPreferencePatch = useCallback((patch: Partial<MagicTeaPartyPreferences>) => {
    setPreferences(() => patchMagicTeaPartyPreferences(patch));
  }, []);

  const applyPreset = useCallback(
    (presetId: MagicTeaPartyPresetId) => {
      const preset = getMagicTeaPartyPreset(presetId);
      if (!preset) return;

      if (!activeSession) {
        void createSession(preset.id);
        return;
      }

      const currentPresetId = activeSession.settings.presetId;
      if (currentPresetId && currentPresetId === preset.id) {
        const currentScenario = activeSession.scenario;
        const currentAux = Array.isArray(activeSession.auxScenarios) ? activeSession.auxScenarios : [];
        const shouldClearScenario =
          currentScenario?.source === 'preset' ||
          currentScenario?.presetId === preset.id ||
          currentScenario?.id === 'preset-scenario';
        const nextScenario = shouldClearScenario ? undefined : currentScenario;
        const nextAux = currentAux.filter((item) => item.source !== 'preset' && item.presetId !== preset.id);

        const nextSession: MagicTeaPartySession = {
          ...activeSession,
          updatedAt: Date.now(),
          scenario: nextScenario,
          auxScenarios: nextAux,
          settings: {
            ...activeSession.settings,
            presetId: undefined,
            worldbookPresetId: undefined,
          },
        };

        void persistSession(nextSession);
        applyPreferencePatch({ lastPresetId: undefined, lastWorldbookPresetId: undefined });
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
    [activeSession, applyPreferencePatch, createSession, persistSession, updateActiveSessionScenarios, updateActiveSessionSettings]
  );

  const onToggleRoleCard = useCallback(
    async (payload: any, nextSelected: boolean) => {
      if (!activeSession) return;
      const dataCardId = mapDataCardRuntimeSourceInfo(payload).sourceDataCardId ?? '';
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
      const dataCardId = mapDataCardRuntimeSourceInfo(payload).sourceDataCardId ?? '';
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

  const parseJsonPayloads = (text: string): Record<string, unknown>[] => {
    const trimmed = text.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.filter((item) => item && typeof item === 'object' && !Array.isArray(item)) as Record<string, unknown>[];
      }
      if (parsed && typeof parsed === 'object') return [parsed as Record<string, unknown>];
    } catch {
      // ignore parse error
    }
    return [];
  };

  const sanitizeJsonPayloads = (payloads: Record<string, unknown>[]): Record<string, unknown>[] =>
    payloads.map((payload) => maskMagicTeaPartyJsonValue(payload).value as Record<string, unknown>);

  const guardImportText = useCallback(
    async (text: string, meta: { label: string; filename?: string; mimeType?: string }): Promise<boolean> => {
      const result = await checkMagicTeaPartySensitiveText({
        text,
        reason: '使用危险符文',
        origin: '/magic-tea-party',
        label: meta.label,
        filename: meta.filename,
        mimeType: meta.mimeType,
      });
      if (!result.blocked) return true;
      if (result.redirectTarget) {
        await router.push(result.redirectTarget);
      }
      return false;
    },
    [router]
  );

  const onDropRoles = useCallback(
    async (files: File[]) => {
      if (!activeSession) return;
      if (!files || files.length === 0) return;

      const importedAt = Date.now();
      const nextRoles: MagicTeaPartyRole[] = [...(activeSession.roles ?? [])];
      const cacheLimits = resolveMagicTeaPartyCacheLimits(preferences);

      for (const file of files) {
        try {
          if (isPngFile(file)) {
            const parsed = await parseTavernCardFromPngFile(file);
            if (parsed && typeof parsed === 'object' && 'code' in parsed) {
              continue;
            }
            const normalized = (parsed as { normalized: ReturnType<typeof normalizeTavernCardPayload> }).normalized;
            const { card } = buildMagicTeaPartyRoleCardFromTavern(normalized);
            const allowed = await guardImportText(JSON.stringify(card), {
              label: '魔法茶会导入 SillyTavern 角色卡',
              filename: file.name,
              mimeType: file.type || 'image/png',
            });
            if (!allowed) return;
            const maskedCard = maskMagicTeaPartyJsonValue(card).value as Record<string, unknown>;
            const role = buildRoleFromTavernCard(maskedCard, { fileName: file.name, importedAt });
            nextRoles.push(role);

            try {
              const assetId = randomUUID();
              const dataUrl = await readFileAsDataUrl(file);
              await putMagicTeaPartyTachieBlob(assetId, file);
              await putMagicTeaPartyTachieAsset({
                id: assetId,
                sessionId: activeSession.id,
                kind: 'tachie',
                roleId: role.id,
                cacheKey: `tavern:${role.id}:${file.name}:${file.size}:${file.lastModified}`,
                fragmentHash: `tavern:${role.id}:${file.size}`,
                styleId: 'tavern-import',
                imageUrl: dataUrl || undefined,
                createdAt: importedAt,
                lastUsedAt: importedAt,
                expireAt: resolveMagicTeaPartyTachieExpireAt(importedAt),
                blobSize: file.size,
              });
              await cleanupMagicTeaPartyTachieCache({ sessionId: activeSession.id, limits: cacheLimits });
            } catch {
              // ignore cache failures
            }
            continue;
          }

          const text = await file.text();
          const allowed = await guardImportText(text, {
            label: '魔法茶会导入角色卡',
            filename: file.name,
            mimeType: 'application/json',
          });
          if (!allowed) return;
          const payloads = sanitizeJsonPayloads(parseJsonPayloads(text));
          if (payloads.length === 0) continue;
          for (const payload of payloads) {
            const template = inferTemplate(payload);
            if (template === 'magical-girl' || template === 'canshou' || template === 'general') {
              const role = buildRoleFromLocalJson(payload, { fileName: file.name, importedAt });
              if (!role) continue;
              nextRoles.push(role);
              continue;
            }
            if (isTavernCardPayload(payload)) {
              const normalized = normalizeTavernCardPayload(payload);
              const { card } = buildMagicTeaPartyRoleCardFromTavern(normalized);
              const maskedCard = maskMagicTeaPartyJsonValue(card).value as Record<string, unknown>;
              const role = buildRoleFromTavernCard(maskedCard, { fileName: file.name, importedAt });
              nextRoles.push(role);
            }
          }
        } catch {
          // ignore invalid file
        }
      }

      if (nextRoles.length === (activeSession.roles ?? []).length) {
        onGlobalError?.('未识别到有效的角色卡。');
        return;
      }
      await updateActiveSessionRoles(nextRoles);
    },
    [activeSession, guardImportText, onGlobalError, preferences, updateActiveSessionRoles]
  );

  const onDropScenarios = useCallback(
    async (files: File[]) => {
      if (!activeSession) return;
      if (!files || files.length === 0) return;

      const importedAt = Date.now();
      let nextMain = activeSession.scenario;
      const nextAux = Array.isArray(activeSession.auxScenarios) ? [...activeSession.auxScenarios] : [];

      for (const file of files) {
        try {
          const text = await file.text();
          const allowed = await guardImportText(text, {
            label: '魔法茶会导入情景卡',
            filename: file.name,
            mimeType: 'application/json',
          });
          if (!allowed) return;
          const payloads = sanitizeJsonPayloads(parseJsonPayloads(text));
          if (payloads.length === 0) continue;
          for (const payload of payloads) {
            const scenario = buildScenarioFromLocalJson(payload, { fileName: file.name, importedAt });
            if (!scenario) continue;
            if (!nextMain) {
              nextMain = scenario;
            } else {
              nextAux.push(scenario);
            }
          }
        } catch {
          // ignore
        }
      }

      if (nextMain === activeSession.scenario && nextAux.length === (activeSession.auxScenarios ?? []).length) {
        onGlobalError?.('未识别到有效的情景卡。');
        return;
      }
      await updateActiveSessionScenarios(nextMain, nextAux);
    },
    [activeSession, guardImportText, onGlobalError, updateActiveSessionScenarios]
  );

  const onUploadRoles = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      if (!event.target.files || event.target.files.length === 0) return;
      await onDropRoles(Array.from(event.target.files));
      event.target.value = '';
    },
    [onDropRoles]
  );

  const onUploadScenarios = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      if (!event.target.files || event.target.files.length === 0) return;
      await onDropScenarios(Array.from(event.target.files));
      event.target.value = '';
    },
    [onDropScenarios]
  );

  const onImportRolesText = useCallback(
    async (text: string) => {
      if (!activeSession) return;
      const allowed = await guardImportText(text, {
        label: '魔法茶会粘贴角色卡',
        filename: 'pasted.json',
        mimeType: 'application/json',
      });
      if (!allowed) return;
      const payloads = sanitizeJsonPayloads(parseJsonPayloads(text));
      if (payloads.length === 0) {
        onGlobalError?.('未识别到有效的角色 JSON。');
        return;
      }
      const importedAt = Date.now();
      const nextRoles: MagicTeaPartyRole[] = [...(activeSession.roles ?? [])];
      for (const payload of payloads) {
        const template = inferTemplate(payload);
        if (template === 'magical-girl' || template === 'canshou' || template === 'general') {
          const role = buildRoleFromLocalJson(payload, { fileName: 'pasted.json', importedAt });
          if (!role) continue;
          nextRoles.push(role);
          continue;
        }
        if (isTavernCardPayload(payload)) {
          const normalized = normalizeTavernCardPayload(payload);
          const { card } = buildMagicTeaPartyRoleCardFromTavern(normalized);
          const maskedCard = maskMagicTeaPartyJsonValue(card).value as Record<string, unknown>;
          const role = buildRoleFromTavernCard(maskedCard, { fileName: 'pasted.json', importedAt });
          nextRoles.push(role);
        }
      }
      if (nextRoles.length === (activeSession.roles ?? []).length) {
        onGlobalError?.('未识别到有效的角色卡。');
        return;
      }
      await updateActiveSessionRoles(nextRoles);
    },
    [activeSession, guardImportText, onGlobalError, updateActiveSessionRoles]
  );

  const onImportScenariosText = useCallback(
    async (text: string) => {
      if (!activeSession) return;
      const allowed = await guardImportText(text, {
        label: '魔法茶会粘贴情景卡',
        filename: 'pasted.json',
        mimeType: 'application/json',
      });
      if (!allowed) return;
      const payloads = sanitizeJsonPayloads(parseJsonPayloads(text));
      if (payloads.length === 0) {
        onGlobalError?.('未识别到有效的情景 JSON。');
        return;
      }
      const importedAt = Date.now();
      let nextMain = activeSession.scenario;
      const nextAux = Array.isArray(activeSession.auxScenarios) ? [...activeSession.auxScenarios] : [];

      for (const payload of payloads) {
        const scenario = buildScenarioFromLocalJson(payload, { fileName: 'pasted.json', importedAt });
        if (!scenario) continue;
        if (!nextMain) {
          nextMain = scenario;
        } else {
          nextAux.push(scenario);
        }
      }

      if (nextMain === activeSession.scenario && nextAux.length === (activeSession.auxScenarios ?? []).length) {
        onGlobalError?.('未识别到有效的情景卡。');
        return;
      }
      await updateActiveSessionScenarios(nextMain, nextAux);
    },
    [activeSession, guardImportText, onGlobalError, updateActiveSessionScenarios]
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

  const forkSessionFromMessage = useCallback(
    async (messageId: string, content: string) => {
      if (!activeSession) return null;
      const trimmed = content.trim();
      if (!trimmed) {
        onGlobalError?.('编辑内容不能为空。');
        return null;
      }

      const targetIndex = messages.findIndex((message) => message.id === messageId);
      if (targetIndex < 0) return null;
      const targetMessage = messages[targetIndex];
      if (targetMessage.role !== 'user') return null;

      const now = Date.now();
      const newSessionId = randomUUID();
      const beforeMessages = messages.slice(0, targetIndex);

      const idMap = new Map<string, string>();
      const cloned = beforeMessages.map((message) => {
        const nextId = randomUUID();
        idMap.set(message.id, nextId);
        return {
          ...message,
          id: nextId,
          sessionId: newSessionId,
        } as MagicTeaPartyMessage;
      });

      const fixedMessages = cloned.map((message) => {
        const next = { ...message } as MagicTeaPartyMessage;
        if (typeof next.sourceMessageId === 'string' && idMap.has(next.sourceMessageId)) {
          next.sourceMessageId = idMap.get(next.sourceMessageId);
        }
        if (typeof next.revisionOf === 'string' && idMap.has(next.revisionOf)) {
          next.revisionOf = idMap.get(next.revisionOf);
        }
        return next;
      });

      const roundIndex = messages.slice(0, targetIndex + 1).filter((message) => message.role === 'user').length;
      const branchLabel = `从第 ${Math.max(1, roundIndex)} 轮分支`;

      let summary = activeSession.summary;
      let summaryMeta = activeSession.summaryMeta;
      let summarySections = activeSession.summarySections;
      if (summaryMeta?.toMessageId) {
        const summaryIndex = messages.findIndex((message) => message.id === summaryMeta?.toMessageId);
        if (summaryIndex >= 0 && targetIndex <= summaryIndex) {
          summary = undefined;
          summaryMeta = undefined;
          summarySections = undefined;
        }
      }

      const nextSession: MagicTeaPartySession = {
        ...activeSession,
        id: newSessionId,
        createdAt: now,
        updatedAt: now,
        summary,
        summarySections,
        summaryMeta,
        forkedFrom: { sessionId: activeSession.id, messageId: targetMessage.id, createdAt: now },
        branchLabel,
      };

      await putMagicTeaPartySession(nextSession);
      if (fixedMessages.length > 0) {
        await Promise.all(fixedMessages.map((message) => putMagicTeaPartyMessage(message)));
      }

      const playerRoleId = activeSession.playerRoleId ?? null;
      const playerRoleName = playerRoleId
        ? (activeSession.roles ?? []).find((role) => role.id === playerRoleId)?.name ?? ''
        : '';
      const speakerName =
        playerRoleId ? playerRoleName || playerRoleId : activeSession.settings.userDisplayName || preferences.userDisplayName || '旅人';

      const editedMessage: MagicTeaPartyMessage = {
        id: randomUUID(),
        sessionId: newSessionId,
        role: 'user',
        content: trimmed,
        createdAt: now + 1,
        status: 'done',
        ...(playerRoleId ? { speakerId: playerRoleId } : {}),
        meta: { speakerName },
        revisionOf: targetMessage.id,
      };

      await putMagicTeaPartyMessage(editedMessage);

      setSessions((prev) => sortSessionsByUpdatedAtDesc([nextSession, ...prev.filter((item) => item.id !== nextSession.id)]));
      setActiveSessionId(newSessionId);
      writeLocalStorageString(STORAGE_RECENT_SESSION, newSessionId);
      return newSessionId;
    },
    [activeSession, messages, onGlobalError, preferences.userDisplayName]
  );

  const mergeSessionToParent = useCallback(
    async (sessionId?: string | null) => {
      const sourceSession =
        sessionId && activeSession?.id === sessionId
          ? activeSession
          : sessionId
            ? sessions.find((session) => session.id === sessionId) ?? (await getMagicTeaPartySession(sessionId))
            : activeSession;
      if (!sourceSession) return null;

      const parentId = sourceSession.forkedFrom?.sessionId;
      const forkMessageId = sourceSession.forkedFrom?.messageId;
      if (!parentId || !forkMessageId) {
        onGlobalError?.('当前会话没有可合并的父分支。');
        return null;
      }

      const parentSession = await getMagicTeaPartySession(parentId);
      if (!parentSession) {
        onGlobalError?.('父会话已不存在，无法合并。');
        return null;
      }

      const [parentMessages, branchMessages] = await Promise.all([
        listMagicTeaPartyMessages(parentId),
        listMagicTeaPartyMessages(sourceSession.id),
      ]);

      const parentForkIndex = parentMessages.findIndex((message) => message.id === forkMessageId);
      if (parentForkIndex < 0) {
        onGlobalError?.('父会话缺少分支锚点，无法合并。');
        return null;
      }

      let branchStartIndex = branchMessages.findIndex((message) => message.revisionOf === forkMessageId);
      if (branchStartIndex < 0) {
        const forkedAt = sourceSession.forkedFrom?.createdAt ?? 0;
        branchStartIndex = branchMessages.findIndex((message) => (message.createdAt ?? 0) >= forkedAt);
      }
      if (branchStartIndex < 0) branchStartIndex = 0;

      const branchTail = branchMessages.slice(branchStartIndex);
      if (branchTail.length === 0) {
        onGlobalError?.('未找到可合并的分支内容。');
        return null;
      }

      const now = Date.now();
      const superseded = parentMessages.slice(parentForkIndex).map((message) => ({
        ...message,
        meta: {
          ...(message.meta ?? {}),
          superseded: true,
          supersededAt: now,
          supersededBy: 'merge',
          supersededBySessionId: sourceSession.id,
        },
      }));
      if (superseded.length > 0) {
        await Promise.all(superseded.map((message) => putMagicTeaPartyMessage(message)));
      }

      const parentMessageIds = new Set(parentMessages.map((message) => message.id));
      const idMap = new Map<string, string>();
      const cloned = branchTail.map((message, index) => {
        const nextId = randomUUID();
        idMap.set(message.id, nextId);
        return {
          ...message,
          id: nextId,
          sessionId: parentId,
          createdAt: typeof message.createdAt === 'number' ? message.createdAt : now + index,
        } as MagicTeaPartyMessage;
      });
      const fixed = cloned.map((message) => {
        const next = { ...message } as MagicTeaPartyMessage;
        if (typeof next.sourceMessageId === 'string') {
          if (idMap.has(next.sourceMessageId)) {
            next.sourceMessageId = idMap.get(next.sourceMessageId);
          } else if (!parentMessageIds.has(next.sourceMessageId)) {
            delete next.sourceMessageId;
          }
        }
        if (typeof next.revisionOf === 'string') {
          if (idMap.has(next.revisionOf)) {
            next.revisionOf = idMap.get(next.revisionOf);
          } else if (!parentMessageIds.has(next.revisionOf)) {
            delete next.revisionOf;
          }
        }
        return next;
      });
      if (fixed.length > 0) {
        await Promise.all(fixed.map((message) => putMagicTeaPartyMessage(message)));
      }

      let summary = parentSession.summary;
      let summaryMeta = parentSession.summaryMeta;
      let summarySections = parentSession.summarySections;
      if (summaryMeta?.toMessageId) {
        const summaryIndex = parentMessages.findIndex((message) => message.id === summaryMeta?.toMessageId);
        if (summaryIndex >= parentForkIndex) {
          summary = undefined;
          summaryMeta = undefined;
          summarySections = undefined;
        }
      }

      const nextParentSession: MagicTeaPartySession = {
        ...parentSession,
        summary,
        summarySections,
        summaryMeta,
        updatedAt: now,
      };

      await putMagicTeaPartySession(nextParentSession);
      setSessions((prev) => sortSessionsByUpdatedAtDesc([nextParentSession, ...prev.filter((item) => item.id !== nextParentSession.id)]));
      setActiveSessionId(parentId);
      writeLocalStorageString(STORAGE_RECENT_SESSION, parentId);
      return parentId;
    },
    [activeSession, onGlobalError, sessions]
  );

  return {
    sessions,
    activeSessionId,
    setActiveSessionId,
    activeSession: resolveMagicTeaPartyActiveSession(activeSessionId, activeSession),
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
  };
}
