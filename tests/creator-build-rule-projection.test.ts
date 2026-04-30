import { describe, expect, test } from 'bun:test';

import { projectBuildRulesForPrompt } from '@/lib/creator/build-rule-projection';

const runtimeResult = {
  ruleId: 'arena-trpg-lite',
  version: '1.0.0',
  blockResults: {
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
  derived: {
    HP: 8,
    MP: 10,
    Radiance: 8,
  },
  validationSummary: {
    valid: true,
    issues: [],
    missingRequiredBlockKeys: [],
    budget: {
      attributePointsUsed: 280,
      attributePointsLimit: 280,
      specialtyPointsUsed: 3,
      specialtyPointsLimit: 4,
    },
  },
} as const;

const dndRuntimeResult = {
  ruleId: 'dnd-5e-lite',
  version: '1.0.0',
  blockResults: {
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
  derived: {
    proficiencyBonus: 3,
    abilityModifiers: {
      STR: -1,
      DEX: 2,
      CON: 2,
      INT: 4,
      WIS: 1,
      CHA: 0,
    },
    hitDie: 'd6',
    spellcastingKind: 'full',
  },
  validationSummary: {
    valid: true,
    issues: [],
    missingRequiredBlockKeys: [],
  },
} as const;

const cocRuntimeResult = {
  ruleId: 'coc-7e-lite',
  version: '1.0.0',
  blockResults: {
    eraTone: 'classic-1920s',
    occupation: 'detective',
    coreAttributes: {
      STR: 60,
      CON: 55,
      SIZ: 65,
      DEX: 70,
      APP: 50,
      INT: 75,
      POW: 60,
      EDU: 80,
    },
    secondaryInputs: {
      luck: 50,
      creditRating: 40,
      age: 32,
    },
    signatureSkills: ['spot-hidden', 'psychology', 'firearms'],
  },
  derived: {
    SAN: 60,
    HP: 12,
    MP: 12,
    Build: 1,
    DamageBonus: '1d4',
  },
  validationSummary: {
    valid: true,
    issues: [],
    missingRequiredBlockKeys: [],
  },
} as const;

const wuxiankongbuFxRuntimeResult = {
  ruleId: 'wuxiankongbu-fx-v137',
  version: '1.0.0',
  blockResults: {
    coreAttributes: {
      INT: 2,
      PER: 2,
      RES: 1,
      STR: 2,
      DEX: 3,
      STA: 1,
      PRE: 2,
      MAN: 1,
      COM: 1,
    },
    skills: {
      academics: 1,
      devices: 1,
      craft: 1,
      focus: 1,
      athletics: 1,
      survival: 1,
      firearms: 2,
      combat: 1,
      insight: 1,
      stealth: 1,
      expression: 1,
      social: 1,
    },
    bodyProfile: {
      size: 5,
    },
    specialties: ['lucky-star-1', 'quick-reload-1'],
  },
  derived: {
    Speed: 10,
    Initiative: '1d10+4',
    BaseDefense: 2,
    Health: 6,
    Willpower: 2,
  },
  validationSummary: {
    valid: true,
    issues: [],
    missingRequiredBlockKeys: [],
  },
} as const;

describe('creator build-rule projection', () => {
  test('主规则投影保留结构化事实与中文摘要', () => {
    const projection = projectBuildRulesForPrompt({
      template: 'general',
      primaryRuleId: 'arena-trpg-lite',
      rules: [runtimeResult],
      resolveRuleProjectionPolicy: () => 'primary-structured',
    });

    expect(projection.primary?.template).toBe('general');
    expect(projection.primary?.facts.derived.HP).toBe(8);
    expect(projection.primary?.summary).toContain('力量层级');
    expect(projection.primary?.summary).toContain('种（Seed）');
    expect(projection.primary?.summary).toContain('魔弹');
  });

  test('reference-only 规则进入 references，不覆盖主规则', () => {
    const projection = projectBuildRulesForPrompt({
      template: 'general',
      primaryRuleId: 'arena-trpg-lite',
      rules: [
        runtimeResult,
        {
          ...runtimeResult,
          ruleId: 'reference-only-rule',
        },
      ],
      resolveRuleProjectionPolicy: (ruleId) =>
        ruleId === 'reference-only-rule' ? 'reference-only' : 'primary-structured',
    });

    expect(projection.primary?.facts.ruleId).toBe('arena-trpg-lite');
    expect(projection.references).toHaveLength(1);
    expect(projection.references[0]?.ruleId).toBe('reference-only-rule');
  });

  test('dnd-5e-lite 主规则摘要包含等级、职业与施法类型', () => {
    const projection = projectBuildRulesForPrompt({
      template: 'general',
      primaryRuleId: 'dnd-5e-lite',
      rules: [dndRuntimeResult],
      resolveRuleProjectionPolicy: () => 'primary-structured',
    });

    expect(projection.primary?.summary).toContain('等级');
    expect(projection.primary?.summary).toContain('法师');
    expect(projection.primary?.summary).toContain('完整施法');
  });

  test('coc-7e-lite 主规则摘要包含年代、职业与理智值', () => {
    const projection = projectBuildRulesForPrompt({
      template: 'general',
      primaryRuleId: 'coc-7e-lite',
      rules: [cocRuntimeResult],
      resolveRuleProjectionPolicy: () => 'primary-structured',
    });

    expect(projection.primary?.summary).toContain('1920s');
    expect(projection.primary?.summary).toContain('侦探');
    expect(projection.primary?.summary).toContain('SAN');
  });

  test('wuxiankongbu-fx-v137 主规则摘要包含九项属性、衍生值与专长', () => {
    const projection = projectBuildRulesForPrompt({
      template: 'general',
      primaryRuleId: 'wuxiankongbu-fx-v137',
      rules: [wuxiankongbuFxRuntimeResult],
      resolveRuleProjectionPolicy: () => 'primary-structured',
    });

    expect(projection.primary?.summary).toContain('无限恐怖FXv137');
    expect(projection.primary?.summary).toContain('智力 2');
    expect(projection.primary?.summary).toContain('速度 10');
    expect(projection.primary?.summary).toContain('幸运星');
  });
});
