import { describe, expect, mock, test } from 'bun:test';

const state = {
  session: {
    user: {
      id: 'auth-user-1',
      email: 'i_moly@example.com',
      name: 'I_moly',
    },
    session: {
      userId: 'auth-user-1',
    },
  } as { user?: { id?: unknown; email?: unknown; name?: unknown }; session?: { userId?: unknown } } | null,
  linkedBusinessUser: {
    id: 12,
    username: 'I_moly',
    prefix: null,
    isBanned: null,
    isAdmin: true,
    isReviewExempt: true,
  } as Record<string, unknown> | null,
};

mock.module('@/lib/auth/better-auth-app', () => ({
  getBetterAuthInstance: () => ({
    api: {
      getSession: async () => state.session,
    },
  }),
}));

mock.module('@/lib/db/drizzle', () => ({
  getDrizzleDbFromRuntime: () => ({ __mockDb: true }),
}));

mock.module('@/lib/auth/user-auth-linking', () => ({
  getLinkedBusinessUserByAuthUserId: async () => state.linkedBusinessUser,
  ensureAuthUserLink: async () => null,
}));

mock.module('@/lib/db/repositories/business-users', () => ({
  getBusinessUserByEmail: async () => null,
  getBusinessUserByUsername: async () => null,
}));

describe('auth/server-app', () => {
  test('应兼容 ORM 驼峰权限字段并映射为统一 is_admin/is_review_exempt', async () => {
    const { getAuthUserForApp } = await import('@/lib/auth/server-app');
    const context = await getAuthUserForApp(new Request('https://example.com/api/data-cards'));

    expect(context).not.toBeNull();
    expect(context?.source).toBe('better-auth-session');
    expect(context?.user.id).toBe(12);
    expect(context?.user.username).toBe('I_moly');
    expect(context?.user.is_admin).toBe(1);
    expect(context?.user.is_review_exempt).toBe(1);
  });
});
