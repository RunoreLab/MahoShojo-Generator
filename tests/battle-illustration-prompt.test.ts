import { describe, expect, test } from 'vitest';

import { buildBattleIllustrationPrompt, extractBattleReportTail } from '@/lib/arena/battle-illustration-prompt';

describe('battle illustration prompt', () => {
  test('能提取魔法少女/残兽/通用角色的外观摘要', () => {
    const result = buildBattleIllustrationPrompt({
      headline: '终局速报',
      reportBody: '战斗在黄昏收束。',
      combatants: [
        {
          type: 'magical-girl',
          data: {
            codename: '星绮',
            appearance: {
              outfit: '黑金礼装',
              accessories: '水晶耳坠',
              colorScheme: '紫金',
              overallLook: '华丽而冷峻',
            },
          },
        },
        {
          type: 'canshou',
          data: {
            name: '裂烬兽',
            appearance: '高大骨甲',
            materialAndSkin: '灰黑岩壳',
            featuresAndAppendages: '多节尾刃',
          },
        },
        {
          type: 'general-character',
          data: {
            name: '调查员 K',
            content: '穿着风衣，携带旧式录音笔，神情始终平静。',
          },
        },
      ],
      aiImpacts: [],
    });

    expect(result.appearanceLines).toHaveLength(3);
    expect(result.appearanceLines[0]).toContain('星绮：黑金礼装');
    expect(result.appearanceLines[1]).toContain('裂烬兽：高大骨甲');
    expect(result.appearanceLines[2]).toContain('调查员 K：穿着风衣');
  });

  test('能从 markdown 正文提取尾段且忽略胜利者区块', () => {
    const markdown = [
      '# 夜色下的决战',
      '',
      '街区残响逐渐平息。',
      '终章里，星绮收起权杖，回望仍在燃烧的天际线。',
      '',
      '## 胜利者',
      '- 星绮',
      '',
      '<!-- MAHOSHOJO_ARENA_META {"version":1,"impacts":[{"characterName":"星绮","impact":"成长"}]} -->',
    ].join('\n');

    const tail = extractBattleReportTail({ reportMarkdown: markdown, maxChars: 80 });
    expect(tail).toContain('回望仍在燃烧的天际线');
    expect(tail).not.toContain('胜利者');
    expect(tail).not.toContain('MAHOSHOJO_ARENA_META');
  });

  test('无 aiImpacts 时不会回退角色卡旧 current_state/arena_history', () => {
    const result = buildBattleIllustrationPrompt({
      headline: '无 impacts 场景',
      reportBody: '正文结尾内容。',
      combatants: [
        {
          type: 'magical-girl',
          data: {
            codename: '白昼铃',
            appearance: { outfit: '白银战裙' },
            current_state: { summary: '旧状态：不应被提示词引用' },
            arena_history: { entries: [{ impact: '旧历战：不应被提示词引用' }] },
          },
        },
      ],
      aiImpacts: null,
    });

    expect(result.currentStateLines).toHaveLength(0);
    expect(result.impactLines).toHaveLength(0);
    expect(result.prompt).not.toContain('旧状态：不应被提示词引用');
    expect(result.prompt).not.toContain('旧历战：不应被提示词引用');
  });

  test('aiImpacts 缺字段时应跳过，不伪造内容', () => {
    const result = buildBattleIllustrationPrompt({
      headline: '字段缺失容错',
      reportBody: '正文结尾内容。',
      combatants: [
        { type: 'magical-girl', data: { codename: 'A', appearance: { outfit: '短斗篷' } } },
        { type: 'magical-girl', data: { codename: 'B', appearance: { outfit: '长斗篷' } } },
      ],
      aiImpacts: [
        { characterName: 'A', impact: 'A 的历战变化' },
        { characterName: 'B', currentStateSummary: 'B 的当前状态' },
        { characterName: 'C' },
      ],
    });

    expect(result.impactLines).toEqual(['A：A 的历战变化']);
    expect(result.currentStateLines).toEqual(['B：B 的当前状态']);
    expect(result.prompt).not.toContain('C：');
  });
});
