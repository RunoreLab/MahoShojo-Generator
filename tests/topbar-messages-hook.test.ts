import { beforeEach, describe, expect, test } from 'bun:test';

import {
  clearTopBarMessagesMemoryCacheForTests,
  getTopBarMessagesStateSnapshot,
  setTopBarMessagesMemoryCacheForTests,
} from '@/components/navigation/useTopBarMessages';

describe('topbar messages snapshot', () => {
  beforeEach(() => {
    clearTopBarMessagesMemoryCacheForTests();
  });

  test('user switch without cache resets unreadTotal immediately', () => {
    setTopBarMessagesMemoryCacheForTests(7, {
      unreadTotal: 12,
      fetchedAt: Date.now(),
    });

    expect(getTopBarMessagesStateSnapshot(7, true).unreadTotal).toBe(12);
    expect(getTopBarMessagesStateSnapshot(8, true)).toMatchObject({
      unreadTotal: 0,
      loading: true,
      error: null,
    });
  });
});
