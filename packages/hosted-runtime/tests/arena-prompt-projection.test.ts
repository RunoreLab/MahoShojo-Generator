import { describe, expect, it } from 'vitest';
import { buildArenaGenerationPrompt } from '../src/arena-generation/prompt';
const noise = {
  templateId: 'TEMPLATE_ONLY', signature: 'SIGNATURE_ONLY',
  creationInputs: { freeformBrief: 'CREATION_ONLY' },
  adjudicationEvents: [{ type: 'binary', probability: 50, description: 'CONFIG_ONLY' }],
  metadata: { created_at: 'METADATA_ONLY' }, _battle_story: { total_chapters: 5 },
};
const makeCard = (type: string) => ({
  name: '雾灯', ...noise,
  ...(type === 'magical-girl' ? { analysis: { personalityAnalysis: 'CORE_ONCE' } } : { content: 'CORE_ONCE' }),
  buildState: { rules: [{ ruleId: 'rule', derived: { HP: 0 }, validationSummary: { valid: 'VALIDATION_ONLY' } }] },
  current_state: { summary: 'STATE_ONCE', fields: [] },
  arena_history: { entries: [1, 2, 3].map((id) => ({ id, title: `HISTORY_${id}`,
    participants: ['雾灯'], winner: '雾灯', impact: `IMPACT_${id}`, metadata: {} })) },
  userAnswers: [{ question: '是谁？', answer: 'ANSWER_ONCE' }],
});
describe('Arena 输入去冗余回归', () => {
  it.each(['magical-girl', 'canshou', 'general-character'])('%s 只注入一次有效语义，保留原卡', async (type) => {
    const card = makeCard(type);
    const snapshot = structuredClone(card);
    for (const structured of [false, true]) {
      const payload = { mode: 'scenario', combatants: [{ type, data: card }],
        scenario: { title: '主情景', elements: { events: 'SCENE_ONCE' }, ...noise },
        auxScenarios: [{ title: '辅助', elements: { events: 'AUX_ONCE' }, ...noise }],
        materials: [{ name: '素材', content: { ...noise, description: 'MATERIAL_ONCE' } }],
        readArenaHistory: true, arenaHistoryReadLimit: 1, readCurrentState: true,
        adjudicationResults: [{ depth: 0, description: 'RESULT_ONCE', type: 'binary',
          roll: 1, outcome: '成功', details: '已判定' }],
        ...(structured ? { __arenaServerContextV1: { endpoint: 'api/arena/generate', deliveryMode: 'non-stream' } } : {}),
      };
      const { prompt } = await buildArenaGenerationPrompt({ actorKey: 'test', payload });
      for (const marker of ['CORE_ONCE', 'STATE_ONCE', 'HISTORY_3', 'ANSWER_ONCE',
        'SCENE_ONCE', 'AUX_ONCE', 'MATERIAL_ONCE', 'RESULT_ONCE']) {
        expect(prompt.split(marker).length - 1, marker).toBe(1);
      }
      for (const marker of ['TEMPLATE_ONLY', 'SIGNATURE_ONLY', 'CREATION_ONLY', 'CONFIG_ONLY',
        'METADATA_ONLY', 'VALIDATION_ONLY', 'HISTORY_1', 'HISTORY_2', '"_battle_story"']) {
        expect(prompt, marker).not.toContain(marker);
      }
      expect(card).toEqual(snapshot);
    }
  });
  it('严格排位中兜底角色也不泄漏被关闭的问卷、历史和状态', async () => {
    const { prompt, metadata } = await buildArenaGenerationPrompt({ actorKey: 'test', payload: {
      mode: 'classic', language: 'zh-CN', combatants: [
        { type: 'canshou', data: makeCard('canshou') }, { type: 'canshou', data: { name: '对手' } },
      ], readArenaHistory: false, readCurrentState: false, readNarrativeHistory: false,
      adjudicationEvents: [],
    } });
    expect(metadata.strictRankedMatch).toBe(true);
    for (const marker of ['ANSWER_ONCE', 'STATE_ONCE', 'HISTORY_', 'CONFIG_ONLY']) {
      expect(prompt).not.toContain(marker);
    }
    expect(prompt).toContain('CORE_ONCE');
  });
});
