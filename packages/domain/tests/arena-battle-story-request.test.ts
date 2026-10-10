import { describe, expect, it } from 'vitest';
import {
  buildBattleStoryInternalGuidance,
  buildBattleStoryPromptContext, resolveBattleStoryRecentWindow,
} from '../src/arena-battle-story-session';
import { BattleStoryArenaSeedSchema, buildBattleStoryArenaRequest, type BattleStoryArenaRequestInput } from '../src/arena-battle-story-request';

const request = (): BattleStoryArenaRequestInput => ({
  action: 'continue', sourceChapterId: 'c12', chapterIndex: 13,
  seed: { combatants: [{ data: { name: '原始角色' } }], mode: 'scenario', language: 'zh-CN', storyLength: 'standard', customStoryLength: '1500',
    scenario: { title: '场景', content: 'SCENARIO_ONCE' }, auxScenarios: [{ title: '辅场景' }], materials: [{ name: '素材', content: 'MATERIAL_ONCE' }],
    adjudicationEvents: [{ id: 'event' }], questionnaires: [{ id: 'q', title: '问卷', kind: 'magical-girl', loreMarkdown: 'LORE_ONCE' }],
    settings: { readArenaHistory: true, readArenaHistoryLimit: 7, writeArenaHistory: false, readCurrentState: true,
      writeCurrentState: false, readNarrativeHistory: true, isNarrativeHistoryUnlimited: true, writeNarrativeHistory: true } },
  chapterContext: { sessionSummary: 'SUMMARY_ONLY', workingCombatants: [{ type: 'general-character', data: { name: '当前角色', current_state: { summary: 'STATE_ONCE' } } }],
    recentChapters: Array.from({ length: 12 }, (_, index) => ({ id: `c${index + 1}`, index: index + 1, title: `章${index + 1}`,
      markdown: `# 前情${index + 1}\n${'正文'.repeat(3500)}\n<!-- MAHOSHOJO_ARENA_META {} -->`,
      deterministicDigest: { chapterTitle: `章${index + 1}`, bodyExcerpt: `摘要${index + 1}` } })) },
  userGuidance: 'USER_ONCE',
});

describe('shared continuous-story Arena business request', () => {
  it('Hosted complete chapters and native projected window yield identical semantics', () => {
    const input = request();
    const chapters = input.chapterContext.recentChapters!;
    const recentWindow = resolveBattleStoryRecentWindow({ chapters });
    const actual = buildBattleStoryArenaRequest(input);
    const native = buildBattleStoryArenaRequest({ ...input, chapterContext: {
      workingCombatants: input.chapterContext.workingCombatants, sessionSummary: input.chapterContext.sessionSummary, recentWindow,
    } });
    expect(native).toEqual(actual);
    expect(recentWindow.map((chapter) => chapter.mode)).toEqual([...Array(10).fill('digest'), 'full', 'full']);
    expect(recentWindow.at(-1)!.text.length).toBe(6000);
    expect(recentWindow.at(-1)!.text).not.toContain('MAHOSHOJO');
    expect(actual.internalGuidance).toBe(buildBattleStoryInternalGuidance({ action: 'continue', chapterIndex: 13, sourceChapterId: 'c12',
      context: buildBattleStoryPromptContext({ baseContext: 'arena-provided', recentChapters: chapters, sessionSummary: 'SUMMARY_ONLY', userGuidance: 'USER_ONCE' }) }));
    expect(actual).toMatchObject({ mode: 'scenario', combatants: input.chapterContext.workingCombatants, userGuidance: 'USER_ONCE', arenaHistoryReadLimit: 7,
      narrativeHistoryReadLimit: null, forceStreamMeta: true, writeArenaHistory: false, questionnaires: input.seed.questionnaires });
    for (const marker of ['当前角色', '原始角色', 'USER_ONCE', 'SCENARIO_ONCE', 'MATERIAL_ONCE', 'LORE_ONCE']) expect(actual.internalGuidance).not.toContain(marker);
    expect(actual.internalGuidance).toContain('SUMMARY_ONLY');
    for (const key of ['teams', 'teamNames', 'narrativeHistory', 'scenarioTitle', 'scenarioFileName', 'customProvider', 'generationRequestId']) expect(actual).not.toHaveProperty(key);
  });
  it('ignores seed and request extension fields instead of passing draft authority or secrets', () => {
    const value = request();
    const actual = buildBattleStoryArenaRequest({ ...value, internalGuidance: 'INJECTED', customProvider: { apiKey: 'SECRET' },
      seed: { ...value.seed, internalGuidance: 'INJECTED', providerToken: 'SECRET', teams: { 1: ['NOT_SENT'] } } } as BattleStoryArenaRequestInput);
    expect(JSON.stringify(actual)).not.toMatch(/INJECTED|SECRET|NOT_SENT/u);
  });
  it('validates persisted seed carriers without cloning full role bodies', () => {
    const seed = request().seed;
    expect(BattleStoryArenaSeedSchema.parse(seed)).toBe(seed);
    for (const value of [{ combatants: [] }, { ...seed, settings: {} }, { ...seed, combatants: ['bad'] },
      { ...seed, mode: 'unknown' }, { ...seed, storyLength: 'medium' }, { ...seed, settings: { ...seed.settings, readArenaHistoryLimit: 1000 } }]) {
      expect(BattleStoryArenaSeedSchema.safeParse(value).success).toBe(false);
    }
    expect(() => buildBattleStoryArenaRequest({ ...request(), chapterContext: { workingCombatants: [], recentWindow: [] } })).toThrow();
  });
  it('keeps the explicit chapter plan limit separate from total stored chapter count', () => {
    const value = request();
    const chapterContext = { workingCombatants: value.chapterContext.workingCombatants,
      recentWindow: [{ chapterId: 'c400', chapterIndex: 400, title: '长故事', mode: 'full' as const, text: '前情', truncated: false }] };
    const input = { ...value, sourceChapterId: 'c400', chapterIndex: 401, chapterContext };
    expect(buildBattleStoryArenaRequest(input).internalGuidance).toContain('续写第 401 章');
    expect(() => buildBattleStoryArenaRequest({ ...input, chapterPlan: { totalChapters: 20 } })).toThrow('计划章节上限');
    expect(() => buildBattleStoryArenaRequest({ ...input, sourceChapterId: 'stale' })).toThrow('最后一章');
    expect(() => buildBattleStoryArenaRequest({ ...input, action: 'start' })).toThrow('空会话');
  });
});
