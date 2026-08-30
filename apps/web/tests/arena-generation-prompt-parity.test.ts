import { describe, expect, it } from 'vitest';

import {
  buildArenaGenerationPrompt,
  DEFAULT_ARENA_PROMPT_QUESTIONS,
  getSystemPrompt as getSharedSystemPrompt,
} from '@mahoshojo/hosted-runtime/arena-generation';
import { getSystemPrompt as getLegacySystemPrompt } from '@/lib/arena/constants';
import { createPromptBuilder, createStreamPromptBuilder } from '@/lib/arena/logic';

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

describe('Arena generation prompt compatibility', () => {
  it.each(['classic', 'kizuna', 'daily', 'scenario'])('%s system prompt 与 legacy 完全一致', (mode) => {
    expect(getSharedSystemPrompt(mode, combatants)).toBe(getLegacySystemPrompt(mode, combatants));
  });

  it.each(['classic', 'kizuna', 'daily', 'scenario'] as const)(
    '%s mode 的完整 prompt 与 legacy builder 一致',
    async (mode) => {
      const payload = {
        mode,
        language: 'zh-CN',
        combatants,
        userGuidance: '完整 parity 指引',
        internalGuidance: '服务器内部判定',
        scenario: mode === 'scenario'
          ? { templateId: 'general-scenario', title: '测试场景', content: '场景正文' }
          : null,
        auxScenarios: null,
        teams: { '1': ['星火'], '2': ['夜潮'] },
        teamNames: { '1': '守护方', '2': '侵袭方' },
        readArenaHistory: true,
        arenaHistoryReadLimit: 2,
        readCurrentState: true,
        writeArenaHistory: true,
        writeCurrentState: true,
        forceStreamMeta: true,
        adjudicationResults: null,
        adjudicationEvents: [],
        storyLength: 'standard',
        customStoryLength: '',
        narrativeHistory: null,
        questionnaires: [],
        materials: [{
          name: '完整 parity 素材',
          sourceType: 'fixture',
          sourceKind: 'raw-json',
          content: { mode },
        }],
      };
      const legacyStreamPrompt = createStreamPromptBuilder(
        {
          ...DEFAULT_ARENA_PROMPT_QUESTIONS,
          default: DEFAULT_ARENA_PROMPT_QUESTIONS.magicalGirl,
        },
        payload.userGuidance,
        payload.internalGuidance,
        false,
        payload.language,
        payload.mode,
        payload.scenario,
        payload.auxScenarios,
        payload.teams,
        payload.teamNames,
        payload.readArenaHistory,
        payload.arenaHistoryReadLimit,
        payload.readCurrentState,
        payload.writeArenaHistory,
        payload.writeCurrentState,
        payload.forceStreamMeta,
        payload.adjudicationResults,
        payload.storyLength,
        payload.customStoryLength,
        payload.narrativeHistory,
        null,
        true,
        payload.materials,
      )({ combatants });

      const shared = await buildArenaGenerationPrompt({ actorKey: 'user:42', payload });
      expect(shared.prompt).toBe(`${getLegacySystemPrompt(mode, combatants)}\n\n${legacyStreamPrompt}`);
    },
  );

  it('shared runtime 复用 legacy stream prompt 的完整语义', async () => {
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
    const loreText = '【设定来源：车站设定】\n红伞是车站结界的钥匙。';
    const legacyStreamPrompt = createStreamPromptBuilder(
      {
        ...DEFAULT_ARENA_PROMPT_QUESTIONS,
        default: DEFAULT_ARENA_PROMPT_QUESTIONS.magicalGirl,
      },
      payload.userGuidance,
      payload.internalGuidance,
      false,
      payload.language,
      payload.mode,
      payload.scenario,
      payload.auxScenarios,
      payload.teams,
      payload.teamNames,
      payload.readArenaHistory,
      payload.arenaHistoryReadLimit,
      payload.readCurrentState,
      payload.writeArenaHistory,
      payload.writeCurrentState,
      payload.forceStreamMeta,
      payload.adjudicationResults,
      payload.storyLength,
      payload.customStoryLength,
      payload.narrativeHistory,
      loreText,
      true,
      payload.materials,
    )({ combatants });

    const shared = await buildArenaGenerationPrompt({ actorKey: 'user:42', payload });
    expect(shared.prompt).toBe(`${getLegacySystemPrompt(payload.mode, combatants)}\n\n${legacyStreamPrompt}`);
    expect(shared.metadata).toMatchObject({
      expectsMeta: true,
      userGuidance: payload.userGuidance,
      characterGuidances: [{
        characterName: '星火',
        guidance: '优先保护站台上的乘客',
      }],
    });
  });

  it('受信 non-stream route 与 legacy structured prompt 完全一致', async () => {
    const payload = {
      mode: 'scenario',
      language: 'zh-CN',
      combatants,
      userGuidance: '保留结构化战报框架',
      internalGuidance: '服务器内部判定',
      scenario: { templateId: 'general-scenario', title: '雨夜车站', content: '站台即将停电。' },
      auxScenarios: [{ title: '补充', weather: '暴雨' }],
      materials: [{
        name: '红伞',
        sourceType: 'fixture',
        sourceKind: 'raw-json',
        content: { color: 'red' },
      }],
      teams: { '1': ['星火'], '2': ['夜潮'] },
      teamNames: { '1': '守护方', '2': '侵袭方' },
      readArenaHistory: true,
      arenaHistoryReadLimit: 3,
      readCurrentState: true,
      writeArenaHistory: true,
      writeCurrentState: true,
      adjudicationResults: null,
      storyLength: 'standard',
      customStoryLength: '',
      narrativeHistory: null,
      questionnaires: [],
      __arenaServerContextV1: {
        endpoint: 'api/arena/generate',
        deliveryMode: 'non-stream',
      },
    };
    const legacyStructuredPrompt = createPromptBuilder(
      {
        ...DEFAULT_ARENA_PROMPT_QUESTIONS,
        default: DEFAULT_ARENA_PROMPT_QUESTIONS.magicalGirl,
      },
      payload.userGuidance,
      payload.internalGuidance,
      false,
      payload.language,
      payload.mode,
      payload.scenario,
      payload.auxScenarios,
      payload.teams,
      payload.teamNames,
      payload.readArenaHistory,
      payload.arenaHistoryReadLimit,
      payload.readCurrentState,
      payload.writeCurrentState,
      payload.adjudicationResults,
      payload.storyLength,
      payload.customStoryLength,
      payload.narrativeHistory,
      null,
      true,
      payload.materials,
    )({ combatants });

    const shared = await buildArenaGenerationPrompt({ actorKey: 'user:42', payload });
    expect(shared.prompt).toBe(
      `${getLegacySystemPrompt(payload.mode, combatants)}\n\n${legacyStructuredPrompt}`,
    );
    expect(shared.metadata).toMatchObject({
      outputContract: 'structured-report',
      expectsMeta: false,
    });
  });
});
