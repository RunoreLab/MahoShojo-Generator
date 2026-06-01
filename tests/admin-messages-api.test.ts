import { describe, expect, test } from 'vitest';

import { createAdminMessagesExpireSiteHandler } from '@/pages/api/admin/messages/site/[id]/expire';
import { createAdminDirectMessagesHandler } from '@/pages/api/admin/messages/direct';
import { createAdminMessagesHandler } from '@/pages/api/admin/messages';
import { createAdminSiteMessagesHandler } from '@/pages/api/admin/messages/site';

const auth = {
  user: { id: 88, username: 'admin', is_admin: 1 },
  source: 'better-auth-session' as const,
};

const jsonBody = async <T>(response: Response): Promise<T> => (await response.json()) as T;

describe('admin messages API', () => {
  test('GET /api/admin/messages reads filters and returns payload', async () => {
    let receivedScope: string | undefined;
    let receivedTemplateKey: string | undefined;
    const handler = createAdminMessagesHandler({
      getAuthUser: async () => auth,
      getDb: () => ({ db: true }),
      listAdminMessages: async (input) => {
        receivedScope = input.scope;
        receivedTemplateKey = input.templateKey;
        return {
          siteMessages: [],
          directMessages: [],
          fetchedAt: '2026-04-11T02:00:00.000Z',
        };
      },
    });

    const response = await handler(
      new Request('https://example.test/api/admin/messages?scope=site&templateKey=site.issue.update'),
    );

    expect(response.status).toBe(200);
    expect(receivedScope).toBe('site');
    expect(receivedTemplateKey).toBe('site.issue.update');
  });

  test('POST /api/admin/messages/site sends site message with optional actor', async () => {
    let receivedActorUserId: number | null | undefined;
    const handler = createAdminSiteMessagesHandler({
      getAuthUser: async () => auth,
      getDb: () => ({ db: true }),
      createAdminSiteMessage: async (input) => {
        receivedActorUserId = input.actorUserId;
        return { id: 17 };
      },
    });

    const response = await handler(
      new Request('https://example.test/api/admin/messages/site', {
        method: 'POST',
        body: JSON.stringify({
          messageType: 'issue',
          templateKey: 'site.issue.update',
          payload: { issueTitle: '测试' },
          titleText: '标题',
          bodyText: '正文',
          actionUrl: '/messages',
          priority: 'high',
          expiresAt: '2026-04-12T00:00:00.000Z',
        }),
      }),
    );
    const payload = await jsonBody<{ id: number }>(response);

    expect(response.status).toBe(200);
    expect(receivedActorUserId).toBe(88);
    expect(payload.id).toBe(17);
  });

  test('POST /api/admin/messages/direct validates recipient ids and returns created count', async () => {
    const badHandler = createAdminDirectMessagesHandler({
      getAuthUser: async () => auth,
      getDb: () => ({ db: true }),
      createAdminDirectMessages: async () => ({ createdCount: 0, messageIds: [] }),
    });

    const badResponse = await badHandler(
      new Request('https://example.test/api/admin/messages/direct', {
        method: 'POST',
        body: JSON.stringify({
          recipientUserIds: [0],
          messageType: 'generic',
          templateKey: 'user.generic.notice',
          payload: {},
        }),
      }),
    );

    expect(badResponse.status).toBe(400);

    let receivedRecipients: number[] = [];
    const okHandler = createAdminDirectMessagesHandler({
      getAuthUser: async () => auth,
      getDb: () => ({ db: true }),
      createAdminDirectMessages: async (input) => {
        receivedRecipients = input.recipientUserIds;
        return { createdCount: 2, messageIds: [101, 102] };
      },
    });

    const okResponse = await okHandler(
      new Request('https://example.test/api/admin/messages/direct', {
        method: 'POST',
        body: JSON.stringify({
          recipientUserIds: [7, 8],
          messageType: 'generic',
          templateKey: 'user.generic.notice',
          payload: { summary: 'hello' },
          priority: 'normal',
        }),
      }),
    );
    const payload = await jsonBody<{ createdCount: number; messageIds: number[] }>(okResponse);

    expect(okResponse.status).toBe(200);
    expect(receivedRecipients).toEqual([7, 8]);
    expect(payload).toEqual({ createdCount: 2, messageIds: [101, 102] });
  });

  test('POST /api/admin/messages/site/[id]/expire returns 404 when target is missing', async () => {
    const handler = createAdminMessagesExpireSiteHandler({
      getAuthUser: async () => auth,
      getDb: () => ({ db: true }),
      expireAdminSiteMessageNow: async () => false,
    });

    const response = await handler(
      new Request('https://example.test/api/admin/messages/site/3/expire', { method: 'POST' }),
      { params: { id: '3' } },
    );

    expect(response.status).toBe(404);
  });
});
