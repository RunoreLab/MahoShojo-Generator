'use client';

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import {
  BattleStoreState,
  BattleSettings,
  isCombatantLimitReached,
  MAX_COMBATANTS,
  ScenarioState,
  MAX_AUX_SCENARIOS,
  MAX_ARENA_MATERIALS,
} from '../types';
import {
  DEFAULT_BATTLE_REPORT_CARD_WIDTH_MODE,
  DEFAULT_BATTLE_REPORT_CARD_WIDTH_PX,
} from '../utils/battleReportCardWidth';
import type { AdjudicatorEvent } from '@/types/arena';
import { buildAdjudicationSourceKey, filterAdjudicationEventsBySources } from '@/lib/arena/adjudication-events';

const normalizeSourceKey = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const getCombatantSourceKey = (combatant: unknown): string => {
  if (!combatant || typeof combatant !== 'object') return '';
  const record = combatant as Record<string, unknown>;
  return (
    normalizeSourceKey(record.adjudicationSourceKey) ||
    buildAdjudicationSourceKey({
      sourceDataCardId: normalizeSourceKey(record.sourceDataCardId),
      sourceFileName: normalizeSourceKey(record.filename),
      sourceLabel: normalizeSourceKey(record.sourceDataCardName) || normalizeSourceKey(record.filename) || normalizeSourceKey(record.id),
    }) ||
    ''
  );
};

const matchesCombatantIdentifier = (combatant: unknown, identifier: unknown): boolean => {
  const normalizedIdentifier = normalizeSourceKey(identifier);
  if (!normalizedIdentifier || !combatant || typeof combatant !== 'object') return false;

  const record = combatant as Record<string, unknown>;
  const directMatches = [record.id, record.filename, record.sourceDataCardId, record.adjudicationSourceKey]
    .map(normalizeSourceKey)
    .some((value) => value === normalizedIdentifier);
  if (directMatches) return true;

  return getCombatantSourceKey(combatant) === normalizedIdentifier;
};

const getScenarioSourceKey = (scenario: unknown): string => {
  if (!scenario || typeof scenario !== 'object') return '';
  const record = scenario as Record<string, unknown>;
  return (
    normalizeSourceKey(record.adjudicationSourceKey) ||
    buildAdjudicationSourceKey({
      sourceDataCardId: normalizeSourceKey(record.sourceDataCardId),
      sourceFileName: normalizeSourceKey(record.fileName),
      sourceLabel: normalizeSourceKey(record.sourceDataCardName) || normalizeSourceKey(record.fileName),
    }) ||
    ''
  );
};

const applyAdjudicationEventSourceRemoval = (events: unknown, sourceKey: string): AdjudicatorEvent[] => {
  if (!Array.isArray(events) || !normalizeSourceKey(sourceKey)) return Array.isArray(events) ? (events as AdjudicatorEvent[]) : [];
  return filterAdjudicationEventsBySources(events, [sourceKey]);
};

const removeAdjudicationEventsForKeys = (events: unknown, sourceKeys: string[]): AdjudicatorEvent[] => {
  if (!Array.isArray(events) || events.length === 0) return Array.isArray(events) ? (events as AdjudicatorEvent[]) : [];
  return filterAdjudicationEventsBySources(events, sourceKeys);
};

const defaultScenario: ScenarioState = {
  content: null,
  fileName: null,
  isNative: false,
};

const defaultSettings: BattleSettings = {
  readArenaHistory: true,
  readArenaHistoryLimit: 3,
  isArenaHistoryUnlimited: false,
  writeArenaHistory: true,
  readCurrentState: true,
  writeCurrentState: true,
  readNarrativeHistory: false,
  readNarrativeHistoryLimit: 10,
  isNarrativeHistoryUnlimited: false,
  writeNarrativeHistory: false,
  streamTransport: 'sse',
  userGuidance: '',
  battleReportCardWidthMode: DEFAULT_BATTLE_REPORT_CARD_WIDTH_MODE,
  battleReportCardWidthPx: DEFAULT_BATTLE_REPORT_CARD_WIDTH_PX,
};

const createStorage = (): Storage => {
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage;
  }
  // 服务器端渲染时使用 noop storage
  return {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
    clear: () => undefined,
    key: () => null,
    length: 0,
  };
};

export const useBattleStore = create<BattleStoreState>()(
  persist(
    (set) => ({
      combatants: [],
      teams: [],
      scenario: defaultScenario,
      auxScenarios: [],
      materials: [],
      selectedQuestionnaires: [],
      battleMode: 'classic',
      generationMode: 'non-stream',
      arenaFreeRankingEnabled: false,
      isStreaming: false,
      streamingMarkdown: null,
      streamReporterInfo: null,
      streamUserGuidance: null,
      streamCharacterGuidances: null,
      streamAiUsage: null,
      streamAiModel: null,
      streamNarrativeHistoryReadCount: null,
      streamReasoning: null,
      streamUpdateMetaDebug: null,
      streamSoftTimeoutWarning: null,
      latestAiImpacts: null,
      storyLength: 'default',
      customStoryLength: '',
      selectedLanguage: 'zh-CN',
      lastGenerationId: null,
      settings: defaultSettings,
      adjudicationEvents: [],
      adjudicationResults: null,
      newsReport: null,
      updatedCombatants: [],
      error: null,
      isGenerating: false,
      isRedoingUpdates: false,
      isMatching: null,
      loadingPreset: null,
      userProviderConfig: null,

      setBattleMode: (mode) => set({ battleMode: mode }),
      setGenerationMode: (mode) => set({ generationMode: mode }),
      setArenaFreeRankingEnabled: (enabled) => set({ arenaFreeRankingEnabled: enabled }),
      setIsStreaming: (stateValue) => set({ isStreaming: stateValue }),
      setStreamingMarkdown: (markdown) => set({ streamingMarkdown: markdown }),
      setStreamReporterInfo: (info) => set({ streamReporterInfo: info }),
      setStreamUserGuidance: (guidance) => set({ streamUserGuidance: guidance }),
      setStreamCharacterGuidances: (guidances) => set({ streamCharacterGuidances: guidances }),
      setStreamAiUsage: (usage) => set({ streamAiUsage: usage }),
      setStreamAiModel: (model) => set({ streamAiModel: model }),
      setStreamNarrativeHistoryReadCount: (count) => set({ streamNarrativeHistoryReadCount: count }),
      setStreamReasoning: (reasoning) => set({ streamReasoning: reasoning }),
      setStreamUpdateMetaDebug: (debug) => set({ streamUpdateMetaDebug: debug }),
      setStreamSoftTimeoutWarning: (warning) => set({ streamSoftTimeoutWarning: warning }),
      setLatestAiImpacts: (impacts) => set({ latestAiImpacts: impacts }),
      setStoryLength: (storyLength) => set({ storyLength }),
      setCustomStoryLength: (customStoryLength) => set({ customStoryLength }),
      setSelectedLanguage: (selectedLanguage) => set({ selectedLanguage }),
      setLastGenerationId: (lastGenerationId) => set({ lastGenerationId }),
      updateSettings: (incoming) =>
        set((state) => ({
          settings: {
            ...state.settings,
            ...incoming,
          },
        })),

      addCombatant: (combatant) =>
        set((state) => {
          if (isCombatantLimitReached(state.combatants.length, MAX_COMBATANTS)) {
            return state;
          }
          return { combatants: [...state.combatants, combatant] };
        }),

      removeCombatant: (identifier) =>
        set((state) => {
          const removed = state.combatants.filter((item) => matchesCombatantIdentifier(item, identifier));
          const removedKeys = removed.map(getCombatantSourceKey).filter(Boolean);
          return {
            combatants: state.combatants.filter((item) => !removed.includes(item)),
            adjudicationEvents: removedKeys.length > 0
              ? removeAdjudicationEventsForKeys(state.adjudicationEvents, removedKeys)
              : state.adjudicationEvents,
          };
        }),

      setCombatants: (combatants) => set({ combatants }),
      moveCombatant: (fromIndex, toIndex) =>
        set((state) => {
          const current = state.combatants;
          if (fromIndex === toIndex) return state;
          if (fromIndex < 0 || fromIndex >= current.length) return state;
          if (toIndex < 0 || toIndex >= current.length) return state;

          const next = [...current];
          const [moved] = next.splice(fromIndex, 1);
          next.splice(toIndex, 0, moved!);
          return { combatants: next };
        }),
      clearCombatants: () =>
        set((state) => {
          const removedKeys = state.combatants.map(getCombatantSourceKey).filter(Boolean);
          return {
            combatants: [],
            teams: [],
            adjudicationEvents: removedKeys.length > 0
              ? removeAdjudicationEventsForKeys(state.adjudicationEvents, removedKeys)
              : state.adjudicationEvents,
          };
        }),

      updateCombatantTeam: (identifier, teamId) =>
        set((state) => ({
          combatants: state.combatants.map((combatant) => {
            const isMatch = 'id' in combatant ? combatant.id === identifier || combatant.filename === identifier : combatant.filename === identifier;
            if (isMatch) {
              return {
                ...combatant,
                teamId: !teamId ? undefined : teamId,
              };
            }
            return combatant;
          }),
        })),

      updateCombatantCharacterGuidance: (filename, guidance) =>
        set((state) => ({
          combatants: state.combatants.map((combatant) => {
            if (!('data' in combatant)) return combatant;
            if (combatant.filename !== filename) return combatant;
            return {
              ...combatant,
              characterGuidance: guidance,
            };
          }),
        })),

      addTeam: (name) => {
        let createdId = 1;
        set((state) => {
          const maxId = state.teams.reduce((max, team) => Math.max(max, team.id), 0);
          createdId = maxId + 1;
          const trimmedName = typeof name === 'string' ? name.trim() : '';
          const nextTeam = {
            id: createdId,
            name: trimmedName || `分队 ${createdId}`,
            isCollapsed: false,
          };
          return { teams: [...state.teams, nextTeam] };
        });
        return createdId;
      },

      removeTeam: (teamId) =>
        set((state) => ({
          teams: state.teams.filter((team) => team.id !== teamId),
          combatants: state.combatants.map((combatant) => {
            if (combatant.teamId !== teamId) return combatant;
            return { ...combatant, teamId: undefined };
          }),
        })),

      renameTeam: (teamId, name) =>
        set((state) => ({
          teams: state.teams.map((team) =>
            team.id === teamId ? { ...team, name: name.trim().slice(0, 50) || `分队 ${teamId}` } : team
          ),
        })),

      toggleTeamCollapsed: (teamId) =>
        set((state) => ({
          teams: state.teams.map((team) => (team.id === teamId ? { ...team, isCollapsed: !team.isCollapsed } : team)),
        })),

      setScenario: (scenario) =>
        set((state) => {
          const previousSourceKey = getScenarioSourceKey(state.scenario);
          const nextEvents = previousSourceKey
            ? applyAdjudicationEventSourceRemoval(state.adjudicationEvents, previousSourceKey)
            : state.adjudicationEvents;
          return {
            scenario,
            adjudicationEvents: nextEvents,
          };
        }),
      clearScenario: () =>
        set((state) => {
          const previousSourceKey = getScenarioSourceKey(state.scenario);
          return {
            scenario: defaultScenario,
            adjudicationEvents: previousSourceKey
              ? applyAdjudicationEventSourceRemoval(state.adjudicationEvents, previousSourceKey)
              : state.adjudicationEvents,
          };
        }),

      addAuxScenario: (scenario) =>
        set((state) => {
          if (state.auxScenarios.length >= MAX_AUX_SCENARIOS) {
            return state;
          }
          return { auxScenarios: [...state.auxScenarios, scenario] };
        }),

      removeAuxScenario: (id) =>
        set((state) => {
          const removed = state.auxScenarios.filter((item) => item.id === id);
          const removedKeys = removed.map(getScenarioSourceKey).filter(Boolean);
          return {
            auxScenarios: state.auxScenarios.filter((item) => item.id !== id),
            adjudicationEvents: removedKeys.length > 0
              ? removeAdjudicationEventsForKeys(state.adjudicationEvents, removedKeys)
              : state.adjudicationEvents,
          };
        }),

      moveAuxScenario: (fromIndex, toIndex) =>
        set((state) => {
          const current = state.auxScenarios;
          if (fromIndex === toIndex) return state;
          if (fromIndex < 0 || fromIndex >= current.length) return state;
          if (toIndex < 0 || toIndex >= current.length) return state;

          const next = [...current];
          const [moved] = next.splice(fromIndex, 1);
          next.splice(toIndex, 0, moved!);
          return { auxScenarios: next };
        }),

      clearAuxScenarios: () =>
        set((state) => ({
          auxScenarios: [],
          adjudicationEvents: removeAdjudicationEventsForKeys(
            state.adjudicationEvents,
            state.auxScenarios.map(getScenarioSourceKey).filter(Boolean)
          ),
        })),
      setAuxScenarios: (scenarios) =>
        set((state) => {
          const nextKeys = new Set(scenarios.map(getScenarioSourceKey).filter(Boolean));
          const removedKeys = state.auxScenarios
            .map(getScenarioSourceKey)
            .filter((key) => key && !nextKeys.has(key));
          return {
            auxScenarios: scenarios,
            adjudicationEvents: removedKeys.length > 0
              ? removeAdjudicationEventsForKeys(state.adjudicationEvents, removedKeys)
              : state.adjudicationEvents,
          };
        }),

      addMaterial: (material) =>
        set((state) => {
          if (state.materials.length >= MAX_ARENA_MATERIALS) {
            return state;
          }
          return { materials: [...state.materials, material] };
        }),

      removeMaterial: (id) =>
        set((state) => ({
          materials: state.materials.filter((item) => item.id !== id),
        })),

      moveMaterial: (fromIndex, toIndex) =>
        set((state) => {
          const current = state.materials;
          if (fromIndex === toIndex) return state;
          if (fromIndex < 0 || fromIndex >= current.length) return state;
          if (toIndex < 0 || toIndex >= current.length) return state;

          const next = [...current];
          const [moved] = next.splice(fromIndex, 1);
          next.splice(toIndex, 0, moved!);
          return { materials: next };
        }),

      clearMaterials: () => set({ materials: [] }),
      setMaterials: (materials) => set({ materials }),

      setAdjudicationEvents: (events) => set({ adjudicationEvents: events }),
      appendAdjudicationEvents: (events, sourceKey) =>
        set((state) => {
          const normalizedSourceKey = normalizeSourceKey(sourceKey);
          const nextEvents = Array.isArray(events) ? events : [];
          if (nextEvents.length === 0) return state;
          const withoutSameSource = normalizedSourceKey
            ? filterAdjudicationEventsBySources(state.adjudicationEvents, [normalizedSourceKey])
            : state.adjudicationEvents;
          const markedEvents = normalizedSourceKey
            ? nextEvents.map((event) => ({ ...event, sourceKey: normalizedSourceKey }))
            : nextEvents;
          return { adjudicationEvents: [...withoutSameSource, ...markedEvents] };
        }),
      removeAdjudicationEventsBySource: (sourceKey) =>
        set((state) => ({
          adjudicationEvents: applyAdjudicationEventSourceRemoval(state.adjudicationEvents, sourceKey),
        })),
      clearAdjudicationEvents: () => set({ adjudicationEvents: [] }),
      setAdjudicationResults: (results) => set({ adjudicationResults: results }),

      setNewsReport: (report) => set({ newsReport: report }),
      setUpdatedCombatants: (list) => set({ updatedCombatants: list }),

      setError: (message) => set({ error: message }),
      setIsGenerating: (stateValue) => set({ isGenerating: stateValue }),
      setIsRedoingUpdates: (stateValue) => set({ isRedoingUpdates: stateValue }),
      setIsMatching: (target) => set({ isMatching: target }),
      setLoadingPreset: (filename) => set({ loadingPreset: filename }),
      setUserProviderConfig: (config) => set({ userProviderConfig: config }),

      addQuestionnaireSelection: (incoming) =>
        set((state) => {
          const questionnaireId = incoming.questionnaire?.id ?? '';
          const isDuplicate = state.selectedQuestionnaires.some((item) => {
            if (item.source !== incoming.source) return false;
            if (item.questionnaire?.id !== questionnaireId) return false;
            if (incoming.source === 'database') {
              return Boolean(incoming.dataCardId) && item.dataCardId === incoming.dataCardId;
            }
            return true;
          });
          if (isDuplicate) return state;

          const usedSelectionIds = new Set<string>();
          state.selectedQuestionnaires.forEach((item) => {
            const existingId = item.selectionId || item.questionnaire.id;
            if (existingId) usedSelectionIds.add(existingId);
          });

          const createSelectionSuffix = () => {
            try {
              if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
                return crypto.randomUUID();
              }
            } catch {
              // ignore
            }
            return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
          };

          const base = questionnaireId || 'questionnaire';
          let selectionId = typeof incoming.selectionId === 'string' ? incoming.selectionId.trim() : '';
          if (!selectionId) {
            selectionId = usedSelectionIds.has(base) ? `${base}::${createSelectionSuffix()}` : base;
          } else if (usedSelectionIds.has(selectionId)) {
            selectionId = `${base}::${createSelectionSuffix()}`;
          }

          return { selectedQuestionnaires: [...state.selectedQuestionnaires, { ...incoming, selectionId }] };
        }),

      removeQuestionnaireSelection: (selectionId) =>
        set((state) => ({
          selectedQuestionnaires: state.selectedQuestionnaires.filter(
            (item) => (item.selectionId ?? item.questionnaire.id) !== selectionId
          ),
        })),

      setQuestionnaireSelections: (selections) => set({ selectedQuestionnaires: selections }),

      toggleQuestionnaireSelectionLore: (selectionId, enabled) =>
        set((state) => ({
          selectedQuestionnaires: state.selectedQuestionnaires.map((item) => {
            const id = item.selectionId ?? item.questionnaire.id;
            if (id !== selectionId) return item;
            return { ...item, useLore: enabled };
          }),
        })),
    }),
    {
      name: 'arena-storage',
      storage: createJSONStorage(createStorage),
      merge: (persistedState, currentState) => {
        const merged = { ...currentState, ...(persistedState as any) };
        if ((persistedState as any)?.settings && typeof (persistedState as any).settings === 'object') {
          merged.settings = { ...currentState.settings, ...(persistedState as any).settings };
        }
        return merged;
      },
      partialize: (state) => ({
        battleMode: state.battleMode,
        generationMode: state.generationMode,
        arenaFreeRankingEnabled: state.arenaFreeRankingEnabled,
        storyLength: state.storyLength,
        customStoryLength: state.customStoryLength,
        selectedLanguage: state.selectedLanguage,
        settings: state.settings,
      }),
    }
  )
);

export const selectBattleSettings = (state: BattleStoreState) => state.settings;
