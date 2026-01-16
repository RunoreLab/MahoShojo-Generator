import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ChangeEvent, Dispatch, SetStateAction } from 'react';

import type { UserAIProviderConfig } from '@/components/AiProviderSelector';
import { randomUUID } from '@/lib/crypto';
import { inferTemplate } from '@/lib/data-card-converter';
import { clearMagicTeaPartyDraft } from '@/lib/magic-tea-party/drafts';
import { parseMagicTeaPartyJsonl } from '@/lib/magic-tea-party/jsonl';
import { migrateMagicTeaPartyLocalStorage } from '@/lib/magic-tea-party/migration';
import {
  DEFAULT_MAGIC_TEA_PARTY_PREFERENCES,
  patchMagicTeaPartyPreferences,
  readMagicTeaPartyPreferences,
} from '@/lib/magic-tea-party/preferences';
import { getMagicTeaPartyPreset, type MagicTeaPartyPresetId } from '@/lib/magic-tea-party/presets';
import {
  deleteMagicTeaPartySession,
  getMagicTeaPartySession,
  listMagicTeaPartyMessages,
  listMagicTeaPartySessions,
  putMagicTeaPartyMessage,
  putMagicTeaPartySession,
} from '@/lib/magic-tea-party/storage';
import { deriveMagicTeaPartyTitle } from '@/lib/magic-tea-party/title';
import type {
  MagicTeaPartyMessage,
  MagicTeaPartyPreferences,
  MagicTeaPartyRole,
  MagicTeaPartyScenario,
  MagicTeaPartySession,
} from '@/lib/magic-tea-party/types';
import { applyShieldWords } from '@/lib/shield-word-filter';

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

const sortSessionsByUpdatedAtDesc = (items: MagicTeaPartySession[]): MagicTeaPartySession[] => {
  return [...items].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
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
  const cardId = typeof payload?._cardId === 'string' ? payload._cardId : randomUUID();
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

const buildScenarioFromDataCardPayload = (payload: any): MagicTeaPartyScenario => {
  const cardId = typeof payload?._cardId === 'string' ? payload._cardId : randomUUID();
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

  const [sessions, setSessions] = useState<MagicTeaPartySession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [activeSession, setActiveSession] = useState<MagicTeaPartySession | null>(null);
  const [messages, setMessages] = useState<MagicTeaPartyMessage[]>([]);
  const [preferences, setPreferences] = useState(() => DEFAULT_MAGIC_TEA_PARTY_PREFERENCES);

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
    const next = await listMagicTeaPartySessions({ limit: 50 });
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
    const session = await getMagicTeaPartySession(sessionId);
    setActiveSession(session);
    const nextMessagesRaw = await listMagicTeaPartyMessages(sessionId);

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

      const parsed = parseMagicTeaPartyJsonl(content);
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
    if (!activeSessionId) {
      setActiveSession(null);
      setMessages([]);
      return;
    }

    writeLocalStorageString(STORAGE_RECENT_SESSION, activeSessionId);
    void refreshActiveSession(activeSessionId).catch((error) => {
      const message = error instanceof Error ? error.message : '加载会话失败';
      onGlobalError?.(message);
    });
  }, [activeSessionId, onGlobalError, refreshActiveSession]);

  const persistSession = useCallback(async (next: MagicTeaPartySession) => {
    await putMagicTeaPartySession(next);
    setActiveSession(next);
    setSessions((prev) => sortSessionsByUpdatedAtDesc([next, ...prev.filter((item) => item.id !== next.id)]));
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

  const onDropRoles = useCallback(
    async (files: File[]) => {
      if (!activeSession) return;
      if (!files || files.length === 0) return;

      const importedAt = Date.now();
      const nextRoles: MagicTeaPartyRole[] = [...(activeSession.roles ?? [])];

      for (const file of files) {
        try {
          const text = await file.text();
          const payloads = parseJsonPayloads(text);
          if (payloads.length === 0) continue;
          for (const payload of payloads) {
            const role = buildRoleFromLocalJson(payload, { fileName: file.name, importedAt });
            if (!role) continue;
            nextRoles.push(role);
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
    [activeSession, onGlobalError, updateActiveSessionRoles]
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
          const payloads = parseJsonPayloads(text);
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
    [activeSession, onGlobalError, updateActiveSessionScenarios]
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
      const payloads = parseJsonPayloads(text);
      if (payloads.length === 0) {
        onGlobalError?.('未识别到有效的角色 JSON。');
        return;
      }
      const importedAt = Date.now();
      const nextRoles: MagicTeaPartyRole[] = [...(activeSession.roles ?? [])];
      for (const payload of payloads) {
        const role = buildRoleFromLocalJson(payload, { fileName: 'pasted.json', importedAt });
        if (!role) continue;
        nextRoles.push(role);
      }
      if (nextRoles.length === (activeSession.roles ?? []).length) {
        onGlobalError?.('未识别到有效的角色卡。');
        return;
      }
      await updateActiveSessionRoles(nextRoles);
    },
    [activeSession, onGlobalError, updateActiveSessionRoles]
  );

  const onImportScenariosText = useCallback(
    async (text: string) => {
      if (!activeSession) return;
      const payloads = parseJsonPayloads(text);
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
    [activeSession, onGlobalError, updateActiveSessionScenarios]
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
      if (summaryMeta?.toMessageId) {
        const summaryIndex = messages.findIndex((message) => message.id === summaryMeta?.toMessageId);
        if (summaryIndex >= 0 && targetIndex <= summaryIndex) {
          summary = undefined;
          summaryMeta = undefined;
        }
      }

      const nextSession: MagicTeaPartySession = {
        ...activeSession,
        id: newSessionId,
        createdAt: now,
        updatedAt: now,
        summary,
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
      if (summaryMeta?.toMessageId) {
        const summaryIndex = parentMessages.findIndex((message) => message.id === summaryMeta?.toMessageId);
        if (summaryIndex >= parentForkIndex) {
          summary = undefined;
          summaryMeta = undefined;
        }
      }

      const nextParentSession: MagicTeaPartySession = {
        ...parentSession,
        summary,
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
    activeSession,
    messages,
    setMessages,
    preferences,
    applyPreferencePatch,
    persistSession,
    createSession,
    deleteSession,
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
