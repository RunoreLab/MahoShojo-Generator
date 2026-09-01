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
      // 服务端门禁不能沿用“所有非 CJK 都按拉丁文本四字符一 token”的乐观估算。
      // BMP 非 ASCII 至少按一 code point 一 token；astral symbol（常见于 emoji）按
      // 四字节 UTF-8 的保守上界计数，避免多语种或 emoji 绕过系统渠道预算。
      nonAsciiEstimate += codePoint > 0xffff ? 4 : 1;
    }
  }
  return Math.max(1, Math.ceil(nonAsciiEstimate + ascii / 4));
};

/**
 * Provider tokenizer 因渠道/模型而异，服务端资金门禁使用 UTF-8 byte count 作为
 * byte-fallback tokenizer 的保守 token 上界；UI 的近似展示继续使用上面的 estimator。
 */
export const estimateArenaPromptBudgetTokens = (text: string): number => {
  let utf8Bytes = 0;
  for (const character of text) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x7f) utf8Bytes += 1;
    else if (codePoint <= 0x7ff) utf8Bytes += 2;
    else if (codePoint <= 0xffff) utf8Bytes += 3;
    else utf8Bytes += 4;
  }
  return utf8Bytes;
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
  const estimatedPromptTokens = estimateArenaPromptBudgetTokens(input.prompt);
  const maxEstimatedPromptTokens = ARENA_RESOURCE_BUDGET
    .maxEstimatedPromptTokens[input.fundingMode];
  return Object.freeze({
    allowed: estimatedPromptTokens <= maxEstimatedPromptTokens,
    estimatedPromptTokens,
    maxEstimatedPromptTokens,
  });
};
