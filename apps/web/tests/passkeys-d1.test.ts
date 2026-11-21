import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { convertV4MiniflareOptions, Miniflare } from 'miniflare';
import { __resetAuthAttemptRateLimitForTest } from '@/lib/auth/attempt-rate-limit';
import { readPasskeyConfig } from '@/lib/auth/passkey-config';
import { createDrizzleDb, type AppDrizzleDb } from '@/lib/db/drizzle';
import {
  addPasskey, consumePasskeyChallenge, deletePasskey, listOwnedPasskeys, renamePasskey,
  savePasskeyChallenge, type PasskeyActor,
} from '@/lib/db/repositories/passkeys';

const ORIGIN = 'http://localhost:3003';
const PASSWORD = 'Passkey-D1-fixture$521';
type Auth = NonNullable<ReturnType<typeof import('@/lib/auth/better-auth-app').getBetterAuthInstance>>;
type Fixture = { actor: PasskeyActor; cookie: string };

let runtime: Miniflare;
let db: AppDrizzleDb;
let auth: Auth;
let alice: Fixture;
let bob: Fixture;

async function post(path: string, body: unknown, cookie = '', origin = ORIGIN) {
  return auth.handler(new Request(`${ORIGIN}/api/auth/passkey/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie, origin },
    body: JSON.stringify(body),
  }));
}

async function createAccount(name: string): Promise<Fixture> {
  const response = await auth.api.signUpEmail({
    body: { name, email: `${name}@example.test`, password: PASSWORD },
    asResponse: true,
  });
  expect(response.ok).toBe(true);
  const cookie = response.headers.getSetCookie().find((entry) => entry.startsWith('better-auth.session_token='))!.split(';')[0];
  const session = await auth.api.getSession({ headers: new Headers({ cookie }) });
  expect(session?.session.id).toBeTruthy();
  const { getLinkedBusinessUserByAuthUserId } = await import('@/lib/auth/user-auth-linking');
  const business = await getLinkedBusinessUserByAuthUserId(session!.user.id);
  expect(business?.id).toBeTruthy();
  return {
    cookie, actor: {
      rpId: 'localhost', sessionId: session!.session.id, authUserId: session!.user.id, businessUserId: business!.id,
    },
  };
}

describe('通行密钥与本地 D1', () => {
  beforeAll(async () => {
    vi.stubEnv('BETTER_AUTH_URL', ORIGIN);
    vi.stubEnv('PASSKEY_ORIGIN', ORIGIN);
    vi.stubEnv('BETTER_AUTH_SECRET', 'synthetic-test-secret-for-passkeys-d1-000');
    runtime = new Miniflare(convertV4MiniflareOptions({ workers: [{
      name: 'passkey-fixture', modules: true, script: 'export default { fetch() { return new Response("fixture"); } };',
      compatibilityDate: '2024-09-23', d1Databases: ['DB'],
    }] }));
    const binding = await runtime.getD1Database('DB');
    vi.stubGlobal('__MAHOSHOJO_D1__', binding);
    db = createDrizzleDb(binding);
    const schema = readFileSync(new URL('../lib/database/schema.sql', import.meta.url), 'utf8');
    const users = schema.match(/^CREATE TABLE IF NOT EXISTS users \([\s\S]+?^\);/mu)?.[0];
    if (!users) throw new Error('数据库夹具缺少 users 定义。');
    await binding.prepare(users).run();
    for (const file of [
      '../../../drizzle/0000_auth_domain_bootstrap.sql',
      '../../../drizzle/0003_auth_audit_logs.sql',
      '../../../drizzle/0022_auth_passkeys.sql',
    ]) {
      const sql = readFileSync(new URL(file, import.meta.url), 'utf8')
        .replace(/^\s*--.*$/gmu, '').split(';').map((entry) => entry.trim()).filter(Boolean);
      await binding.batch(sql.map((statement) => binding.prepare(statement)));
    }
    const { getBetterAuthInstance } = await import('@/lib/auth/better-auth-app');
    auth = getBetterAuthInstance()!;
    alice = await createAccount('alice');
    bob = await createAccount('bob');
  }, 45_000);

  afterAll(async () => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    __resetAuthAttemptRateLimitForTest();
    await runtime?.dispose();
  });

  it('要求当前密码、有权威会话，且将注册选项固定到可发现凭据和设备验证', async () => {
    const options = 'register-options';
    expect((await post(options, { confirmation: { method: 'password', password: PASSWORD } })).status).toBe(401);
    expect((await post(options, { confirmation: { method: 'password', password: PASSWORD } },
      alice.cookie, 'http://localhost:3004')).status).toBe(403);
    const rejected = await post(options, { confirmation: { method: 'password', password: 'incorrect' } }, alice.cookie);
    expect(rejected.status).toBe(401);
    expect(await rejected.json()).toMatchObject({ code: 'PASSKEY_WRONG_PASSWORD' });
    expect((await post('confirm-options', { kind: 'register' }, alice.cookie)).status).toBe(403);

    const password = { confirmation: { method: 'password', password: PASSWORD } };
    const first = await post(options, password, alice.cookie);
    expect(first.status).toBe(200);
    expect(first.headers.get('cache-control')).toBe('no-store');
    const one = await first.json();
    const two = await (await post(options, password, alice.cookie)).json();
    const other = await (await post(options, password, bob.cookie)).json();
    expect(one.options).toMatchObject({
      rp: { id: 'localhost' },
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    });
    expect(two.options.user.id).toBe(one.options.user.id);
    expect(two.options.challenge).not.toBe(one.options.challenge);
    expect(other.options.user.id).not.toBe(one.options.user.id);

    const login = await post('login-options', {});
    expect((await login.json()).options).toMatchObject({ rpId: 'localhost', userVerification: 'required', allowCredentials: [] });
    expect(login.headers.getSetCookie().join(' ')).toMatch(/passkey_login=.*HttpOnly.*SameSite=Strict/iu);
  });

  it('在 D1 原子消费中校验用途、归属会话和有效期', async () => {
    const now = Date.now();
    const key = { id: crypto.randomUUID(), rpId: 'localhost', purpose: 'register' as const, binding: alice.actor.sessionId };
    await savePasskeyChallenge(db, { ...key, challenge: 'fixture', expiresAt: now + 10_000, confirmedByPasskeyId: null }, now);
    expect(await consumePasskeyChallenge(db, { ...key, purpose: 'login' }, now)).toBeUndefined();
    expect(await consumePasskeyChallenge(db, { ...key, binding: bob.actor.sessionId }, now)).toBeUndefined();
    expect(await consumePasskeyChallenge(db, key, now + 10_000)).toBeUndefined();
    const results = await Promise.all([
      consumePasskeyChallenge(db, key, now),
      consumePasskeyChallenge(db, key, now),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('约束凭据归属、重复绑定、账号容量及并发删除最后一把', async () => {
    const newKey = () => {
      const id = crypto.randomUUID();
      return {
        id, credentialId: id, publicKey: 'fixture', counter: 0, deviceType: 'singleDevice' as const,
        transports: ['internal'], name: '测试凭据', createdAt: Date.now(),
      };
    };
    const first = newKey();
    const second = newKey();
    expect(await addPasskey(db, alice.actor, first, null)).toEqual({ id: first.id });
    expect(await addPasskey(db, alice.actor, second, first.id)).toEqual({ id: second.id });
    expect(await addPasskey(db, bob.actor, { ...newKey(), credentialId: first.credentialId }, null)).toBeFalsy();
    expect(await renamePasskey(db, bob.actor, first.id, '越权')).toBeUndefined();
    expect(await deletePasskey(db, bob.actor, first.id, null)).toBeUndefined();

    const removed = await Promise.all([
      deletePasskey(db, alice.actor, first.id, second.id),
      deletePasskey(db, alice.actor, second.id, first.id),
    ]);
    expect(removed.filter(Boolean)).toHaveLength(1);
    const [last] = await listOwnedPasskeys(db, alice.actor);
    expect(await deletePasskey(db, alice.actor, last.id, last.id)).toBeUndefined();
    expect(await deletePasskey(db, alice.actor, last.id, null)).toEqual({ id: last.id });
    expect(await addPasskey(db, alice.actor, newKey(), last.id)).toBeFalsy();

    const additions = await Promise.all(Array.from({ length: 11 }, () => addPasskey(db, bob.actor, newKey(), null)));
    expect(additions.filter(Boolean)).toHaveLength(10);
  });
});

it('只为显式匹配的生产 origin 或独立测试 origin 启用通行密钥', () => {
  const config = (target: string, origin: string, baseUrl = origin) => readPasskeyConfig({
    NEXT_PUBLIC_HOSTED_API_ENVIRONMENT: target, PASSKEY_ORIGIN: origin, BETTER_AUTH_URL: baseUrl,
  });
  expect(config('production', 'https://mahoshojo.colanns.me')?.rpId).toBe('mahoshojo.colanns.me');
  expect(config('production', 'https://api.mahoshojo.colanns.me')).toBeNull();
  expect(config('production', 'https://mahoshojo.colanns.me:3000')).toBeNull();
  expect(config('production', 'https://mahoshojo.colanns.me', 'https://example.test')).toBeNull();
  expect(config('preview', 'https://mahoshojo.colanns.me')).toBeNull();
  expect(config('preview', 'https://isolated.example.test')?.rpId).toBe('isolated.example.test');
  expect(config('local', ORIGIN)?.rpId).toBe('localhost');
  expect(config('local', 'http://127.0.0.1:3003')).toBeNull();
});
