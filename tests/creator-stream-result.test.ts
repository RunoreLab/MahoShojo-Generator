import { describe, expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import GeneralCharacterCard from '@/components/GeneralCharacterCard';
import { buildCreatorStreamCardFromMarkdown, finalizeCreatorStreamCard } from '@/lib/creator/stream-result';

describe('creator stream result', () => {
  test('general 流式展示对象可携带 creator 规则元数据并渲染角色参数', () => {
    const creationInputs = {
      template: 'general',
      buildRules: [
        {
          ruleId: 'dnd-5e-lite',
          version: '1.0.0',
          blockResults: {
            level: '3',
            class: 'wizard',
          },
          validationSummary: {
            valid: true,
            issues: [],
            missingRequiredBlockKeys: [],
          },
        },
      ],
    };
    const buildState = {
      primaryRuleId: 'dnd-5e-lite',
      rules: [
        {
          ruleId: 'dnd-5e-lite',
          version: '1.0.0',
          blockResults: {
            level: '5',
            class: 'wizard',
          },
          validationSummary: {
            valid: true,
            issues: [],
            missingRequiredBlockKeys: [],
          },
        },
      ],
    };

    const displayCard = buildCreatorStreamCardFromMarkdown({
      template: 'general',
      markdown: '# 巡夜人\n\n代号：巡夜人\n\n守望街区的人。',
      fallbackLabel: '巡夜人',
      creationInputs,
      buildState,
    } as any) as any;

    expect(displayCard.creationInputs).toEqual(creationInputs);
    expect(displayCard.buildState).toEqual(buildState);

    const html = renderToStaticMarkup(React.createElement(GeneralCharacterCard, { general: displayCard }));
    expect(html).toContain('角色参数');
  });

  test('general-scenario 流式提交后保存为通用情景卡', () => {
    const result = finalizeCreatorStreamCard({
      template: 'general-scenario',
      markdown: '# 深夜车站\n\n标题：深夜车站\n\n月台空无一人。',
      fallbackLabel: '补充说明里的标题',
      creationInputs: {
        template: 'general-scenario',
        freeformBrief: '写成冷清的都市异闻。',
        questionnaires: [],
        questionnaireAnswers: [],
        buildRules: [],
      },
      buildState: {
        rules: [],
      },
    });

    expect(result.templateId).toBe('通用情景');
    expect(result.title).toBe('深夜车站');
    expect(result.content).toContain('月台空无一人');
    expect(result.creationInputs.template).toBe('general-scenario');
    expect(result.buildState?.rules).toEqual([]);
  });
});
