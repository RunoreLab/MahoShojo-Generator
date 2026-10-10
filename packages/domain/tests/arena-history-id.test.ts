import { describe, expect, it } from 'vitest';
import { getNextArenaHistoryEntryId } from '../src/arena-history-id';
import { ArenaHistoryEntrySchema } from '../src/data-card-schemas';

describe('new Arena history IDs without rewriting legacy records', () => {
  it.each([
    { ids: [], next: 1 },
    { ids: [undefined, '', 'legacy-id'], next: 1 },
    { ids: [3, 1, 3, 2], next: 4 },
    { ids: [4.8, 2], next: 5 },
    { ids: [1, '2', '3'], next: 4 },
    { ids: ['100', '01', '1e0', ' 1 ', '+1', '1.0'], next: 1 },
    { ids: [Number.MAX_SAFE_INTEGER - 1], next: Number.MAX_SAFE_INTEGER },
    { ids: [Number.MAX_SAFE_INTEGER - 1, String(Number.MAX_SAFE_INTEGER), 1], next: 2 },
    { ids: [Number.MAX_SAFE_INTEGER, '1', 2, 2, '3'], next: 4 },
    { ids: [Number.MAX_SAFE_INTEGER + 1, 1, '2'], next: 3 },
    { ids: [Number.MAX_VALUE, 1, '2'], next: 3 },
    { ids: [-7, 0, Number.NaN, Number.POSITIVE_INFINITY], next: 1 },
  ])('allocates $next from $ids independently of order', ({ ids, next }) => {
    const entries = ids.map((id) => Object.freeze({ id, extra: 'untouched' }));
    expect(getNextArenaHistoryEntryId(Object.freeze(entries))).toBe(next);
    expect(getNextArenaHistoryEntryId([...entries].reverse())).toBe(next);
    expect(Number.isSafeInteger(next)).toBe(true);
    expect(next).toBeGreaterThan(0);
    expect(ids.map(String)).not.toContain(String(next));
    expect(ArenaHistoryEntrySchema.safeParse({ id: next }).success).toBe(true);
    const following = getNextArenaHistoryEntryId([...entries, { id: next }]);
    expect(Number.isSafeInteger(following)).toBe(true);
    expect(following).not.toBe(next);
  });

  it('ignores opaque entries and a dynamically generated 9 MiB legacy ID without copying it into the new ID', () => {
    const id = 'x'.repeat(9 * 1024 * 1024);
    const entries = [null, false, 'opaque', [], { id }, { title: 'unnumbered' }];
    expect(getNextArenaHistoryEntryId(entries)).toBe(1);
    expect(entries[4]).toEqual({ id });
    // Read compatibility never broadens the canonical write schema.
    expect(ArenaHistoryEntrySchema.safeParse({ id: '1' }).success).toBe(false);
  });
});
