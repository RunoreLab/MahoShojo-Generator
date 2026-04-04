export type ChallengeWorldId = 'arena';

export type WorldTrackKindV1 = 'vital' | 'energy' | 'currency' | 'other';
export type ChallengeRunStatus = 'bootstrapping' | 'in_progress' | 'completed' | 'failed' | 'abandoned';
export type ChallengeNodeStatus = 'entered' | 'resolved';
export type ChallengeCheckpointKind = 'bootstrap_accepted' | 'node_resolved' | 'reward_applied' | 'finished';
export type ChallengeNodeType = 'battle' | 'elite' | 'event' | 'rest' | 'shop' | 'boss';
export type NodeVisibility = 'summary' | 'focused' | 'resolved';
export type EventInputMode = 'choice-only' | 'choice-plus-note' | 'free-intent';
export type NodeInputMode = EventInputMode | 'recommended-action-plus-free-intent';
export type StrengthTier = 'common' | 'elite' | 'boss';
export type RewardSelectionModeV1 = 'none' | 'auto' | 'choose-one';
export type RewardKindV1 =
  | 'adjust_track'
  | 'add_consumable'
  | 'add_persistent_item'
  | 'add_status'
  | 'clear_negative_status';
export type ShopRewardKindV1 = 'add_consumable' | 'add_persistent_item' | 'add_status' | 'clear_negative_status';

export interface WorldTrackValueV1 {
  current: number;
  max: number | null;
}

export interface WorldStateV1 {
  version: 1;
  schemaId: string;
  tracks: Record<string, WorldTrackValueV1>;
  temporaryStatuses: string[];
  runFlags: string[];
  persistentItemIds: string[];
  consumableIds: string[];
}

export interface ResourcePresentationEntryV1 {
  trackId: string;
  label: string;
  kind: WorldTrackKindV1;
  displayMode: 'bar' | 'badge' | 'hidden';
}

export interface ResourcePresentationPresetV1 {
  version: 1;
  id: string;
  primaryTracks: ResourcePresentationEntryV1[];
  secondaryCollections: Array<{
    key: 'consumableIds' | 'persistentItemIds' | 'temporaryStatuses';
    label: string;
    displayMode: 'chips' | 'list' | 'hidden';
  }>;
}

export interface WorldPresetV1 {
  version: 1;
  id: ChallengeWorldId;
  title: string;
  defaultVisitedNodes: number;
  resourceModelId: string;
  resourcePresentationId: string;
  mapProfileId: string;
  nodeGenerationRulesId: string;
  actionCatalogIds: string[];
  eventCatalogIds: string[];
  enemySourcePolicyId: string;
  failurePolicyId: string;
  aiPromptPackId: string;
}

export interface PlayerSnapshotV1 {
  version: 1;
  sourceType: 'preset' | 'local-card' | 'public-card';
  sourceId: string;
  displayName: string;
  snapshotSeed: string;
  strengthTier: StrengthTier;
  baseTrackSnapshot: Record<string, WorldTrackValueV1>;
  combatProfile: Record<string, unknown>;
  tags: string[];
  promptSummary: string;
}

export interface PendingRewardChoiceV1 {
  selectionMode: Extract<RewardSelectionModeV1, 'auto' | 'choose-one'>;
  rewardOptionIds: string[];
  sourceNodeId: string;
}

export interface MapNodeV1 {
  version: 1;
  nodeId: string;
  layer: number;
  nodeType: ChallengeNodeType;
  visibility: NodeVisibility;
  riskHint: 'low' | 'mid' | 'high';
  rewardHint: 'low' | 'mid' | 'high';
  encounterRef: string;
}

export interface MapEdgeV1 {
  version: 1;
  edgeId: string;
  fromNodeId: string;
  toNodeId: string;
}

export interface MapStateV1 {
  version: 1;
  rootNodeId: string;
  totalLayers: number;
  bossNodeId: string;
  nodes: MapNodeV1[];
  edges: MapEdgeV1[];
}

export interface RewardOptionV1 {
  version: 1;
  rewardOptionId: string;
  kind: RewardKindV1;
  label: string;
  payload: {
    trackId?: string;
    amount?: number;
    itemId?: string;
    statusId?: string;
    clearCount?: number;
  };
}

export interface EffectPatchV1 {
  version: 1;
  trackDeltas: Record<string, number>;
  addStatuses: string[];
  removeStatuses: string[];
  rewardSelectionMode: RewardSelectionModeV1;
  rewardOptionIds: string[];
}

export interface EventOptionV1 {
  version: 1;
  optionId: string;
  label: string;
  notePolicy: 'none' | 'optional' | 'required';
  effectPatch: EffectPatchV1;
  disabled?: boolean;
}

export interface ShopOfferV1 {
  version: 1;
  offerId: string;
  price: number;
  reward: RewardOptionV1 & { kind: ShopRewardKindV1 };
  disabled?: boolean;
}

export interface EnemySnapshotV1 {
  version: 1;
  sourceType: 'preset' | 'public-card' | 'season-entity';
  sourceId: string;
  displayName: string;
  strengthTier: StrengthTier;
  combatProfile: Record<string, unknown>;
  tags: string[];
  promptSummary: string;
}

export interface EncounterSnapshotV1 {
  version: 1;
  nodeId: string;
  templateId: string;
  kind: ChallengeNodeType;
  inputMode: NodeInputMode;
  enemySnapshot: EnemySnapshotV1 | null;
  rewardOptions: RewardOptionV1[];
  eventOptions: EventOptionV1[];
  shopOffers: ShopOfferV1[];
}

export interface RunStateV1 {
  version: 1;
  runId: string;
  worldPresetId: string;
  runSeed: string | null;
  status: ChallengeRunStatus;
  playerSnapshot: PlayerSnapshotV1 | null;
  worldState: WorldStateV1 | null;
  mapState: MapStateV1 | null;
  pendingRewardChoice: PendingRewardChoiceV1 | null;
  currentNodeId: string | null;
  visitedNodeCount: number;
  checkpointSeq: number;
  usedBootstrapReroll: boolean;
  startedAt: number;
  updatedAt: number;
}

export interface ChallengeRunRecord {
  id: string;
  worldPresetId: string;
  status: ChallengeRunStatus;
  snapshotSeed: string;
  runSeed: string | null;
  usedBootstrapReroll: boolean;
  playerSnapshot: unknown | null;
  runState: unknown | null;
  currentStateDigest: string | null;
  currentNodeId: string | null;
  visitedNodeCount: number;
  lastResolvedNodeId: string | null;
  lastCheckpointId: string | null;
  startedAt: number;
  updatedAt: number;
  finishedAt: number | null;
}

export interface ChallengeNodeRecord {
  id: string;
  runId: string;
  nodeId: string;
  visitIndex: number;
  nodeType: ChallengeNodeType;
  status: ChallengeNodeStatus;
  encounterSnapshot: EncounterSnapshotV1 | null;
  playerInput: unknown | null;
  resolverEnvelope: unknown | null;
  adjudicationResultDigest: string | null;
  storyText: string | null;
  createdAt: number;
  resolvedAt: number | null;
}

export interface ChallengeCheckpointSnapshotRecord {
  runState: RunStateV1 | null;
  playerSnapshot: PlayerSnapshotV1 | null;
  lastResolvedNodeId: string | null;
  pendingRewardChoice?: PendingRewardChoiceV1 | null;
}

export interface ChallengeCheckpointRecord {
  id: string;
  runId: string;
  seq: number;
  kind: ChallengeCheckpointKind;
  snapshot: ChallengeCheckpointSnapshotRecord;
  createdAt: number;
}

export interface ChallengeUnlockRecord {
  id: string;
  worldPresetId: string;
  runId: string;
  unlockType: string;
  unlockKey: string;
  title: string;
  description: string;
  sourceNodeId: string | null;
  createdAt: number;
}
