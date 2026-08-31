import { createStore } from 'zustand/vanilla';

import type { ArenaRoomSharedConfig } from '@mahoshojo/contracts/arena-room';

import {
  buildArenaProposalSubmitIntent,
  createArenaProposalEditor,
  editWorkingConfig,
  previewArenaProposal,
  resetArenaProposalEditor,
  syncArenaProposalEditor,
  type ArenaProposalEditorState,
} from '@/lib/arena-room/proposal-editor';

import {
  cloneArenaEditorSharedConfig,
  mapSharedConfigToArenaEditorView,
} from './shared-config-mapper';
import type {
  ArenaEditorActions,
  ArenaEditorCapabilities,
  ArenaEditorState,
  ArenaProposalEditorSnapshotInput,
  RoomProposalArenaEditorSession,
} from './types';

export const ROOM_PROPOSAL_ARENA_EDITOR_CAPABILITIES: ArenaEditorCapabilities = Object.freeze({
  canUploadLocalPayload: false,
  canPasteLocalPayload: false,
  canBrowsePrivateCards: false,
  canAddPresetRefs: false,
  canEditSharedConfig: true,
  canPublishRoomConfig: false,
  canStartGeneration: false,
  canPersistCharacterUpdate: false,
  canUseHostOnlyGenerationOptions: false,
});

const disposedError = (): Error => new Error('Arena editor session is disposed');

const buildState = (
  editor: ArenaProposalEditorState,
  actions: ArenaEditorActions,
  disposed: boolean,
): ArenaEditorState => Object.freeze({
  mode: 'room-proposal' as const,
  ...mapSharedConfigToArenaEditorView(editor.workingConfig),
  roomId: editor.roomId,
  baselineEpoch: editor.baselineEpoch,
  baselineRevision: editor.baselineRevision,
  baselineConfig: cloneArenaEditorSharedConfig(editor.baselineConfig),
  dirty: editor.dirty,
  stale: editor.stale,
  replacementRequired: editor.replacementRequired,
  workspaceStatus: null,
  disposed,
  actions,
});

export const createRoomProposalArenaEditorSession = (
  snapshot: ArenaProposalEditorSnapshotInput,
): RoomProposalArenaEditorSession => {
  let editor = createArenaProposalEditor(snapshot);
  let disposed = false;
  const assertActive = (): void => {
    if (disposed) throw disposedError();
  };
  function update(
    updater: (draft: ArenaRoomSharedConfig) => ArenaRoomSharedConfig,
  ): void {
    assertActive();
    commit(editWorkingConfig(editor, updater));
  }
  const actions: ArenaEditorActions = Object.freeze({
    setBattleMode: (value) => update((draft) => ({ ...draft, battleMode: value })),
    setStoryLength: (value) => update((draft) => ({ ...draft, storyLength: value })),
    setCustomStoryLength: (value) => update((draft) => ({
      ...draft,
      customStoryLength: value.trim() || null,
    })),
    setSelectedLanguage: (value) => update((draft) => ({
      ...draft,
      selectedLanguage: value,
    })),
    setUserGuidance: (value) => update((draft) => ({
      ...draft,
      userGuidance: value,
    })),
    updateHistorySettings: (value) => update((draft) => ({
      ...draft,
      historySettings: { ...draft.historySettings, ...value },
    })),
  });
  const store = createStore<ArenaEditorState>()(() => buildState(editor, actions, false));
  const commit = (nextEditor: ArenaProposalEditorState): void => {
    editor = nextEditor;
    store.setState(buildState(editor, actions, disposed), true);
  };

  const session: RoomProposalArenaEditorSession = Object.freeze({
    mode: 'room-proposal' as const,
    capabilities: ROOM_PROPOSAL_ARENA_EDITOR_CAPABILITIES,
    store,
    update,
    sync(incoming) {
      assertActive();
      const next = syncArenaProposalEditor(editor, incoming);
      if (next !== editor) commit(next);
    },
    replace(incoming) {
      assertActive();
      commit(resetArenaProposalEditor(incoming));
    },
    exportSharedConfig(): ArenaRoomSharedConfig {
      assertActive();
      return cloneArenaEditorSharedConfig(editor.workingConfig);
    },
    preview(selectedChangeIds) {
      assertActive();
      return previewArenaProposal(editor, selectedChangeIds);
    },
    buildSubmitIntent(proposalId, selectedChangeIds) {
      assertActive();
      return buildArenaProposalSubmitIntent(editor, proposalId, selectedChangeIds);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      store.setState(buildState(editor, actions, true), true);
    },
  });

  return session;
};
