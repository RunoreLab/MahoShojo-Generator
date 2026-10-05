import { beforeEach, describe, expect, test, vi } from 'vitest';

import {
  buildDesktopGrantRedirectUrl,
  decodeDesktopGrantRecord,
  desktopGrantIdentifierFromCode,
  encodeDesktopGrantRecord,
  generateDesktopGrantCode,
  parseDesktopAuthorizeQuery,
  verifyDesktopCodeVerifier,
} from '@/lib/auth/native-desktop';

const sha256Base64Url = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  let binary = '';
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '');
};

describe('native-desktop 协议核心', () => {
  test('grant code 为 43 字符 base64url 且不可预测', () => {
    const a = generateDesktopGrantCode();
    const b = generateDesktopGrantCode();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(b).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(a).not.toBe(b);
  });

  test('code 的存储键是 sha256 派生值，不含明文', async () => {
    const code = generateDesktopGrantCode();
    const identifier = await desktopGrantIdentifierFromCode(code);
    expect(identifier.startsWith('desktop-native-grant:')).toBe(true);
    expect(identifier.includes(code)).toBe(false);
    expect(identifier).toMatch(/^desktop-native-grant:[0-9a-f]{64}$/u);
  });

  test('S256 verifier 校验', async () => {
    const verifier = 'a'.repeat(50);
    const challenge = await sha256Base64Url(verifier);
    expect(await verifyDesktopCodeVerifier(verifier, challenge)).toBe(true);
    expect(await verifyDesktopCodeVerifier('b'.repeat(50), challenge)).toBe(false);
    expect(await verifyDesktopCodeVerifier(verifier, 'x'.repeat(44))).toBe(false);
  });

  test('redirectUrl 使用记录的 redirectUri 并仅附加 code/state', () => {
    const url = buildDesktopGrantRedirectUrl({
      redirectUri: 'http://127.0.0.1:45231/callback',
      code: 'code-value',
      state: 'state-value',
    });
    const parsed = new URL(url);
    expect(`${parsed.protocol}//${parsed.host}${parsed.pathname}`).toBe('http://127.0.0.1:45231/callback');
    expect(parsed.searchParams.get('code')).toBe('code-value');
    expect(parsed.searchParams.get('state')).toBe('state-value');
    expect([...parsed.searchParams.keys()].sort()).toEqual(['code', 'state']);
  });

  test('授权页 query 解析：缺失/非法各归一类', () => {
    const valid = {
      state: 'abc',
      code_challenge: 'x'.repeat(43),
      code_challenge_method: 'S256',
      redirect_uri: 'http://127.0.0.1:8080/callback',
    };
    expect(parseDesktopAuthorizeQuery(valid).ok).toBe(true);
    expect(parseDesktopAuthorizeQuery({ ...valid, state: undefined }).reason).toBe('missing');
    expect(parseDesktopAuthorizeQuery({ ...valid, state: ['a', 'b'] }).reason).toBe('missing');
    expect(parseDesktopAuthorizeQuery({ ...valid, redirect_uri: 'https://127.0.0.1:1/callback' }).reason)
      .toBe('invalid');
    expect(parseDesktopAuthorizeQuery({ ...valid, code_challenge_method: 'plain' }).reason)
      .toBe('invalid');
  });

  test('grant record 编解码往返 + 拒收异构载荷', () => {
    const record = {
      v: 1 as const,
      authUserId: 'au_1',
      businessUserId: 9,
      codeChallenge: 'c'.repeat(43),
      redirectUri: 'http://127.0.0.1:1/callback',
      state: 'st',
    };
    expect(decodeDesktopGrantRecord(encodeDesktopGrantRecord(record))).toEqual(record);
    expect(decodeDesktopGrantRecord('not-json')).toBeNull();
    expect(decodeDesktopGrantRecord('{"v":2}')).toBeNull();
    expect(decodeDesktopGrantRecord(JSON.stringify({ ...record, businessUserId: '9' }))).toBeNull();
  });
});

// ── 端点级集成：真实 better-auth 实例 + better-sqlite3 ────────────────────

import Database from 'better-sqlite3';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import * as schema from '@/lib/db/schema';
import { desktopNativeAuthPlugin } from '@/lib/auth/native-desktop-plugin';
import { __resetAuthAttemptRateLimitForTest } from '@/lib/auth/attempt-rate-limit';
import type { AppDrizzleDb } from '@/lib/db/drizzle';

const mockBusinessUser = {
  id: 7,
  username: 'homura',
  email: 'homura@example.com',
  isBanned: null,
};

vi.mock('@/lib/auth/user-auth-linking', () => ({
  getLinkedBusinessUserByAuthUserId: vi.fn(async () => mockBusinessUser),
  ensureAuthUserLink: vi.fn(async () => mockBusinessUser),
}));

const TEST_BASE_URL = 'http://localhost:3000/api/auth';
const BETTER_AUTH_SECRET = 'better-auth-secret-that-is-long-enough-for-desktop-native-test';

let sqlite: Database.Database;
let db: AppDrizzleDb;
let auth: ReturnType<typeof betterAuth>;

const createAuth = () =>
  betterAuth({
    database: drizzleAdapter(db, {
      provider: 'sqlite',
      schema: {
        user: schema.baUsers,
        session: schema.baSessions,
        account: schema.baAccounts,
        verification: schema.baVerifications,
      },
    }),
    secret: BETTER_AUTH_SECRET,
    baseURL: TEST_BASE_URL,
    emailAndPassword: { enabled: true },
    rateLimit: { enabled: false },
    logger: { level: 'error' },
    plugins: [desktopNativeAuthPlugin()],
  });

const extractSessionCookie = (response: Response): string => {
  const setCookies = response.headers.getSetCookie();
  const match = setCookies
    .map((entry) => entry.match(/^(better-auth\.session_token=[^;,]+)/u)?.[1])
    .find((value): value is string => Boolean(value));
  expect(match, 'set-cookie 必须包含 session_token').toBeTruthy();
  return match!;
};

const signUpAndGetCookie = async (): Promise<string> => {
  const response = await auth.api.signUpEmail({
    body: { email: 'homura@example.com', password: 'correct-horse-battery', name: 'homura' },
    asResponse: true,
  });
  expect(response.ok).toBe(true);
  return extractSessionCookie(response);
};

const postJson = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  auth.handler(new Request(`${TEST_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  }));

const grantBody = {
  state: 'state-abc',
  codeChallenge: 'x'.repeat(43),
  codeChallengeMethod: 'S256',
  redirectUri: 'http://127.0.0.1:45231/callback',
};

describe('desktop-auth-v1 端点集成', () => {
  beforeEach(async () => {
    sqlite = new Database(':memory:');
    db = drizzle(sqlite, { schema }) as unknown as AppDrizzleDb;
    sqlite.exec(`
      CREATE TABLE ba_user (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        email_verified INTEGER NOT NULL DEFAULT 0,
        image TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
      CREATE UNIQUE INDEX ba_user_email_unique ON ba_user(email);
      CREATE TABLE ba_session (
        id TEXT PRIMARY KEY NOT NULL,
        expires_at INTEGER NOT NULL,
        token TEXT NOT NULL,
        ip_address TEXT,
        user_agent TEXT,
        user_id TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
      CREATE UNIQUE INDEX ba_session_token_unique ON ba_session(token);
      CREATE TABLE ba_account (
        id TEXT PRIMARY KEY NOT NULL,
        account_id TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        access_token TEXT,
        refresh_token TEXT,
        id_token TEXT,
        access_token_expires_at INTEGER,
        refresh_token_expires_at INTEGER,
        scope TEXT,
        password TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
      CREATE TABLE ba_verification (
        id TEXT PRIMARY KEY NOT NULL,
        identifier TEXT NOT NULL,
        value TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
    `);
    auth = createAuth();
    __resetAuthAttemptRateLimitForTest();
  });

  test('grant 无会话 → 401', async () => {
    const response = await postJson('/native/grant', grantBody);
    expect(response.status).toBe(401);
  });

  test('grant 会话 + 非法 redirectUri → 4xx', async () => {
    const cookie = await signUpAndGetCookie();
    const response = await postJson('/native/grant', {
      ...grantBody,
      redirectUri: 'https://127.0.0.1:45231/callback',
    }, { Cookie: cookie, Origin: 'http://localhost:3000' });
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
  });

  test('grant → exchange 完整流程建立可用会话', async () => {
    const cookie = await signUpAndGetCookie();

    const grantResponse = await postJson('/native/grant', grantBody, {
      Cookie: cookie,
      Origin: 'http://localhost:3000',
    });
    expect(grantResponse.status).toBe(200);
    const grant = await grantResponse.json() as {
      protocolVersion: string;
      redirectUrl: string;
      expiresInSeconds: number;
    };
    expect(grant.protocolVersion).toBe('desktop-auth-v1');
    expect(grant.expiresInSeconds).toBe(120);

    const redirect = new URL(grant.redirectUrl);
    expect(`${redirect.protocol}//${redirect.host}${redirect.pathname}`)
      .toBe('http://127.0.0.1:45231/callback');
    const code = redirect.searchParams.get('code');
    expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(redirect.searchParams.get('state')).toBe('state-abc');

    // 正确的 verifier（challenge = sha256(verifier)）。
    const verifier = 'v'.repeat(50);
    const realChallenge = await sha256Base64Url(verifier);

    // 先验错误 verifier：code 被原子消费，重放同样失败。
    const badExchange = await postJson('/native/exchange', {
      protocolVersion: 'desktop-auth-v1',
      code,
      codeVerifier: 'w'.repeat(50),
    });
    expect(badExchange.status).toBe(401);
    const replay = await postJson('/native/exchange', {
      protocolVersion: 'desktop-auth-v1',
      code,
      codeVerifier: verifier,
    });
    expect(replay.status).toBe(401);

    // 重新授权一次，这次 challenge 与 verifier 匹配。
    const grant2 = await postJson('/native/grant', {
      ...grantBody,
      codeChallenge: realChallenge,
    }, { Cookie: cookie, Origin: 'http://localhost:3000' });
    expect(grant2.status).toBe(200);
    const code2 = new URL((await grant2.json() as { redirectUrl: string }).redirectUrl)
      .searchParams.get('code');

    const exchange = await postJson('/native/exchange', {
      protocolVersion: 'desktop-auth-v1',
      code: code2,
      codeVerifier: verifier,
    });
    expect(exchange.status).toBe(200);
    const payload = await exchange.json() as {
      protocolVersion: string;
      account: { userId: number; username: string };
      sessionExpiresAt: string;
    };
    expect(payload.protocolVersion).toBe('desktop-auth-v1');
    expect(payload.account).toEqual({ userId: 7, username: 'homura', displayName: 'homura' });
    expect(Number.isNaN(Date.parse(payload.sessionExpiresAt))).toBe(false);

    // Set-Cookie 里有签名的 session_token；用它调 get-session 应返回有效会话。
    const nativeCookie = extractSessionCookie(exchange);
    const sessionCheck = await auth.handler(new Request(`${TEST_BASE_URL}/get-session`, {
      headers: { Cookie: nativeCookie },
    }));
    expect(sessionCheck.status).toBe(200);
    const sessionPayload = await sessionCheck.json() as { session?: { userId?: string } | null };
    expect(sessionPayload.session?.userId).toBeTruthy();
  });

  test('exchange 协议版本不匹配 → 4xx', async () => {
    const response = await postJson('/native/exchange', {
      protocolVersion: 'desktop-auth-v2',
      code: 'x'.repeat(43),
      codeVerifier: 'v'.repeat(50),
    });
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
  });
});
