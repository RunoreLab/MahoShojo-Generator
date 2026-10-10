import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { digestBattleStoryCommitValue } from '@mahoshojo/domain/arena-story-commit';

const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${Array.from(value, (item) => canonical(item === undefined ? null : item)).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort().filter((key) => (value as Record<string, unknown>)[key] !== undefined).map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
  return JSON.stringify(value);
};
describe('streaming story digest against independent Node crypto', () => {
  it('streaming canonical JSON digest matches node crypto, independent of token/string chunks', () => {
    const values = [null, { z: '最后', '10': 10, '2': 2, a: [undefined, null, -0, 1e-6, '控制\u0000\n"\\\ud800\udc00\ud800😀中文'], omitted: undefined },
      { long: '😀\u0000\ud800x中文'.repeat(2_500), nested: { x: true } }];
    for (const value of values) {
      const expected = `sha256:${createHash('sha256').update(canonical(value)).digest('hex')}`;
      for (const size of [2, 3, 127, 8_192]) expect(digestBattleStoryCommitValue(value, size)).toBe(expected);
    }
  });
});
