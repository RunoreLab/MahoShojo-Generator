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
});
