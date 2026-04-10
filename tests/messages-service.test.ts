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

  test('summary returns crowd review prompt when crowd review has pending work', async () => {
    const service = buildMessagesService({
      getCrowdReviewPromptSummary: async () => ({
        hasCrowdReviewPending: true,
        crowdReviewPrompt: {
          title: '调查院有新的可处理案件',
          body: '你有新的众查案件待处理，前往调查院查看',
          actionUrl: '/investigation',
        },
      }),
    });

    const summary = await service.getSummary({ userId: 7 });

    expect(summary.hasCrowdReviewPending).toBe(true);
    expect(summary.crowdReviewPrompt).toEqual({
      title: '调查院有新的可处理案件',
      body: '你有新的众查案件待处理，前往调查院查看',
      actionUrl: '/investigation',
    });
  });

  test('summary rethrows unexpected runtime error from optional crowd review lookup', async () => {
    const service = buildMessagesService({
      getCrowdReviewPromptSummary: async () => {
        throw new Error('crowd review tables mismatch');
      },
    });

    await expect(service.getSummary({ userId: 7 })).rejects.toThrow('crowd review tables mismatch');
  });
});
