import { describe, expect, it } from 'bun:test';

import { applyShieldWords } from '@/lib/shield-word-filter';

describe('shield-word-filter', () => {
  it('replaces configured word with replacement text', () => {
    const result = applyShieldWords('我来自中国。');
    expect(result.hasShieldWords).toBe(true);
    expect(result.filteredText).toBe('我来自【国度】。');
  });

  it('masks default shield words with asterisks', () => {
    const result = applyShieldWords('八九是个数字。');
    expect(result.hasShieldWords).toBe(true);
    expect(result.filteredText).toBe('**是个数字。');
  });

  it('matches case-insensitively for latin words', () => {
    const result = applyShieldWords('JEW / Jew / jew');
    expect(result.hasShieldWords).toBe(true);
    expect(result.filteredText).toBe('*** / *** / ***');
  });

  it('keeps text unchanged when no shield words appear', () => {
    const text = '这是一段安全的文本。';
    const result = applyShieldWords(text);
    expect(result.hasShieldWords).toBe(false);
    expect(result.filteredText).toBe(text);
  });
});

