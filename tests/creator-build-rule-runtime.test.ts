import { describe, expect, test } from 'bun:test';

import { evaluateBuildRuleState } from '@/lib/creator/build-rule-runtime';

describe('creator build-rule runtime', () => {
  test('arena-trpg-lite 计算 HP / MP / Radiance', () => {
    const result = evaluateBuildRuleState({
      ruleId: 'arena-trpg-lite',
      inputs: {
        powerLevel: 'seed',
        coreAttributes: {
          STR: 40,
          CON: 40,
          AGI: 40,
          MAG: 40,
          WILL: 40,
          PER: 40,
          CHM: 40,
        },
        specialties: ['magic-bullet', 'magic-shield'],
      },
    });

    expect(result.derived).toEqual({ HP: 8, MP: 10, Radiance: 8 });
    expect(result.validationSummary.valid).toBe(true);
    expect(result.validationSummary.budget?.attributePointsUsed).toBe(280);
    expect(result.validationSummary.budget?.specialtyPointsUsed).toBe(3);
  });

  test('属性预算超限时返回 invalid', () => {
    const result = evaluateBuildRuleState({
      ruleId: 'arena-trpg-lite',
      inputs: {
        powerLevel: 'seed',
        coreAttributes: {
          STR: 80,
          CON: 80,
          AGI: 80,
          MAG: 80,
          WILL: 80,
          PER: 80,
          CHM: 80,
        },
        specialties: [],
      },
    });

    expect(result.validationSummary.valid).toBe(false);
    expect(result.validationSummary.issues.some((issue) => issue.includes('属性点'))).toBe(true);
  });

  test('专长预算超限时返回 invalid', () => {
    const result = evaluateBuildRuleState({
      ruleId: 'arena-trpg-lite',
      inputs: {
        powerLevel: 'seed',
        coreAttributes: {
          STR: 40,
          CON: 40,
          AGI: 40,
          MAG: 40,
          WILL: 40,
          PER: 40,
          CHM: 40,
        },
        specialties: ['shell-launch', 'perpetual-flight'],
      },
    });

    expect(result.validationSummary.valid).toBe(false);
    expect(result.validationSummary.budget?.specialtyPointsUsed).toBe(6);
    expect(result.validationSummary.budget?.specialtyPointsLimit).toBe(4);
  });

  test('unlimited 跳过预算总量校验，但仍保留字段合法性校验', () => {
    const result = evaluateBuildRuleState({
      ruleId: 'arena-trpg-lite',
      inputs: {
        powerLevel: 'unlimited',
        coreAttributes: {
          STR: 80,
          CON: 80,
          AGI: 80,
          MAG: 80,
          WILL: 80,
          PER: 80,
          CHM: 80,
        },
        specialties: ['hypersonic-flash'],
      },
    });

    expect(result.validationSummary.valid).toBe(true);
    expect(result.validationSummary.budget?.attributePointsLimit).toBeNull();
    expect(result.validationSummary.budget?.specialtyPointsLimit).toBeNull();
  });
});
