import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  BATTLE_STORY_JSON_MAX_CHUNK_BYTES,
  BattleStoryCommitByteLimitError,
  chunkBattleStoryCommitJson,
  countBattleStoryCommitJsonBytes,
  createBattleStoryByteDigest,
  digestBattleStoryCommitValue,
  iterateBattleStoryCommitJsonUtf8,
  prepareBattleStoryCommitJson,
} from '@mahoshojo/domain/arena-story-commit';

const decoded = (chunks: Iterable<Uint8Array>): string => {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let text = '';
  for (const chunk of chunks) text += decoder.decode(chunk, { stream: true });
  return text + decoder.decode();
};
const sha256 = (text: string) => `sha256:${createHash('sha256').update(text).digest('hex')}`;

describe('shared canonical story JSON traversal', () => {
  it('keeps UTF-16 key ordering and exact JSON escaping, holes, undefined and repeated references', () => {
    const shared = { text: '中😀\ud800x\udc00\u0000\b\t\n\f\r\\"\u001f' };
    const value = {
      '\ue000': 1, '😀': 2, '2': 3, '10': 4,
      z: undefined, a: [undefined, , shared, shared, -0, 1e30],
    };
    const text = decoded(iterateBattleStoryCommitJsonUtf8(value, 2));
    const expected = '{"10":4,"2":3,"a":[null,null,' + JSON.stringify(shared) + ','
      + JSON.stringify(shared) + ',0,1e+30],"😀":2,"\ue000":1}';
    expect(text).toBe(expected);
    expect(digestBattleStoryCommitValue(value, 2)).toBe(sha256(expected));
    expect(countBattleStoryCommitJsonBytes(value)).toBe(Buffer.byteLength(JSON.stringify(value)));
    expect(JSON.parse(text)).toEqual(JSON.parse(JSON.stringify(value)));
  });

  it.each([null, true, false, '', '😀', '\ud800', '\udc00', '\ud800\ud800\udc00', '\u0000', 0, -0, 1e-7, []])(
    'matches JSON.stringify bytes for %j', (value) => {
      const expected = JSON.stringify(value);
      expect(decoded(iterateBattleStoryCommitJsonUtf8(value, 2))).toBe(expected);
      expect(countBattleStoryCommitJsonBytes(value)).toBe(Buffer.byteLength(expected));
      expect(decoded(chunkBattleStoryCommitJson(value, 1))).toBe(expected);
    },
  );

  it('rejects non-JSON values, cycles and changing accessors without invoking them', () => {
    const cycle: unknown[] = []; cycle.push(cycle);
    const hiddenSerializer = Object.defineProperty({}, 'toJSON', { value: () => 'other' });
    class NonJsonArray extends Array<unknown> {}
    for (const value of [undefined, NaN, Infinity, 1n, new Date(), { fn: () => {} }, [Symbol('bad')], hiddenSerializer, new NonJsonArray(), cycle]) {
      expect(() => countBattleStoryCommitJsonBytes(value)).toThrow();
    }
    const getter = vi.fn(() => 'different each time');
    const value = Object.defineProperty({}, 'text', { enumerable: true, get: getter });
    expect(() => prepareBattleStoryCommitJson(value, 1024)).toThrow('访问器');
    expect(getter).not.toHaveBeenCalled();
  });

  it('admits the exact byte boundary and rejects +1 early without visiting the rest', () => {
    const value = { text: '\u0000中😀'.repeat(4000) };
    const byteLength = Buffer.byteLength(JSON.stringify(value));
    expect(countBattleStoryCommitJsonBytes(value, byteLength)).toBe(byteLength);
    expect(() => countBattleStoryCommitJsonBytes(value, byteLength - 1)).toThrow(BattleStoryCommitByteLimitError);
    // Reaching z would be a non-JSON error; a tiny budget must stop before then.
    expect(() => countBattleStoryCommitJsonBytes({ a: 'x'.repeat(100_000), z: NaN }, 10))
      .toThrow(BattleStoryCommitByteLimitError);
    for (const limit of [-1, 0.5, NaN, Infinity]) {
      expect(() => countBattleStoryCommitJsonBytes(null, limit)).toThrow(RangeError);
    }
  });

  it('hashes, counts and emits bounded frames without whole-record or large-string stringify', () => {
    const value = { text: '\u0000'.repeat(900_000) + '😀', other: ['保留', 3] };
    const expectedBytes = countBattleStoryCommitJsonBytes(value);
    const expectedDigest = digestBattleStoryCommitValue(value);
    const stringify = JSON.stringify;
    const spy = vi.spyOn(JSON, 'stringify').mockImplementation(((value: unknown) => {
      if (typeof value === 'object' || (typeof value === 'string' && value.length > 8_192)) {
        throw new Error('unbounded serialization');
      }
      return stringify(value);
    }) as typeof JSON.stringify);
    try {
      const prepared = prepareBattleStoryCommitJson(value, expectedBytes);
      expect(prepared.byteLength).toBe(expectedBytes);
      expect(prepared.contentDigest).toBe(expectedDigest);
      const hash = createHash('sha256');
      let total = 0;
      let frames = 0;
      for (const frame of prepared.chunks()) {
        expect(frame.byteLength).toBeGreaterThan(0);
        expect(frame.byteLength).toBeLessThanOrEqual(BATTLE_STORY_JSON_MAX_CHUNK_BYTES);
        hash.update(frame); total += frame.byteLength; frames += 1;
      }
      expect(frames).toBe(2);
      expect(total).toBe(prepared.byteLength);
      expect(`sha256:${hash.digest('hex')}`).toBe(prepared.contentDigest);
    } finally { spy.mockRestore(); }
  });

  it('binds count and every retry to the same frozen graph; materialization is optional and isolated', () => {
    const value = { data: { text: '原文😀', extension: { retained: true } } };
    const prepared = prepareBattleStoryCommitJson(value, 1024);
    expect(prepared.value).toBe(value);
    expect(Object.isFrozen(value.data.extension)).toBe(true);
    expect(() => { value.data.text = '改过'; }).toThrow();
    expect(decoded(prepared.chunks(3))).toBe(decoded(prepared.chunks(7)));
    const copy = prepared.materialize();
    expect(copy).toEqual(value);
    expect(copy.data.extension).not.toBe(value.data.extension);
    copy.data.text = '副本';
    expect(value.data.text).toBe('原文😀');
    for (const size of [0, -1, 0.5, NaN, BATTLE_STORY_JSON_MAX_CHUNK_BYTES + 1]) {
      expect(() => [...prepared.chunks(size)]).toThrow(RangeError);
    }
  });
  it('hashes exact raw bytes incrementally and refuses updates after finalization', () => {
    const bytes = new Uint8Array([0xff, 0, 0x80, 0xf0, 0x9f, 0x98, 0x80]);
    const digest = createBattleStoryByteDigest();
    digest.update(bytes.subarray(0, 2));
    digest.update(bytes.subarray(2, 5));
    digest.update(bytes.subarray(5));
    const expected = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
    expect(digest.digest()).toBe(expected);
    expect(digest.digest()).toBe(expected);
    expect(() => digest.update(new Uint8Array())).toThrow('摘要已结束');
    expect(createBattleStoryByteDigest().digest()).toBe(sha256(''));
  });

});
