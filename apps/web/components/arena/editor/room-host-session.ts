import type { ArenaRoomSharedConfig } from '@mahoshojo/contracts/arena-room';

import { cloneArenaEditorSharedConfig } from './shared-config-mapper';
import { createSingleArenaEditorSession } from './single-session';
import type {
  ArenaEditorActions,
  ArenaEditorCapabilities,
  ArenaEditorState,
  ArenaEditorWorkspaceStatus,
  ArenaProposalEditorSnapshotInput,
  RoomHostArenaEditorSession,
  RoomHostArenaEditorSessionInput,
} from './types';
import { createArenaProposalEditor } from '@/lib/arena-room/proposal-editor';

export const ROOM_HOST_ARENA_EDITOR_CAPABILITIES: ArenaEditorCapabilities = Object.freeze({
  canUploadLocalPayload: true,
  canPasteLocalPayload: true,
  canBrowsePrivateCards: true,
  canAddPresetRefs: true,
  canEditSharedConfig: true,
  canPublishRoomConfig: true,
  canStartGeneration: true,
  canPersistCharacterUpdate: true,
  canUseHostOnlyGenerationOptions: true,
});

type HostMetadata = Readonly<{
  authority: ArenaProposalEditorSnapshotInput;
  workspaceStatus: ArenaEditorWorkspaceStatus;
}>;

const normalizeMetadata = (
  input: RoomHostArenaEditorSessionInput,
): HostMetadata => {
  const authority = createArenaProposalEditor(input.authority);
  const workspaceStatus: ArenaEditorWorkspaceStatus = input.workspaceStatus?.kind === 'dirty'
    ? Object.freeze({
        kind: 'dirty',
        reasons: Object.freeze([...input.workspaceStatus.reasons]),
      })
    : input.workspaceStatus?.kind === 'invalid'
      ? Object.freeze({ kind: 'invalid', reason: input.workspaceStatus.reason })
      : Object.freeze({ kind: input.workspaceStatus?.kind ?? 'unknown' });
  return Object.freeze({
    authority: Object.freeze({
      roomId: authority.roomId,
      roomEpoch: authority.baselineEpoch,
      revision: authority.baselineRevision,
      sharedConfig: cloneArenaEditorSharedConfig(authority.baselineConfig),
    }),
    workspaceStatus,
  });
};

const isDirty = (status: ArenaEditorWorkspaceStatus): boolean => status.kind !== 'clean';

export const createRoomHostArenaEditorSession = (
  input: RoomHostArenaEditorSessionInput,
): RoomHostArenaEditorSession => {
  const single = createSingleArenaEditorSession();
  let metadata = normalizeMetadata(input);
  let metadataRevision = 0;
  let disposed = false;
  let cachedSingleState: ArenaEditorState | null = null;
  let cachedMetadataRevision = -1;
  let cachedState: ArenaEditorState | null = null;
  const listeners = new Set<() => void>();
  const assertActive = (): void => {
    if (disposed) throw new Error('Arena editor session is disposed');
  };
  const singleActions = single.store.getState().actions;
  const actions: ArenaEditorActions = Object.freeze({
    setBattleMode(value) {
      assertActive();
      singleActions.setBattleMode(value);
    },
    setStoryLength(value) {
      assertActive();
      singleActions.setStoryLength(value);
    },
    setCustomStoryLength(value) {
      assertActive();
      singleActions.setCustomStoryLength(value);
    },
    setSelectedLanguage(value) {
      assertActive();
      singleActions.setSelectedLanguage(value);
    },
    setUserGuidance(value) {
      assertActive();
      singleActions.setUserGuidance(value);
    },
    updateHistorySettings(value) {
      assertActive();
      singleActions.updateHistorySettings(value);
    },
  });

  const getState = (): ArenaEditorState => {
    const singleState = single.store.getState();
    if (
      singleState !== cachedSingleState
      || metadataRevision !== cachedMetadataRevision
      || !cachedState
    ) {
      cachedSingleState = singleState;
      cachedMetadataRevision = metadataRevision;
      cachedState = Object.freeze({
        ...singleState,
        mode: 'room-host' as const,
        roomId: metadata.authority.roomId,
        baselineEpoch: metadata.authority.roomEpoch,
        baselineRevision: metadata.authority.revision,
        baselineConfig: cloneArenaEditorSharedConfig(metadata.authority.sharedConfig),
        dirty: isDirty(metadata.workspaceStatus),
        workspaceStatus: metadata.workspaceStatus,
        disposed,
        actions,
      });
    }
    return cachedState;
  };
  const initialState = getState();
  const unsubscribeSingle = single.store.subscribe(() => {
    listeners.forEach((listener) => listener());
  });
  const notifyMetadata = (): void => {
    metadataRevision += 1;
    listeners.forEach((listener) => listener());
  };

  const session: RoomHostArenaEditorSession = Object.freeze({
    mode: 'room-host' as const,
    capabilities: ROOM_HOST_ARENA_EDITOR_CAPABILITIES,
    store: Object.freeze({
      getState,
      getInitialState: () => initialState,
      subscribe(listener: () => void) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    }),
    syncAuthority(nextInput) {
      assertActive();
      metadata = normalizeMetadata(nextInput);
      notifyMetadata();
    },
    async exportSharedConfig(): Promise<ArenaRoomSharedConfig> {
      assertActive();
      return single.exportSharedConfig();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribeSingle();
      notifyMetadata();
      listeners.clear();
    },
  });

  return session;
};
