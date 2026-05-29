import { beforeEach, describe, expect, test } from 'vitest';

import {
  clearTopBarMessagesMemoryCacheForTests,
  getTopBarMessagesStateSnapshot,
  resolveTopBarMessagesStateForRender,
  setTopBarMessagesMemoryCacheForTests,
} from '@/components/navigation/useTopBarMessages';

describe('topbar messages snapshot', () => {
  beforeEach(() => {
    clearTopBarMessagesMemoryCacheForTests();
  });

  test('user switch without cache resets unreadTotal immediately', () => {
    setTopBarMessagesMemoryCacheForTests(7, {
      unreadTotal: 12,
      hasCrowdReviewPending: false,
      fetchedAt: Date.now(),
    });

    expect(getTopBarMessagesStateSnapshot(7, true).unreadTotal).toBe(12);
    expect(getTopBarMessagesStateSnapshot(8, true)).toMatchObject({
      unreadTotal: 0,
      loading: true,
      error: null,
    });
  });

  test('stale hook state does not leak unread count across user switch render', () => {
    setTopBarMessagesMemoryCacheForTests(7, {
      unreadTotal: 12,
      hasCrowdReviewPending: false,
      fetchedAt: Date.now(),
    });

    expect(
      resolveTopBarMessagesStateForRender(
        {
          ownerUserId: 7,
          enabled: true,
          unreadTotal: 12,
          hasCrowdReviewPending: false,
          loading: false,
          error: null,
        },
        8,
        true,
      ),
    ).toMatchObject({
      ownerUserId: 8,
      enabled: true,
      unreadTotal: 0,
      hasCrowdReviewPending: false,
      loading: true,
      error: null,
    });
  });

  test('returns hasCrowdReviewPending from messages summary cache and refresh', () => {
    setTopBarMessagesMemoryCacheForTests(7, {
      unreadTotal: 0,
      hasCrowdReviewPending: true,
      fetchedAt: Date.now(),
    });

    expect(getTopBarMessagesStateSnapshot(7, true)).toMatchObject({
      unreadTotal: 0,
      hasCrowdReviewPending: true,
      loading: false,
    });
  });
});
