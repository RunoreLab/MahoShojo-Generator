import { describe, expect, it } from 'vitest';

import { buildMagicTeaPartySummarizePrompt } from '@/lib/magic-tea-party/prompts';

describe('magic tea party summarize prompt', () => {
  it('summary 模式包含 5 个小节与对话记录', () => {
    const prompt = buildMagicTeaPartySummarizePrompt({
      mode: 'summary',
      language: 'zh-CN',
      userDisplayName: '旅人',
      messages: [
        { id: 'u1', sessionId: 's1', role: 'user', content: '我推开奶茶店的门。', createdAt: 0 },
        { id: 'a1', sessionId: 's1', role: 'assistant', content: '甜香在雨夜里弥漫。', createdAt: 1 },
      ],
    });

    expect(prompt).toContain('【任务】生成会话摘要');
    expect(prompt).toContain('世界状态');
    expect(prompt).toContain('角色关系');
    expect(prompt).toContain('关键事件');
    expect(prompt).toContain('未决事项');
    expect(prompt).toContain('禁忌/边界');
    expect(prompt).toContain('旅人: 我推开奶茶店的门。');
    expect(prompt).toContain('assistant: 甜香在雨夜里弥漫。');
  });

  it('title 模式只要求输出一行标题', () => {
    const prompt = buildMagicTeaPartySummarizePrompt({
      mode: 'title',
      language: 'zh-CN',
      userDisplayName: '{{user}}',
      messages: [{ id: 'u1', sessionId: 's1', role: 'user', content: '你好', createdAt: 0 }],
    });

    expect(prompt).toContain('【任务】生成会话标题');
    expect(prompt).toContain('仅输出 1 行纯文本标题');
    expect(prompt).not.toContain('世界状态：');
  });
});
