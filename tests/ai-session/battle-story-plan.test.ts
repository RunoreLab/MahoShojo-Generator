import { describe, expect, test } from 'bun:test';

import {
  formatBattleStoryChapterPlanSource,
  formatBattleStoryChapterProgress,
  resolveBattleStoryInitialChapterPlan,
  resolveBattleStoryPromptChapterPlanState,
} from '@/lib/ai-session/battle-story/plan';

describe('battle story chapter plan helpers', () => {
  test('固定情景卡优先于用户输入', () => {
    const plan = resolveBattleStoryInitialChapterPlan({
      scenario: {
        title: '固定情景',
        _battle_story: {
          total_chapters: 5,
          plan_mode: 'fixed',
        },
      },
      userSelectionMode: 'custom',
      userDesiredTotalChapters: 8,
    });

    expect(plan).toEqual({
      totalChapters: 5,
      source: 'scenario',
      locked: true,
    });
  });

  test('用户可用“不限制”覆盖情景卡建议值', () => {
    const plan = resolveBattleStoryInitialChapterPlan({
      scenario: {
        title: '建议情景',
        _battle_story: {
          total_chapters: 5,
          plan_mode: 'suggested',
        },
      },
      userSelectionMode: 'none',
    });

    expect(plan).toBeNull();
  });

  test('能计算章节定位与进度展示', () => {
    const chapterPlan = {
      totalChapters: 5,
      source: 'scenario' as const,
      locked: true,
    };
    const promptState = resolveBattleStoryPromptChapterPlanState({
      chapterPlan,
      chapterIndex: 4,
    });

    expect(promptState).toEqual({
      totalChapters: 5,
      currentChapterIndex: 4,
      isFinalChapter: false,
      remainingChaptersIncludingCurrent: 2,
      remainingChaptersAfterCurrent: 1,
      positionLabel: '终局前章',
    });
    expect(formatBattleStoryChapterProgress({ completedChapterCount: 3, chapterPlan })).toBe('3 / 5');
    expect(formatBattleStoryChapterPlanSource(chapterPlan)).toBe('情景卡固定');
  });
});
