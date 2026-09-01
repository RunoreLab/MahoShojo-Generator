import { describe, expect, it } from 'vitest';

import {
  ARENA_CANONICAL_CAPABILITIES,
  ARENA_RUNTIME_RESOURCE_BUDGET_KEYS,
} from '@mahoshojo/contracts/arena-capabilities';

import {
  ARENA_RESOURCE_BUDGET,
  countArenaReferenceItems,
  estimateTokensFromText,
  evaluateArenaPromptBudget,
} from '../src/arena-generation/resource-budget';

describe('Arena resource budget', () => {
  it('[GMR10Q-RUNTIME-BUDGET-KEYS] canonical inventory 精确覆盖 runtime budget', () => {
    expect(Object.keys(ARENA_RESOURCE_BUDGET).sort())
      .toEqual([...ARENA_RUNTIME_RESOURCE_BUDGET_KEYS].sort());
  });
  it('从 dependency-neutral canonical source 继承角色与参考项容量', () => {
    expect(ARENA_RESOURCE_BUDGET.maxCombatants)
      .toBe(ARENA_CANONICAL_CAPABILITIES.maxCombatants);
    expect(ARENA_RESOURCE_BUDGET.maxReferenceItemsSanity)
      .toBe(ARENA_CANONICAL_CAPABILITIES.maxReferenceItemsSanity);
  });

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

  it('uses the shared approximation instead of UTF-8 bytes for CJK prompt budgets', () => {
    expect(evaluateArenaPromptBudget({
      fundingMode: 'hosted-system',
      prompt: 'あ'.repeat(100_000),
    })).toMatchObject({
      allowed: true,
      estimatedPromptTokens: 100_000,
      maxEstimatedPromptTokens: 128_000,
    });
  });

  it('uses the shared four-characters-per-token approximation for ASCII prompt budgets', () => {
    expect(evaluateArenaPromptBudget({
      fundingMode: 'hosted-system',
      prompt: '~'.repeat(400_000),
    })).toMatchObject({
      allowed: true,
      estimatedPromptTokens: 100_000,
      maxEstimatedPromptTokens: 128_000,
    });

    expect(evaluateArenaPromptBudget({
      fundingMode: 'hosted-system',
      prompt: '~'.repeat(512_001),
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
    })).toMatchObject({
      allowed: false,
      estimatedPromptTokens: 129_000,
      maxEstimatedPromptTokens: 128_000,
    });
    expect(evaluateArenaPromptBudget({
      fundingMode: 'hosted-byok',
      prompt,
    })).toMatchObject({ allowed: true, maxEstimatedPromptTokens: 1_000_000 });
    expect(ARENA_RESOURCE_BUDGET.maxOutputBytes).toBe(4 * 1_024 * 1_024);
  });
});
