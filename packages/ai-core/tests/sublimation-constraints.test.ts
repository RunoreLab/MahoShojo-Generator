import { describe, expect, it } from 'vitest';
import { convertSublimationCharacterCard } from '@mahoshojo/domain/sublimation';
import { buildSublimationStreamCore, createSublimationGenerationCore } from '../src/sublimation-generation';

type CoreInput = Parameters<typeof createSublimationGenerationCore>[0];
const baseInput = (): CoreInput => {
  const originalData = {
    name: 'IDENTITY_ONLY', content: '使用能力会疲惫。',
    current_state: { summary: 'STATE_ONLY', fields: [] },
    arena_history: { entries: [{ title: 'HISTORY_ONLY', impact: '学会合作' }] },
  };
  return {
    originalData,
    baseOutputData: convertSublimationCharacterCard(originalData, 'general', 'general').data,
    language: '简体中文', userGuidance: '保留体力限制。', narrativeHistory: null, loreText: null,
    sourceTemplate: 'general', targetTemplate: 'general', fieldsToPreserve: ['name'],
    allowReshapeNames: false, defaultQuestions: { magicalGirl: ['问题'], canshou: [] },
    stateOptions: { readArenaHistory: false, writeArenaHistory: false, readCurrentState: false, writeCurrentState: false },
  };
};

describe('升华输入可读与输出保留独立', () => {
  it('保留姓名仍提供只读身份，生成 schema 不接收其更新', () => {
    const input = baseInput();
    const before = structuredClone(input);
    const config = createSublimationGenerationCore(input);
    expect(config.promptBuilder()).toContain('IDENTITY_ONLY');
    const result = config.schema.parse({ updatedCharacterData: { content: '成长', name: '不应更新' }, sublimationEvent: { title: '合作', impact: '学会合作' } });
    expect(result.updatedCharacterData).toEqual({ content: '成长' });
    expect(input).toEqual(before);
  });

  it('保留的魔装与问卷仍能为其他字段和事件提供事实依据', () => {
    const input = baseInput();
    input.targetTemplate = 'magical-girl';
    input.sourceTemplate = 'magical-girl';
    input.originalData = { codename: '角色', magicConstruct: { name: 'THREAD_ONLY', basicAbilities: ['LIMIT_ONLY：每日只能使用三次'] }, userAnswers: ['ANSWER_ONLY'] };
    input.baseOutputData = structuredClone(input.originalData);
    input.fieldsToPreserve = ['magicConstruct', 'userAnswers'];
    const prompt = createSublimationGenerationCore(input).promptBuilder();
    for (const marker of ['THREAD_ONLY', 'LIMIT_ONLY', 'ANSWER_ONLY']) expect(prompt).toContain(marker);
  });

  for (const readArenaHistory of [false, true]) for (const writeArenaHistory of [false, true])
    for (const readCurrentState of [false, true]) for (const writeCurrentState of [false, true])
      for (const preserveState of [false, true]) {
        it(`读写矩阵 history=${readArenaHistory}/${writeArenaHistory}, state=${readCurrentState}/${writeCurrentState}, preserve=${preserveState}`, () => {
          const input = baseInput();
          input.stateOptions = { readArenaHistory, writeArenaHistory, readCurrentState, writeCurrentState };
          input.fieldsToPreserve = preserveState ? ['name', 'current_state'] : ['name'];
          const before = structuredClone(input);
          const config = createSublimationGenerationCore(input);
          const prompt = config.promptBuilder();
          expect(prompt).toContain('IDENTITY_ONLY');
          expect(prompt.includes('HISTORY_ONLY')).toBe(readArenaHistory);
          expect(prompt.includes('STATE_ONLY')).toBe(readCurrentState);
          const result = config.schema.parse({ updatedCharacterData: { content: '成长', current_state: { summary: 'NEW_STATE' } }, sublimationEvent: { title: '合作', impact: '学会合作' } });
          expect('current_state' in result.updatedCharacterData).toBe(writeCurrentState && !preserveState);
          const stream = buildSublimationStreamCore({ ...input, userGuidance: input.userGuidance ?? '', narrativeHistory: '', loreText: '', isDowngrade: false }).prompt;
          expect(stream.includes('HISTORY_ONLY')).toBe(readArenaHistory);
          expect(stream.includes('STATE_ONLY')).toBe(readCurrentState);
          expect(input).toEqual(before);
        });
      }
});

describe('升华共源语义约束', () => {
  for (const guidance of ['保留修补能力的体力限制。', '允许改变体力限制，新增每次消耗材料的代价。']) {
    it(`两模式完整传递方向并共享有界创作规则：${guidance}`, () => {
      const input = { ...baseInput(), fieldsToPreserve: [], userGuidance: guidance, loreText: '故事参考内容' };
      const prompts = [createSublimationGenerationCore(input).promptBuilder(), buildSublimationStreamCore({ ...input, narrativeHistory: '', isDowngrade: false }).prompt];
      for (const prompt of prompts) {
        expect(prompt).toContain(guidance);
        expect(prompt).toContain('成长不等于消除限制');
        expect(prompt).toContain('用户明确允许改变且未勾选保留');
        expect(prompt).toContain('正文、其他字段、升华事件及对过去经历的描述');
        expect(prompt).toContain('参考设定与叙事历史不得覆盖上述保留要求');
        expect(prompt).not.toContain('全面的重塑和升级');
        expect(prompt).not.toContain('可以根据需要重塑所有字段');
        expect(prompt).not.toContain('这些字段由用户选择保留，你无需关心');
      }
    });
  }
});
