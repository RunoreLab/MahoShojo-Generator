import { describe, expect, test } from 'vitest';

describe('challenge stream meta', () => {
  test('extractChallengeAdjudicationMeta 会去掉隐藏尾注并解析出裁定结果', async () => {
    const { extractChallengeAdjudicationMeta } = await import('@/lib/challenge/stream-meta');

    const input = [
      '# 战斗纪要',
      '',
      '雾灯抓住了雪绒的回气空档，以更稳的节奏收下战局。',
      '',
      '<!-- MAHOSHOJO_ARENA_META',
      '{"version":1,"adjudication":{"outcome":"victory","trackDeltas":{"hp":-12,"radiance":-8},"addStatuses":[],"removeStatuses":[],"rewardOptionId":null,"summary":"雾灯稳稳取胜。"}}',
      '-->',
    ].join('\n');

    const result = await extractChallengeAdjudicationMeta(input);

    expect(result).not.toBeNull();
    expect(result?.strippedMarkdown).toContain('雾灯抓住了雪绒的回气空档');
    expect(result?.strippedMarkdown.includes('MAHOSHOJO_ARENA_META')).toBe(false);
    expect(result?.meta.adjudication.outcome).toBe('victory');
    expect(result?.meta.adjudication.trackDeltas.hp).toBe(-12);
  });

  test('extractChallengeAdjudicationMeta 会修复常见的 JSON 格式错误', async () => {
    const { extractChallengeAdjudicationMeta } = await import('@/lib/challenge/stream-meta');

    const input = [
      '战斗正文第一段',
      '',
      "<!-- MAHOSHOJO_ARENA_META {version:1, adjudication:{outcome:'costly_victory', trackDeltas:{hp:-18, radiance:-12}, addStatuses:['fatigued',], removeStatuses:[], rewardOptionId:null, summary:'险胜',},} -->",
    ].join('\n');

    const result = await extractChallengeAdjudicationMeta(input);

    expect(result).not.toBeNull();
    expect(result?.meta.adjudication.outcome).toBe('costly_victory');
    expect(result?.meta.adjudication.addStatuses).toEqual(['fatigued']);
    expect(result?.meta.adjudication.summary).toBe('险胜');
  });

  test('没有隐藏尾注时返回 null', async () => {
    const { extractChallengeAdjudicationMeta } = await import('@/lib/challenge/stream-meta');

    const result = await extractChallengeAdjudicationMeta('只有正文，没有结构化尾注。');

    expect(result).toBeNull();
  });
});
