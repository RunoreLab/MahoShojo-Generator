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

export const estimateTokensFromText = (text: string): number => {
  if (!text) return 0;
  let ascii = 0;
  let nonAsciiEstimate = 0;
  for (const character of text) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x7f) {
      ascii += 1;
    } else {
      // 这是跨 Provider 共用的轻量近似，不代表任一模型的真实 tokenizer。
      // BMP 非 ASCII 按一 code point 一 token；astral symbol（常见于 emoji）
      // 按四 token 保守估算。
      nonAsciiEstimate += codePoint > 0xffff ? 4 : 1;
    }
  }
  return Math.max(1, Math.ceil(nonAsciiEstimate + ascii / 4));
};

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
