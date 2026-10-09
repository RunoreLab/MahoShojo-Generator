import { describe, expect, it } from 'vitest';
import { decodeBase64ToBytes, encodeBytesToBase64 } from '../src/tavern-card/base64';
import { getPlaceholderPngBytes, MAX_TAVERN_TEXT_BYTES, readTavernLocalDocument, writeTavernCardToPngBytes } from '../src/tavern-card';

describe('large Tavern base64 validation', () => {
  it('roundtrips maximum-size JSON through both PNG text chunks without regexp stack overflow', () => {
    const empty = { name: 'boundary', description: '' };
    const overhead = new TextEncoder().encode(JSON.stringify(empty)).length;
    const raw = { ...empty, description: 'a'.repeat(MAX_TAVERN_TEXT_BYTES - overhead) };
    const bytes = new TextEncoder().encode(JSON.stringify(raw));
    expect(bytes.length).toBe(MAX_TAVERN_TEXT_BYTES);
    expect(new TextDecoder().decode(decodeBase64ToBytes(encodeBytesToBase64(bytes)))).toBe(JSON.stringify(raw));
    const png = writeTavernCardToPngBytes(getPlaceholderPngBytes(), raw);
    expect(readTavernLocalDocument(png, 'png').candidates[0].parsed).toEqual(raw);
    const oversized = { ...raw, description: `${raw.description}a` };
    expect(() => readTavernLocalDocument(new TextEncoder().encode(JSON.stringify(oversized)), 'json')).toThrow('4 MiB');
    expect(() => readTavernLocalDocument(writeTavernCardToPngBytes(getPlaceholderPngBytes(), oversized), 'png')).toThrow();
  });
  it.each(['ĀAAA', '=AAA', 'AA=A', 'AA==AAAA', '!!!!', 'AAAA===', 'A==='])('rejects malformed encoding %s', (value) => {
    expect(() => decodeBase64ToBytes(value)).toThrow();
  });
  it('rejects a malformed suffix after a long legal prefix and supports legal padding', () => {
    expect(() => decodeBase64ToBytes(`${'AAAA'.repeat(1_400_000)}AA=A`)).toThrow();
    expect([...decodeBase64ToBytes('YQ==')]).toEqual([97]);
    expect([...decodeBase64ToBytes('YWI=')]).toEqual([97, 98]);
    expect([...decodeBase64ToBytes('YWJj')]).toEqual([97, 98, 99]);
  });
});
