import { describe, expect, test } from 'bun:test';

import { createMessagesServiceForTests } from '@/lib/messages/service';

const now = '2026-04-08T12:00:00.000Z';

const buildMessagesService = (
  overrides: Parameters<typeof createMessagesServiceForTests>[0] = {},
) =>
  createMessagesServiceForTests({
    now: () => now,
    repo: {
      getUserMessageState: async () => ({
        userId: 7,
        lastReadSiteMessageId: 0,
        lastSummaryReadAt: null,
      }),
      countUnreadSiteMessages: async () => 0,
      countUnreadUserMessages: async () => 0,
      listSiteMessages: async () => [],
      listUserMessages: async () => [],
      markUserMessagesRead: async () => 0,
      markAllUnreadUserMessagesRead: async () => 0,
      advanceSiteMessageCursor: async () => 0,
      getMaxVisibleSiteMessageId: async () => 0,
      createSiteMessage: async () => null,
      createUserMessage: async () => null,
      updateSiteMessageExpiry: async () => true,
      expireSiteMessageNow: async () => true,
      ...(overrides.repo ?? {}),
    },
    ...overrides,
  });

describe('messages service', () => {
  test('summary degrades crowd review prompt when crowd review service is unavailable', async () => {
    const service = buildMessagesService({
      getCrowdReviewPromptSummary: async () => {
        const error = new Error('众查服务当前不可用');
        error.name = 'CrowdReviewServiceUnavailableError';
        throw error;
      },
    });

    const summary = await service.getSummary({ userId: 7 });

    expect(summary.hasCrowdReviewPending).toBe(false);
    expect(summary.crowdReviewPrompt).toBeNull();
  });

  test('summary degrades crowd review prompt when optional summary lookup throws unexpected runtime error', async () => {
    const service = buildMessagesService({
      getCrowdReviewPromptSummary: async () => {
        throw new Error('crowd review tables mismatch');
      },
    });

    const summary = await service.getSummary({ userId: 7 });

    expect(summary.unreadTotal).toBe(0);
    expect(summary.hasCrowdReviewPending).toBe(false);
    expect(summary.crowdReviewPrompt).toBeNull();
  });
});
