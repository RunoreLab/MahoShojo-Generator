import { describe, expect, test } from 'bun:test';

import { finalizeCreatorStreamCard } from '@/lib/creator/stream-result';

describe('creator stream result', () => {
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
