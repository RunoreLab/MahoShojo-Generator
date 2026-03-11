import { describe, expect, test } from 'bun:test';

import { buildBattleStoryDeterministicDigest } from '@/lib/ai-session/battle-story/digest';

describe('battle story deterministic digest', () => {
  test('从标准战报 markdown 与 reportJson 中提取标题、胜者、结论与正文摘要', () => {
    const markdown = [
      '# 星光回廊的终局',
      '',
      '在长夜般的回廊里，晓雾与砂金残响交错碰撞。晓雾先是退让，随后抓住对手节奏里那一瞬的迟疑，完成了漂亮的反制。',
      '',
      '## 胜利者',
      '',
      '- 晓雾',
      '',
      '## 最终结果',
      '',
      '晓雾在代价可控的前提下赢下了这场鏖战。',
    ].join('\n');

    const digest = buildBattleStoryDeterministicDigest({
      markdown,
      chapterIndex: 2,
      reportJson: {
        headline: '星光回廊的终局',
        officialReport: {
          winner: '晓雾',
          conclusion: '晓雾在代价可控的前提下赢下了这场鏖战。',
        },
      },
      impacts: [
        { characterName: '晓雾', impact: '更明确了自己的战斗节奏', currentStateSummary: '体力消耗明显，但精神稳定' },
        { characterName: '砂金', impact: '意识到硬碰硬并非唯一选择', currentStateSummary: '外伤不重，情绪低落' },
      ],
      rosterOrder: ['晓雾', '砂金'],
    });

    expect(digest.chapterTitle).toBe('星光回廊的终局');
    expect(digest.winner).toBe('晓雾');
    expect(digest.officialConclusion).toBe('晓雾在代价可控的前提下赢下了这场鏖战。');
    expect(digest.bodyExcerpt).toContain('在长夜般的回廊里');
    expect(digest.impactDigest?.map((item) => item.characterName)).toEqual(['晓雾', '砂金']);
  });

  test('当 markdown 没有标题时，回退为章节标题', () => {
    const digest = buildBattleStoryDeterministicDigest({
      markdown: '她们在寂静校舍里彼此试探，没有谁真正先出手。',
      chapterIndex: 5,
    });

    expect(digest.chapterTitle).toBe('第 5 章');
    expect(digest.bodyExcerpt).toContain('她们在寂静校舍里彼此试探');
  });

  test('impact digest 会去重并保留后续补全字段', () => {
    const digest = buildBattleStoryDeterministicDigest({
      markdown: '# 标题\n\n正文',
      impacts: [
        { characterName: '白露', impact: '意识到自己的犹豫' },
        { characterName: '白露', currentStateSummary: '心态逐渐稳定' },
        { characterName: '赤铃', current_state_summary: '保持警惕' },
      ],
    });

    expect(digest.impactDigest).toEqual([
      {
        characterName: '白露',
        impact: '意识到自己的犹豫',
        currentStateSummary: '心态逐渐稳定',
      },
      {
        characterName: '赤铃',
        currentStateSummary: '保持警惕',
      },
    ]);
  });
});
