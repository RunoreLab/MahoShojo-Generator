import { describe, expect, it } from 'vitest';

import {
  buildBattleStoryDeterministicDigest,
  buildBattleStoryInternalGuidance,
  buildBattleStoryPromptContext,
  resolveBattleStoryRecentWindow,
  validateBattleStoryGenerateNextInput,
} from '../src/arena-battle-story-session';

const settings = {
  readArenaHistory: false,
  writeArenaHistory: false,
  readCurrentState: false,
  writeCurrentState: false,
  readNarrativeHistory: false,
  writeNarrativeHistory: false,
};

describe('Arena battle-story session domain', () => {
  it('validates stable chapter transitions without route/runtime state', () => {
    expect(validateBattleStoryGenerateNextInput({
      action: 'branch',
      sourceChapterId: 'chapter-2',
      chapterPlan: { totalChapters: 4 },
      recentChapters: [
        { id: 'chapter-1', index: 1 },
        { id: 'chapter-2', index: 2 },
        { id: 'chapter-3', index: 3 },
      ],
    })).toEqual({ ok: true, chapterIndex: 3 });

    expect(validateBattleStoryGenerateNextInput({
      action: 'continue',
      chapterPlan: { totalChapters: 3 },
      recentChapters: [
        { id: 'chapter-1', index: 1 },
        { id: 'chapter-2', index: 2 },
        { id: 'chapter-3', index: 3 },
      ],
    })).toEqual({ ok: false, error: '该会话已达到计划章节上限（共 3 章）' });
  });

  it('builds the same bounded context and server guidance for Web and Hono consumers', () => {
    const recentChapters = [
      {
        id: 'chapter-1',
        index: 1,
        title: '序章',
        markdown: '# 序章\n旧正文',
        deterministicDigest: { chapterTitle: '序章', winner: '白百合' },
      },
      {
        id: 'chapter-2',
        index: 2,
        title: '交锋',
        markdown: '# 交锋\n新正文',
      },
    ];
    expect(resolveBattleStoryRecentWindow({ chapters: recentChapters })).toHaveLength(2);

    const context = buildBattleStoryPromptContext({
      source: { mode: 'classic', language: 'zh-CN' },
      seed: { combatants: [], settings },
      chapterPlan: { totalChapters: 3 },
      chapterIndex: 3,
      workingCombatants: [{ data: { name: '白百合', current_state: { summary: '负伤' } } }],
      recentChapters,
      userGuidance: '完成主线',
    });
    const guidance = buildBattleStoryInternalGuidance({
      action: 'continue',
      chapterIndex: 3,
      chapterPlan: { totalChapters: 3 },
      context,
    });

    expect(context.promptText).toContain('章节规划层');
    expect(guidance).toContain('本章是终章');
    expect(guidance).toContain('完成主线');
  });

  it('builds a deterministic digest while excluding stream metadata comments', () => {
    expect(buildBattleStoryDeterministicDigest({
      markdown: '# 决战\n少女们完成最后一击。\n<!-- MAHOSHOJO_ARENA_META {"secret":"ignored"} -->',
      reportJson: { report: { winner: '白百合' } },
      impacts: [{ characterName: '白百合', impact: '守住城市' }],
      chapterIndex: 4,
    })).toEqual({
      chapterTitle: '决战',
      winner: '白百合',
      bodyExcerpt: '少女们完成最后一击。',
      impactDigest: [{ characterName: '白百合', impact: '守住城市' }],
    });
  });
});
