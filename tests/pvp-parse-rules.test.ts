import { describe, expect, test } from 'bun:test';

import { DEFAULT_PVP_RULES } from '@/lib/pvp/defaults';
import { parsePvpRules } from '@/lib/pvp/validate';

describe('pvp: parsePvpRules', () => {
  test('默认值包含 showAllSubmissions/shuffleDecks', () => {
    const parsed = parsePvpRules({});
    expect('error' in parsed).toBe(false);
    if ('error' in parsed) return;

    expect(parsed.rules.showAllSubmissions).toBe(true);
    expect(parsed.rules.shuffleDecks).toBe(true);
  });

  test('可显式关闭 showAllSubmissions/shuffleDecks', () => {
    const parsed = parsePvpRules({ showAllSubmissions: false, shuffleDecks: false });
    expect('error' in parsed).toBe(false);
    if ('error' in parsed) return;

    expect(parsed.rules.showAllSubmissions).toBe(false);
    expect(parsed.rules.shuffleDecks).toBe(false);
  });

  test('非布尔值回退到默认', () => {
    const parsed = parsePvpRules({ showAllSubmissions: 1, shuffleDecks: 'nope' });
    expect('error' in parsed).toBe(false);
    if ('error' in parsed) return;

    expect(parsed.rules.showAllSubmissions).toBe(DEFAULT_PVP_RULES.showAllSubmissions);
    expect(parsed.rules.shuffleDecks).toBe(DEFAULT_PVP_RULES.shuffleDecks);
  });
});

