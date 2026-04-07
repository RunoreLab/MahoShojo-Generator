import { describe, expect, test } from 'bun:test';

import { createMessagesHandler } from '@/pages/api/messages';
import { createMessagesReadAllHandler } from '@/pages/api/messages/read-all';
import { createMessagesReadHandler } from '@/pages/api/messages/read';
import { createMessagesSiteReadHandler } from '@/pages/api/messages/site/read';
import { createMessagesSummaryHandler } from '@/pages/api/messages/summary';

const auth = {
  user: { id: 7, username: 'hana' },
  source: 'better-auth-session' as const,
};

const jsonBody = async <T>(response: Response): Promise<T> => (await response.json()) as T;

describe('messages API', () => {
  test('GET summary returns zero unread for logged out user without requiring db', async () => {
    const handler = createMessagesSummaryHandler({
      getAuthUser: async () => null,
      getDb: () => {
        throw new Error('db should not be read');
      },
      getMessageSummary: async () => {
        throw new Error('service should not be called');
      },
    });

    const response = await handler(new Request('https://example.test/api/messages/summary'));
    const payload = await jsonBody<{ unreadTotal: number; isAuthenticated: boolean }>(response);

    expect(response.status).toBe(200);
    expect(payload.unreadTotal).toBe(0);
    expect(payload.isAuthenticated).toBe(false);
  });

  test('GET messages uses default limit=20 when query omits limit', async () => {
    let receivedLimit = 0;
    const handler = createMessagesHandler({
      getAuthUser: async () => auth,
      getDb: () => ({ db: true }),
      listMessages: async (input) => {
        receivedLimit = input.limit;
        return {
          messages: [],
          nextCursor: null,
          filter: input.filter,
          appliedFilter: input.filter,
          fetchedAt: '2026-04-07T10:00:00.000Z',
          isAuthenticated: true,
        };
      },
    });

    const response = await handler(new Request('https://example.test/api/messages'));

    expect(response.status).toBe(200);
    expect(receivedLimit).toBe(20);
  });

  test('GET messages clamps limit above 50 down to 50 before calling service', async () => {
    let receivedLimit = 0;
    const handler = createMessagesHandler({
      getAuthUser: async () => auth,
      getDb: () => ({ db: true }),
      listMessages: async (input) => {
        receivedLimit = input.limit;
        return {
          messages: [],
          nextCursor: null,
          filter: input.filter,
          appliedFilter: input.filter,
          fetchedAt: '2026-04-07T10:00:00.000Z',
          isAuthenticated: true,
        };
      },
    });

    const response = await handler(new Request('https://example.test/api/messages?limit=500'));

    expect(response.status).toBe(200);
    expect(receivedLimit).toBe(50);
  });

  test('GET messages rejects invalid or non-positive limit', async () => {
    const handler = createMessagesHandler({
      getAuthUser: async () => auth,
      getDb: () => ({ db: true }),
      listMessages: async () => {
        throw new Error('service should not be called');
      },
    });

    expect((await handler(new Request('https://example.test/api/messages?limit=0'))).status).toBe(400);
    expect((await handler(new Request('https://example.test/api/messages?limit=abc'))).status).toBe(400);
  });

  test('GET messages allows logged out all filter and returns site-only list with appliedFilter=site', async () => {
    const handler = createMessagesHandler({
      getAuthUser: async () => null,
      getDb: () => ({ db: true }),
      listMessages: async (input) => ({
        messages: [],
        nextCursor: null,
        filter: input.filter,
        appliedFilter: 'site',
        fetchedAt: '2026-04-07T10:00:00.000Z',
        isAuthenticated: false,
      }),
    });

    const response = await handler(new Request('https://example.test/api/messages?filter=all'));
    const payload = await jsonBody<{ appliedFilter: string; isAuthenticated: boolean }>(response);

    expect(response.status).toBe(200);
    expect(payload.appliedFilter).toBe('site');
    expect(payload.isAuthenticated).toBe(false);
  });

  test('GET messages rejects logged out direct filter and malformed cursor', async () => {
    const loggedOutHandler = createMessagesHandler({
      getAuthUser: async () => null,
      getDb: () => ({ db: true }),
      listMessages: async () => {
        throw new Error('service should not be called');
      },
    });
    const loggedInHandler = createMessagesHandler({
      getAuthUser: async () => auth,
      getDb: () => ({ db: true }),
      listMessages: async () => {
        throw new Error('service should not be called');
      },
    });

    expect((await loggedOutHandler(new Request('https://example.test/api/messages?filter=direct'))).status).toBe(401);
    expect((await loggedInHandler(new Request('https://example.test/api/messages?cursor=bad-cursor'))).status).toBe(400);
  });

  test('POST read rejects site ids and returns service result for direct ids', async () => {
    const handler = createMessagesReadHandler({
      requireAuthUser: async () => auth,
      getDb: () => ({ db: true }),
      markMessagesRead: async () => ({ markedCount: 1, ignoredCount: 1 }),
    });

    const rejected = await handler(
      new Request('https://example.test/api/messages/read', {
        method: 'POST',
        body: JSON.stringify({ ids: ['site:1'] }),
      }),
    );
    const accepted = await handler(
      new Request('https://example.test/api/messages/read', {
        method: 'POST',
        body: JSON.stringify({ ids: ['user:1', 'user:2'] }),
      }),
    );

    expect(rejected.status).toBe(400);
    expect(await jsonBody<{ markedCount: number; ignoredCount: number }>(accepted)).toEqual({
      markedCount: 1,
      ignoredCount: 1,
    });
  });

  test('POST read rejects non-positive user ids', async () => {
    const handler = createMessagesReadHandler({
      requireAuthUser: async () => auth,
      getDb: () => ({ db: true }),
      markMessagesRead: async () => ({ markedCount: 0, ignoredCount: 0 }),
    });

    const response = await handler(
      new Request('https://example.test/api/messages/read', {
        method: 'POST',
        body: JSON.stringify({ ids: ['user:0'] }),
      }),
    );

    expect(response.status).toBe(400);
  });

  test('POST site read requires login and returns monotonic cursor result', async () => {
    const unauthorized = createMessagesSiteReadHandler({
      requireAuthUser: async () => new Response(JSON.stringify({ error: '未授权' }), { status: 401 }) as never,
      getDb: () => ({ db: true }),
      markSiteMessagesRead: async () => {
        throw new Error('service should not be called');
      },
    });
    const handler = createMessagesSiteReadHandler({
      requireAuthUser: async () => auth,
      getDb: () => ({ db: true }),
      markSiteMessagesRead: async () => ({ advancedSiteCursorTo: 8 }),
    });

    expect((await unauthorized(new Request('https://example.test/api/messages/site/read', { method: 'POST' }))).status).toBe(401);
    const response = await handler(
      new Request('https://example.test/api/messages/site/read', {
        method: 'POST',
        body: JSON.stringify({ lastReadSiteMessageId: 3 }),
      }),
    );

    expect(await jsonBody<{ advancedSiteCursorTo: number }>(response)).toEqual({ advancedSiteCursorTo: 8 });
  });

  test('POST read-all requires login and returns counts', async () => {
    const handler = createMessagesReadAllHandler({
      requireAuthUser: async () => auth,
      getDb: () => ({ db: true }),
      markAllMessagesRead: async () => ({ markedUserMessageCount: 2, advancedSiteCursorTo: 9 }),
    });

    const response = await handler(new Request('https://example.test/api/messages/read-all', { method: 'POST' }));

    expect(await jsonBody<{ markedUserMessageCount: number; advancedSiteCursorTo: number }>(response)).toEqual({
      markedUserMessageCount: 2,
      advancedSiteCursorTo: 9,
    });
  });
});
