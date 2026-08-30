import { describe, expect, vi, test } from 'vitest';

const state = {
  authContext: null as { user: { id: number; username: string; prefix?: string | null } } | null,
  verifiedActivity: null as { userId: number; expiresAt: string } | null,
  businessUser: null as Record<string, unknown> | null,
  getUserByIdCalls: [] as number[],
};

vi.mock('@/lib/auth/server', () => ({
  getAuthUser: async () => state.authContext,
}));

vi.mock('@/lib/auth/activity-token', () => ({
  ACTIVITY_TOKEN_HEADER: 'x-mahoshojo-activity-token',
  verifyActivityToken: async (_token: string) => state.verifiedActivity,
}));

vi.mock('@/lib/database/users', () => ({
  getUserById: async (userId: number) => {
    state.getUserByIdCalls.push(userId);
    return state.businessUser;
  },
}));

describe('auth/request-auth-user', () => {
  test('统一鉴权失败时，应允许用已签名活动令牌恢复业务用户', async () => {
    state.authContext = null;
    state.verifiedActivity = {
      userId: 382,
      expiresAt: '2026-06-01T00:00:00.000Z',
    };
    state.businessUser = {
      id: 382,
      username: 'I_moly',
      prefix: '优秀记者',
      is_banned: null,
      is_admin: 0,
      is_review_exempt: 1,
    };
    state.getUserByIdCalls = [];

    const { createRequestAuthUserResolver } = await import('@/lib/auth/request-auth-user');
    const resolver = createRequestAuthUserResolver(
      new Request('https://example.com/api/arena/generate-stream', {
        headers: {
          'x-mahoshojo-activity-token': 'activity-token-382',
        },
      }),
    );

    const user = await resolver.getUser();
    expect(user).toEqual({
      id: 382,
      username: 'I_moly',
      prefix: '优秀记者',
      is_banned: null,
      is_admin: 0,
      is_review_exempt: 1,
    });
    expect(state.getUserByIdCalls).toEqual([382]);
  });

  test('仅有裸 user-id 头时，不应伪造登录用户', async () => {
    state.authContext = null;
    state.verifiedActivity = null;
    state.businessUser = {
      id: 999,
      username: 'should-not-be-used',
    };
    state.getUserByIdCalls = [];

    const { createRequestAuthUserResolver } = await import('@/lib/auth/request-auth-user');
    const resolver = createRequestAuthUserResolver(
      new Request('https://example.com/api/arena/generate-stream', {
        headers: {
          'x-mahoshojo-user-id': '382',
        },
      }),
    );

    const user = await resolver.getUser();
    expect(user).toBeNull();
    expect(state.getUserByIdCalls).toEqual([]);
  });
});
