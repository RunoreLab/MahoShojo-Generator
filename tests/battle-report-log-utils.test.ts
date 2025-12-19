import { describe, expect, test } from 'bun:test';

import {
  anonymizeIp,
  buildContentPreview,
  extractHeadlineFromMarkdown,
  extractWinnerFromText,
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
});

