import { describe, expect, it } from 'bun:test';

import { normalizeWinnerFromCandidates } from '@/lib/pvp/logic';

describe('normalizeWinnerFromCandidates', () => {
  it('识别平局', () => {
    expect(normalizeWinnerFromCandidates('平局', ['P1', 'P2'])).toEqual({ kind: 'draw' });
    expect(normalizeWinnerFromCandidates('draw', ['P1', 'P2'])).toEqual({ kind: 'draw' });
  });

  it('支持精确匹配（含引号）', () => {
    expect(normalizeWinnerFromCandidates('“P2”', ['P1', 'P2'])).toEqual({ kind: 'index', index: 1 });
    expect(normalizeWinnerFromCandidates("'P1'", ['P1', 'P2'])).toEqual({ kind: 'index', index: 0 });
  });

  it('支持包含式匹配（用于容错）', () => {
    expect(normalizeWinnerFromCandidates('胜者：P1', ['P1', 'P2'])).toEqual({ kind: 'index', index: 0 });
  });

  it('多匹配视为无效', () => {
    const result = normalizeWinnerFromCandidates('P1 和 P2', ['P1', 'P2']);
    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') {
      expect(result.matchedIndexes.sort()).toEqual([0, 1]);
    }
  });

  it('空/缺失视为无效', () => {
    expect(normalizeWinnerFromCandidates('', ['P1', 'P2']).kind).toBe('invalid');
    expect(normalizeWinnerFromCandidates(null, ['P1', 'P2']).kind).toBe('invalid');
  });
});

