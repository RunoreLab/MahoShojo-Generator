import { ARENA_CANONICAL_CAPABILITIES } from '@mahoshojo/contracts/arena-capabilities';

export type ArenaHostedFundingMode = 'hosted-system' | 'hosted-byok';

export const ARENA_RESOURCE_BUDGET = Object.freeze({
  hardBodyBytes: 12 * 1_024 * 1_024,
  cancelBodyBytes: 1_024,
  maxCombatants: ARENA_CANONICAL_CAPABILITIES.maxCombatants,
  maxAdjudicationEvents: 100,
  maxReferenceItemsSanity: ARENA_CANONICAL_CAPABILITIES.maxReferenceItemsSanity,
  maxOutputBytes: 4 * 1_024 * 1_024,
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
