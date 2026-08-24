import { describe, expect, test } from 'vitest';

import { resolveBuildRuleRuntimeResultsFromRequest } from '../src/creator/build-rule-request';
import { buildCreatorPromptInput, validateCreatorRequest } from '../src/creator/server';
import {
  CANSHOU_LORE,
  QUESTIONNAIRE_PRESET_INDEX,
  getRandomFlowers,
} from '../src/node-runtime/static-assets';

describe('package-owned Creator runtime and static assets', () => {
  test('build-rule request 在 package 内完成版本校验、计算与 prompt 投影', () => {
    const [rule] = resolveBuildRuleRuntimeResultsFromRequest([{
      ruleId: 'arena-trpg-lite',
      version: '1.0.0',
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
    }]);
    expect(rule?.validationSummary.valid).toBe(true);
    expect(rule?.derived).toEqual({ HP: 8, MP: 10, Radiance: 8 });

    const input = {
      template: 'general' as const,
      freeformBrief: '保持冷淡口吻',
      questionnaires: [],
      questionnaireAnswers: [],
      buildRules: [rule!],
      primaryRuleId: 'arena-trpg-lite',
    };
    expect(() => validateCreatorRequest(input)).not.toThrow();
    expect(buildCreatorPromptInput(input).buildRuleProjection.primary?.summary)
      .toContain('魔弹');
  });

  test('Hosted 静态资产由 package 直接提供，不依赖 legacy public 路径', () => {
    expect(QUESTIONNAIRE_PRESET_INDEX.presets.length).toBeGreaterThan(0);
    expect(QUESTIONNAIRE_PRESET_INDEX.presets.every((preset) => (
      preset.path.startsWith('/questionnaires/presets/')
    ))).toBe(true);
    expect(CANSHOU_LORE).toContain('残兽设定整理');
    expect(getRandomFlowers(2).split('\n')).toHaveLength(2);
  });
});
