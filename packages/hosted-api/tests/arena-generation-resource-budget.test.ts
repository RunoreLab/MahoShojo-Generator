import { describe, expect, it } from 'vitest';

import {
  ARENA_RESOURCE_BUDGET,
  countArenaReferenceItems,
  estimateArenaPromptBudgetTokens,
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
    expect(estimateTokensFromText('あいうえ한글')).toBe(6);
    expect(estimateTokensFromText('😀')).toBe(4);
    expect(estimateTokensFromText('')).toBe(0);
  });

  it('does not let non-ASCII scripts bypass the system prompt budget', () => {
    expect(estimateArenaPromptBudgetTokens('あ한😀A')).toBe(11);
    expect(estimateArenaPromptBudgetTokens('\uE000')).toBe(3);
    expect(evaluateArenaPromptBudget({
      fundingMode: 'hosted-system',
      prompt: 'あ'.repeat(43_000),
    })).toMatchObject({
      allowed: false,
      estimatedPromptTokens: 129_000,
      maxEstimatedPromptTokens: 128_000,
    });
  });

  it('does not let adversarial ASCII bypass the system prompt budget', () => {
    expect(evaluateArenaPromptBudget({
      fundingMode: 'hosted-system',
      prompt: '~'.repeat(128_001),
    })).toMatchObject({
      allowed: false,
      estimatedPromptTokens: 128_001,
      maxEstimatedPromptTokens: 128_000,
    });
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
