import { describe, expect, test } from 'vitest';

import {
  exceedsUtf8ByteLimit,
  getUtf8ByteLength,
  isHotCard,
} from '@mahoshojo/domain/data-card-size';

describe('exceedsUtf8ByteLimit（D5.1-P2-r2 上移共享域层）', () => {
  test('按 UTF-8 字节数判定，超限即停', () => {
    expect(exceedsUtf8ByteLimit('abcd', 4)).toBe(false);
    expect(exceedsUtf8ByteLimit('abcde', 4)).toBe(true);
    // UTF-16 码元数不超但 UTF-8 字节超限（CJK 每字 3 字节）。
    expect(exceedsUtf8ByteLimit('汉汉', 5)).toBe(true);
    expect(exceedsUtf8ByteLimit('汉汉', 6)).toBe(false);
    // 孤立代理项按 U+FFFD 计 3 字节，与 TextEncoder 语义一致。
    expect(exceedsUtf8ByteLimit('\ud800a', 3)).toBe(true);
    expect(exceedsUtf8ByteLimit('\ud800a', 4)).toBe(false);
    // 代理对合算 4 字节。
    expect(exceedsUtf8ByteLimit('\ud83d\ude00', 4)).toBe(false);
    expect(exceedsUtf8ByteLimit('\ud83d\ude00x', 4)).toBe(true);
  });

  test('与 getUtf8ByteLength 的真实编码计数一致', () => {
    for (const text of ['', 'ascii', '中文混合 mixed', '\ud83d\ude00\ud83c\udf38', 'x'.repeat(1024)]) {
      const actual = getUtf8ByteLength(text);
      expect(exceedsUtf8ByteLimit(text, actual)).toBe(false);
      expect(exceedsUtf8ByteLimit(text, Math.max(0, actual - 1))).toBe(text.length > 0);
    }
  });
});

test('热门展示沿同一严格阈值，不把边界值提前减免', () => {
  expect(isHotCard({})).toBe(false);
  expect(isHotCard({ favorite_count: 10, usage_count: 31 })).toBe(false);
  expect(isHotCard({ favorite_count: 11, usage_count: 30 })).toBe(false);
  expect(isHotCard({ favorite_count: 11, usage_count: 31 })).toBe(true);
});
