import { ARENA_CANONICAL_CAPABILITIES, ARENA_CANONICAL_RESOURCE_LIMITS } from '@mahoshojo/contracts/arena-capabilities';

export type ArenaHostedFundingMode = 'hosted-system' | 'hosted-byok';

export const ARENA_RESOURCE_BUDGET = Object.freeze({
  hardBodyBytes: ARENA_CANONICAL_RESOURCE_LIMITS.requestBodyBytes,
  cancelBodyBytes: 1_024,
  maxCombatants: ARENA_CANONICAL_CAPABILITIES.maxCombatants,
  maxAdjudicationEvents: ARENA_CANONICAL_RESOURCE_LIMITS.maxAdjudicationEvents,
  maxReferenceItemsSanity: ARENA_CANONICAL_CAPABILITIES.maxReferenceItemsSanity,
  maxOutputBytes: ARENA_CANONICAL_RESOURCE_LIMITS.outputContentBytes,
  maxEstimatedPromptTokens: Object.freeze({
    'hosted-system': 128_000,
    'hosted-byok': 1_000_000,
  }),
});

export const ARENA_REFERENCE_COLLECTION_KEYS = Object.freeze([
  'auxScenarios',
  'materials',
  'questionnaires',
  'narrativeHistory',
] as const);

export const countArenaReferenceItems = (
  payload: Readonly<Record<string, unknown>>,
): number => ARENA_REFERENCE_COLLECTION_KEYS.reduce((total, key) => (
  total + (Array.isArray(payload[key]) ? payload[key].length : 0)
), 0);

export { estimateTokensFromText } from '@mahoshojo/domain/token-estimate';
import { estimateTokensFromText } from '@mahoshojo/domain/token-estimate';

export type ArenaPromptBudgetEvaluation = Readonly<{
  allowed: boolean;
  estimatedPromptTokens: number;
  maxEstimatedPromptTokens: number;
}>;

export const evaluateArenaPromptBudget = (input: Readonly<{
  fundingMode: ArenaHostedFundingMode;
  prompt: string;
}>): ArenaPromptBudgetEvaluation => {
  const estimatedPromptTokens = estimateTokensFromText(input.prompt);
  const maxEstimatedPromptTokens = ARENA_RESOURCE_BUDGET
    .maxEstimatedPromptTokens[input.fundingMode];
  return Object.freeze({
    allowed: estimatedPromptTokens <= maxEstimatedPromptTokens,
    estimatedPromptTokens,
    maxEstimatedPromptTokens,
  });
};
