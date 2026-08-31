import type { ArenaRoomSharedConfig } from '@mahoshojo/contracts/arena-room';

import {
  mapBattleStoreToArenaEditorView,
  type ArenaEditorViewProjection,
} from './shared-config-mapper';
import type {
  ArenaEditorActions,
  ArenaEditorCapabilities,
  ArenaEditorSession,
  ArenaEditorState,
  ArenaEditorStoreApi,
} from './types';
import { useBattleStore } from '../stores/useBattleStore';
import type { BattleStoreState } from '../types';
import { buildArenaRoomSharedConfigFromBattleState } from '@/lib/arena-room/shared-config';

export const SINGLE_ARENA_EDITOR_CAPABILITIES: ArenaEditorCapabilities = Object.freeze({
  canUploadLocalPayload: true,
  canPasteLocalPayload: true,
  canBrowsePrivateCards: true,
  canAddPresetRefs: true,
  canEditSharedConfig: true,
  canPublishRoomConfig: false,
  canStartGeneration: true,
  canPersistCharacterUpdate: true,
  canUseHostOnlyGenerationOptions: true,
});

const createSingleActions = (): ArenaEditorActions => Object.freeze({
  setBattleMode: (value) => useBattleStore.getState().setBattleMode(value),
  setStoryLength: (value) => useBattleStore.getState().setStoryLength(value),
  setCustomStoryLength: (value) => useBattleStore.getState().setCustomStoryLength(value),
  setSelectedLanguage: (value) => useBattleStore.getState().setSelectedLanguage(value),
  setUserGuidance: (value) => useBattleStore.getState().updateSettings({ userGuidance: value }),
  updateHistorySettings: (value) => useBattleStore.getState().updateSettings(value),
});

const buildState = (
  projection: ArenaEditorViewProjection,
  actions: ArenaEditorActions,
): ArenaEditorState => Object.freeze({
  mode: 'single' as const,
  ...projection,
  roomId: null,
  baselineEpoch: null,
  baselineRevision: null,
  baselineConfig: null,
  dirty: false,
  stale: false,
  replacementRequired: false,
  workspaceStatus: null,
  disposed: false,
  actions,
});

export const createSingleArenaEditorSession = (): ArenaEditorSession => {
  const actions = createSingleActions();
  let cachedSource: BattleStoreState | null = null;
  let cachedState: ArenaEditorState | null = null;

  const getState = (): ArenaEditorState => {
    const source = useBattleStore.getState();
    if (source !== cachedSource || !cachedState) {
      cachedSource = source;
      cachedState = buildState(mapBattleStoreToArenaEditorView(source), actions);
    }
    return cachedState;
  };
  const initialState = getState();
  const store: ArenaEditorStoreApi = Object.freeze({
    getState,
    getInitialState: () => initialState,
    subscribe: (listener) => useBattleStore.subscribe(() => listener()),
  });

  return Object.freeze({
    mode: 'single' as const,
    capabilities: SINGLE_ARENA_EDITOR_CAPABILITIES,
    store,
    exportSharedConfig: async (): Promise<ArenaRoomSharedConfig> => (
      buildArenaRoomSharedConfigFromBattleState(useBattleStore.getState())
    ),
    dispose: () => undefined,
  });
};
