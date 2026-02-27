import { describe, expect, mock, test } from 'bun:test';

type MockUser = {
  id: number;
  username: string;
  email: string;
  prefix: string | null;
  authKey: string | null;
  authUserId: string | null;
  password: string | null;
  isBanned: string | null;
  isAdmin: number;
  isReviewExempt: number;
};

type AuthAccount = {
  authUserId: string;
  email: string;
  name: string;
  password: string;
};

type ResetTokenRow = {
  id: string;
  userId: number;
  tokenHash: string;
  expiresAt: number;
  consumedAt: number | null;
};

type MailRequest = {
  url: string;
  payload: Record<string, unknown>;
};

const normalizeEmail = (value: string): string => value.trim().toLowerCase();

const postJsonRequest = (url: string, payload: unknown, headers?: Record<string, string>): Request =>
  new Request(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(headers ?? {}),
    },
    body: JSON.stringify(payload),
  });

const createJsonResponse = (payload: unknown, status = 200, headers?: Headers): Response => {
  const merged = new Headers(headers ?? {});
  if (!merged.has('Content-Type')) {
    merged.set('Content-Type', 'application/json');
  }
  return new Response(JSON.stringify(payload), { status, headers: merged });
};

const getCookieValue = (cookieHeader: string | null, key: string): string | null => {
  if (!cookieHeader) return null;
  const pairs = cookieHeader.split(';');
  for (const pair of pairs) {
    const [cookieKey, ...rest] = pair.trim().split('=');
    if (cookieKey === key) {
      return rest.join('=').trim() || null;
    }
  }
  return null;
};

type RouteFactories = {
  createRegisterHandler: (overrides?: Record<string, unknown>) => (req: Request) => Promise<Response>;
  createLoginHandler: (overrides?: Record<string, unknown>) => (req: Request) => Promise<Response>;
  createVerifyHandler: (overrides?: Record<string, unknown>) => (req: Request) => Promise<Response>;
  createRecoverHandler: (overrides?: Record<string, unknown>) => (req: Request) => Promise<Response>;
  createRecoverResetHandler: (overrides?: Record<string, unknown>) => (req: Request) => Promise<Response>;
};

let routeFactoriesPromise: Promise<RouteFactories> | null = null;

const loadRouteFactories = async (): Promise<RouteFactories> => {
  if (!routeFactoriesPromise) {
    mock.module('server-only', () => ({}));

    routeFactoriesPromise = Promise.all([
      import('@/app/api/auth/register/handler'),
      import('@/app/api/auth/login/handler'),
      import('@/app/api/auth/verify/handler'),
      import('@/app/api/auth/recover/handler'),
      import('@/app/api/auth/recover/reset/handler'),
    ]).then(([registerRoute, loginRoute, verifyRoute, recoverRoute, recoverResetRoute]) => ({
      createRegisterHandler: registerRoute.createRegisterHandler,
      createLoginHandler: loginRoute.createLoginHandler,
      createVerifyHandler: verifyRoute.createVerifyHandler,
      createRecoverHandler: recoverRoute.createRecoverHandler,
      createRecoverResetHandler: recoverResetRoute.createRecoverResetHandler,
    }));
  }

  return routeFactoriesPromise;
};

const buildAuthHarness = async () => {
  const routes = await loadRouteFactories();

  const state = {
    nextUserId: 1,
    nextAuthUserSeq: 1,
    nextSessionSeq: 1,
    nextActivitySeq: 1,
    nextResetSeq: 1,
    usersById: new Map<number, MockUser>(),
    usersByUsername: new Map<string, number>(),
    usersByEmail: new Map<string, number>(),
    usersByAuthUserId: new Map<string, number>(),
    authAccountsByEmail: new Map<string, AuthAccount>(),
    sessions: new Map<string, string>(),
    resetTokensByHash: new Map<string, ResetTokenRow>(),
    resendRequests: [] as MailRequest[],
    lastRecoveryToken: '',
    nowMs: Date.now(),
  };

  const getUserById = (id: number): MockUser | null => state.usersById.get(id) ?? null;

  const getUserByUsername = (username: string): MockUser | null => {
    const id = state.usersByUsername.get(username.trim());
    if (!id) return null;
    return getUserById(id);
  };

  const getUserByEmail = (email: string): MockUser | null => {
    const id = state.usersByEmail.get(normalizeEmail(email));
    if (!id) return null;
    return getUserById(id);
  };

  const toBusinessUser = (user: MockUser): Record<string, unknown> => ({
    id: user.id,
    username: user.username,
    email: user.email,
    prefix: user.prefix,
    authKey: user.authKey,
    isBanned: user.isBanned,
    isAdmin: user.isAdmin,
    isReviewExempt: user.isReviewExempt,
  });

  const toLegacyUser = (user: MockUser): Record<string, unknown> => ({
    id: user.id,
    username: user.username,
    email: user.email,
    auth_key: user.authKey,
    prefix: user.prefix,
    is_banned: user.isBanned,
    is_admin: user.isAdmin,
    is_review_exempt: user.isReviewExempt,
  });

  const createUser = (input: {
    username: string;
    email: string;
    authKey?: string | null;
    password?: string | null;
    authUserId?: string | null;
  }): MockUser => {
    const user: MockUser = {
      id: state.nextUserId++,
      username: input.username.trim(),
      email: normalizeEmail(input.email),
      prefix: null,
      authKey: input.authKey ?? null,
      authUserId: input.authUserId ?? null,
      password: input.password ?? null,
      isBanned: null,
      isAdmin: 0,
      isReviewExempt: 0,
    };

    state.usersById.set(user.id, user);
    state.usersByUsername.set(user.username, user.id);
    state.usersByEmail.set(user.email, user.id);
    if (user.authUserId) {
      state.usersByAuthUserId.set(user.authUserId, user.id);
    }
    return user;
  };

  const attachAuthUser = (authUserId: string, user: MockUser): void => {
    user.authUserId = authUserId;
    state.usersByAuthUserId.set(authUserId, user.id);
  };

  const ensureUniqueUsername = (seed: string): string => {
    const base = seed.trim() || 'user';
    if (!state.usersByUsername.has(base)) return base;
    for (let i = 1; i <= 500; i += 1) {
      const candidate = `${base}_${i}`;
      if (!state.usersByUsername.has(candidate)) return candidate;
    }
    return `user_${Date.now()}`;
  };

  const issueSessionCookie = (authUserId: string): string => {
    const token = `session-${state.nextSessionSeq++}`;
    state.sessions.set(token, authUserId);
    return `better-auth.session_token=${token}; Path=/; HttpOnly`;
  };

  const invokeBetterAuthJsonEndpoint = async (input: {
    path: string;
    body: Record<string, unknown>;
    sourceHeaders: Headers;
  }) => {
    const path = input.path.startsWith('/') ? input.path : `/${input.path}`;
    const body = input.body ?? {};

    if (path === '/api/auth/sign-up/email') {
      const email = normalizeEmail(String(body.email ?? ''));
      const password = String(body.password ?? '');
      const name = String(body.name ?? '').trim() || 'user';
      if (!email || !password) {
        return { ok: true, response: createJsonResponse({ error: 'invalid payload' }, 400) } as const;
      }
      if (state.authAccountsByEmail.has(email)) {
        return { ok: true, response: createJsonResponse({ error: '邮箱已被注册' }, 409) } as const;
      }

      const authUserId = `auth-user-${state.nextAuthUserSeq++}`;
      state.authAccountsByEmail.set(email, {
        authUserId,
        email,
        name,
        password,
      });

      const headers = new Headers();
      headers.set('set-cookie', issueSessionCookie(authUserId));
      return {
        ok: true,
        response: createJsonResponse(
          {
            user: {
              id: authUserId,
              email,
              name,
            },
          },
          200,
          headers,
        ),
      } as const;
    }

    if (path === '/api/auth/sign-in/email') {
      const email = normalizeEmail(String(body.email ?? ''));
      const password = String(body.password ?? '');
      const account = state.authAccountsByEmail.get(email);
      if (!account || account.password !== password) {
        return { ok: true, response: createJsonResponse({ error: '邮箱或密码错误' }, 401) } as const;
      }

      const headers = new Headers();
      headers.set('set-cookie', issueSessionCookie(account.authUserId));
      return {
        ok: true,
        response: createJsonResponse(
          {
            user: {
              id: account.authUserId,
              email: account.email,
              name: account.name,
            },
          },
          200,
          headers,
        ),
      } as const;
    }

    return {
      ok: false,
      code: 'BETTER_AUTH_INIT_FAILED',
      message: `unsupported path: ${path}`,
    } as const;
  };

  const readJsonSafely = async <T>(response: Response): Promise<T | null> => {
    try {
      return (await response.clone().json()) as T;
    } catch {
      return null;
    }
  };

  const appendSetCookieHeaders = (target: Headers, source: Headers): void => {
    const setCookie = source.get('set-cookie');
    if (setCookie) target.append('set-cookie', setCookie);
  };

  const extractErrorMessage = (payload: unknown, fallback: string): string => {
    if (!payload || typeof payload !== 'object') return fallback;
    const data = payload as Record<string, unknown>;
    if (typeof data.error === 'string' && data.error.trim()) return data.error;
    if (typeof data.message === 'string' && data.message.trim()) return data.message;
    return fallback;
  };

  const ensureAuthUserLink = async (input: { authUserId: string; email?: string | null; name?: string | null }) => {
    const authUserId = input.authUserId?.trim();
    if (!authUserId) return null;

    const linkedId = state.usersByAuthUserId.get(authUserId);
    if (linkedId) {
      const linked = getUserById(linkedId);
      return linked ? toBusinessUser(linked) : null;
    }

    const email = typeof input.email === 'string' ? normalizeEmail(input.email) : '';
    if (!email) return null;

    let user = getUserByEmail(email);
    if (!user) {
      const seed = (input.name ?? '').trim() || email.split('@')[0] || 'user';
      const username = ensureUniqueUsername(seed.slice(0, 20));
      const account = state.authAccountsByEmail.get(email);
      user = createUser({
        username,
        email,
        password: account?.password ?? null,
      });
    }

    attachAuthUser(authUserId, user);
    return toBusinessUser(user);
  };

  const getLinkedBusinessUserByAuthUserId = async (authUserId: string) => {
    const userId = state.usersByAuthUserId.get(authUserId);
    if (!userId) return null;
    const user = getUserById(userId);
    return user ? toBusinessUser(user) : null;
  };

  const ensureBusinessUserLegacyAuthKey = async (businessUser: { id: number; authKey?: string | null }) => {
    const user = getUserById(businessUser.id);
    if (!user) return null;
    if (!user.authKey) {
      user.authKey = `legacy-auth-key-${String(user.id).padStart(4, '0')}`;
    }
    return toBusinessUser(user);
  };

  const issueActivityToken = async (userId: number): Promise<string> => `activity-${userId}-${state.nextActivitySeq++}`;

  const verifyUserLogin = async (username: string, authKey: string) => {
    const user = getUserByUsername(username);
    if (!user || user.authKey !== authKey) return null;
    return {
      id: user.id,
      username: user.username,
      prefix: user.prefix,
    };
  };

  const verifyTurnstileToken = async (token: string): Promise<boolean> => token === 'turnstile-ok';

  const hashRecoveryToken = async (token: string): Promise<string> => `hash:${token}`;

  const normalizeLegacyAuthKey = (value: unknown): string | null => {
    if (typeof value !== 'string') return null;
    const normalized = value.trim();
    if (!normalized) return null;
    if (normalized.length < 16 || normalized.length > 128) return null;
    if (/\s/.test(normalized)) return null;
    return normalized;
  };

  const registerPost = routes.createRegisterHandler({
    issueActivityToken,
    appendSetCookieHeaders,
    extractErrorMessage,
    invokeBetterAuthJsonEndpoint,
    readJsonSafely,
    ensureAuthUserLink,
    ensureBusinessUserLegacyAuthKey,
    getLinkedBusinessUserByAuthUserId,
    getRandomValues: (values: Uint8Array) => {
      for (let i = 0; i < values.length; i += 1) values[i] = (i * 17 + 11) % 256;
      return values;
    },
    createUser: async (username: string, email: string, authKey: string) => createUser({ username, email, authKey }).id,
    getUserByEmail: async (email: string) => {
      const user = getUserByEmail(email);
      return user ? toLegacyUser(user) : null;
    },
    getUserByUsername: async (username: string) => {
      const user = getUserByUsername(username);
      return user ? toLegacyUser(user) : null;
    },
    getDrizzleDbFromRuntime: () => ({ __mockDb: true }),
    getBusinessUserByEmail: async (_db: unknown, email: string) => {
      const user = getUserByEmail(email);
      return user ? toBusinessUser(user) : null;
    },
    getBusinessUserByUsername: async (_db: unknown, username: string) => {
      const user = getUserByUsername(username);
      return user ? toBusinessUser(user) : null;
    },
    quickCheck: async (text: string) => ({
      hasSensitiveWords: false,
      detectedWords: [],
      filteredText: text,
      originalText: text,
      shouldRedirectToArrested: false,
      matchDetails: [],
    }),
    verifyTurnstileToken,
  });

  const loginPost = routes.createLoginHandler({
    issueActivityToken,
    appendSetCookieHeaders,
    extractErrorMessage,
    invokeBetterAuthJsonEndpoint,
    readJsonSafely,
    ensureAuthUserLink,
    ensureBusinessUserLegacyAuthKey,
    getLinkedBusinessUserByAuthUserId,
    verifyUserLogin,
    verifyTurnstileToken,
  });

  const verifyPost = routes.createVerifyHandler({
    issueActivityToken,
    requireAuthUserForApp: async (req: Request) => {
      const cookieHeader = req.headers.get('cookie');
      const sessionToken =
        getCookieValue(cookieHeader, 'better-auth.session_token') ??
        getCookieValue(cookieHeader, '__Secure-better-auth.session_token');

      if (!sessionToken) {
        return { response: createJsonResponse({ error: '未授权' }, 401) };
      }

      const authUserId = state.sessions.get(sessionToken);
      if (!authUserId) {
        return { response: createJsonResponse({ error: '未授权' }, 401) };
      }

      const userId = state.usersByAuthUserId.get(authUserId);
      const user = userId ? getUserById(userId) : null;
      if (!user) {
        return { response: createJsonResponse({ error: '未授权' }, 401) };
      }

      return {
        source: 'better-auth-session',
        user: {
          id: user.id,
          username: user.username,
          prefix: user.prefix,
          is_banned: user.isBanned,
          is_admin: user.isAdmin,
          is_review_exempt: user.isReviewExempt,
        },
      };
    },
  });

  const recoverPost = routes.createRecoverHandler({
    generateRecoveryToken: () => {
      const token = `recover-token-${String(state.nextResetSeq).padStart(4, '0')}`;
      state.lastRecoveryToken = token;
      return token;
    },
    hashRecoveryToken,
    recoveryTokenTtlSeconds: 15 * 60,
    getDrizzleDbFromRuntime: () => ({ __mockDb: true }),
    getBusinessUserByUsername: async (_db: unknown, username: string) => {
      const user = getUserByUsername(username);
      return user ? toBusinessUser(user) : null;
    },
    consumePasswordResetTokenById: async (_db: unknown, tokenId: string, nowEpochSeconds: number) => {
      for (const row of state.resetTokensByHash.values()) {
        if (row.id === tokenId && row.consumedAt === null) {
          row.consumedAt = nowEpochSeconds;
        }
      }
    },
    createPasswordResetToken: async (
      _db: unknown,
      input: {
        userId: number;
        tokenHash: string;
        expiresAt: number;
      },
    ) => {
      const id = `reset-${state.nextResetSeq++}`;
      const row: ResetTokenRow = {
        id,
        userId: input.userId,
        tokenHash: input.tokenHash,
        expiresAt: input.expiresAt,
        consumedAt: null,
      };
      state.resetTokensByHash.set(input.tokenHash, row);
      return {
        id: row.id,
        userId: row.userId,
        tokenHash: row.tokenHash,
        expiresAt: row.expiresAt,
      };
    },
    getUserByUsername: async (username: string) => {
      const user = getUserByUsername(username);
      return user ? toLegacyUser(user) : null;
    },
    verifyTurnstileToken,
    fetchImpl: async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url !== 'https://api.resend.com/emails') {
        throw new Error(`Unexpected fetch URL: ${url}`);
      }
      const payload = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as Record<string, unknown>;
      state.resendRequests.push({ url, payload });
      return createJsonResponse({ id: 'mail-001' }, 200);
    },
    getResendApiKey: () => 'resend-test-key',
    now: () => state.nowMs,
  });

  const resetPost = routes.createRecoverResetHandler({
    hashRecoveryToken,
    normalizeLegacyAuthKey,
    getDrizzleDbFromRuntime: () => ({ __mockDb: true }),
    consumePasswordResetTokenByHash: async (_db: unknown, tokenHash: string, nowEpochSeconds: number) => {
      const row = state.resetTokensByHash.get(tokenHash);
      if (!row || row.consumedAt !== null || row.expiresAt <= nowEpochSeconds) return null;
      row.consumedAt = nowEpochSeconds;
      return { userId: row.userId };
    },
    invalidateActivePasswordResetTokensByUserId: async (_db: unknown, userId: number, nowEpochSeconds: number) => {
      for (const row of state.resetTokensByHash.values()) {
        if (row.userId === userId && row.consumedAt === null && row.expiresAt > nowEpochSeconds) {
          row.consumedAt = nowEpochSeconds;
        }
      }
    },
    updateUserAuthKey: async (userId: number, newAuthKey: string) => {
      const user = getUserById(userId);
      if (!user) return false;
      user.authKey = newAuthKey;
      return true;
    },
    now: () => state.nowMs,
  });

  return {
    state,
    registerPost,
    loginPost,
    verifyPost,
    recoverPost,
    resetPost,
  };
};

describe('auth 全链路集成', () => {
  test('register/login/verify/recover/reset 应串联成功并验证重置一次性', async () => {
    const harness = await buildAuthHarness();

    const registerResp = await harness.registerPost(
      postJsonRequest('https://example.com/api/auth/register', {
        username: 'hikari',
        email: 'hikari@example.com',
        password: 'password-123',
        turnstileToken: 'turnstile-ok',
      }),
    );
    expect(registerResp.status).toBe(200);
    const registerPayload = (await registerResp.json()) as {
      success: boolean;
      authMode: string;
      authKey: string;
      user: { id: number; username: string };
    };
    expect(registerPayload.success).toBeTrue();
    expect(registerPayload.authMode).toBe('better-auth');
    expect(registerPayload.user.username).toBe('hikari');

    const oldAuthKey = registerPayload.authKey;
    expect(oldAuthKey.length).toBeGreaterThanOrEqual(16);

    const loginResp = await harness.loginPost(
      postJsonRequest('https://example.com/api/auth/login', {
        identifier: 'hikari@example.com',
        credential: 'password-123',
        mode: 'password',
        turnstileToken: 'turnstile-ok',
      }),
    );
    expect(loginResp.status).toBe(200);
    const loginPayload = (await loginResp.json()) as {
      success: boolean;
      authMode: string;
      user: { id: number; username: string };
    };
    expect(loginPayload.success).toBeTrue();
    expect(loginPayload.authMode).toBe('better-auth');
    expect(loginPayload.user.id).toBe(registerPayload.user.id);

    const setCookie = loginResp.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('better-auth.session_token=');
    const cookieHeader = setCookie.split(';')[0] ?? '';

    const verifyResp = await harness.verifyPost(
      new Request('https://example.com/api/auth/verify', {
        method: 'POST',
        headers: {
          cookie: cookieHeader,
        },
      }),
    );
    expect(verifyResp.status).toBe(200);
    const verifyPayload = (await verifyResp.json()) as {
      success: boolean;
      user: { id: number; username: string };
      activityToken: string;
    };
    expect(verifyPayload.success).toBeTrue();
    expect(verifyPayload.user.username).toBe('hikari');
    expect(verifyPayload.activityToken).toContain(`activity-${registerPayload.user.id}-`);

    const recoverResp = await harness.recoverPost(
      postJsonRequest(
        'https://example.com/api/auth/recover',
        {
          username: 'hikari',
          email: 'hikari@example.com',
          turnstileToken: 'turnstile-ok',
        },
        {
          'cf-connecting-ip': '203.0.113.8',
        },
      ),
    );
    expect(recoverResp.status).toBe(200);
    const recoverPayload = (await recoverResp.json()) as {
      success: boolean;
      message: string;
    };
    expect(recoverPayload.success).toBeTrue();
    expect(recoverPayload.message).toContain('15 分钟');
    expect(harness.state.lastRecoveryToken).toContain('recover-token-');
    expect(harness.state.resendRequests).toHaveLength(1);
    expect(String(harness.state.resendRequests[0]?.payload.text ?? '')).toContain(harness.state.lastRecoveryToken);

    const newAuthKey = 'new-legacy-auth-key-0001';
    const resetResp = await harness.resetPost(
      postJsonRequest('https://example.com/api/auth/recover/reset', {
        token: harness.state.lastRecoveryToken,
        newAuthKey,
      }),
    );
    expect(resetResp.status).toBe(200);
    const resetPayload = (await resetResp.json()) as {
      success: boolean;
      message: string;
    };
    expect(resetPayload.success).toBeTrue();
    expect(resetPayload.message).toContain('重置成功');

    const replayResetResp = await harness.resetPost(
      postJsonRequest('https://example.com/api/auth/recover/reset', {
        token: harness.state.lastRecoveryToken,
        newAuthKey: 'another-valid-key-0002',
      }),
    );
    expect(replayResetResp.status).toBe(400);

    const oldLegacyLoginResp = await harness.loginPost(
      postJsonRequest('https://example.com/api/auth/login', {
        username: 'hikari',
        authKey: oldAuthKey,
        mode: 'legacy',
        turnstileToken: 'turnstile-ok',
      }),
    );
    expect(oldLegacyLoginResp.status).toBe(401);

    const newLegacyLoginResp = await harness.loginPost(
      postJsonRequest('https://example.com/api/auth/login', {
        username: 'hikari',
        authKey: newAuthKey,
        mode: 'legacy',
        turnstileToken: 'turnstile-ok',
      }),
    );
    expect(newLegacyLoginResp.status).toBe(200);
    const newLegacyPayload = (await newLegacyLoginResp.json()) as {
      success: boolean;
      authMode: string;
      user: { id: number; username: string };
    };
    expect(newLegacyPayload.success).toBeTrue();
    expect(newLegacyPayload.authMode).toBe('legacy');
    expect(newLegacyPayload.user.id).toBe(registerPayload.user.id);
  });
});
