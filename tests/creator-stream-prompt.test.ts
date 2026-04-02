import { describe, expect, test } from 'bun:test';

import { buildCreatorStreamPrompt } from '@/lib/creator/stream-prompt';

describe('creator stream prompt', () => {
  test('general-scenario 使用情景卡提示词而非角色卡提示词', () => {
    const prompt = buildCreatorStreamPrompt({
      template: 'general-scenario',
      language: 'zh-CN',
      creatorPromptText: '写成冷清、克制的都市异闻。',
      questionnaireAnswerText: '- [q-1] 这座站台总在凌晨 2:17 出现',
      loreText: '【设定来源：都市传闻】终点站会吞掉最后一班乘客。',
    });

    expect(prompt).toContain('通用情景卡');
    expect(prompt).toContain('- 标题：...');
    expect(prompt).not.toContain('- 名字：...');
    expect(prompt).not.toContain('代号说明');
  });
});
