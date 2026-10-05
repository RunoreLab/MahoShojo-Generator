import {
  ARENA_RESOURCE_BUDGET,
  countArenaReferenceItems,
} from '@mahoshojo/hosted-api/arena-generation/resource-budget';

export const MAX_ARENA_REFERENCE_ITEMS = ARENA_RESOURCE_BUDGET.maxReferenceItemsSanity;
export const ARENA_ESTIMATED_PROMPT_TOKEN_BUDGETS =
  ARENA_RESOURCE_BUDGET.maxEstimatedPromptTokens;

export type ArenaReferenceCollections = Readonly<{
  auxScenarios?: readonly unknown[];
  materials?: readonly unknown[];
  selectedQuestionnaires?: readonly unknown[];
  narrativeHistory?: readonly unknown[];
}>;

export const countArenaSelectedReferenceItems = (
  collections: ArenaReferenceCollections,
): number => countArenaReferenceItems({
  auxScenarios: collections.auxScenarios,
  materials: collections.materials,
  questionnaires: collections.selectedQuestionnaires,
  narrativeHistory: collections.narrativeHistory,
});

export const getArenaReferenceRemainingCapacity = (
  collections: ArenaReferenceCollections,
): number => Math.max(
  0,
  MAX_ARENA_REFERENCE_ITEMS - countArenaSelectedReferenceItems(collections),
);

export const canAddArenaReferenceItems = (
  collections: ArenaReferenceCollections,
  count = 1,
): boolean => (
  Number.isInteger(count)
  && count >= 0
  && countArenaSelectedReferenceItems(collections) + count <= MAX_ARENA_REFERENCE_ITEMS
);
