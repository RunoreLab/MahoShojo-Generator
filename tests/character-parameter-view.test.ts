import { describe, expect, test } from 'vitest';

import { buildCharacterParameterView } from '@/lib/creator/character-parameter-view';

describe('character parameter view', () => {
  test('同时存在 creationInputs 与 buildState 时默认显示当前并提供双来源', () => {
    const view = buildCharacterParameterView({
      creationInputs: {
        buildRules: [
          {
            ruleId: 'dnd-5e-lite',
            version: '1.0.0',
            blockResults: {
              level: '3',
              class: 'wizard',
              lineage: 'high-elf',
              abilityScores: {
                STR: 8,
                DEX: 14,
                CON: 14,
                INT: 16,
                WIS: 12,
                CHA: 10,
              },
            },
            derived: {},
            validationSummary: {},
          },
        ],
      },
      buildState: {
        primaryRuleId: 'dnd-5e-lite',
        rules: [
          {
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
            },
            derived: {
              proficiencyBonus: 3,
            },
            validationSummary: {
              valid: true,
              issues: [],
              missingRequiredBlockKeys: [],
            },
          },
        ],
      },
    });

    expect(view).not.toBeNull();
    expect(view?.activeSource).toBe('current');
    expect(view?.sources.map((item) => item.key)).toEqual(['initial', 'current']);
  });

  test('select / number-group / multi-select / derived 会转换为卡面友好展示值', () => {
    const view = buildCharacterParameterView({
      buildState: {
        primaryRuleId: 'coc-7e-lite',
        rules: [
          {
            ruleId: 'coc-7e-lite',
            version: '1.0.0',
            blockResults: {
              eraTone: 'modern',
              occupation: 'doctor',
              secondaryInputs: { luck: 55, creditRating: 40, age: 28 },
              signatureSkills: ['medicine', 'psychology'],
            },
            derived: { SAN: 50, HP: 10, MP: 10, DamageBonus: '0' },
            validationSummary: {
              valid: true,
              issues: [],
              missingRequiredBlockKeys: [],
            },
          },
        ],
      },
    });

    const currentRule = view?.sources[0]?.rules[0];
    expect(currentRule).toBeDefined();
    expect(currentRule?.sections.some((section) => section.title === '职业' && section.entries.some((entry) => entry.value === '医生'))).toBe(true);
    expect(currentRule?.sections.some((section) => section.title === '补充数值' && section.entries.some((entry) => entry.label === '幸运' && entry.value === '55'))).toBe(true);
    expect(currentRule?.sections.some((section) => section.title === '代表性技能倾向' && section.entries.some((entry) => entry.value.includes('医学') && entry.value.includes('心理学')))).toBe(true);
    expect(currentRule?.sections.some((section) => section.title === '派生摘要' && section.entries.some((entry) => entry.label === 'SAN' && entry.value === '50'))).toBe(true);
  });

  test('没有可显示规则来源时返回 null', () => {
    expect(buildCharacterParameterView({})).toBeNull();
    expect(
      buildCharacterParameterView({
        creationInputs: { buildRules: [] },
        buildState: { rules: [] },
      })
    ).toBeNull();
  });

  test('missingRequiredBlockKeys 会并入问题列表并反映到状态文案', () => {
    const view = buildCharacterParameterView({
      buildState: {
        primaryRuleId: 'dnd-5e-lite',
        rules: [
          {
            ruleId: 'dnd-5e-lite',
            version: '1.0.0',
            blockResults: {
              level: '5',
              class: 'wizard',
              lineage: 'high-elf',
            },
            derived: {},
            validationSummary: {
              valid: false,
              issues: [],
              missingRequiredBlockKeys: ['abilityScores', 'combatProfile'],
            },
          },
        ],
      },
    });

    const currentRule = view?.sources[0]?.rules[0];
    expect(currentRule).toBeDefined();
    expect(currentRule?.valid).toBe(false);
    expect(currentRule?.statusLabel).toBe('存在 2 条规则问题');
    expect(currentRule?.issues).toEqual([
      '缺少必填块：六维属性',
      '缺少必填块：战斗摘要',
    ]);
  });
});
