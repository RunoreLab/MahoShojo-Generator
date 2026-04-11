import type { ResourcePresentationPresetV1, WorldPresetV1 } from '@/lib/challenge/types';

export const arenaChallengeResourcePresentation: ResourcePresentationPresetV1 = {
  version: 1,
  id: 'arena-v1',
  primaryTracks: [
    { trackId: 'hp', label: '生命', kind: 'vital', displayMode: 'bar' },
    { trackId: 'radiance', label: '光辉', kind: 'energy', displayMode: 'bar' },
    { trackId: 'currency', label: '晶尘', kind: 'currency', displayMode: 'badge' },
  ],
  secondaryCollections: [
    { key: 'persistentItemIds', label: '奇物', displayMode: 'chips' },
    { key: 'consumableIds', label: '消耗品', displayMode: 'chips' },
    { key: 'temporaryStatuses', label: '状态', displayMode: 'chips' },
  ],
};

export const arenaChallengeWorldPreset: WorldPresetV1 = {
  version: 1,
  id: 'arena',
  title: '魔法少女竞技场',
  defaultVisitedNodes: 8,
  resourceModelId: 'arena-v1',
  resourcePresentationId: 'arena-v1',
  mapProfileId: 'arena-fixed-8',
  nodeGenerationRulesId: 'arena-fixed-8',
  actionCatalogIds: ['arena-core-actions'],
  eventCatalogIds: ['arena-manual-events'],
  enemySourcePolicyId: 'arena-ranked-seasonal',
  failurePolicyId: 'arena-standard-failure',
  aiPromptPackId: 'arena-challenge-v1',
};
