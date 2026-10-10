import { describe, expect, it } from 'vitest';
import * as web from '@/lib/story-length';
import * as domain from '@mahoshojo/domain/story-length';
describe('story length pure extraction golden', () => {
  it.each([
    [undefined, ''], [null, ''], [0, ''], [-1, ''], [1.5, ''], [Infinity, ''], [NaN, ''], [1200, '1200'],
    ['', ''], [' ', ''], ['000', ''], [' 001200 ', '1200'], ['1.5', ''], ['-2', ''], ['1e3', ''], ['１２', ''],
  ])('normalizes %s without changing legacy defaults', (input, output) => {
    expect(web.normalizeCustomStoryLength(input)).toBe(output);
    expect(web.hasCustomStoryLength(input)).toBe(Boolean(output));
  });
  it('reuses the pure domain implementation and preserves formatting defaults', () => {
    expect(web.normalizeCustomStoryLength).toBe(domain.normalizeCustomStoryLength);
    expect(web.formatStoryLengthSummaryLabel(undefined, '')).toBe('default');
    expect(web.formatStoryLengthSummaryLabel('  ', '12')).toBe('自定义 12 字（预设：default）');
    expect(web.formatStoryLengthSummaryLabel(' long ', '00042')).toBe('自定义 42 字（预设：long）');
    expect(web.formatStoryLengthSummaryLabel(' detailed ', -1)).toBe('detailed');
  });
});
