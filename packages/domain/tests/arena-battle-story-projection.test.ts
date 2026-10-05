import { describe, expect, it } from 'vitest';
import { buildBattleStoryPromptContext, resolveBattleStoryRecentWindow } from '../src/arena-battle-story-session';
const settings = { readArenaHistory: true, readCurrentState: true, readNarrativeHistory: false,
  writeArenaHistory: true, writeCurrentState: true, writeNarrativeHistory: false };
const card = { data: { name: '雾灯', content: 'CORE_ONLY', signature: 'SIGNATURE_ONLY',
  current_state: { summary: 'STATE_ONLY' }, adjudicationEvents: [{ description: 'CONFIG_ONLY' }] },
  sourceAuthor: 'AUTHOR_ONLY' };
const seed = { combatants: [card], settings,
  scenario: { title: 'SCENE_ONLY', creationInputs: { brief: 'CREATION_ONLY' } },
  materials: [{ name: '素材', content: { description: 'MATERIAL_ONLY', templateId: 'TEMPLATE_ONLY' } }],
};
describe('连续战报上下文投影', () => {
  it('Arena 已提供的基础内容不再进入附加上下文，保留剧情与章节约束', () => {
    const input = { baseContext: 'arena-provided' as const, seed, workingCombatants: [card],
      source: { providerId: 'PROVIDER_ONLY' }, userGuidance: 'GUIDANCE_ONLY',
      chapterPlan: { totalChapters: 5 }, chapterIndex: 3, sessionSummary: 'SUMMARY_ONLY',
      recentChapters: [{ id: 'c2', index: 2, markdown: 'RECENT_ONLY' }] };
    const snapshot = structuredClone(input);
    const result = buildBattleStoryPromptContext(input);
    expect(result.sections.map((section) => section.key)).toEqual(['chapter-plan', 'session-summary', 'recent-window']);
    for (const marker of ['CORE_ONLY', 'STATE_ONLY', 'SCENE_ONLY', 'MATERIAL_ONLY', 'CONFIG_ONLY', 'PROVIDER_ONLY', 'GUIDANCE_ONLY']) {
      expect(result.promptText).not.toContain(marker);
    }
    expect(result.promptText).toContain('第 3 章 / 共 5 章');
    expect(result.promptText).toContain('SUMMARY_ONLY');
    expect(result.promptText).toContain('RECENT_ONLY');
    expect(input).toEqual(snapshot);
  });
  it('独立编排只携带一份当前角色，并清理种子和来源中的管理信息', () => {
    const result = buildBattleStoryPromptContext({ seed, workingCombatants: [card],
      source: { mode: 'scenario', providerId: 'PROVIDER_ONLY' } });
    for (const marker of ['CORE_ONLY', 'STATE_ONLY', 'SCENE_ONLY', 'MATERIAL_ONLY']) {
      expect(result.promptText.split(marker).length - 1, marker).toBe(1);
    }
    for (const marker of ['SIGNATURE_ONLY', 'AUTHOR_ONLY', 'CREATION_ONLY', 'CONFIG_ONLY', 'PROVIDER_ONLY', 'TEMPLATE_ONLY']) {
      expect(result.promptText).not.toContain(marker);
    }
    const seedOnly = buildBattleStoryPromptContext({ seed });
    expect(seedOnly.promptText).toContain('CORE_ONLY');
  });
  it('机器注释在正文预算截断前删除，不破坏普通故事注释', () => {
    const markdown = `# 前情\nSTORY_ONLY\n<!-- 故事内注释 -->\n<!-- MAHOSHOJO_ARENA_META ${'x'.repeat(2000)} -->`;
    const [chapter] = resolveBattleStoryRecentWindow({
      chapters: [{ id: 'c1', index: 1, markdown }], maxFullChapterChars: 500,
    });
    expect(chapter!.truncated).toBe(false);
    expect(chapter!.text).toContain('STORY_ONLY');
    expect(chapter!.text).toContain('<!-- 故事内注释 -->');
    expect(chapter!.text).not.toContain('MAHOSHOJO_ARENA_META');
  });
});

it('原始万途素材不被误当作运行时包装，保留正文之外的字段', () => {
  const result = buildBattleStoryPromptContext({ seed: { ...seed, materials: [{
    cardKind: 'location', name: '废站', content: '车站正文', fields: { secretPassage: 'RAW_EXTRA_LORE' },
  }] } });
  expect(result.promptText).toContain('车站正文');
  expect(result.promptText).toContain('RAW_EXTRA_LORE');
});
