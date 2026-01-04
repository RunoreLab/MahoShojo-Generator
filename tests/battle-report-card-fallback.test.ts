import { describe, expect, it } from 'bun:test';

import { hydrateBattleReportCardFromGenerationRecord } from '@/lib/arena/battle-report-card-fallback';

describe('hydrateBattleReportCardFromGenerationRecord', () => {
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
});
