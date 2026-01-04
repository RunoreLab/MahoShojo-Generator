import { describe, expect, test } from 'bun:test';

import {
  anonymizeIp,
  buildCombatantsFallbackForExtraJson,
  buildContentPreview,
  compactExtraJson,
  extractHeadlineFromMarkdown,
  extractWinnerFromText,
  normalizeErrorMessage,
  normalizeUsage,
} from '@/lib/arena/battle-report-log-utils';

describe('battle-report-log-utils', () => {
  test('buildContentPreview: 短文本不截断', () => {
    expect(buildContentPreview('你好世界', { headChars: 3, tailChars: 3 })).toBe('你好世界');
  });

  test('buildContentPreview: 长文本按前后截断并插入省略号（按 code point）', () => {
    const text = 'A😀BCDEFGHIJ';
    const preview = buildContentPreview(text, { headChars: 2, tailChars: 2, ellipsis: '……' });
    expect(preview).toBe('A😀……IJ');
  });

  test('anonymizeIp: IPv4 /24', () => {
    expect(anonymizeIp('1.2.3.4')).toBe('1.2.3.0');
    expect(anonymizeIp('255.255.255.255')).toBe('255.255.255.0');
  });

  test('anonymizeIp: IPv6 /64 粗脱敏', () => {
    expect(anonymizeIp('2001:db8:85a3:0000:0000:8a2e:0370:7334')).toBe('2001:db8:85a3:0000::');
    expect(anonymizeIp('2001:db8::1')).toBe('2001:db8::');
  });

  test('extractHeadlineFromMarkdown: 优先取标题行', () => {
    expect(extractHeadlineFromMarkdown('# 魔法少女速报\n内容')).toBe('魔法少女速报');
    expect(extractHeadlineFromMarkdown('## 小标题\n内容')).toBe('小标题');
  });

  test('extractHeadlineFromMarkdown: 无标题则取第一行', () => {
    expect(extractHeadlineFromMarkdown('第一行\n第二行')).toBe('第一行');
  });

  test('extractWinnerFromText: 支持多种标记', () => {
    expect(extractWinnerFromText('胜利者：小圆\n其他')).toBe('小圆');
    expect(extractWinnerFromText('Winner: Homura')).toBe('Homura');
  });

  test('extractWinnerFromText: 支持 Markdown “## 胜利者”段落', () => {
    const md = ['# 标题', '', '正文', '', '## 胜利者', '', '白百合', '', '## 最终结果', '略'].join('\n');
    expect(extractWinnerFromText(md)).toBe('白百合');
  });

  test('extractWinnerFromText: 不应吞掉 codename 下划线（如 I_moly）', () => {
    const md = ['# 标题', '', '正文', '', '## 胜利者', '', 'I_moly（墨澧）', '', '## 最终结果', '略'].join('\n');
    expect(extractWinnerFromText(md)).toBe('I_moly（墨澧）');
  });

  test('extractWinnerFromText: 支持内联 Markdown 粗体标签（**胜利者**: ...）', () => {
    const md = ['- **胜利者**: I_moly（墨澧）', '其他'].join('\n');
    expect(extractWinnerFromText(md)).toBe('I_moly（墨澧）');
  });

  test('extractWinnerFromText: 支持 Markdown 列表样式胜利者', () => {
    const md = ['## 胜利者', '- 白百合', '', '别的内容'].join('\n');
    expect(extractWinnerFromText(md)).toBe('白百合');
  });

  test('normalizeUsage: 兼容常见字段', () => {
    expect(normalizeUsage({ promptTokens: 10, completionTokens: 20, totalTokens: 30 })).toEqual({
      promptTokens: 10,
      completionTokens: 20,
      totalTokens: 30,
    });

    expect(normalizeUsage({ cacheTokens: 4, reasoningTokens: 7 })).toEqual({
      cachedTokens: 4,
      reasoningTokens: 7,
    });
  });

  test('normalizeErrorMessage: 去空格、截断、非字符串返回 null', () => {
    expect(normalizeErrorMessage(null)).toBeNull();
    expect(normalizeErrorMessage('   ')).toBeNull();
    expect(normalizeErrorMessage('  hello  ')).toBe('hello');
    expect(normalizeErrorMessage('a'.repeat(10), 5)).toBe('aaaaa…');
    expect(normalizeErrorMessage('a'.repeat(10), 0)).toBeNull();
  });

  test('compactExtraJson: 去掉空值/空白/空数组/空对象，但保留 0/false', () => {
    expect(compactExtraJson(null)).toBeNull();
    expect(compactExtraJson({})).toBeNull();

    const compacted = compactExtraJson({
      a: null,
      b: undefined,
      c: '',
      d: '  ',
      e: [],
      f: {},
      g: 0,
      h: false,
      i: ' ok ',
      j: [1],
      k: { x: 1 },
    });

    expect(compacted).toEqual({
      g: 0,
      h: false,
      i: 'ok',
      j: [1],
      k: { x: 1 },
    });
  });

  test('buildCombatantsFallbackForExtraJson: 生成最小兜底参战者摘要', () => {
    const fallback = buildCombatantsFallbackForExtraJson([
      { type: 'magical-girl', isNative: true, data: { codename: '小圆' } },
      { type: 'general-character', isPreset: false, teamId: 2, sourceDataCardId: 'card_1', data: { name: 'QB' } },
    ]);

    expect(fallback).toEqual([
      {
        sortIndex: 0,
        name: '小圆',
        type: 'magical-girl',
        isNative: true,
      },
      {
        sortIndex: 1,
        name: 'QB',
        type: 'general-character',
        isPreset: false,
        teamId: 2,
        dataCardId: 'card_1',
      },
    ]);
  });
});
