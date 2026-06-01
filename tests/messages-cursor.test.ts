import { describe, expect, test } from 'vitest';

import { compareMessageSortKeys, decodeMessageCursor, encodeMessageCursor } from '@/lib/messages/cursor';

describe('message cursor', () => {
  test('round trips canonical cursor', () => {
    const cursor = encodeMessageCursor({ createdAt: '2026-04-07T01:00:00.000Z', scope: 'user', numericId: 9 });
    expect(decodeMessageCursor(cursor)).toEqual({
      createdAt: '2026-04-07T01:00:00.000Z',
      scope: 'user',
      numericId: 9,
    });
  });

  test('orders by createdAt desc, user before site, numericId desc', () => {
    const ordered = [
      { createdAt: '2026-04-07T02:00:00.000Z', scope: 'site' as const, numericId: 1 },
      { createdAt: '2026-04-07T01:00:00.000Z', scope: 'user' as const, numericId: 2 },
      { createdAt: '2026-04-07T01:00:00.000Z', scope: 'site' as const, numericId: 9 },
    ].sort(compareMessageSortKeys);

    expect(ordered.map((x) => `${x.scope}:${x.numericId}`)).toEqual(['site:1', 'user:2', 'site:9']);
  });
});
