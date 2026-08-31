import { describe, expect, it } from 'vitest';

import {
  ARENA_RESOURCE_BUDGET,
  countArenaReferenceItems,
  estimateTokensFromText,
  evaluateArenaPromptBudget,
} from '../src/arena-generation/resource-budget';

describe('Arena resource budget', () => {
  it('counts all model-reference collections against one aggregate sanity budget', () => {
    expect(countArenaReferenceItems({
      auxScenarios: Array.from({ length: 3 }),
      materials: Array.from({ length: 4 }),
      questionnaires: Array.from({ length: 5 }),
      narrativeHistory: Array.from({ length: 6 }),
      unrelated: Array.from({ length: 99 }),
    })).toBe(18);
  });

  it('uses the shared text estimator for CJK and non-CJK input', () => {
    expect(estimateTokensFromText('魔法少女abcd')).toBe(5);
    expect(estimateTokensFromText('')).toBe(0);
  });

  it('keeps platform ceilings common while loosening only BYOK prompt spend', () => {
    const prompt = '输'.repeat(129_000);

    expect(evaluateArenaPromptBudget({
      fundingMode: 'hosted-system',
      prompt,
    })).toMatchObject({ allowed: false, maxEstimatedPromptTokens: 128_000 });
    expect(evaluateArenaPromptBudget({
      fundingMode: 'hosted-byok',
      prompt,
    })).toMatchObject({ allowed: true, maxEstimatedPromptTokens: 1_000_000 });
    expect(ARENA_RESOURCE_BUDGET.maxOutputBytes).toBe(4 * 1_024 * 1_024);
  });
});
