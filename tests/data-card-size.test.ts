import { describe, expect, it } from 'bun:test';
import { getUtf8ByteLength, MAX_DATA_CARD_BYTES } from '@/lib/data-card-size';

describe('data-card-size', () => {
  it('MAX_DATA_CARD_BYTES is 300KB', () => {
    expect(MAX_DATA_CARD_BYTES).toBe(300 * 1024);
  });

  it('getUtf8ByteLength counts UTF-8 bytes', () => {
    expect(getUtf8ByteLength('a')).toBe(1);
    expect(getUtf8ByteLength('中')).toBe(3);
    expect(getUtf8ByteLength('😀')).toBe(4);
  });

  it('can build json strings around the max limit deterministically', () => {
    const maxBytes = MAX_DATA_CARD_BYTES;

    const jsonBytes = (n: number) => getUtf8ByteLength(JSON.stringify({ content: 'a'.repeat(n) }));

    // 二分找到在 maxBytes 内的最大 n
    let low = 0;
    let high = maxBytes;
    while (low < high) {
      const mid = Math.ceil((low + high + 1) / 2);
      if (jsonBytes(mid) <= maxBytes) low = mid;
      else high = mid - 1;
    }

    const within = JSON.stringify({ content: 'a'.repeat(low) });
    expect(getUtf8ByteLength(within)).toBeLessThanOrEqual(maxBytes);

    const overshoot = JSON.stringify({ content: 'a'.repeat(low + 1) });
    expect(getUtf8ByteLength(overshoot)).toBeGreaterThan(maxBytes);
  });
});

