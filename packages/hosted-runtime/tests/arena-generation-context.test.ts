import { describe, expect, it } from 'vitest';
import { buildArenaGenerationPrompt } from '../src/arena-generation/prompt';

const combatants = [
  {
    type: 'magical-girl',
    data: {
      codename: '星火',
      analysis: { personality: '坚定' },
      buildState: { level: '叶级' },
      userAnswers: [{ question: '你的真实名字是？', answer: '白思与' }],
      arena_history: {
        entries: [{
          id: 2,
          title: '旧日雨战',
          participants: ['星火', '夜潮'],
          winner: '星火',
          impact: '学会信任',
          metadata: {
            user_guidance: null,
            character_guidance: '保护同伴',
            scenario_title: null,
            non_native_data_involved: false,
          },
        }],
      },
      current_state: { summary: '轻伤', fields: [] },
    },
    characterGuidance: '优先保护站台上的乘客',
  },
  {
    type: 'canshou',
    data: { name: '夜潮', content: '会吞噬光线的蛹级残兽' },
  },
];

describe('Arena generation context', () => {
  it('组合角色、情景、分队、判定、前情与问卷 Lore，保留更新元数据', async () => {
    const payload = {
      mode: 'scenario',
      language: 'zh-CN',
      combatants,
      userGuidance: '在末班车到站前解决冲突',
      internalGuidance: '服务端判定：夜潮首先发动遮光。',
      scenario: { templateId: 'general-scenario', title: '雨夜车站', content: '站台即将停电。' },
      auxScenarios: [{ title: '补充', weather: '暴雨' }],
      materials: [{
        name: '红伞',
        sourceType: 'prop',
        sourceKind: 'raw-json',
        fileName: 'umbrella.json',
        content: { color: 'red' },
      }],
      teams: { '1': ['星火'], '2': ['夜潮'] },
      teamNames: { '1': '守护方', '2': '侵袭方' },
      readArenaHistory: true,
      arenaHistoryReadLimit: 3,
      writeArenaHistory: true,
      readCurrentState: true,
      writeCurrentState: true,
      forceStreamMeta: true,
      adjudicationResults: [{
        depth: 0,
        description: '列车是否准时到站',
        type: 'binary',
        roll: 42,
        outcome: '成功',
        details: '掷骰(42) vs 成功率(60%)',
      }],
      adjudicationEvents: [{ type: 'binary' }],
      storyLength: 'detailed',
      customStoryLength: '',
      readNarrativeHistory: true,
      narrativeHistory: [{
        title: '前情',
        content: '两者曾在港口短暂交锋。',
        createdAt: '2026-08-24T00:00:00.000Z',
        updatedAt: '2026-08-24T00:00:00.000Z',
      }],
      questionnaires: [{
        id: 'lore-one',
        title: '车站设定',
        kind: 'magical-girl',
        loreMarkdown: '红伞是车站结界的钥匙。',
      }],
    };
    const shared = await buildArenaGenerationPrompt({ actorKey: 'user:42', payload });
    for (const content of ['星火', '夜潮', '优先保护站台上的乘客', '在末班车到站前解决冲突',
      '夜潮首先发动遮光', '雨夜车站', '站台即将停电', '暴雨', '红伞', 'red',
      '守护方', '侵袭方', '列车是否准时到站', '成功', '两者曾在港口短暂交锋',
      '红伞是车站结界的钥匙', '白思与', '轻伤', '学会信任']) {
      expect(shared.prompt).toContain(content);
    }
    expect(shared.metadata).toMatchObject({
      expectsMeta: true,
      userGuidance: payload.userGuidance,
      characterGuidances: [{
        characterName: '星火',
        guidance: '优先保护站台上的乘客',
      }],
    });
  });

});
