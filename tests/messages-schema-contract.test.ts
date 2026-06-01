import { describe, expect, test } from 'vitest';

import { siteMessages, userMessageState, userMessages } from '@/lib/db/schema';

describe('messages schema contract', () => {
  test('exports message tables with canonical snake_case columns', () => {
    expect(siteMessages.id.name).toBe('id');
    expect(siteMessages.templateKey.name).toBe('template_key');
    expect(siteMessages.expiresAt.name).toBe('expires_at');

    expect(userMessages.recipientUserId.name).toBe('recipient_user_id');
    expect(userMessages.sourceEntityType.name).toBe('source_entity_type');
    expect(userMessages.readAt.name).toBe('read_at');

    expect(userMessageState.userId.name).toBe('user_id');
    expect(userMessageState.lastReadSiteMessageId.name).toBe('last_read_site_message_id');
  });
});
