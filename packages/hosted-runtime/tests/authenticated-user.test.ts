import { describe, expect, test, vi } from 'vitest';

import { createSignatureService } from '../src/signature';
import { createActivityTokenService } from '../src/node-runtime/activity-token';
import { createAuthenticatedUserIdResolver } from '../src/node-runtime/authenticated-user';

const createSignatures = async () => {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode('test-only-authenticated-user-key'),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
  return createSignatureService({ getSigningKey: async () => key });
};

describe('Hosted authenticated user resolver', () => {
  test('默认身份解析不把 activity token 提升为私有资源凭据', async () => {
    const signatures = await createSignatures();
    const activityToken = await createActivityTokenService(signatures).issueActivityToken(7);
    const client = {
      prepare: vi.fn(() => ({
        bind: vi.fn().mockReturnThis(),
        all: vi.fn(async () => ({
          success: true,
          results: [{ id: 7, username: 'activity-user', isBanned: null }],
          meta: {},
        })),
        run: vi.fn(),
      })),
    };
    const resolveUserId = createAuthenticatedUserIdResolver({
      env: { HONO_AUTH_MODE: 'bearer' },
      signatures,
      getD1Client: () => client,
    });

    await expect(resolveUserId(new Request('https://example.test', {
      headers: { 'x-mahoshojo-activity-token': activityToken! },
    }))).resolves.toBeNull();
    expect(client.prepare).not.toHaveBeenCalled();
  });
});
