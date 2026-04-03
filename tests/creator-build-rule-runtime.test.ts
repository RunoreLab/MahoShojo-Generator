import { describe, expect, test } from 'bun:test';

import { createDefaultBuildRuleInputs } from '@/lib/creator/build-rules';
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

  test('dnd 默认输入包含 level / class / lineage / abilityScores / combatProfile', () => {
    const inputs = createDefaultBuildRuleInputs('dnd-5e-lite');

    expect(inputs.level).toBe('1');
    expect(typeof inputs.class).toBe('string');
    expect(typeof inputs.lineage).toBe('string');
    expect(typeof inputs.abilityScores).toBe('object');
    expect(typeof inputs.combatProfile).toBe('object');
  });

  test('coc 默认输入包含 eraTone / occupation / coreAttributes / secondaryInputs', () => {
    const inputs = createDefaultBuildRuleInputs('coc-7e-lite');

    expect(typeof inputs.eraTone).toBe('string');
    expect(typeof inputs.occupation).toBe('string');
    expect(typeof inputs.coreAttributes).toBe('object');
    expect(typeof inputs.secondaryInputs).toBe('object');
  });

  test('缺少 stat-array 输入时会生成 block 级问题摘要', () => {
    const result = evaluateBuildRuleState({
      ruleId: 'dnd-5e-lite',
      inputs: {
        level: '1',
        class: 'fighter',
        lineage: 'human',
      },
    });

    expect(result.validationSummary.valid).toBe(false);
    expect(result.validationSummary.issues.some((issue) => issue.includes('abilityScores'))).toBe(true);
  });

  test('dnd-5e-lite 计算六维调整值与熟练加值', () => {
    const result = evaluateBuildRuleState({
      ruleId: 'dnd-5e-lite',
      inputs: {
        level: '5',
        class: 'wizard',
        lineage: 'high-elf',
        abilityScores: {
          STR: 8,
          DEX: 14,
          CON: 14,
          INT: 18,
          WIS: 12,
          CHA: 10,
        },
        combatProfile: {
          armorClass: 15,
          hitPoints: 32,
          speed: 30,
          passivePerception: 11,
        },
      },
    });

    expect(result.derived.proficiencyBonus).toBe(3);
    expect(result.derived.abilityModifiers).toEqual({
      STR: -1,
      DEX: 2,
      CON: 2,
      INT: 4,
      WIS: 1,
      CHA: 0,
    });
  });
});
