import { describe, expect, test } from 'bun:test';

import { evaluateBuildRuleState } from '@/lib/creator/build-rule-runtime';

describe('creator build rule runtime', () => {
  test('arena-trpg-lite 计算派生值且校验通过', () => {
    const result = evaluateBuildRuleState({
      presetId: 'arena-trpg-lite',
      input: {
        powerLevel: 'seed',
        coreAttributes: {
          STR: 12,
          CON: 18,
          AGI: 10,
          MAG: 16,
          WILL: 20,
          PER: 8,
          CHM: 6,
        },
        specialties: ['magic-burst'],
      },
    });

    expect(result.derived.HP).toBeGreaterThan(0);
    expect(result.derived.MP).toBeGreaterThan(0);
    expect(result.derived.Radiance).toBeGreaterThan(0);
    expect(result.validationSummary.valid).toBe(true);
  });

  test('预算超限或必填 block 缺失时返回 invalid summary', () => {
    const overBudget = evaluateBuildRuleState({
      presetId: 'arena-trpg-lite',
      input: {
        powerLevel: 'seed',
        coreAttributes: {
          STR: 13,
          CON: 18,
          AGI: 10,
          MAG: 16,
          WILL: 20,
          PER: 8,
          CHM: 6,
        },
        specialties: ['magic-burst'],
      },
    });

    expect(overBudget.validationSummary.valid).toBe(false);
    expect(
      overBudget.validationSummary.issues.some((issue) => issue.code === 'budget-exceeded')
    ).toBe(true);

    const missingRequired = evaluateBuildRuleState({
      presetId: 'arena-trpg-lite',
      input: {
        specialties: ['magic-burst'],
      },
    });

    expect(missingRequired.validationSummary.valid).toBe(false);
    expect(
      missingRequired.validationSummary.issues.some((issue) => issue.code === 'required-missing')
    ).toBe(true);
  });
});
