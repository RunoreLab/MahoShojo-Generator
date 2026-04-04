export type ChallengeWorldId = 'arena';

export type WorldTrackKindV1 = 'vital' | 'energy' | 'currency' | 'other';

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
