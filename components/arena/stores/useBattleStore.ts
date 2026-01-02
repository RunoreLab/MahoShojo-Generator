'use client';

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import {
  BattleStoreState,
  BattleSettings,
  MAX_COMBATANTS,
  ScenarioState,
  MAX_AUX_SCENARIOS,
} from '../types';

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
  writeNarrativeHistory: false,
  userGuidance: '',
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
      battleMode: 'classic',
      generationMode: 'non-stream',
      isStreaming: false,
      streamingMarkdown: null,
      streamReporterInfo: null,
      streamUserGuidance: null,
      streamCharacterGuidances: null,
      streamAiUsage: null,
      streamAiModel: null,
      streamNarrativeHistoryReadCount: null,
      storyLength: 'default',
      selectedLevel: '',
      selectedLanguage: 'zh-CN',
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
      stats: null,

      setBattleMode: (mode) => set({ battleMode: mode }),
      setGenerationMode: (mode) => set({ generationMode: mode }),
      setIsStreaming: (stateValue) => set({ isStreaming: stateValue }),
      setStreamingMarkdown: (markdown) => set({ streamingMarkdown: markdown }),
      setStreamReporterInfo: (info) => set({ streamReporterInfo: info }),
      setStreamUserGuidance: (guidance) => set({ streamUserGuidance: guidance }),
      setStreamCharacterGuidances: (guidances) => set({ streamCharacterGuidances: guidances }),
      setStreamAiUsage: (usage) => set({ streamAiUsage: usage }),
      setStreamAiModel: (model) => set({ streamAiModel: model }),
      setStreamNarrativeHistoryReadCount: (count) => set({ streamNarrativeHistoryReadCount: count }),
      setStoryLength: (storyLength) => set({ storyLength }),
      setSelectedLevel: (selectedLevel) => set({ selectedLevel }),
      setSelectedLanguage: (selectedLanguage) => set({ selectedLanguage }),
      updateSettings: (incoming) =>
        set((state) => ({
          settings: {
            ...state.settings,
            ...incoming,
          },
        })),

      addCombatant: (combatant) =>
        set((state) => {
          if (state.combatants.length >= MAX_COMBATANTS) {
            return state;
          }
          return { combatants: [...state.combatants, combatant] };
        }),

      removeCombatant: (identifier) =>
        set((state) => ({
          combatants: state.combatants.filter((item) => {
            if ('id' in item) {
              return item.id !== identifier && item.filename !== identifier;
            }
            return item.filename !== identifier;
          }),
        })),

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
        set({
          combatants: [],
          teams: [],
          newsReport: null,
          updatedCombatants: [],
          streamingMarkdown: null,
          isStreaming: false,
          streamReporterInfo: null,
          streamUserGuidance: null,
          streamCharacterGuidances: null,
          streamAiUsage: null,
          streamAiModel: null,
          streamNarrativeHistoryReadCount: null,
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

      setScenario: (scenario) => set({ scenario }),
      clearScenario: () => set({ scenario: defaultScenario }),

      addAuxScenario: (scenario) =>
        set((state) => {
          if (state.auxScenarios.length >= MAX_AUX_SCENARIOS) {
            return state;
          }
          return { auxScenarios: [...state.auxScenarios, scenario] };
        }),

      removeAuxScenario: (id) =>
        set((state) => ({
          auxScenarios: state.auxScenarios.filter((item) => item.id !== id),
        })),

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

      clearAuxScenarios: () => set({ auxScenarios: [] }),
      setAuxScenarios: (scenarios) => set({ auxScenarios: scenarios }),

      setAdjudicationEvents: (events) => set({ adjudicationEvents: events }),
      setAdjudicationResults: (results) => set({ adjudicationResults: results }),

      setNewsReport: (report) => set({ newsReport: report }),
      setUpdatedCombatants: (list) => set({ updatedCombatants: list }),

      setError: (message) => set({ error: message }),
      setIsGenerating: (stateValue) => set({ isGenerating: stateValue }),
      setIsRedoingUpdates: (stateValue) => set({ isRedoingUpdates: stateValue }),
      setIsMatching: (target) => set({ isMatching: target }),
      setLoadingPreset: (filename) => set({ loadingPreset: filename }),
      setUserProviderConfig: (config) => set({ userProviderConfig: config }),
      setStats: (stats) => set({ stats }),
    }),
    {
      name: 'arena-storage',
      storage: createJSONStorage(createStorage),
      partialize: (state) => ({
        battleMode: state.battleMode,
        generationMode: state.generationMode,
        storyLength: state.storyLength,
        selectedLevel: state.selectedLevel,
        selectedLanguage: state.selectedLanguage,
        settings: state.settings,
      }),
    }
  )
);

export const selectBattleSettings = (state: BattleStoreState) => state.settings;
