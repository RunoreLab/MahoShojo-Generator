import { describe, expect, test } from 'bun:test';

import { projectBuildRulesForPrompt } from '@/lib/creator/build-rule-projection';

describe('creator build rule projection', () => {
  test('primary-structured 只投影主规则结构化事实，其他规则进入 references', () => {
    const projected = projectBuildRulesForPrompt({
      primaryRuleId: 'rule-main',
      rules: [
        {
          ruleId: 'rule-main',
          presetId: 'arena-trpg-lite',
          state: {
            powerLevel: 'seed',
          },
          derived: {
            HP: 3,
            MP: 4,
            Radiance: 5,
          },
        },
        {
          ruleId: 'rule-ref',
          presetId: 'arena-trpg-lite',
          state: {
            powerLevel: 'bloom',
          },
          derived: {
            HP: 4,
          },
        },
      ],
    });

    expect(projected.primary?.ruleId).toBe('rule-main');
    expect(projected.references.map((entry) => entry.ruleId)).toEqual(['rule-ref']);
  });

  test('reference-only 不覆盖主规则', () => {
    const projected = projectBuildRulesForPrompt({
      primaryRuleId: 'rule-ref-main',
      rules: [
        {
          ruleId: 'rule-ref-main',
          presetId: 'custom-reference-only',
          state: {
            note: 'only reference',
          },
        },
        {
          ruleId: 'rule-main',
          presetId: 'arena-trpg-lite',
          state: {
            powerLevel: 'seed',
          },
        },
      ],
      resolvePreset: (presetId) => {
        if (presetId === 'custom-reference-only') {
          return {
            id: 'custom-reference-only',
            version: '1.0.0',
            title: 'Custom Reference Only',
            supportedTemplates: ['general'],
            allowStandalone: true,
            mainRuleEligible: false,
            projectionPolicy: 'reference-only',
            blocks: [],
          };
        }
        return null;
      },
    });

    expect(projected.primary).toBeNull();
    expect(projected.references.map((entry) => entry.ruleId)).toEqual([
      'rule-ref-main',
      'rule-main',
    ]);
  });
});
