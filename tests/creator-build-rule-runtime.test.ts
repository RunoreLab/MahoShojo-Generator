import { describe, expect, test } from 'bun:test';

import { evaluateBuildRuleState } from '@/lib/creator/build-rule-runtime';

describe('creator build rule runtime', () => {
  test('arena-trpg-lite 计算派生值且校验通过（支持组合 key 归一化）', () => {
    const result = evaluateBuildRuleState({
      ruleId: 'arena-trpg-lite',
      inputs: {
        'powerLevel/select': 'seed',
        'coreAttributes/point-buy': {
          STR: 12,
          CON: 18,
          AGI: 10,
          MAG: 16,
          WILL: 20,
          PER: 8,
          CHM: 6,
        },
        'specialties/multi-select': ['magic-burst'],
      },
    });

    expect(result.ruleId).toBe('arena-trpg-lite');
    expect(result.version).toBe('1.0.0');
    expect(result.blockResults.powerLevel).toBe('seed');
    expect(result.blockResults.coreAttributes).toEqual({
      STR: 12,
      CON: 18,
      AGI: 10,
      MAG: 16,
      WILL: 20,
      PER: 8,
      CHM: 6,
    });
    expect(result.blockResults.specialties).toEqual(['magic-burst']);
    expect(result.derived).toEqual({
      HP: 3,
      MP: 4,
      Radiance: 4,
    });
    expect(result.validationSummary.valid).toBe(true);
    expect(result.validationSummary.issues).toEqual([]);
    expect(result.validationSummary.missingRequiredBlockKeys).toEqual([]);
  });

  test('属性预算超限时返回 invalid summary', () => {
    const overBudget = evaluateBuildRuleState({
      ruleId: 'arena-trpg-lite',
      inputs: {
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
  });

  test('必填 block 缺失时返回 invalid summary', () => {
    const missingRequired = evaluateBuildRuleState({
      ruleId: 'arena-trpg-lite',
      inputs: {
        specialties: ['magic-burst'],
      },
    });

    expect(missingRequired.validationSummary.valid).toBe(false);
    expect(
      missingRequired.validationSummary.issues.some((issue) => issue.code === 'required-missing')
    ).toBe(true);
    expect(missingRequired.validationSummary.missingRequiredBlockKeys).toEqual([
      'powerLevel',
      'coreAttributes',
    ]);
  });

  test('multi-select 数量约束生效', () => {
    const overCount = evaluateBuildRuleState({
      ruleId: 'arena-trpg-lite',
      inputs: {
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
        specialties: ['magic-burst', 'magic-burst', 'magic-burst'],
      },
    });

    expect(overCount.validationSummary.valid).toBe(false);
    expect(
      overCount.validationSummary.issues.some((issue) => issue.code === 'selection-count')
    ).toBe(true);
  });

  test('multi-select 预算约束生效', () => {
    const overBudget = evaluateBuildRuleState({
      ruleId: 'arena-trpg-lite',
      inputs: {
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
        specialties: ['magic-burst', 'magic-burst'],
      },
    });

    expect(overBudget.validationSummary.valid).toBe(false);
    expect(
      overBudget.validationSummary.issues.some(
        (issue) => issue.code === 'budget-exceeded' && issue.blockKey === 'specialties'
      )
    ).toBe(true);
  });
});
