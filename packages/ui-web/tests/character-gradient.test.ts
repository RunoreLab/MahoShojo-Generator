import { expect, it } from 'vitest';
import { resolveMagicalGirlGradient } from '../src/character-card/gradient';

it('preserves the mature Web color match and canonical domain values', () => {
  expect(resolveMagicalGirlGradient('蓝色与粉色搭配')).toBe('linear-gradient(135deg, #5c7cfa 0%, #748ffc 100%)');
});
it('preserves catalog precedence rather than first occurrence in prose', () => {
  expect(resolveMagicalGirlGradient('蓝色背景，红色边缘')).toBe('linear-gradient(135deg, #ff6b6b 0%, #ee5a6f 100%)');
});
it('uses the existing pink fallback without rewriting malformed source data', () => {
  const data = { unexpected: true };
  for (const value of [undefined, '', '银白色', data]) {
    expect(resolveMagicalGirlGradient(value)).toBe('linear-gradient(135deg, #ff9a9e 0%, #fecfef 100%)');
  }
  expect(data).toEqual({ unexpected: true });
});
