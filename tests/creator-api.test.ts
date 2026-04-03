import { describe, expect, test } from 'bun:test';

import { buildCreatorPromptInput, validateCreatorRequest } from '@/lib/creator/server';

const arenaRule = {
  ruleId: 'arena-trpg-lite',
  version: '1.0.0',
  blockResults: {
    powerLevel: 'seed',
  },
  derived: {
    HP: 3,
  },
  validationSummary: {
    valid: true,
    issues: [],
    missingRequiredBlockKeys: [],
  },
} as const;

const dndRule = {
  ruleId: 'dnd-5e-lite',
  version: '1.0.0',
  blockResults: {
    level: '5',
    class: 'wizard',
    lineage: 'high-elf',
  },
  derived: {
    proficiencyBonus: 3,
  },
  validationSummary: {
    valid: true,
    issues: [],
    missingRequiredBlockKeys: [],
  },
} as const;

const cocRule = {
  ruleId: 'coc-7e-lite',
  version: '1.0.0',
  blockResults: {
    eraTone: 'classic-1920s',
    occupation: 'detective',
  },
  derived: {
    SAN: 60,
  },
  validationSummary: {
    valid: true,
    issues: [],
    missingRequiredBlockKeys: [],
  },
} as const;

const resolvePreset = (ruleId: string) => {
  if (ruleId === 'requires-questionnaire-rule') {
    return {
      id: 'requires-questionnaire-rule',
      version: '1.0.0',
      supportedTemplates: ['general'],
      allowStandalone: false,
      mainRuleEligible: true,
      projectionPolicy: 'primary-structured' as const,
      blocks: [],
    };
  }

  if (ruleId === 'reference-only-rule') {
    return {
      id: 'reference-only-rule',
      version: '1.0.0',
      supportedTemplates: ['general'],
      allowStandalone: true,
      mainRuleEligible: false,
      projectionPolicy: 'reference-only' as const,
      blocks: [],
    };
  }

  return null;
};

describe('creator server', () => {
  test('freeformBrief 优先于问卷说明，但不覆盖结构化规则事实', () => {
    const built = buildCreatorPromptInput({
      template: 'general',
      freeformBrief: '写成冷淡口吻',
      questionnaires: [{ questionnaireId: 'q-1', title: '背景问卷' }],
      questionnaireAnswers: [{ questionnaireId: 'q-1', question: '你是谁', answer: '观测者' }],
      buildRules: [arenaRule],
      primaryRuleId: 'arena-trpg-lite',
    });

    expect(built.userIntent).toContain('冷淡口吻');
    expect(built.questionnaireSummary).toContain('背景问卷');
    expect(built.buildRuleProjection.primary?.template).toBe('general');
    expect(built.buildRuleProjection.primary?.facts.blockResults.powerLevel).toBe('seed');
  });

  test('没有问卷和规则时要求 freeformBrief 非空', () => {
    expect(() =>
      validateCreatorRequest({
        template: 'general',
        freeformBrief: '',
        questionnaires: [],
        questionnaireAnswers: [],
        buildRules: [],
      })
    ).toThrow('FREEFORM_BRIEF_REQUIRED');
  });

  test('存在规则时要求 primaryRuleId', () => {
    expect(() =>
      validateCreatorRequest({
        template: 'general',
        freeformBrief: 'x',
        questionnaires: [],
        questionnaireAnswers: [],
        buildRules: [arenaRule],
      })
    ).toThrow('PRIMARY_RULE_REQUIRED');
  });

  test('primaryRuleId 必须存在于 buildRules', () => {
    expect(() =>
      validateCreatorRequest({
        template: 'general',
        freeformBrief: 'x',
        questionnaires: [],
        questionnaireAnswers: [],
        buildRules: [arenaRule],
        primaryRuleId: 'missing-rule',
      })
    ).toThrow('PRIMARY_RULE_NOT_SELECTED');
  });

  test('规则不支持当前模板时拒绝请求', () => {
    expect(() =>
      validateCreatorRequest({
        template: 'scenario',
        freeformBrief: 'x',
        questionnaires: [],
        questionnaireAnswers: [],
        buildRules: [arenaRule],
        primaryRuleId: 'arena-trpg-lite',
      })
    ).toThrow('RULE_TEMPLATE_UNSUPPORTED');
  });

  test('dnd-5e-lite 在 scenario 模板下被拒绝', () => {
    expect(() =>
      validateCreatorRequest({
        template: 'scenario',
        freeformBrief: 'x',
        questionnaires: [],
        questionnaireAnswers: [],
        buildRules: [dndRule],
        primaryRuleId: 'dnd-5e-lite',
      })
    ).toThrow('RULE_TEMPLATE_UNSUPPORTED');
  });

  test('coc-7e-lite 在 general-scenario 模板下被拒绝', () => {
    expect(() =>
      validateCreatorRequest({
        template: 'general-scenario',
        freeformBrief: 'x',
        questionnaires: [],
        questionnaireAnswers: [],
        buildRules: [cocRule],
        primaryRuleId: 'coc-7e-lite',
      })
    ).toThrow('RULE_TEMPLATE_UNSUPPORTED');
  });

  test('allowStandalone=false 的规则缺少问卷时拒绝请求', () => {
    expect(() =>
      validateCreatorRequest(
        {
          template: 'general',
          freeformBrief: 'x',
          questionnaires: [],
          questionnaireAnswers: [],
          buildRules: [
            {
              ...arenaRule,
              ruleId: 'requires-questionnaire-rule',
            },
          ],
          primaryRuleId: 'requires-questionnaire-rule',
        },
        { resolvePreset }
      )
    ).toThrow('QUESTIONNAIRE_REQUIRED_FOR_RULE');
  });

  test('primaryRuleId 对应规则必须允许作为主规则', () => {
    expect(() =>
      validateCreatorRequest(
        {
          template: 'general',
          freeformBrief: 'x',
          questionnaires: [{ questionnaireId: 'q-1' }],
          questionnaireAnswers: [],
          buildRules: [
            {
              ...arenaRule,
              ruleId: 'reference-only-rule',
            },
          ],
          primaryRuleId: 'reference-only-rule',
        },
        { resolvePreset }
      )
    ).toThrow('PRIMARY_RULE_INELIGIBLE');
  });

  test('规则快照 validationSummary 无效时拒绝请求', () => {
    expect(() =>
      validateCreatorRequest({
        template: 'general',
        freeformBrief: 'x',
        questionnaires: [],
        questionnaireAnswers: [],
        buildRules: [
          {
            ...arenaRule,
            validationSummary: {
              valid: false,
              issues: ['属性点超出预算：已使用 320 / 上限 280'],
              missingRequiredBlockKeys: [],
            },
          },
        ],
        primaryRuleId: 'arena-trpg-lite',
      })
    ).toThrow('RULE_VALIDATION_FAILED');
  });
});
