import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import Database from 'better-sqlite3';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import type { AppDrizzleDb } from '@/lib/db/drizzle';
import * as schema from '@/lib/db/schema';

let sqlite: Database;
let db: AppDrizzleDb;

const BETTER_AUTH_SECRET = 'better-auth-secret-that-is-long-enough-for-validation-test';
const TEST_BASE_URL = 'http://localhost:3000/api/auth';

const exec = (sqlText: string): void => {
  sqlite.exec(sqlText);
};

const createRuntimeAuth = () =>
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
    emailAndPassword: {
      enabled: true,
    },
    rateLimit: {
      enabled: false,
    },
    advanced: {
      cookies: {},
    },
    logger: {
      level: 'error',
    },
  });

const insertResetPasswordVerification = async (input: {
  id: string;
  token: string;
  authUserId: string;
  expiresAtEpochSeconds: number;
}): Promise<void> => {
  await db.insert(schema.baVerifications).values({
    id: input.id,
    identifier: `reset-password:${input.token}`,
    value: input.authUserId,
    expiresAt: new Date(input.expiresAtEpochSeconds * 1000),
  });
};

const signUpRuntimeUser = async (
  auth: ReturnType<typeof betterAuth>,
  input: { email: string; password: string; name: string },
): Promise<{ authUserId: string }> => {
  const response = await auth.api.signUpEmail({
    body: input,
    asResponse: true,
  });

  expect(response.ok).toBe(true);

  const payload = (await response.json()) as {
    user?: {
      id?: string;
    };
  };

  expect(typeof payload.user?.id).toBe('string');

  return {
    authUserId: payload.user?.id ?? '',
  };
};

describe('better-auth drizzle runtime compatibility', () => {
  beforeEach(() => {
    sqlite = new Database(':memory:');
    db = drizzle(sqlite, { schema }) as unknown as AppDrizzleDb;

    exec(`
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
  });

  afterEach(() => {
    sqlite.close();
  });

  test('真实 better-auth 可以通过当前 drizzle schema 创建密码用户', async () => {
    const auth = createRuntimeAuth();

    await signUpRuntimeUser(auth, {
      email: 'runtime-signup@example.com',
      password: 'RuntimePass@2026',
      name: 'runtime-signup',
    });

    const row = sqlite
      .prepare<
        [],
        {
          email: string;
          createdAtType: string;
          updatedAtType: string;
        }
      >(
        `select email, typeof(created_at) as createdAtType, typeof(updated_at) as updatedAtType
         from ba_user
         where email = 'runtime-signup@example.com'
         limit 1`,
      )
      .get();

    expect(row?.email).toBe('runtime-signup@example.com');
    expect(row?.createdAtType).toBe('integer');
    expect(row?.updatedAtType).toBe('integer');
  });

  test('legacy recover 产生的 reset verification 记录能被 better-auth reset-password 消费', async () => {
    const auth = createRuntimeAuth();
    const { authUserId } = await signUpRuntimeUser(auth, {
      email: 'runtime-reset@example.com',
      password: 'RuntimePass@2026',
      name: 'runtime-reset',
    });

    await insertResetPasswordVerification({
      id: 'verify-runtime-reset',
      token: 'manual-runtime-reset-token',
      authUserId,
      expiresAtEpochSeconds: Math.floor(Date.now() / 1000) + 300,
    });

    const resetResponse = await auth.api.resetPassword({
      body: {
        token: 'manual-runtime-reset-token',
        newPassword: 'RuntimePass@2027',
      },
      asResponse: true,
    });

    expect(resetResponse.ok).toBe(true);

    const signInResponse = await auth.api.signInEmail({
      body: {
        email: 'runtime-reset@example.com',
        password: 'RuntimePass@2027',
      },
      asResponse: true,
    });

    expect(signInResponse.ok).toBe(true);
  });
});
