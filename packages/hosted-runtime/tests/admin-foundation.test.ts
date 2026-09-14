import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';

import type { AdminDatabase, AdminPreparedStatement, AdminQueryResult } from '../src/admin/database';
import { bootstrapAdminPrincipal, resolveAdminPrincipal, revokeAdminPrincipal, restoreAdminPrincipal } from '../src/admin/principals';
import { executeAdminOperation, type AdminOperationContext } from '../src/admin/operations';

type SQLiteDatabase = {
  close(): void;
  exec(_sql: string): void;
  prepare(_sql: string): {
    all(..._values: unknown[]): Record<string, unknown>[];
    get(..._values: unknown[]): Record<string, unknown> | undefined;
    run(..._values: unknown[]): { changes: number | bigint };
  };
};
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (_path: string) => SQLiteDatabase;
};
const databases: SQLiteDatabase[] = [];
afterEach(() => databases.splice(0).forEach((database) => database.close()));

const sqliteD1 = (sqlite: SQLiteDatabase): AdminDatabase => ({
  prepare(sql) {
    let values: unknown[] = [];
    const stmt: AdminPreparedStatement = {
      bind(...parameters) { values = parameters; return stmt; },
      async all<T>() { return { success: true, results: sqlite.prepare(sql).all(...values) as T[] }; },
      async first<T>() { return (sqlite.prepare(sql).get(...values) ?? null) as T | null; },
      async run() { return { success: true, results: [], meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) } }; },
    };
    return stmt;
  },
  async batch(statements) {
    sqlite.exec('BEGIN');
    try {
      const results: AdminQueryResult[] = [];
      for (const statement of statements) results.push(await statement.run());
      sqlite.exec('COMMIT');
      return results;
    } catch (error) {
      sqlite.exec('ROLLBACK');
      throw error;
    }
  },
});

const identity = { issuer: 'https://fixture.cloudflareaccess.com', subject: 'stable-subject', kind: 'human' as const };
const allowed = ['users.write', 'users.read', 'admin.shell.read'];
// Synthetic examples only; exercise the actual persistence entry points below.
const credentialPastes = [
  'Bearer opaque-fixture-token', 'Authorization: Basic fixture-credential', 'secret=fixture-value',
  '"api_key": "fixture-value"', 'access_token=fixture-token', 'session-token: fixture-token',
  'sk-fixture-provider-token', 'sk_live_fixture123456', 'sk-ant-api03-fixture123456',
  'AIzaFixtureProviderCredential12345', 'ghp_fixturecredential123456',
  'postgres://fixture:credential@db.invalid/app', 'mysql://fixture:credential@db.invalid/app',
  'rediss://:fixture-credential@db.invalid', 'mongodb+srv://fixture:credential@db.invalid/app',
  'https://fixture:credential@service.invalid', 'eyJfixture.payload.signature',
  '-----BEGIN PRIVATE KEY-----',
];
const setup = async () => {
  const sqlite = new DatabaseSync(':memory:');
  databases.push(sqlite);
  sqlite.exec('PRAGMA foreign_keys=ON');
  sqlite.exec(readFileSync(new URL('../../../drizzle/0014_admin_foundation.sql', import.meta.url), 'utf8'));
  sqlite.exec('CREATE TABLE fixture_resource(id TEXT PRIMARY KEY, version INTEGER NOT NULL, value TEXT NOT NULL)');
  sqlite.exec("INSERT INTO fixture_resource VALUES ('target-1', 1, 'before')");
  sqlite.exec('CREATE TABLE fixture_effect(id TEXT PRIMARY KEY, value TEXT NOT NULL)');
  const db = sqliteD1(sqlite);
  await bootstrapAdminPrincipal(db, {
    id: 'principal-1', verifiedIdentity: identity, capabilities: ['users.write', 'users.read'],
    allowedCapabilities: allowed, requestId: 'bootstrap-1', reason: '首位管理员配置', operatorSafeRef: 'cloudflare-account-control',
  });
  return { db, sqlite };
};

const context = (overrides: Partial<AdminOperationContext> = {}): AdminOperationContext => ({
  actorPrincipalId: 'principal-1', capability: 'users.write', action: 'fixture.update',
  authnContextSafeRef: 'verified-access', requestId: 'request-1', reason: 'fixture test',
  idempotencyKey: 'idempotency-1', expectedVersion: '1', targetType: 'fixture', targetId: 'target-1',
  payload: { value: 'after' }, ...overrides,
});
const plan = (version = 1) => ({
  primary: {
    name: 'update-fixture',
    sql: 'UPDATE fixture_resource SET version=version+1, value=? WHERE id=? AND version=? AND {{admin_guard}}',
    bindings: ['after', 'target-1', version],
  },
  effects: [{
    name: 'notify-fixture',
    sql: 'INSERT INTO fixture_effect (id,value) SELECT ?,? WHERE {{admin_guard}}',
    bindings: ['notification-1', 'notice'],
  }],
  result: { id: 'target-1', version: 2 },
});

describe('Admin principal persistence', () => {
  it.each(['bootstrap', 'revoke', 'restore'] as const)('%s rejects credential pastes in all persisted control fields', async (command) => {
    const { db, sqlite } = await setup();
    if (command === 'restore') sqlite.exec("UPDATE admin_principals SET status='disabled'");
    for (const field of ['id', 'requestId', 'reason', 'operatorSafeRef']) {
      for (const value of credentialPastes) {
        const input = { id: command === 'bootstrap' ? 'principal-2' : 'principal-1', requestId: 'control-2',
          reason: '受控恢复', operatorSafeRef: 'cloudflare-account-control', [field]: value,
          verifiedIdentity: command === 'bootstrap' ? { ...identity, subject: 'second' } : identity,
          capabilities: ['users.read'], allowedCapabilities: allowed };
        await expect(({ bootstrap: bootstrapAdminPrincipal, revoke: revokeAdminPrincipal, restore: restoreAdminPrincipal })[command](db, input))
          .rejects.toThrow(field === 'reason' ? 'ADMIN_PRINCIPAL_TOOL_REASON_UNSAFE' : 'ADMIN_PRINCIPAL_TOOL_CONTEXT_INVALID');
      }
    }
    expect(sqlite.prepare('SELECT count(*) AS n FROM admin_audit_events').get()?.n).toBe(1);
    expect(sqlite.prepare('SELECT count(*) AS n FROM admin_principals').get()?.n).toBe(1);
    expect((await resolveAdminPrincipal(db, identity, allowed))?.status).toBe(command === 'restore' ? 'disabled' : 'active');
  });

  it('uses exact stable issuer/subject/kind, validates capability allowlist, and reads revocation every time', async () => {
    const { db, sqlite } = await setup();
    expect((await resolveAdminPrincipal(db, identity, allowed))?.status).toBe('active');
    expect(await resolveAdminPrincipal(db, { ...identity, kind: 'service' }, allowed)).toBeNull();
    expect(await resolveAdminPrincipal(db, { ...identity, issuer: `${identity.issuer}/other` }, allowed)).toBeNull();
    await revokeAdminPrincipal(db, { id: 'principal-1', requestId: 'revoke-1', reason: '设备丢失', operatorSafeRef: 'cloudflare-account-control' });
    expect((await resolveAdminPrincipal(db, identity, allowed))?.status).toBe('disabled');
    expect(sqlite.prepare('SELECT count(*) AS n FROM admin_audit_events').get()?.n).toBe(2);
    sqlite.exec("UPDATE admin_principals SET capabilities_json='[\"unregistered.write\"]'");
    await expect(resolveAdminPrincipal(db, identity, allowed)).rejects.toThrow('ADMIN_PRINCIPAL_INVALID');
  });

  it('rolls back bootstrap/revoke when audit persistence fails', async () => {
    const { db, sqlite } = await setup();
    sqlite.exec("CREATE TRIGGER fail_audit BEFORE INSERT ON admin_audit_events BEGIN SELECT RAISE(ABORT,'fixture audit failure'); END");
    await expect(revokeAdminPrincipal(db, { id: 'principal-1', requestId: 'r2', reason: '撤权', operatorSafeRef: 'control' })).rejects.toThrow();
    expect((await resolveAdminPrincipal(db, identity, allowed))?.status).toBe('active');
    await expect(bootstrapAdminPrincipal(db, { id: 'principal-2', verifiedIdentity: { ...identity, subject: 'second' }, capabilities: ['users.read'], allowedCapabilities: allowed, requestId: 'b2', reason: '配置', operatorSafeRef: 'control' })).rejects.toThrow();
    expect(await resolveAdminPrincipal(db, { ...identity, subject: 'second' }, allowed)).toBeNull();
  });
});

describe('Admin native D1 transaction semantics', () => {
  it('rejects credentials in every persisted context field without claims, audit rows or business effects', async () => {
    const { db, sqlite } = await setup();
    for (const field of ['actorPrincipalId', 'capability', 'action', 'authnContextSafeRef', 'requestId',
      'reason', 'idempotencyKey', 'expectedVersion', 'targetType', 'targetId']) {
      for (const value of credentialPastes) {
        await expect(executeAdminOperation(db, context({ [field]: value }), plan())).rejects.toMatchObject({
          code: field === 'reason' ? 'ADMIN_OPERATION_REASON_UNSAFE' : 'ADMIN_OPERATION_CONTEXT_INVALID', status: 400,
        });
      }
    }
    expect(sqlite.prepare('SELECT count(*) AS n FROM admin_operations').get()?.n).toBe(0);
    expect(sqlite.prepare('SELECT count(*) AS n FROM admin_audit_events').get()?.n).toBe(1);
    expect(sqlite.prepare('SELECT count(*) AS n FROM fixture_effect').get()?.n).toBe(0);
    expect(sqlite.prepare('SELECT value FROM fixture_resource').get()?.value).toBe('before');
  });

  it('atomically stores business state, effects, success audit and result; retries do not replay', async () => {
    const { db, sqlite } = await setup();
    const result = await executeAdminOperation(db, context(), plan());
    expect(result).toMatchObject({ status: 'succeeded', result: { version: 2 }, replayed: false });
    const replay = await executeAdminOperation(db, context({ requestId: 'request-2' }), plan());
    expect(replay).toMatchObject({ operationId: result.operationId, replayed: true });
    expect(sqlite.prepare('SELECT version FROM fixture_resource').get()?.version).toBe(2);
    expect(sqlite.prepare('SELECT count(*) AS n FROM fixture_effect').get()?.n).toBe(1);
    expect(sqlite.prepare("SELECT count(*) AS n FROM admin_audit_events WHERE operation_id IS NOT NULL AND result='success'").get()?.n).toBe(1);
  });

  it('does not run effects or write a success audit after zero-row CAS', async () => {
    const { db, sqlite } = await setup();
    const result = await executeAdminOperation(db, context({ expectedVersion: '0' }), plan(0));
    expect(result.status).toBe('conflict');
    expect(sqlite.prepare('SELECT value FROM fixture_resource').get()?.value).toBe('before');
    expect(sqlite.prepare('SELECT count(*) AS n FROM fixture_effect').get()?.n).toBe(0);
    expect(sqlite.prepare("SELECT count(*) AS n FROM admin_audit_events WHERE operation_id IS NOT NULL AND result='success'").get()?.n).toBe(0);
  });

  it('rejects idempotency key reuse with a different action or payload and does not overwrite', async () => {
    const { db, sqlite } = await setup();
    await executeAdminOperation(db, context(), plan());
    await expect(executeAdminOperation(db, context({ payload: { value: 'different' } }), plan())).rejects.toMatchObject({ code: 'ADMIN_IDEMPOTENCY_CONFLICT', status: 409 });
    await expect(executeAdminOperation(db, context({ action: 'fixture.delete' }), plan())).rejects.toMatchObject({ status: 409 });
    expect(sqlite.prepare('SELECT version FROM fixture_resource').get()?.version).toBe(2);
  });

  it('canonicalizes payload key order without storing the payload in audit or operation rows', async () => {
    const { db, sqlite } = await setup();
    await executeAdminOperation(db, context({ payload: { b: 2, a: 'private content' } }), plan());
    expect((await executeAdminOperation(db, context({ payload: { a: 'private content', b: 2 } }), plan())).replayed).toBe(true);
    expect(JSON.stringify(sqlite.prepare('SELECT * FROM admin_operations').all())).not.toContain('private content');
    expect(JSON.stringify(sqlite.prepare('SELECT * FROM admin_audit_events').all())).not.toContain('private content');
  });

  it('rolls back primary, effects and idempotency claim on audit failure', async () => {
    const { db, sqlite } = await setup();
    sqlite.exec("CREATE TRIGGER fail_audit BEFORE INSERT ON admin_audit_events BEGIN SELECT RAISE(ABORT,'fixture audit failure'); END");
    await expect(executeAdminOperation(db, context(), plan())).rejects.toThrow();
    expect(sqlite.prepare('SELECT value FROM fixture_resource').get()?.value).toBe('before');
    expect(sqlite.prepare('SELECT count(*) AS n FROM fixture_effect').get()?.n).toBe(0);
    expect(sqlite.prepare('SELECT count(*) AS n FROM admin_operations').get()?.n).toBe(0);
  });

  it('rolls back even when an audit trigger silently ignores the insert', async () => {
    const { db, sqlite } = await setup();
    sqlite.exec('CREATE TRIGGER ignore_audit BEFORE INSERT ON admin_audit_events BEGIN SELECT RAISE(IGNORE); END');
    await expect(executeAdminOperation(db, context(), plan())).rejects.toThrow();
    expect(sqlite.prepare('SELECT value FROM fixture_resource').get()?.value).toBe('before');
    expect(sqlite.prepare('SELECT count(*) AS n FROM admin_operations').get()?.n).toBe(0);
  });

  it('bounds nested payloads and rejects obvious credentials/control characters before any write', async () => {
    const { db, sqlite } = await setup();
    let nested: unknown = {};
    for (let i = 0; i < 40; i++) nested = { child: nested };
    await expect(executeAdminOperation(db, context({ payload: nested }), plan())).rejects.toMatchObject({ status: 400 });
    await expect(executeAdminOperation(db, context({ reason: 'password=credential' }), plan())).rejects.toMatchObject({ code: 'ADMIN_OPERATION_REASON_UNSAFE' });
    await expect(executeAdminOperation(db, context({ reason: 'a\u001bb' }), plan())).rejects.toMatchObject({ status: 400 });
    expect(sqlite.prepare('SELECT count(*) AS n FROM admin_operations').get()?.n).toBe(0);
  });

  it('rechecks actor status and capability within transaction', async () => {
    const { db, sqlite } = await setup();
    sqlite.exec("UPDATE admin_principals SET status='disabled'");
    await expect(executeAdminOperation(db, context(), plan())).rejects.toMatchObject({ code: 'ADMIN_OPERATION_DENIED', status: 403 });
    sqlite.exec("UPDATE admin_principals SET status='active', capabilities_json='[\"users.read\"]'");
    await expect(executeAdminOperation(db, context(), plan())).rejects.toMatchObject({ status: 403 });
    expect(sqlite.prepare('SELECT value FROM fixture_resource').get()?.value).toBe('before');
  });

  it('rejects missing guards before executing any database statements', async () => {
    const { db, sqlite } = await setup();
    const unsafe = plan();
    unsafe.effects[0].sql = 'DELETE FROM fixture_effect';
    await expect(executeAdminOperation(db, context(), unsafe)).rejects.toThrow('ADMIN_STATEMENT_GUARD_REQUIRED');
    expect(sqlite.prepare('SELECT count(*) AS n FROM admin_operations').get()?.n).toBe(0);
  });

  it('rolls back an unexpected multi-row primary update', async () => {
    const { db, sqlite } = await setup();
    sqlite.exec("INSERT INTO fixture_resource VALUES ('target-2',1,'before')");
    const unsafe = plan();
    unsafe.primary.sql = 'UPDATE fixture_resource SET version=version+1 WHERE {{admin_guard}}';
    unsafe.primary.bindings = [];
    await expect(executeAdminOperation(db, context(), unsafe)).rejects.toThrow();
    expect(sqlite.prepare('SELECT sum(version) AS n FROM fixture_resource').get()?.n).toBe(2);
  });
});
