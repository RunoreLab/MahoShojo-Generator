import { describe, expect, test } from 'vitest';

import { createAdminDataCardsBatchUpdateHandler } from '@/pages/api/admin/data-cards/batch-update';
import { createAdminDataCardUpdatesBatchReviewHandler } from '@/pages/api/admin/data-card-updates/batch-review';

const auth = {
  user: { id: 88, username: 'admin', is_admin: 1 },
  source: 'better-auth-session' as const,
};

describe('admin content management moderation messages API', () => {
  test('batch data card reject can send rejection reason to card authors', async () => {
    let receivedTemplateKey = '';
    let receivedReason = '';
    const handler = createAdminDataCardsBatchUpdateHandler({
      getAuthUser: async () => auth,
      getDb: () => ({ db: true }),
      batchUpdateDataCards: async () => true,
      getDataCardNotificationTargets: async () => [
        {
          dataCardId: 'card-1',
          dataCardName: '测试卡',
          recipientUserId: 7,
          reasonKey: 'card-1',
        },
      ],
      sendDataCardModerationMessages: async (input) => {
        receivedTemplateKey = input.templateKey;
        receivedReason = input.reasonByTargetKey?.['card-1'] ?? input.defaultReason ?? '';
        return { createdCount: 1, messageIds: [100] };
      },
    });

    const response = await handler(
      new Request('https://example.test/api/admin/data-cards/batch-update', {
        method: 'PUT',
        body: JSON.stringify({
          cardIds: ['card-1'],
          action: 'reject',
          messageOptions: {
            send: true,
            defaultReason: 'AI 审查认为存在违规内容',
          },
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(receivedTemplateKey).toBe('user.moderation.data_card_rejected');
    expect(receivedReason).toBe('AI 审查认为存在违规内容');
  });

  test('batch data card ban uses banned template when sending author message', async () => {
    let receivedTemplateKey = '';
    const handler = createAdminDataCardsBatchUpdateHandler({
      getAuthUser: async () => auth,
      getDb: () => ({ db: true }),
      batchUpdateDataCards: async () => true,
      getDataCardNotificationTargets: async () => [
        {
          dataCardId: 'card-1',
          dataCardName: '测试卡',
          recipientUserId: 7,
          reasonKey: 'card-1',
        },
      ],
      sendDataCardModerationMessages: async (input) => {
        receivedTemplateKey = input.templateKey;
        return { createdCount: 1, messageIds: [100] };
      },
    });

    const response = await handler(
      new Request('https://example.test/api/admin/data-cards/batch-update', {
        method: 'PUT',
        body: JSON.stringify({
          cardIds: ['card-1'],
          action: 'set_public_status',
          value: -1,
          messageOptions: {
            send: true,
            defaultReason: '公开卡违规封禁',
          },
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(receivedTemplateKey).toBe('user.moderation.data_card_banned');
  });

  test('batch update review can use per-update AI reason when rejecting', async () => {
    let receivedReason = '';
    const handler = createAdminDataCardUpdatesBatchReviewHandler({
      getAuthUser: async () => auth,
      getDb: () => ({ db: true }),
      reviewDataCardUpdate: async () => true,
      getDataCardUpdateNotificationTargets: async () => [
        {
          dataCardId: 'card-1',
          dataCardName: '更新后的测试卡',
          recipientUserId: 7,
          reasonKey: 'update-1',
        },
      ],
      sendDataCardModerationMessages: async (input) => {
        receivedReason = input.reasonByTargetKey?.['update-1'] ?? input.defaultReason ?? '';
        return { createdCount: 1, messageIds: [100] };
      },
    });

    const response = await handler(
      new Request('https://example.test/api/admin/data-card-updates/batch-review', {
        method: 'PUT',
        body: JSON.stringify({
          updateIds: ['update-1'],
          action: 'reject',
          messageOptions: {
            send: true,
            reasonByTargetKey: {
              'update-1': '外部 AI 审查理由',
            },
          },
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(receivedReason).toBe('外部 AI 审查理由');
  });
});
