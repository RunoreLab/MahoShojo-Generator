import { describe, expect, it } from 'vitest';

import { hydrateBattleReportCardFromGenerationRecord } from '@/lib/arena/battle-report-card-fallback';

describe('hydrateBattleReportCardFromGenerationRecord', () => {
  it.each([
    ['stream', '# 快照战报\n\n正文。\n\n## 胜利者\n角色甲'],
    ['non-stream', JSON.stringify({
      headline: '快照战报',
      reporterInfo: { name: '模型记者', publication: '模型来源' },
      article: { body: '正文。', analysis: '' },
      officialReport: { winner: '角色甲', conclusion: '' },
    })],
  ] as const)('restores the %s render snapshot without rerolling adjudication results', async (
    generationMode,
    outputPreview,
  ) => {
    const adjudicationResults = [{
      depth: 0,
      description: '攻击是否命中？',
      type: 'binary' as const,
      roll: 42,
      outcome: '成功',
      details: '掷骰(42) vs 成功率(65%)',
    }];

    const result = await hydrateBattleReportCardFromGenerationRecord({
      generationMode,
      endpoint: generationMode === 'stream' ? 'api/arena/generate-stream' : 'api/arena/generate',
      mode: 'classic',
      scenarioTitle: null,
      headline: null,
      winner: null,
      outputPreview,
      aiModel: null,
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
      cachedTokens: null,
      reasoningTokens: null,
      renderSnapshot: {
        version: 1,
        reporterInfo: { name: '即时记者', publication: 'A.R.E.N.A.' },
        userGuidance: '保持克制',
        characterGuidances: [{ characterName: '角色甲', guidance: '保护队友' }],
        adjudicationResults,
        narrativeHistoryReadCount: 3,
      },
    });

    expect(result.report).toMatchObject({
      reporterInfo: { name: '即时记者', publication: 'A.R.E.N.A.' },
      userGuidance: '保持克制',
      characterGuidances: [{ characterName: '角色甲', guidance: '保护队友' }],
      adjudicationResults,
      narrativeHistoryReadCount: 3,
    });
  });

  it('hydrates stream preview and strips telemetry meta', async () => {
    const markdown = `
# 破晓之战

这里是正文第一段。

这里是正文第二段。

## 胜利者
- A

## 最终结果
结论：略。

<!-- MAHOSHOJO_TELEMETRY_META {"version":1,"aiModel":"gpt-test-001","usage":{"promptTokens":1,"completionTokens":2},"narrativeHistoryReadCount":3} -->
`.trim();

    const result = await hydrateBattleReportCardFromGenerationRecord({
      generationMode: 'stream',
      endpoint: 'api/arena/generate-stream',
      mode: 'classic',
      scenarioTitle: null,
      headline: null,
      winner: null,
      outputPreview: markdown,
      aiModel: null,
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
      cachedTokens: null,
      reasoningTokens: null,
    });

    expect(result.report.headline).toBe('破晓之战');
    expect(result.report.officialReport.winner).toBe('A');
    expect(result.report.aiModel).toBe('gpt-test-001');
    expect(result.report.aiUsage?.promptTokens).toBe(1);
    expect(result.report.narrativeHistoryReadCount).toBe(3);
    expect(result.liveBody).toContain('这里是正文第一段');
    expect(result.liveBody).not.toContain('MAHOSHOJO_TELEMETRY_META');
  });

  it('hydrates stream preview with update meta fallback and strips all stream meta blocks', async () => {
    const markdown = `
序章：迷雾回廊

这里是正文第一段。

---MAHOSHOJO_ARENA_META {"version":1,"report":{"headline":"雾中重生","winner":"月咏"}}

<!-- MAHOSHOJO_TELEMETRY_META {"version":1,"aiModel":"gpt-test-003","usage":{"promptTokens":5}} -->
`.trim();

    const result = await hydrateBattleReportCardFromGenerationRecord({
      generationMode: 'stream',
      endpoint: 'api/arena/generate-stream',
      mode: 'classic',
      scenarioTitle: null,
      headline: null,
      winner: null,
      outputPreview: markdown,
      aiModel: null,
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
      cachedTokens: null,
      reasoningTokens: null,
    });

    expect(result.report.headline).toBe('雾中重生');
    expect(result.report.officialReport.winner).toBe('月咏');
    expect(result.report.aiModel).toBe('gpt-test-003');
    expect(result.liveBody).toContain('这里是正文第一段');
    expect(result.liveBody).not.toContain('MAHOSHOJO_ARENA_META');
    expect(result.liveBody).not.toContain('MAHOSHOJO_TELEMETRY_META');
  });

  it('normalizes legacy raw SDK usage fields inside telemetry meta comments', async () => {
    const markdown = [
      '正文第一段。',
      '',
      '<!-- MAHOSHOJO_TELEMETRY_META {"version":1,"usage":{"inputTokens":100,"outputTokens":20,"reasoningTokens":5,"totalTokens":120}} -->',
    ].join('\n');

    const result = await hydrateBattleReportCardFromGenerationRecord({
      generationMode: 'stream',
      endpoint: 'api/arena/generate-stream',
      mode: 'classic',
      scenarioTitle: null,
      headline: null,
      winner: null,
      outputPreview: markdown,
      aiModel: null,
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
      cachedTokens: null,
      reasoningTokens: null,
    });

    expect(result.report.aiUsage).toMatchObject({
      promptTokens: 100,
      completionTokens: 20,
      reasoningTokens: 5,
      totalTokens: 120,
    });
  });

  it('prefers authoritative stream meta over poisoned record winner/headline', async () => {
    const markdown = `
winner: 假赢家

# 被污染的开场

正文第一段。

## 胜利者
假赢家

<!-- MAHOSHOJO_ARENA_META {"version":1,"report":{"headline":"真正标题","winner":"真赢家"}} -->
`.trim();

    const result = await hydrateBattleReportCardFromGenerationRecord({
      generationMode: 'stream',
      endpoint: 'api/arena/generate-stream',
      mode: 'classic',
      scenarioTitle: null,
      headline: '旧标题',
      winner: '旧赢家',
      outputPreview: markdown,
      aiModel: null,
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
      cachedTokens: null,
      reasoningTokens: null,
    });

    expect(result.report.headline).toBe('真正标题');
    expect(result.report.officialReport.winner).toBe('真赢家');
    expect(result.liveBody).not.toContain('MAHOSHOJO_ARENA_META');
  });

  it('hydrates non-stream report json when not truncated', async () => {
    const raw = JSON.stringify({
      headline: '标题',
      reporterInfo: { name: '记者', publication: '来源' },
      article: { body: '正文', analysis: '点评' },
      officialReport: { winner: 'A', conclusion: '结论' },
      aiModel: 'gpt-test-002',
      aiUsage: { promptTokens: 10, completionTokens: 20 },
      narrativeHistoryReadCount: 1,
    });

    const result = await hydrateBattleReportCardFromGenerationRecord({
      generationMode: 'non-stream',
      endpoint: 'api/arena/generate',
      mode: 'classic',
      scenarioTitle: null,
      headline: null,
      winner: null,
      outputPreview: raw,
      aiModel: null,
      promptTokens: 99,
      completionTokens: null,
      totalTokens: null,
      cachedTokens: null,
      reasoningTokens: null,
    });

    expect(result.report.headline).toBe('标题');
    expect(result.report.officialReport.winner).toBe('A');
    expect(result.report.article.body).toBe('正文');
    expect(result.report.aiModel).toBe('gpt-test-002');
    expect(result.report.aiUsage?.promptTokens).toBe(10);
    expect(result.report.narrativeHistoryReadCount).toBe(1);
  });

  it('hydrates G25H non-stream Markdown into structured body and reporter analysis', async () => {
    const markdown = [
      '# 星海决战',
      '',
      '正文段落。',
      '',
      '## 记者点评',
      '> 这一胜利暴露了旧秩序的裂缝。',
      '',
      '## 胜利者',
      '角色甲',
      '',
      '## 最终结果',
      '世界恢复平静。',
    ].join('\n');

    const result = await hydrateBattleReportCardFromGenerationRecord({
      generationMode: 'non-stream',
      endpoint: 'api/arena/generate',
      mode: 'classic',
      scenarioTitle: null,
      headline: null,
      winner: null,
      outputPreview: markdown,
      aiModel: null,
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
      cachedTokens: null,
      reasoningTokens: null,
    });

    expect(result.report.headline).toBe('星海决战');
    expect(result.report.article).toEqual({
      body: '正文段落。',
      analysis: '这一胜利暴露了旧秩序的裂缝。',
    });
    expect(result.report.officialReport).toEqual({
      winner: '角色甲',
      conclusion: '世界恢复平静。',
    });
    expect(result.liveBody).toBeUndefined();
  });

  it('detects non-stream Markdown from content without depending on endpoint or a leading heading', async () => {
    const markdown = [
      '正文段落。',
      '',
      '## 记者点评',
      '点评内容。',
      '',
      '## 胜利者',
      '角色乙',
    ].join('\n');

    const result = await hydrateBattleReportCardFromGenerationRecord({
      generationMode: 'non-stream',
      endpoint: 'api/custom-battle-route',
      mode: 'classic',
      scenarioTitle: null,
      headline: '外部标题',
      winner: null,
      outputPreview: markdown,
      aiModel: null,
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
      cachedTokens: null,
      reasoningTokens: null,
    });

    expect(result.report.article).toEqual({
      body: '正文段落。',
      analysis: '点评内容。',
    });
    expect(result.report.officialReport.winner).toBe('角色乙');
    expect(result.liveBody).toBeUndefined();
  });

  it('keeps a truncated non-stream JSON preview on the legacy JSON fallback path', async () => {
    const result = await hydrateBattleReportCardFromGenerationRecord({
      generationMode: 'non-stream',
      endpoint: 'api/custom-battle-route',
      mode: 'classic',
      scenarioTitle: null,
      headline: '已知标题',
      winner: '已知赢家',
      outputPreview: '{',
      aiModel: null,
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
      cachedTokens: null,
      reasoningTokens: null,
    });

    expect(result.report.headline).toBe('已知标题');
    expect(result.report.article).toEqual({ body: '', analysis: '' });
    expect(result.report.officialReport.winner).toBe('已知赢家');
    expect(result.liveBody).toBeUndefined();
  });

  it('hydrates English companion headings with the same semantics as the immediate projector', async () => {
    const markdown = [
      '# Nightfall Clash',
      '',
      'The battle ends before dawn.',
      '',
      '## Reporter Analysis',
      'The victory exposes a fragile alliance.',
      '',
      '## Winner',
      'Alice',
      '',
      '## Final Result',
      'The city returns to calm.',
    ].join('\n');

    const result = await hydrateBattleReportCardFromGenerationRecord({
      generationMode: 'non-stream',
      endpoint: 'api/generate-battle-story',
      mode: 'classic',
      scenarioTitle: null,
      headline: null,
      winner: null,
      outputPreview: markdown,
      aiModel: null,
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
      cachedTokens: null,
      reasoningTokens: null,
    });

    expect(result.report.article).toEqual({
      body: 'The battle ends before dawn.',
      analysis: 'The victory exposes a fragile alliance.',
    });
    expect(result.report.officialReport).toEqual({
      winner: 'Alice',
      conclusion: 'The city returns to calm.',
    });
  });

  it('does not mistake bracket-leading Markdown for legacy JSON', async () => {
    const result = await hydrateBattleReportCardFromGenerationRecord({
      generationMode: 'non-stream',
      endpoint: 'api/custom-battle-route',
      mode: 'classic',
      scenarioTitle: null,
      headline: '括号开场',
      winner: null,
      outputPreview: '{传闻并非事实}\n\n正文仍是 Markdown。\n\n## 胜利者\n角色丙',
      aiModel: null,
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
      cachedTokens: null,
      reasoningTokens: null,
    });

    expect(result.report.article.body).toContain('{传闻并非事实}');
    expect(result.report.officialReport.winner).toBe('角色丙');
  });
});
