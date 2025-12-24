'use client';

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import {
  BattleStoreState,
  BattleSettings,
  MAX_COMBATANTS,
  ScenarioState,
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
      scenario: defaultScenario,
      battleMode: 'classic',
      generationMode: 'non-stream',
      isStreaming: false,
      streamingMarkdown: null,
      streamReporterInfo: null,
      streamUserGuidance: null,
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
      clearCombatants: () =>
        set({
          combatants: [],
          newsReport: null,
          updatedCombatants: [],
          streamingMarkdown: null,
          isStreaming: false,
          streamReporterInfo: null,
          streamUserGuidance: null,
        }),

      updateCombatantTeam: (filename, teamId) =>
        set((state) => ({
          combatants: state.combatants.map((combatant) => {
            if ('filename' in combatant && combatant.filename === filename) {
              return {
                ...combatant,
                teamId: teamId === 0 ? undefined : teamId,
              };
            }
            return combatant;
          }),
        })),

      setScenario: (scenario) => set({ scenario }),
      clearScenario: () => set({ scenario: defaultScenario }),

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
