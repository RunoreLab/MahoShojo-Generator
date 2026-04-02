import { describe, expect, mock, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

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
