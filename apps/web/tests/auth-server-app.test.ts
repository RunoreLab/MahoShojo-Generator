import { afterEach, describe, expect, vi, test } from 'vitest';

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
  legacyBearerUser: null as { id: number; username: string } | null,
};

vi.mock('@/lib/auth/server', () => ({
  getLegacyBearerAuthUser: async () => state.legacyBearerUser,
}));

vi.mock('@/lib/auth/better-auth-app', () => ({
  getBetterAuthInstance: () => ({
    api: {
      getSession: async () => state.session,
    },
  }),
}));

vi.mock('@/lib/db/drizzle', () => ({
  getDrizzleDbFromRuntime: () => ({ __mockDb: true }),
}));

vi.mock('@/lib/auth/user-auth-linking', () => ({
  getLinkedBusinessUserByAuthUserId: async () => state.linkedBusinessUser,
  ensureAuthUserLink: async () => null,
}));

vi.mock('@/lib/db/repositories/business-users', () => ({
  getBusinessUserByEmail: async () => null,
  getBusinessUserByUsername: async () => null,
}));

describe('auth/server-app', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    state.legacyBearerUser = null;
  });

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

  test('bearer 模式应跳过 Better Auth 初始化', async () => {
    vi.stubEnv('HONO_AUTH_MODE', 'bearer');
    state.session = {
      user: { id: 'auth-user-1', email: 'i_moly@example.com', name: 'I_moly' },
      session: { userId: 'auth-user-1' },
    };
    state.legacyBearerUser = { id: 23, username: 'api-client' };

    const { getAuthUserForApp } = await import('@/lib/auth/server-app');
    const context = await getAuthUserForApp(new Request('https://example.com/api/protected', {
      headers: { authorization: 'Bearer authkey' },
    }));

    expect(context).toMatchObject({ source: 'legacy-bearer', user: { id: 23 } });
  });
});
