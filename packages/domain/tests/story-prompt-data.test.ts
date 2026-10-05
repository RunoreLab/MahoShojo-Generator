import { describe, expect, it } from 'vitest';
import { sanitizeStoryPromptRecord, projectStoryPromptCombatant, projectStoryPromptMaterial } from '../src/story-prompt-data';
const options = { readArenaHistory: false, readCurrentState: false };
describe('故事输入投影', () => {
  it('只移除已知运行时字段，保留自定义设定、数值零与否定值', () => {
    const source = {
      name: '雾灯', templateId: '模板', signature: '签名', metadata: { author: '作者' },
      creationInputs: { freeformBrief: '原始输入' }, isPreset: true,
      adjudicationEvents: [{ description: '未抽中分支' }],
      _battle_story: { total_chapters: 5 }, _author: '作者', _cardId: 'id',
      wantuCard: { content: '往返备份' }, _mahoshojo: { originalData: '备份' },
      createdAt: '时间', extra_json: { telemetry: true },
      arena_history: { entries: [] }, current_state: { summary: '负伤' },
      custom: { metadata: { author: '世界内作者' }, signature: '家族徽记', _rule: '自定义规则' },
      _custom: '自定义扩展', hp: 0, alive: false, content: '正文内 templateId 不应被改写',
    };
    const snapshot = structuredClone(source);
    const projected = sanitizeStoryPromptRecord(source, options)!;
    expect(projected).toEqual({ name: '雾灯', custom: source.custom,
      _custom: source._custom, hp: 0, alive: false, content: source.content });
    expect(source).toEqual(snapshot);
    expect(projected.custom).not.toBe(source.custom);
    expect(sanitizeStoryPromptRecord(projected, options)).toEqual(projected);
  });
  it('保留有效角色参数与规则版本，只移除校验报告', () => {
    const rule = { ruleId: 'dnd-5e-lite', version: '1', blockResults: { STR: 10 },
      derived: { HP: 0 }, validationSummary: { issues: ['校验报告'] } };
    const projected = sanitizeStoryPromptRecord({ buildState: { rules: [rule] } }, options)!;
    expect(projected['角色参数']).toEqual({ rules: [{ ruleId: 'dnd-5e-lite', version: '1',
      blockResults: { STR: 10 }, derived: { HP: 0 } }] });
    expect(projected).not.toHaveProperty('buildState');
    expect(rule.validationSummary.issues).toEqual(['校验报告']);
  });
  it('角色包装只保留语义字段，不将作者/来源信息带入会话', () => {
    const result = projectStoryPromptCombatant({ type: 'general-character', sourceAuthor: '作者',
      filename: '文件名', isNative: true, teamId: 2, characterGuidance: '守护队友',
      data: { name: '雾灯', content: '设定', current_state: { summary: '负伤' } } },
    { ...options, readCurrentState: true });
    expect(result).toEqual({ type: 'general-character', teamId: 2, characterGuidance: '守护队友',
      data: { name: '雾灯', content: '设定', current_state: { summary: '负伤' } } });
  });
  it('素材保留叙事事件和历史正文，不把随机配置当作设定', () => {
    const result = projectStoryPromptMaterial({ name: '车站', elements: { events: '列车迟到' },
      adjudicationEvents: [{ description: '抽签配置' }], creationInputs: {},
      arena_history: { entries: [{ impact: '故人重逢' }] } });
    expect(result).toEqual({ name: '车站', elements: { events: '列车迟到' },
      arena_history: { entries: [{ impact: '故人重逢' }] } });
    expect(projectStoryPromptMaterial('Markdown **原样保留**')).toBe('Markdown **原样保留**');
  });
});
