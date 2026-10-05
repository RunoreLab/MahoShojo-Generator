import { describe, expect, it } from 'vitest';
import { buildSublimationStreamConfig, createSublimationGenerationConfig } from '../src/sublimation-runtime-shared';
const original = {
  name: '雾灯', content: 'CORE_ONCE', templateId: 'TEMPLATE_ONLY', signature: 'SIGNATURE_ONLY',
  creationInputs: { freeformBrief: 'CREATION_ONLY' },
  adjudicationEvents: [{ description: 'CONFIG_ONLY' }],
  buildState: { rules: [{ ruleId: 'rule', derived: { HP: 0 }, validationSummary: { issues: ['VALIDATION_ONLY'] } }] },
  current_state: { summary: 'STATE_ONCE', fields: [] },
  arena_history: { entries: [{ title: 'HISTORY_ONCE', winner: '雾灯', impact: '学会信任' }] },
  userAnswers: ['ANSWER_ONCE'],
};
const assertNoNoise = (prompt: string) => {
  for (const marker of ['TEMPLATE_ONLY', 'SIGNATURE_ONLY', 'CREATION_ONLY', 'CONFIG_ONLY', 'VALIDATION_ONLY']) {
    expect(prompt).not.toContain(marker);
  }
};
describe('升华模型输入去冗余', () => {
  it('结构化升华的相同骨架/历史/状态/问卷只出现一次，原卡与输出 schema 不变', () => {
    const snapshot = structuredClone(original);
    const config = createSublimationGenerationConfig({
      originalData: original, baseOutputData: { ...original, newSetting: 'TARGET_ONLY' },
      language: 'zh-CN', userGuidance: null, narrativeHistory: null, loreText: null,
      sourceTemplate: 'general', targetTemplate: 'general', fieldsToPreserve: [],
      allowReshapeNames: false, isDowngrade: false, defaultQuestions: { magicalGirl: ['问题'], canshou: [] },
      stateOptions: { readArenaHistory: true, readCurrentState: true, writeArenaHistory: true, writeCurrentState: true },
    });
    const prompt = config.promptBuilder(null);
    assertNoNoise(prompt);
    for (const marker of ['CORE_ONCE', 'STATE_ONCE', 'HISTORY_ONCE', 'ANSWER_ONCE', 'TARGET_ONLY']) {
      expect(prompt.split(marker).length - 1, marker).toBe(1);
    }
    expect(prompt).toContain('角色参数');
    expect(config.schema.safeParse({ updatedCharacterData: { name: '新称号', content: '新设定' },
      sublimationEvent: { title: '成长', impact: '信任同伴' } }).success).toBe(true);
    expect(original).toEqual(snapshot);
  });
  it('流式升华仍保留唯一的当前状态和问卷，且不改变原始数据', () => {
    const snapshot = structuredClone(original);
    const config = buildSublimationStreamConfig({ originalData: original,
      language: 'zh-CN', userGuidance: '', narrativeHistory: '', fieldsToPreserve: ['name'],
      isDowngrade: false, allowReshapeNames: false, sourceTemplate: 'general', targetTemplate: 'general', loreText: '',
    });
    assertNoNoise(config.prompt);
    for (const marker of ['CORE_ONCE', 'STATE_ONCE', 'ANSWER_ONCE']) {
      expect(config.prompt.split(marker).length - 1, marker).toBe(1);
    }
    expect(config.prompt).not.toContain('HISTORY_ONCE');
    expect(config.prompt).toContain('来源模板: general');
    expect(config.prompt).toContain('角色参数');
    expect(original).toEqual(snapshot);
  });
});
