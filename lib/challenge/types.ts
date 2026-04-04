export type ChallengeWorldId = 'arena';

export type WorldTrackKindV1 = 'vital' | 'energy' | 'currency' | 'other';
export type ChallengeRunStatus = 'bootstrapping' | 'in_progress' | 'completed' | 'failed' | 'abandoned';
export type ChallengeNodeStatus = 'entered' | 'resolved';
export type ChallengeCheckpointKind = 'bootstrap_accepted' | 'node_resolved' | 'reward_applied' | 'finished';

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
  nodeType: string;
  status: ChallengeNodeStatus;
  encounterSnapshot: unknown | null;
  playerInput: unknown | null;
  resolverEnvelope: unknown | null;
  adjudicationResultDigest: string | null;
  storyText: string | null;
  createdAt: number;
  resolvedAt: number | null;
}

export interface ChallengeCheckpointSnapshotRecord {
  runState: unknown | null;
  playerSnapshot: unknown | null;
  lastResolvedNodeId: string | null;
  pendingRewardChoice?: unknown | null;
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
