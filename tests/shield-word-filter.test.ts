import { describe, expect, it } from 'vitest';

import { applyShieldWords } from '@/lib/shield-word-filter';

describe('shield-word-filter', () => {
  const decodeBase64Utf8 = (input: string): string => {
    if (typeof atob === 'function') {
      const binaryString = atob(input);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      return new TextDecoder('utf-8').decode(bytes);
    }
    return Buffer.from(input, 'base64').toString('utf8');
  };

  it('replaces configured word with replacement text', () => {
    const result = applyShieldWords('我来自中国。');
    expect(result.hasShieldWords).toBe(true);
    expect(result.filteredText).toBe('我来自【国度】。');
  });

  it('replaces traditional variant with replacement text', () => {
    const result = applyShieldWords('我来自中國。');
    expect(result.hasShieldWords).toBe(true);
    expect(result.filteredText).toBe('我来自【国度】。');
  });

  it('masks default shield words with a non-markdown-safe symbol', () => {
    const word = decodeBase64Utf8('5Y+R5oOF'); // 发情
    const result = applyShieldWords(`abc${word}def`);
    expect(result.hasShieldWords).toBe(true);
    expect(result.filteredText).toBe('abc❀❀def');
  });

  it('keeps text unchanged when no shield words appear', () => {
    const text = '这是一段安全的文本。';
    const result = applyShieldWords(text);
    expect(result.hasShieldWords).toBe(false);
    expect(result.filteredText).toBe(text);
  });
});
