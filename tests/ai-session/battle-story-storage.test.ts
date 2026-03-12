import { describe, expect, test } from 'bun:test';

import {
  createBattleStoryChapterRecord,
  createBattleStorySessionRecord,
} from '@/lib/ai-session/battle-story/storage';

describe('battle story storage helpers', () => {
  test('createBattleStorySessionRecord 会生成可用的默认 session 元数据', () => {
    const session = createBattleStorySessionRecord({
      title: '',
      source: {
        mode: 'scenario',
        language: 'zh-CN',
        storyLength: 'standard',
        generationMode: 'stream',
      },
      seed: {
        combatants: [{ name: '晓雾' }],
        settings: {
          readArenaHistory: true,
          writeArenaHistory: true,
          readCurrentState: true,
          writeCurrentState: true,
          readNarrativeHistory: true,
          writeNarrativeHistory: false,
        },
      },
      workingCombatants: [{ name: '晓雾' }],
      chapterPlan: {
        totalChapters: 5,
        source: 'scenario',
        locked: true,
      },
    });

    expect(session.id).toBeString();
    expect(session.title).toBe('未命名连续战报');
    expect(session.chapterCount).toBe(0);
    expect(session.lastChapterId).toBeNull();
    expect(session.chapterPlan).toEqual({
      totalChapters: 5,
      source: 'scenario',
      locked: true,
    });
  });

  test('createBattleStoryChapterRecord 会生成 active 章节记录', () => {
    const chapter = createBattleStoryChapterRecord({
      sessionId: 'session-1',
      index: 3,
      action: 'continue',
      title: '',
      markdown: '# 第三章\n\n正文',
      reportJson: { headline: '第三章' },
      cardSnapshot: {
        reporterInfo: {
          name: '阿尔法记者',
          publication: '星光日报',
        },
        aiModel: 'gemini-2.5-flash',
      },
      deterministicDigest: {
        chapterTitle: '第三章',
        bodyExcerpt: '正文',
      },
      sourceChapterId: 'chapter-2',
      generationId: 'generation-3',
    });

    expect(chapter.id).toBeString();
    expect(chapter.sessionId).toBe('session-1');
    expect(chapter.index).toBe(3);
    expect(chapter.status).toBe('active');
    expect(chapter.title).toBe('第三章');
    expect(chapter.sourceChapterId).toBe('chapter-2');
    expect(chapter.generationId).toBe('generation-3');
    expect(chapter.cardSnapshot?.reporterInfo?.publication).toBe('星光日报');
    expect(chapter.cardSnapshot?.aiModel).toBe('gemini-2.5-flash');
  });
});
