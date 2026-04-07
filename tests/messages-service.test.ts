import { describe, expect, test } from 'bun:test';

import { createMessagesServiceForTests } from '@/lib/messages/service';

describe('messages service', () => {
  test('summary returns latest unread across direct and site messages', async () => {
    const service = createMessagesServiceForTests({
      now: () => '2026-04-07T10:00:00.000Z',
      repo: {
        getUserMessageState: async () => ({ userId: 7, lastReadSiteMessageId: 2, lastSummaryReadAt: null }),
        countUnreadSiteMessages: async () => 1,
        countUnreadUserMessages: async () => 1,
        listSiteMessages: async () => [
          {
            id: 3,
            messageType: 'issue',
            templateKey: 'site.issue.update',
            payloadJson: '{"issueTitle":"PVP","statusText":"已修复"}',
            titleText: null,
            bodyText: null,
            actionUrl: null,
            priority: 'normal',
            expiresAt: null,
            createdAt: '2026-04-07T09:00:00.000Z',
          },
        ],
        listUserMessages: async () => [
          {
            id: 10,
            recipientUserId: 7,
            messageType: 'moderation',
            templateKey: 'user.moderation.data_card_rejected',
            payloadJson: '{"dataCardName":"雪沫","reason":"简介违规"}',
            titleText: null,
            bodyText: null,
            actionUrl: '/character-manager',
            priority: 'high',
            readAt: null,
            archivedAt: null,
            expiresAt: null,
            createdAt: '2026-04-07T09:30:00.000Z',
          },
        ],
      },
    });

    const summary = await service.getSummary({ userId: 7 });

    expect(summary.unreadTotal).toBe(2);
    expect(summary.siteUnread).toBe(1);
    expect(summary.directUnread).toBe(1);
    expect(summary.latest?.id).toBe('user:10');
  });

  test('read all marks direct messages and advances site cursor', async () => {
    const calls: string[] = [];
    const service = createMessagesServiceForTests({
      now: () => '2026-04-07T10:00:00.000Z',
      repo: {
        markAllUnreadUserMessagesRead: async () => {
          calls.push('direct');
          return 2;
        },
        getMaxVisibleSiteMessageId: async () => 8,
        advanceSiteMessageCursor: async () => {
          calls.push('site');
          return 8;
        },
      },
    });

    const result = await service.markAllRead({ userId: 7 });

    expect(result).toEqual({ markedUserMessageCount: 2, advancedSiteCursorTo: 8 });
    expect(calls).toEqual(['direct', 'site']);
  });

  test('site read clamps requested cursor to the latest visible site message id', async () => {
    const requestedIds: number[] = [];
    const service = createMessagesServiceForTests({
      now: () => '2026-04-07T10:00:00.000Z',
      repo: {
        getMaxVisibleSiteMessageId: async () => 8,
        advanceSiteMessageCursor: async (input) => {
          requestedIds.push(input.lastReadSiteMessageId);
          return input.lastReadSiteMessageId;
        },
      },
    });

    const result = await service.markSiteMessagesRead({ userId: 7, lastReadSiteMessageId: 999999 });

    expect(requestedIds).toEqual([8]);
    expect(result).toEqual({ advancedSiteCursorTo: 8 });
  });

  test('unread filter returns only unread site and user messages', async () => {
    const service = createMessagesServiceForTests({
      now: () => '2026-04-07T10:00:00.000Z',
      repo: {
        getUserMessageState: async () => ({ userId: 7, lastReadSiteMessageId: 2, lastSummaryReadAt: null }),
        listSiteMessages: async () => [
          {
            id: 3,
            messageType: 'issue',
            templateKey: 'site.issue.update',
            payloadJson: '{"issueTitle":"PVP","statusText":"已修复"}',
            titleText: null,
            bodyText: null,
            actionUrl: null,
            priority: 'normal',
            expiresAt: null,
            createdAt: '2026-04-07T09:00:00.000Z',
          },
        ],
        listUserMessages: async () => [
          {
            id: 10,
            recipientUserId: 7,
            messageType: 'moderation',
            templateKey: 'user.moderation.data_card_rejected',
            payloadJson: '{"dataCardName":"雪沫","reason":"简介违规"}',
            titleText: null,
            bodyText: null,
            actionUrl: null,
            priority: 'high',
            readAt: null,
            archivedAt: null,
            expiresAt: null,
            createdAt: '2026-04-07T09:30:00.000Z',
          },
        ],
      },
    });

    const list = await service.listMessages({ userId: 7, filter: 'unread', limit: 20, cursor: null });

    expect(list.messages).toHaveLength(2);
    expect(list.messages.every((message) => message.isRead === false)).toBe(true);
  });

  test('markMessagesRead counts inaccessible or missing user messages as ignored', async () => {
    const service = createMessagesServiceForTests({
      now: () => '2026-04-07T10:00:00.000Z',
      repo: {
        markUserMessagesRead: async () => 1,
      },
    });

    const result = await service.markMessagesRead({ userId: 7, ids: ['user:1', 'user:2', 'user:3'] });

    expect(result).toEqual({ markedCount: 1, ignoredCount: 2 });
  });

  test('markMessagesRead rejects non-canonical or non-positive user ids', async () => {
    const service = createMessagesServiceForTests({
      now: () => '2026-04-07T10:00:00.000Z',
      repo: {
        markUserMessagesRead: async () => 0,
      },
    });

    await expect(service.markMessagesRead({ userId: 7, ids: ['user:0'] })).rejects.toThrow('仅支持 user:* 消息 ID');
    await expect(service.markMessagesRead({ userId: 7, ids: ['user:001'] })).rejects.toThrow('仅支持 user:* 消息 ID');
  });
});
