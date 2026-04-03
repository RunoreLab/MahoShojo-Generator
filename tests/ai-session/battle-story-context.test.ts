import { describe, expect, test } from 'bun:test';

import { buildBattleStoryPromptContext, resolveBattleStoryRecentWindow } from '@/lib/ai-session/battle-story/context';

describe('battle story prompt context', () => {
  test('较早章节退化为摘要，最近章节保留全文窗口', () => {
    const window = resolveBattleStoryRecentWindow({
      chapters: [
        {
          id: 'c1',
          index: 1,
          title: '序章',
          markdown: '# 序章\n\n第一章正文',
          deterministicDigest: { chapterTitle: '序章', bodyExcerpt: '第一章摘要' },
        },
        {
          id: 'c2',
          index: 2,
          title: '第二章',
          markdown: '# 第二章\n\n第二章正文',
          deterministicDigest: { chapterTitle: '第二章', bodyExcerpt: '第二章摘要' },
        },
        {
          id: 'c3',
          index: 3,
          title: '第三章',
          markdown: '# 第三章\n\n第三章正文',
          deterministicDigest: { chapterTitle: '第三章', bodyExcerpt: '第三章摘要' },
        },
      ],
      maxRecentChapters: 2,
    });

    expect(window).toHaveLength(3);
    expect(window[0]?.mode).toBe('digest');
    expect(window[1]?.mode).toBe('full');
    expect(window[2]?.mode).toBe('full');
  });

  test('会裁剪超长 user guidance，并按固定顺序编排 prompt sections', () => {
    const result = buildBattleStoryPromptContext({
      source: {
        mode: 'classic',
        language: 'zh-CN',
        storyLength: 'long',
        generationMode: 'stream',
      },
      seed: {
        combatants: [{ name: '晓雾' }],
        settings: {
          readArenaHistory: true,
          writeArenaHistory: false,
          readCurrentState: true,
          writeCurrentState: true,
          readNarrativeHistory: true,
          writeNarrativeHistory: true,
        },
      },
      chapterPlan: {
        totalChapters: 5,
      },
      chapterIndex: 3,
      workingCombatants: [{ name: '晓雾', current_state: { mood: '紧张' } }],
      sessionSummary: '前两章中，晓雾逐步掌握了战场主动权。',
      recentChapters: [
        {
          id: 'c2',
          index: 2,
          title: '第二章',
          markdown: '# 第二章\n\n第二章正文',
          deterministicDigest: { chapterTitle: '第二章', bodyExcerpt: '第二章摘要' },
        },
      ],
      userGuidance: '请让第三章更偏向心理战，同时让角色状态变化更明确。'.repeat(80),
      maxUserGuidanceChars: 120,
    });

    expect(result.sections.map((section) => section.key)).toEqual([
      'seed',
      'chapter-plan',
      'current-state',
      'session-summary',
      'recent-window',
      'user-guidance',
    ]);
    expect(result.normalizedUserGuidance.length).toBeLessThanOrEqual(120);
    expect(result.promptText).toContain('## 固定种子层');
    expect(result.promptText).toContain('## 章节规划层');
    expect(result.promptText).toContain('当前要生成：第 3 章 / 共 5 章');
    expect(result.promptText).toContain('## 本轮用户引导层');
  });

  test('最近章节正文过长时会按预算截断', () => {
    const result = buildBattleStoryPromptContext({
      recentChapters: [
        {
          id: 'c9',
          index: 9,
          title: '长章节',
          markdown: `# 长章节\n\n${'正文'.repeat(500)}`,
          deterministicDigest: { chapterTitle: '长章节', bodyExcerpt: '长章节摘要' },
        },
      ],
      maxFullChapterChars: 100,
    });

    expect(result.recentWindow[0]?.mode).toBe('full');
    expect(result.recentWindow[0]?.truncated).toBe(true);
    expect(result.sections.find((section) => section.key === 'recent-window')?.text).toContain('[本章内容已按上下文预算截断]');
  });

  test('会按读取设置过滤种子层与当前状态层中不该暴露的字段', () => {
    const result = buildBattleStoryPromptContext({
      seed: {
        combatants: [
          {
            data: {
              name: '晓雾',
              arena_history: {
                entries: [{ id: 1, title: '旧战报' }, { id: 2, title: '新战报' }],
              },
              current_state: { mood: '紧张' },
            },
          },
        ],
        settings: {
          readArenaHistory: true,
          readArenaHistoryLimit: 1,
          isArenaHistoryUnlimited: false,
          writeArenaHistory: false,
          readCurrentState: false,
          writeCurrentState: true,
          readNarrativeHistory: false,
          readNarrativeHistoryLimit: 10,
          isNarrativeHistoryUnlimited: false,
          writeNarrativeHistory: false,
        },
      },
      workingCombatants: [
        {
          data: {
            name: '晓雾',
            arena_history: {
              entries: [{ id: 1, title: '旧战报' }, { id: 2, title: '新战报' }],
            },
            current_state: { mood: '紧张' },
          },
        },
      ],
    });

    expect(result.promptText).toContain('"arena_history"');
    expect(result.promptText).toContain('"id": 2');
    expect(result.promptText).not.toContain('"id": 1');
    expect(result.promptText).not.toContain('"current_state"');
  });

  test('连续战报上下文会忽略 creationInputs，并将 buildState 表述为角色参数', () => {
    const result = buildBattleStoryPromptContext({
      seed: {
        combatants: [
          {
            data: {
              name: '巡夜人',
              content: '守望街区的人。',
              creationInputs: {
                buildRules: [{ ruleId: 'should-not-appear' }],
              },
              buildState: {
                primaryRuleId: 'dnd-5e-lite',
                rules: [{ ruleId: 'dnd-5e-lite' }],
              },
            },
          },
        ],
        settings: {
          readArenaHistory: false,
          writeArenaHistory: true,
          readCurrentState: false,
          writeCurrentState: true,
          readNarrativeHistory: false,
          writeNarrativeHistory: false,
        },
      },
      workingCombatants: [
        {
          data: {
            name: '巡夜人',
            content: '守望街区的人。',
            creationInputs: {
              buildRules: [{ ruleId: 'should-not-appear' }],
            },
            buildState: {
              primaryRuleId: 'arena-trpg-lite',
              rules: [{ ruleId: 'arena-trpg-lite' }],
            },
          },
        },
      ],
    });

    expect(result.promptText).toContain('角色参数');
    expect(result.promptText).toContain('arena-trpg-lite');
    expect(result.promptText).not.toContain('creationInputs');
    expect(result.promptText).not.toContain('buildState');
    expect(result.promptText).not.toContain('should-not-appear');
  });
});
