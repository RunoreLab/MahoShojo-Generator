import { describe, expect, mock, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  buildCreatorDraftPayload,
  parseCreatorDraftPayload,
} from '@/lib/creator/draft';
import { getCreatorClientValidationMessage } from '@/lib/creator/client-validation';

mock.module('next/router', () => ({
  useRouter() {
    return {
      pathname: '/creator',
      query: {},
      push() {},
      replace() {},
      prefetch: async () => {},
    };
  },
}));

const { default: CreatorPage } = await import('@/pages/creator');

describe('pages/creator', () => {
  test('creator page shows template selector, questionnaire panel and build-rule panel', () => {
    const html = renderToStaticMarkup(<CreatorPage />);

    expect(html).toContain('输出模板');
    expect(html).toContain('问卷输入');
    expect(html).toContain('自由文本补充');
    expect(html).toContain('车卡规则');
    expect(html).toContain('Arena TRPG Lite');
  });

  test('creator page shows result actions when existing result is available', () => {
    const html = renderToStaticMarkup(
      <CreatorPage
        initialResultForTest={{
          templateId: '通用角色',
          name: '旧角色',
          content: '正文',
        }}
      />
    );

    expect(html).toContain('后续操作');
    expect(html).toContain('下载 JSON');
    expect(html).toContain('保存到云端');
    expect(html).toContain('复制到剪贴板');
  });

  test('creator page warns when existing result references a missing build-rule preset', () => {
    const html = renderToStaticMarkup(
      <CreatorPage
        initialResultForTest={{
          templateId: '通用角色',
          name: '旧角色',
          content: '正文',
          buildState: {
            primaryRuleId: 'missing-rule',
            rules: [
              {
                ruleId: 'missing-rule',
                version: '0.0.1',
                blockResults: {},
                derived: {},
                validationSummary: {
                  valid: true,
                  issues: [],
                  missingRequiredBlockKeys: [],
                },
              },
            ],
          },
        }}
      />
    );

    expect(html).toContain('原预设缺失，当前仅可只读查看既有规则结果。');
  });
});

describe('creator draft helpers', () => {
  test('buildCreatorDraftPayload normalizes generation mode and rule selection', () => {
    expect(
      buildCreatorDraftPayload({
        template: 'magical-girl',
        generationMode: 'stream',
        freeformBrief: '冷淡寡言的图书管理员',
        selectedRuleIds: ['arena-trpg-lite', '', 'arena-trpg-lite'],
        primaryRuleId: 'missing-rule',
        ruleInputs: {
          'arena-trpg-lite': {
            powerLevel: 'seed',
          },
          invalid: null,
        },
      })
    ).toEqual({
      version: 1,
      template: 'magical-girl',
      generationMode: 'non-stream',
      freeformBrief: '冷淡寡言的图书管理员',
      selectedRuleIds: ['arena-trpg-lite'],
      primaryRuleId: null,
      ruleInputs: {
        'arena-trpg-lite': {
          powerLevel: 'seed',
        },
      },
    });
  });

  test('parseCreatorDraftPayload returns null on invalid json', () => {
    expect(parseCreatorDraftPayload('{invalid-json')).toBeNull();
  });
});

describe('creator client validation', () => {
  test('有规则但未选择主规则时返回前端校验提示', () => {
    expect(
      getCreatorClientValidationMessage({
        template: 'general',
        freeformBrief: '写一个冷淡的图书管理员',
        questionnaires: [],
        questionnaireAnswers: [],
        buildRules: [
          {
            ruleId: 'arena-trpg-lite',
            version: '1.0.0',
            blockResults: {
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
              specialties: ['magic-burst'],
            },
            derived: {
              HP: 3,
              MP: 4,
              Radiance: 4,
            },
            validationSummary: {
              valid: true,
              issues: [],
              missingRequiredBlockKeys: [],
            },
          },
        ],
      })
    ).toBe('已选择车卡规则时必须指定一套主规则。');
  });

  test('规则存在未修正项时返回前端校验提示', () => {
    expect(
      getCreatorClientValidationMessage({
        template: 'general',
        freeformBrief: '写一个冷淡的图书管理员',
        questionnaires: [],
        questionnaireAnswers: [],
        buildRules: [
          {
            ruleId: 'arena-trpg-lite',
            version: '1.0.0',
            blockResults: {
              powerLevel: 'seed',
            },
            derived: {
              HP: 0,
              MP: 0,
              Radiance: 0,
            },
            validationSummary: {
              valid: false,
              issues: [
                {
                  code: 'required-missing',
                  blockKey: 'coreAttributes',
                  message: 'coreAttributes is required.',
                },
              ],
              missingRequiredBlockKeys: ['coreAttributes'],
            },
          },
        ],
        primaryRuleId: 'arena-trpg-lite',
      })
    ).toBe('车卡规则还有未修正项，请先完成必填项并处理预算问题。');
  });
});
