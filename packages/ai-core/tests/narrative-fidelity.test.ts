import { describe, expect, it } from 'vitest';
import cases from '../fixtures/narrative-fidelity-cases.json';
import { assembleArenaGenerationPrompt, getSystemPrompt, SYSTEM_PROMPTS } from '../src/arena-generation';
import { NARRATIVE_CONTENT_POLICY, NARRATIVE_RECORDING_RULES } from '../src/narrative-rules';

const combatants = (characters = cases[0]!.characters) => characters.map(data => ({
  type: 'general-character', data: { templateId: '通用角色', ...data },
}));

describe('narrative rule boundaries at the assembled request', () => {
  it.each(cases)('preserves $id source facts without promoting card instructions to system', (sample) => {
    const value = assembleArenaGenerationPrompt({
      payload: { mode: sample.mode, combatants: combatants(sample.characters),
        scenario: 'scenario' in sample ? { templateId: '通用情景', ...sample.scenario } : null,
        userGuidance: 'guidance' in sample ? sample.guidance : '',
        readArenaHistory: false, readCurrentState: false, writeArenaHistory: true, writeCurrentState: true },
      outputContract: 'stream-markdown', adjudicationResults: null,
      reporterInfo: { name: '验收记者', publication: '验收' },
    });
    expect(value.systemPrompt?.split(NARRATIVE_CONTENT_POLICY)).toHaveLength(2);
    expect(value.systemPrompt).toContain(NARRATIVE_RECORDING_RULES);
    for (const character of sample.characters) {
      expect(value.prompt).toContain(character.content);
      expect(value.systemPrompt).not.toContain(character.content);
    }
    expect(value.systemPrompt).not.toContain('PROMPT_OVERRIDE_ACCEPTED');
    expect(value.prompt).toContain('MAHOSHOJO_ARENA_META');
  });

  it.each(['stream-markdown', 'structured-report', 'web-document', 'web-package-target'] as const)(
    'separates immutable rules from material for %s', (outputContract) => {
      const value = assembleArenaGenerationPrompt({
        payload: { mode: 'kizuna', combatants: combatants(), writeArenaHistory: false, writeCurrentState: false },
        outputContract, adjudicationResults: null, reporterInfo: { name: '记者', publication: '验收' },
      });
      expect(value.systemPrompt).toContain('友情、羁绊、信念');
      expect(value.prompt).not.toContain(NARRATIVE_CONTENT_POLICY);
      expect(value.systemPrompt).not.toContain(NARRATIVE_RECORDING_RULES);
      if (outputContract === 'structured-report') {
        expect(value.prompt).toContain('严格按宿主 JSON Schema');
        expect(value.prompt).not.toContain('请在文末 Arena control trailer');
      }
    },
  );

  it('keeps mode identity and source-specific world rules without banning ability categories', () => {
    const all = Object.values(SYSTEM_PROMPTS).join('\n');
    for (const obsolete of ['没有无敌的能力', '忽略设定中【无消耗】', '严禁使用干涉命运', '避免单方面碾压']) {
      expect(all).not.toContain(obsolete);
    }
    expect(SYSTEM_PROMPTS.daily).toContain('温暖');
    expect(SYSTEM_PROMPTS.kizuna).toContain('本场事件支撑');
    expect(SYSTEM_PROMPTS.scenario).toContain('确实不可调和时以主情景为准');
    for (const mode of ['classic', 'kizuna', 'magicalGirlVsCanshou', 'canshouVsCanshou', 'fallback'] as const) {
      expect(SYSTEM_PROMPTS[mode]).toContain('现在让登场角色实际展开一场战斗');
    }
    expect(SYSTEM_PROMPTS.daily).not.toContain('现在让登场角色实际展开一场战斗');
    expect(SYSTEM_PROMPTS.scenario).not.toContain('现在让登场角色实际展开一场战斗');
    expect(getSystemPrompt('classic', combatants())).toContain('按各角色自身体系');
    expect(getSystemPrompt('classic', [{ type: 'magical-girl' }])).toContain('未注明等级时不得凭空增加等级锁定');
  });
});
