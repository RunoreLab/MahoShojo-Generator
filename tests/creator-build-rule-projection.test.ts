import { describe, expect, test } from 'bun:test';

import { projectBuildRulesForPrompt } from '@/lib/creator/build-rule-projection';

describe('creator build rule projection', () => {
  test('primary-structured 只投影主规则结构化事实，其他规则进入 references（直接消费 runtime 结果）', () => {
    const projected = projectBuildRulesForPrompt({
      primaryRuleId: 'rule-main',
      template: 'general',
      rules: [
        {
          ruleId: 'rule-main',
          version: '1.0.0',
          blockResults: {
            powerLevel: 'seed',
          },
          derived: {
            HP: 3,
            MP: 4,
            Radiance: 5,
          },
          validationSummary: {
            valid: true,
            issues: [],
            missingRequiredBlockKeys: [],
          },
        },
        {
          ruleId: 'rule-ref',
          version: '1.0.0',
          blockResults: {
            powerLevel: 'bloom',
          },
          derived: {
            HP: 4,
          },
          validationSummary: {
            valid: false,
            issues: [{ code: 'required-missing', blockKey: 'coreAttributes', message: 'missing' }],
            missingRequiredBlockKeys: ['coreAttributes'],
          },
        },
      ],
      resolveRuleProjectionPolicy: (ruleId) =>
        ruleId === 'rule-main' || ruleId === 'rule-ref' ? 'primary-structured' : 'reference-only',
    });

    expect(projected.primary?.ruleId).toBe('rule-main');
    expect(projected.primary?.template).toBe('general');
    expect(projected.primary?.promptLayer).toBe('fixed-facts');
    expect(projected.primary?.facts.blockResults.powerLevel).toBe('seed');
    expect(projected.primary?.facts.validationSummary).toEqual({
      valid: true,
      issues: [],
      missingRequiredBlockKeys: [],
    });
    expect(projected.references.map((entry) => entry.ruleId)).toEqual(['rule-ref']);
    expect(projected.references[0]?.template).toBe('general');
    expect(projected.references[0]?.promptLayer).toBe('reference-context');
    expect(projected.references[0]?.facts.blockResults.powerLevel).toBe('bloom');
    expect(projected.references[0]?.facts.validationSummary).toEqual({
      valid: false,
      issues: [{ code: 'required-missing', blockKey: 'coreAttributes', message: 'missing' }],
      missingRequiredBlockKeys: ['coreAttributes'],
    });
  });

  test('reference-only 不覆盖主规则', () => {
    const projected = projectBuildRulesForPrompt({
      primaryRuleId: 'rule-ref-main',
      template: 'general',
      rules: [
        {
          ruleId: 'rule-ref-main',
          version: '1.0.0',
          blockResults: {
            note: 'only reference',
          },
          derived: {},
          validationSummary: {
            valid: true,
            issues: [],
            missingRequiredBlockKeys: [],
          },
        },
        {
          ruleId: 'rule-main',
          version: '1.0.0',
          blockResults: {
            powerLevel: 'seed',
          },
          derived: {},
          validationSummary: {
            valid: true,
            issues: [],
            missingRequiredBlockKeys: [],
          },
        },
      ],
      resolveRuleProjectionPolicy: (ruleId) =>
        ruleId === 'rule-ref-main' ? 'reference-only' : 'primary-structured',
    });

    expect(projected.primary).toBeNull();
    expect(projected.references.map((entry) => entry.ruleId)).toEqual([
      'rule-ref-main',
      'rule-main',
    ]);
    expect(projected.references[0]?.promptLayer).toBe('reference-context');
    expect(projected.references[1]?.promptLayer).toBe('reference-context');
  });
});
