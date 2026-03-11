import { describe, expect, test } from 'bun:test';

import { validateBattleStoryGenerateNextInput } from '@/lib/ai-session/battle-story/generate-next';

describe('battle story generate-next validation', () => {
  test('start 只允许空会话且固定首章索引', () => {
    expect(
      validateBattleStoryGenerateNextInput({
        action: 'start',
        chapterIndex: 1,
        recentChapters: [],
      })
    ).toEqual({
      ok: true,
      chapterIndex: 1,
    });

    expect(
      validateBattleStoryGenerateNextInput({
        action: 'start',
        recentChapters: [{ id: 'c1', index: 1 }],
      })
    ).toEqual({
      ok: false,
      error: 'start 只允许用于空会话',
    });
  });

  test('branch 允许基于指定章节分支并推导下一章索引', () => {
    expect(
      validateBattleStoryGenerateNextInput({
        action: 'branch',
        sourceChapterId: 'c2',
        recentChapters: [
          { id: 'c1', index: 1 },
          { id: 'c2', index: 2 },
          { id: 'c3', index: 3 },
        ],
      })
    ).toEqual({
      ok: true,
      chapterIndex: 3,
    });
  });

  test('rewrite 只允许最后一章且索引必须保持不变', () => {
    expect(
      validateBattleStoryGenerateNextInput({
        action: 'rewrite',
        sourceChapterId: 'c2',
        recentChapters: [
          { id: 'c1', index: 1 },
          { id: 'c2', index: 2 },
          { id: 'c3', index: 3 },
        ],
      })
    ).toEqual({
      ok: false,
      error: 'rewrite 只允许重写当前会话的最后一章',
    });

    expect(
      validateBattleStoryGenerateNextInput({
        action: 'rewrite',
        sourceChapterId: 'c3',
        chapterIndex: 4,
        recentChapters: [
          { id: 'c1', index: 1 },
          { id: 'c2', index: 2 },
          { id: 'c3', index: 3 },
        ],
      })
    ).toEqual({
      ok: false,
      error: 'rewrite 的 chapterIndex 必须为 3',
    });
  });
});
