import { describe, expect, it } from 'vitest';

import {
  applyMagicTeaPartyMessageLimits,
  clipMagicTeaPartyMessageContent,
  formatMagicTeaPartyTotalOverflowMessage,
  isMagicTeaPartyTotalOverflow,
  MAGIC_TEA_PARTY_MAX_MESSAGE_CHARS,
  MAGIC_TEA_PARTY_MAX_TOTAL_CHARS,
  MAGIC_TEA_PARTY_MIN_MESSAGE_CHARS,
  resolveMagicTeaPartyMessageCharLimit,
} from '@/lib/magic-tea-party/message-limits';

describe('resolveMagicTeaPartyMessageCharLimit', () => {
  it('按上下文窗口分档', () => {
    expect(resolveMagicTeaPartyMessageCharLimit(8_192)).toBe(8_000);
    expect(resolveMagicTeaPartyMessageCharLimit(32_768)).toBe(16_000);
    expect(resolveMagicTeaPartyMessageCharLimit(65_536)).toBe(24_000);
    expect(resolveMagicTeaPartyMessageCharLimit(131_072)).toBe(32_000);
    expect(resolveMagicTeaPartyMessageCharLimit(200_000)).toBe(48_000);
    expect(resolveMagicTeaPartyMessageCharLimit(1_000_000)).toBe(MAGIC_TEA_PARTY_MAX_MESSAGE_CHARS);
  });

  it('输入非法时回落到最大档（宁可截断也不把超长内容直接推给模型）', () => {
    expect(resolveMagicTeaPartyMessageCharLimit(null)).toBe(MAGIC_TEA_PARTY_MAX_MESSAGE_CHARS);
    expect(resolveMagicTeaPartyMessageCharLimit(undefined)).toBe(MAGIC_TEA_PARTY_MAX_MESSAGE_CHARS);
    expect(resolveMagicTeaPartyMessageCharLimit(Number.NaN)).toBe(MAGIC_TEA_PARTY_MAX_MESSAGE_CHARS);
    expect(resolveMagicTeaPartyMessageCharLimit(-1)).toBe(8_000);
    expect(resolveMagicTeaPartyMessageCharLimit(0)).toBe(8_000);
  });

  it('单条预算始终落在 [MIN, MAX] 区间内', () => {
    for (const ctx of [0, 1, 4_096, 8_192, 16_384, 32_768, 64_000, 131_072, 999_999]) {
      const limit = resolveMagicTeaPartyMessageCharLimit(ctx);
      expect(limit).toBeGreaterThanOrEqual(MAGIC_TEA_PARTY_MIN_MESSAGE_CHARS);
      expect(limit).toBeLessThanOrEqual(MAGIC_TEA_PARTY_MAX_MESSAGE_CHARS);
    }
  });
});

describe('clipMagicTeaPartyMessageContent', () => {
  it('未超限时原样返回且不标记为截断', () => {
    const content = '短消息';
    const result = clipMagicTeaPartyMessageContent(content, 8_000);
    expect(result).toEqual({
      text: content,
      clipped: false,
      originalLength: content.length,
      keptLength: content.length,
      omittedLength: 0,
    });
  });

  it('超限时保留头尾、丢弃中段，并写入显式标记', () => {
    const content = 'A'.repeat(5_000) + 'B'.repeat(50_000) + 'C'.repeat(5_000);
    const result = clipMagicTeaPartyMessageContent(content, 8_000);

    expect(result.clipped).toBe(true);
    expect(result.originalLength).toBe(60_000);
    // budget = 8000 - 48(marker) = 7952；head=5566 / tail=2386
    expect(result.omittedLength).toBe(52_048);
    expect(result.text.startsWith('A')).toBe(true);
    expect(result.text.endsWith('C')).toBe(true);
    expect(result.text).toContain('本条消息过长，已省略中段 52048 字');
    // 中段整块 B 已被丢弃（头部只保留到第 5566 字，故仍含少量 B）
    expect(result.text).not.toContain('B'.repeat(1_000));
  });

  it('截断后的长度不超过预算（标记开销已预留）', () => {
    const content = 'x'.repeat(50_000);
    for (const limit of [8_000, 16_000, 48_000]) {
      const result = clipMagicTeaPartyMessageContent(content, limit);
      expect(result.text.length).toBeLessThanOrEqual(limit);
      expect(result.keptLength).toBe(result.text.length);
    }
  });

  it('小预算下也不会 panic（标记预留后仍为正）', () => {
    const result = clipMagicTeaPartyMessageContent('y'.repeat(200), 10);
    expect(result.clipped).toBe(true);
    expect(result.text.length).toBeGreaterThan(0);
    expect(result.text).toContain('已省略中段');
  });

  it('非字符串输入按空串处理', () => {
    const result = clipMagicTeaPartyMessageContent(undefined as unknown as string, 8_000);
    expect(result.text).toBe('');
    expect(result.clipped).toBe(false);
  });

  it('非法 limit 回落到最小档而不是 0', () => {
    const result = clipMagicTeaPartyMessageContent('z'.repeat(20_000), 0);
    expect(result.clipped).toBe(true);
    expect(result.text.length).toBeLessThanOrEqual(MAGIC_TEA_PARTY_MIN_MESSAGE_CHARS);
  });
});

describe('applyMagicTeaPartyMessageLimits', () => {
  const build = (lengths: number[]) =>
    lengths.map((len, index) => ({
      id: `m${index}`,
      role: 'assistant' as const,
      content: 'q'.repeat(len),
    }));

  it('不删除也不重排消息，只裁剪内容', () => {
    const input = build([1_000, 20_000, 2_000]);
    const result = applyMagicTeaPartyMessageLimits(input, 8_000);

    expect(result.messages).toHaveLength(3);
    expect(result.messages.map((m) => m.id)).toEqual(['m0', 'm1', 'm2']);
    expect(result.messages[0].content).toBe(input[0].content);
    expect(result.messages[2].content).toBe(input[2].content);
    expect(result.messages[1].content).not.toBe(input[1].content);
  });

  it('统计 totalChars 用原始长度（用于总量守卫），而不是截断后的长度', () => {
    const input = build([1_000, 20_000, 2_000]);
    const result = applyMagicTeaPartyMessageLimits(input, 8_000);
    expect(result.totalChars).toBe(23_000);
    expect(result.totalOmittedChars).toBeGreaterThan(0);
  });

  it('记录被截断消息的 id / index / 长度', () => {
    const result = applyMagicTeaPartyMessageLimits(build([10_000, 20_000]), 8_000);
    expect(result.clippedMessages).toHaveLength(2);
    expect(result.clippedMessages[0]).toMatchObject({ id: 'm0', index: 0, originalLength: 10_000, limit: 8_000 });
    expect(result.clippedMessages[1]).toMatchObject({ id: 'm1', index: 1, originalLength: 20_000, limit: 8_000 });
  });

  it('全部未超限时 clippedMessages 为空', () => {
    const result = applyMagicTeaPartyMessageLimits(build([10, 20, 30]), 8_000);
    expect(result.clippedMessages).toEqual([]);
    expect(result.totalOmittedChars).toBe(0);
    expect(result.totalChars).toBe(60);
  });

  it('空数组与非法输入安全返回', () => {
    expect(applyMagicTeaPartyMessageLimits([], 8_000).messages).toEqual([]);
    expect(applyMagicTeaPartyMessageLimits(null as never, 8_000).messages).toEqual([]);
  });

  it('不修改入参对象', () => {
    const input = build([20_000]);
    const snapshot = input[0].content;
    applyMagicTeaPartyMessageLimits(input, 8_000);
    expect(input[0].content).toBe(snapshot);
  });
});

describe('total overflow guard', () => {
  it('刚好等于上限不视为超限', () => {
    expect(isMagicTeaPartyTotalOverflow(MAGIC_TEA_PARTY_MAX_TOTAL_CHARS)).toBe(false);
  });

  it('超过上限即视为超限', () => {
    expect(isMagicTeaPartyTotalOverflow(MAGIC_TEA_PARTY_MAX_TOTAL_CHARS + 1)).toBe(true);
  });

  it('提示文案同时给出实际值与上限，便于用户自查', () => {
    const message = formatMagicTeaPartyTotalOverflowMessage(900_000);
    expect(message).toContain('900000');
    expect(message).toContain(String(MAGIC_TEA_PARTY_MAX_TOTAL_CHARS));
    // 必须命中 error-help 的上下文超限提示词，否则会退回数据卡百科
    expect(message).toContain('超过单次请求');
  });
});
