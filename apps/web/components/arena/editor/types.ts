import type {
  ArenaProposalChange,
  ArenaRoomProposalSubmitRequest,
  ArenaRoomSharedConfig,
  SharedHistorySettings,
} from '@mahoshojo/contracts/arena-room';

export type ArenaEditorMode = 'single' | 'room-host' | 'room-proposal';

export type ArenaEditorCapabilities = Readonly<{
  canUploadLocalPayload: boolean;
  canPasteLocalPayload: boolean;
  canBrowsePrivateCards: boolean;
  canAddPresetRefs: boolean;
  canEditSharedConfig: boolean;
  canPublishRoomConfig: boolean;
  canStartGeneration: boolean;
  canPersistCharacterUpdate: boolean;
  canUseHostOnlyGenerationOptions: boolean;
}>;

export type ArenaEditorResourceSource =
  | 'data-card'
  | 'preset'
  | 'host-local'
  | 'random';

export type ArenaEditorResourceAccess =
  | 'full'
  | 'reference'
  | 'stub'
  | 'placeholder';

export type ArenaEditorReferenceView = Readonly<{
  id: string;
  versionToken: string;
}>;

export type ArenaEditorCombatantView = Readonly<{
  key: string;
  name: string;
  /** Ref projection does not carry a character type; never fabricate one. */
  type: 'magical-girl' | 'canshou' | 'general-character' | null;
  source: ArenaEditorResourceSource;
  access: ArenaEditorResourceAccess;
  reference: ArenaEditorReferenceView | null;
  characterGuidance: string;
  teamKey: string | null;
}>;

export type ArenaEditorTeamView = Readonly<{
  key: string;
  name: string;
  combatantKeys: readonly string[];
}>;

export type ArenaEditorScenarioView = Readonly<{
  key: string;
  name: string;
  source: Exclude<ArenaEditorResourceSource, 'random'>;
  access: Exclude<ArenaEditorResourceAccess, 'placeholder'>;
  reference: ArenaEditorReferenceView | null;
}>;

export type ArenaEditorMaterialView = ArenaEditorScenarioView;

export type ArenaEditorWorkspaceStatus =
  | Readonly<{ kind: 'unknown' }>
  | Readonly<{ kind: 'clean' }>
  | Readonly<{
      kind: 'dirty';
      reasons: readonly (
        | 'baseline-missing'
        | 'host-local-content'
        | 'shared-config'
        | 'working-copy-invalid'
      )[];
    }>
  | Readonly<{ kind: 'invalid'; reason: string }>;

export type ArenaEditorActions = Readonly<{
  setBattleMode(value: ArenaRoomSharedConfig['battleMode']): void;
  setStoryLength(value: ArenaRoomSharedConfig['storyLength']): void;
  setCustomStoryLength(value: string): void;
  setSelectedLanguage(value: string): void;
  setUserGuidance(value: string): void;
  updateHistorySettings(value: Partial<SharedHistorySettings>): void;
}>;

export type ArenaEditorState = Readonly<{
  mode: ArenaEditorMode;
  combatants: readonly ArenaEditorCombatantView[];
  teams: readonly ArenaEditorTeamView[];
  scenario: ArenaEditorScenarioView | null;
  auxScenarios: readonly ArenaEditorScenarioView[];
  materials: readonly ArenaEditorMaterialView[];
  battleMode: ArenaRoomSharedConfig['battleMode'];
  storyLength: ArenaRoomSharedConfig['storyLength'];
  customStoryLength: string;
  selectedLanguage: string;
  userGuidance: string;
  historySettings: SharedHistorySettings;
  busy: boolean;
  roomId: string | null;
  baselineEpoch: string | null;
  baselineRevision: number | null;
  baselineConfig: ArenaRoomSharedConfig | null;
  dirty: boolean;
  stale: boolean;
  replacementRequired: boolean;
  workspaceStatus: ArenaEditorWorkspaceStatus | null;
  disposed: boolean;
  actions: ArenaEditorActions;
}>;

export type ArenaEditorStoreApi = Readonly<{
  getState(): ArenaEditorState;
  getInitialState(): ArenaEditorState;
  subscribe(listener: () => void): () => void;
}>;

export type ArenaEditorSession = Readonly<{
  mode: ArenaEditorMode;
  capabilities: ArenaEditorCapabilities;
  store: ArenaEditorStoreApi;
  exportSharedConfig(): ArenaRoomSharedConfig | Promise<ArenaRoomSharedConfig>;
  dispose(): void;
}>;

export type ArenaProposalEditorSnapshotInput = Readonly<{
  roomId: string;
  roomEpoch: string;
  revision: number;
  sharedConfig: ArenaRoomSharedConfig;
}>;

export type ArenaRoomProposalPreview = Readonly<{
  changes: readonly ArenaProposalChange[];
  selectedChangeIds: readonly string[];
}>;

export type RoomProposalArenaEditorSession = ArenaEditorSession & Readonly<{
  mode: 'room-proposal';
  update(
    updater: (draft: ArenaRoomSharedConfig) => ArenaRoomSharedConfig,
  ): void;
  sync(snapshot: ArenaProposalEditorSnapshotInput): void;
  replace(snapshot: ArenaProposalEditorSnapshotInput): void;
  exportSharedConfig(): ArenaRoomSharedConfig;
  preview(selectedChangeIds?: readonly string[]): ArenaRoomProposalPreview;
  buildSubmitIntent(
    proposalId: string,
    selectedChangeIds?: readonly string[],
  ): ArenaRoomProposalSubmitRequest;
}>;

export type RoomHostArenaEditorSessionInput = Readonly<{
  authority: ArenaProposalEditorSnapshotInput;
  workspaceStatus?: ArenaEditorWorkspaceStatus;
}>;

export type RoomHostArenaEditorSession = ArenaEditorSession & Readonly<{
  mode: 'room-host';
  syncAuthority(input: RoomHostArenaEditorSessionInput): void;
  exportSharedConfig(): Promise<ArenaRoomSharedConfig>;
}>;
