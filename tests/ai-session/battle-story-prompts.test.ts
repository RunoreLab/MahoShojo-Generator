import { describe, expect, test } from 'bun:test';

import {
  buildBattleStoryInternalGuidance,
  buildBattleStorySummaryFallback,
  buildBattleStorySummaryPrompt,
} from '@/lib/ai-session/battle-story/prompts';

describe('battle story prompts', () => {
  test('internal guidance 会注入动作语义与上下文', () => {
    const guidance = buildBattleStoryInternalGuidance({
      action: 'rewrite',
      chapterIndex: 4,
      sourceChapterId: 'chapter-4-old',
      chapterPlan: {
        totalChapters: 5,
        source: 'scenario',
        locked: true,
      },
      context: {
        chapterPlanState: {
          totalChapters: 5,
          currentChapterIndex: 4,
          isFinalChapter: false,
          remainingChaptersIncludingCurrent: 2,
          remainingChaptersAfterCurrent: 1,
          positionLabel: '终局前章',
        },
        normalizedUserGuidance: '让结果更残酷',
        recentWindow: [],
        sections: [],
        promptText: '## 会话摘要层\n前文中，晓雾已经重伤。',
      },
    });

    expect(guidance).toContain('重写第 4 章');
    expect(guidance).toContain('chapter-4-old');
    expect(guidance).toContain('本章不是终章');
    expect(guidance).toContain('前文中，晓雾已经重伤');
  });

  test('internal guidance 会在终章强调收束主线', () => {
    const guidance = buildBattleStoryInternalGuidance({
      action: 'continue',
      chapterIndex: 5,
      chapterPlan: {
        totalChapters: 5,
        source: 'user',
        locked: false,
      },
      context: {
        chapterPlanState: {
          totalChapters: 5,
          currentChapterIndex: 5,
          isFinalChapter: true,
          remainingChaptersIncludingCurrent: 1,
          remainingChaptersAfterCurrent: 0,
          positionLabel: '终章',
        },
        normalizedUserGuidance: '',
        recentWindow: [],
        sections: [],
        promptText: '## 最近章节窗口层\n第四章停在崩塌前夜。',
      },
    });

    expect(guidance).toContain('本章是终章');
    expect(guidance).toContain('完成主线收束');
  });

  test('summary prompt 会整合已有摘要与新增 digests', () => {
    const prompt = buildBattleStorySummaryPrompt({
      previousSummary: '此前两章主要围绕晓雾与砂金的追逐展开。',
      language: 'zh-CN',
      digests: [
        {
          index: 3,
          chapterTitle: '回廊折返',
          winner: '晓雾',
          bodyExcerpt: '晓雾在第三章中夺回主动权。',
        },
      ],
    });

    expect(prompt).toContain('此前两章主要围绕晓雾与砂金的追逐展开');
    expect(prompt).toContain('回廊折返');
    expect(prompt).toContain('请使用【zh-CN】');
  });

  test('summary fallback 会把旧摘要与新增章节拼成保守文本', () => {
    const summary = buildBattleStorySummaryFallback({
      previousSummary: '旧摘要',
      digests: [
        {
          index: 5,
          chapterTitle: '第五章',
          winner: '晓雾',
          officialConclusion: '晓雾暂时压制了敌方。',
        },
      ],
    });

    expect(summary).toContain('旧摘要');
    expect(summary).toContain('第5章');
    expect(summary).toContain('晓雾暂时压制了敌方');
  });
});
