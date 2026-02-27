import { describe, expect, mock, test } from 'bun:test';

const createJsonResponse = (payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const state = {
  authSource: 'better-auth-session' as 'better-auth-session' | 'legacy-bearer',
  bridgeResponse: createJsonResponse({ success: true }, 200) as Response,
  bridgeCalls: [] as Array<{ path: string; body: unknown }>,
  businessUser: {
    id: 1,
    email: 'old@example.com',
  } as { id: number; email: string } | null,
  authLink: { authUserId: 'auth-user-1' } as { authUserId: string } | null,
  authProfile: { id: 'auth-user-1', email: 'new@example.com', emailVerified: false } as
    | { id: string; email: string; emailVerified: boolean }
    | null,
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
    return state.bridgeResponse;
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
}));

const loadHandlers = async () => {
  const [passwordModule, emailModule] = await Promise.all([
    import('@/pages/api/me/account/password'),
    import('@/pages/api/me/account/email'),
  ]);
  return {
    passwordHandler: passwordModule.default as (req: Request) => Promise<Response>,
    emailHandler: emailModule.default as (req: Request) => Promise<Response>,
  };
};

describe('me account auth settings api', () => {
  test('legacy 登录态不能直接修改密码', async () => {
    const { passwordHandler } = await loadHandlers();
    state.authSource = 'legacy-bearer';
    state.bridgeCalls = [];

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

  test('改邮箱成功后会同步业务 users 邮箱', async () => {
    const { emailHandler } = await loadHandlers();
    state.authSource = 'better-auth-session';
    state.businessUser = { id: 1, email: 'old@example.com' };
    state.authLink = { authUserId: 'auth-user-1' };
    state.authProfile = { id: 'auth-user-1', email: 'new@example.com', emailVerified: false };
    state.updatedEmails = [];
    state.bridgeCalls = [];
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
