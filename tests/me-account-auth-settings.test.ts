import { describe, expect, mock, test } from 'bun:test';

const createJsonResponse = (payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

type MigrationStatus = {
  hasAuthLink: boolean;
  authUserId: string | null;
  hasPassword: boolean;
  emailVerified: boolean;
};

const state = {
  authSource: 'better-auth-session' as 'better-auth-session' | 'legacy-bearer',
  bridgeResponse: createJsonResponse({ success: true }, 200) as Response,
  bridgeResponsesByPath: {} as Record<string, Response>,
  bridgeCalls: [] as Array<{ path: string; body: unknown }>,
  businessUser: {
    id: 1,
    email: 'old@example.com',
  } as { id: number; email: string } | null,
  authLink: { authUserId: 'auth-user-1' } as { authUserId: string } | null,
  authProfile: { id: 'auth-user-1', email: 'new@example.com', emailVerified: false } as
    | { id: string; email: string; emailVerified: boolean }
    | null,
  migrationStatus: {
    hasAuthLink: true,
    authUserId: 'auth-user-1',
    hasPassword: true,
    emailVerified: false,
  } as MigrationStatus,
  migrationStatusAfterUpdate: null as MigrationStatus | null,
  migrationStatusReadCount: 0,
  createdResetVerifications: [] as Array<{ id: string; token: string; authUserId: string; expiresAt: number }>,
  ensuredLinks: [] as Array<{ authUserId: string; email?: string | null; name?: string | null }>,
  updatedEmails: [] as string[],
};

mock.module('@/lib/pvp/server', () => ({
  json: (payload: unknown, init?: ResponseInit) =>
    new Response(JSON.stringify(payload), {
      status: init?.status ?? 200,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    }),
  readJson: async <T = unknown>(req: Request): Promise<{ data: T } | { response: Response }> => {
    try {
      return { data: (await req.json()) as T };
    } catch {
      return { response: createJsonResponse({ error: '请求体不是有效 JSON' }, 400) };
    }
  },
  requireAuthUser: async () => ({
    source: state.authSource,
    user: {
      id: 1,
      username: 'alice',
    },
  }),
  withPvpErrorBoundary: (handler: (req: Request) => Promise<Response>) => handler,
}));

mock.module('@/lib/auth/better-auth-subrequest', () => ({
  invokeBetterAuthSubrequest: async (input: { path: string; body: unknown }) => {
    state.bridgeCalls.push({ path: input.path, body: input.body });
    return state.bridgeResponsesByPath[input.path] ?? state.bridgeResponse;
  },
  readJsonSafely: async (response: Response) => {
    try {
      return await response.clone().json();
    } catch {
      return null;
    }
  },
  extractErrorMessage: (payload: any, fallback: string) => {
    if (payload?.error) return String(payload.error);
    if (payload?.message) return String(payload.message);
    return fallback;
  },
  appendSetCookieHeaders: (_target: Headers, _source: Headers) => {},
}));

mock.module('@/lib/db/drizzle', () => ({
  getDrizzleDbFromRuntime: () => ({ __mockDb: true }),
}));

mock.module('@/lib/db/repositories/business-users', () => ({
  getBusinessUserById: async () => (state.businessUser ? { ...state.businessUser } : null),
  updateBusinessUserEmailById: async (_db: unknown, _userId: number, email: string) => {
    state.updatedEmails.push(email);
    if (state.businessUser) state.businessUser.email = email;
    return state.businessUser;
  },
}));

mock.module('@/lib/db/repositories/user-auth-links', () => ({
  getUserAuthLinkByBusinessUserId: async () => state.authLink,
  getAuthUserProfileByAuthUserId: async () => state.authProfile,
  getAuthMigrationStatusByBusinessUserId: async () => {
    state.migrationStatusReadCount += 1;
    if (state.migrationStatusReadCount > 1 && state.migrationStatusAfterUpdate) {
      return state.migrationStatusAfterUpdate;
    }
    return state.migrationStatus;
  },
  createAuthResetPasswordVerification: async (
    _db: unknown,
    input: { id: string; token: string; authUserId: string; expiresAt: number },
  ) => {
    state.createdResetVerifications.push(input);
  },
}));

mock.module('@/lib/auth/user-auth-linking', () => ({
  ensureAuthUserLink: async (input: { authUserId: string; email?: string | null; name?: string | null }) => {
    state.ensuredLinks.push(input);
    return state.businessUser;
  },
}));

const loadHandlers = async () => {
  const [passwordModule, passwordSetModule, emailModule] = await Promise.all([
    import('@/pages/api/me/account/password'),
    import('@/pages/api/me/account/password/set'),
    import('@/pages/api/me/account/email'),
  ]);
  return {
    passwordHandler: passwordModule.default as (req: Request) => Promise<Response>,
    passwordSetHandler: passwordSetModule.default as (req: Request) => Promise<Response>,
    emailHandler: emailModule.default as (req: Request) => Promise<Response>,
  };
};

describe('me account auth settings api', () => {
  test('legacy 登录态不能直接修改密码', async () => {
    const { passwordHandler } = await loadHandlers();
    state.authSource = 'legacy-bearer';
    state.bridgeCalls = [];
    state.bridgeResponsesByPath = {};

    const response = await passwordHandler(
      new Request('https://example.com/api/me/account/password', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentPassword: 'Old!Pass1',
          newPassword: 'Aq!9xK2m',
        }),
      }),
    );

    expect(response.status).toBe(409);
    expect(state.bridgeCalls).toHaveLength(0);
  });

  test('可通过密码接口调用 Better Auth change-password', async () => {
    const { passwordHandler } = await loadHandlers();
    state.authSource = 'better-auth-session';
    state.bridgeCalls = [];
    state.bridgeResponsesByPath = {};
    state.bridgeResponse = createJsonResponse({ user: { id: 'auth-user-1' } }, 200);

    const response = await passwordHandler(
      new Request('https://example.com/api/me/account/password', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentPassword: 'Old!Pass1',
          newPassword: 'Aq!9xK2m',
          revokeOtherSessions: true,
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(state.bridgeCalls[0]?.path).toBe('/api/auth/change-password');
  });

  test('legacy 无密码用户可设置初始密码（已映射账号）', async () => {
    const { passwordSetHandler } = await loadHandlers();
    state.authSource = 'legacy-bearer';
    state.bridgeCalls = [];
    state.bridgeResponsesByPath = {
      '/api/auth/reset-password': createJsonResponse({ status: true }, 200),
    };
    state.bridgeResponse = createJsonResponse({ status: true }, 200);
    state.migrationStatus = {
      hasAuthLink: true,
      authUserId: 'auth-user-1',
      hasPassword: false,
      emailVerified: false,
    };
    state.migrationStatusAfterUpdate = {
      hasAuthLink: true,
      authUserId: 'auth-user-1',
      hasPassword: true,
      emailVerified: false,
    };
    state.migrationStatusReadCount = 0;
    state.createdResetVerifications = [];
    state.ensuredLinks = [];

    const response = await passwordSetHandler(
      new Request('https://example.com/api/me/account/password/set', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          newPassword: 'Aq!9xK2m',
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(state.bridgeCalls[0]?.path).toBe('/api/auth/reset-password');
    expect(state.createdResetVerifications).toHaveLength(1);
    expect(state.ensuredLinks).toHaveLength(0);
  });

  test('legacy 无映射用户可通过设置密码认领迁移', async () => {
    const { passwordSetHandler } = await loadHandlers();
    state.authSource = 'legacy-bearer';
    state.bridgeCalls = [];
    state.bridgeResponsesByPath = {
      '/api/auth/sign-up/email': createJsonResponse(
        { user: { id: 'auth-user-9', email: 'old@example.com', name: 'alice' } },
        200,
      ),
    };
    state.bridgeResponse = createJsonResponse({ status: true }, 200);
    state.migrationStatus = {
      hasAuthLink: false,
      authUserId: null,
      hasPassword: false,
      emailVerified: false,
    };
    state.migrationStatusAfterUpdate = {
      hasAuthLink: true,
      authUserId: 'auth-user-9',
      hasPassword: true,
      emailVerified: false,
    };
    state.migrationStatusReadCount = 0;
    state.createdResetVerifications = [];
    state.ensuredLinks = [];

    const response = await passwordSetHandler(
      new Request('https://example.com/api/me/account/password/set', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          newPassword: 'Aq!9xK2m',
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(state.bridgeCalls[0]?.path).toBe('/api/auth/sign-up/email');
    expect(state.ensuredLinks[0]?.authUserId).toBe('auth-user-9');
    expect(state.createdResetVerifications).toHaveLength(0);
  });

  test('改邮箱成功后会同步业务 users 邮箱', async () => {
    const { emailHandler } = await loadHandlers();
    state.authSource = 'better-auth-session';
    state.businessUser = { id: 1, email: 'old@example.com' };
    state.authLink = { authUserId: 'auth-user-1' };
    state.authProfile = { id: 'auth-user-1', email: 'new@example.com', emailVerified: false };
    state.updatedEmails = [];
    state.bridgeCalls = [];
    state.bridgeResponsesByPath = {};
    state.bridgeResponse = createJsonResponse({ status: true }, 200);

    const response = await emailHandler(
      new Request('https://example.com/api/me/account/email', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          newEmail: 'new@example.com',
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(state.bridgeCalls[0]?.path).toBe('/api/auth/change-email');
    expect(state.updatedEmails).toContain('new@example.com');
  });
});
