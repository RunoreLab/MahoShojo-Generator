import { describe, expect, it } from 'bun:test';

import { buildBattleReportCardFromStoredData } from '@/lib/arena/battle-report-card-fallback';

describe('buildBattleReportCardFromStoredData', () => {
  it('can build a card report without combatant data', () => {
    const markdown = `
# 破晓之战

这里是正文第一段。

这里是正文第二段。

## 胜利者
- A

## 最终结果
结论：略。
`.trim();

    const report = buildBattleReportCardFromStoredData({
      mode: 'classic',
      headline: null,
      winner: null,
      outputMarkdownPreview: markdown,
      endpoint: 'api/arena/generate-stream',
    });

    expect(report.headline).toBe('破晓之战');
    expect(report.officialReport.winner).toBe('A');
    expect(report.article.body).toContain('这里是正文第一段');
    expect(report.reporterInfo.publication).toContain('api/arena/generate-stream');
  });

  it('falls back to minimal placeholders when markdown is missing', () => {
    const report = buildBattleReportCardFromStoredData({
      headline: '标题',
      winner: '未知',
      outputMarkdownPreview: '',
      endpoint: '',
    });

    expect(report.headline).toBe('标题');
    expect(report.officialReport.winner).toBe('未知');
    expect(typeof report.article.body).toBe('string');
  });
});

