import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { convertV4MiniflareOptions, Miniflare } from 'miniflare';

import type { AdminDatabase } from '../src/admin/database';
import { bootstrapAdminPrincipal, revokeAdminPrincipal, restoreAdminPrincipal } from '../src/admin/principals';
import { executeAdminOperation, type AdminOperationContext } from '../src/admin/operations';

describe('Admin local native D1 batch integration', () => {
  let runtime: Miniflare;
  let db: AdminDatabase;
  beforeAll(async () => {
    runtime = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: 'admin-fixture', modules: true,
      script: 'export default { fetch() { return new Response("fixture"); } };',
      compatibilityDate: '2026-08-01', d1Databases: ['DB'] }] }));
    db = await runtime.getD1Database('DB') as unknown as AdminDatabase;
    const migration = readFileSync(new URL('../../../drizzle/0014_admin_foundation.sql', import.meta.url), 'utf8');
    await db.batch(migration.split('--> statement-breakpoint').map((sql) => db.prepare(sql.trim())));
    await db.batch([
      db.prepare('CREATE TABLE fixture_resource (id TEXT PRIMARY KEY, version INTEGER NOT NULL)'),
      db.prepare('CREATE TABLE fixture_effect (id TEXT PRIMARY KEY)'),
    ]);
    await bootstrapAdminPrincipal(db, { id: 'd1-principal', verifiedIdentity: { issuer: 'https://fixture.cloudflareaccess.com', subject: 'subject', kind: 'human' },
      capabilities: ['users.write'], allowedCapabilities: ['users.write'], requestId: 'bootstrap', reason: '本地 D1 验证', operatorSafeRef: 'local-test' });
  }, 30_000);
  afterAll(async () => { await runtime?.dispose(); });

  const context = (id: string): AdminOperationContext => ({
    actorPrincipalId: 'd1-principal', capability: 'users.write', action: 'fixture.update', authnContextSafeRef: 'local-test',
    requestId: `request-${id}`, reason: '本地 D1 事务验证', idempotencyKey: id, expectedVersion: '1',
    targetType: 'fixture', targetId: id, payload: { id },
  });
  const plan = (id: string, version = 1) => ({
    primary: { name: 'update-fixture', sql: 'UPDATE fixture_resource SET version=version+1 WHERE id=? AND version=? AND {{admin_guard}}', bindings: [id, version] },
    effects: [{ name: 'notify-fixture', sql: 'INSERT INTO fixture_effect(id) SELECT ? WHERE {{admin_guard}}', bindings: [id] }],
    result: { id, version: 2 },
  });

  it('keeps changes() CAS guards and idempotency atomic using the real D1 binding', async () => {
    await db.prepare("INSERT INTO fixture_resource VALUES ('success',1),('stale',2)").run();
    expect((await executeAdminOperation(db, context('success'), plan('success'))).status).toBe('succeeded');
    expect((await executeAdminOperation(db, context('success'), plan('success'))).replayed).toBe(true);
    expect((await executeAdminOperation(db, context('stale'), plan('stale'))).status).toBe('conflict');
    expect(await db.prepare('SELECT id FROM fixture_effect').all()).toMatchObject({ results: [{ id: 'success' }] });
    expect(await db.prepare("SELECT count(*) AS n FROM admin_audit_events WHERE result='success' AND operation_id IS NOT NULL").first()).toEqual({ n: 1 });
    await expect(executeAdminOperation(db, { ...context('success'), payload: { changed: true } }, plan('success')))
      .rejects.toMatchObject({ status: 409 });
  });

  it('rolls back all business changes and the idempotency claim when D1 audit insert aborts', async () => {
    await db.prepare("INSERT INTO fixture_resource VALUES ('rollback',1)").run();
    await db.prepare("CREATE TRIGGER fixture_fail_audit BEFORE INSERT ON admin_audit_events WHEN NEW.target_id='rollback' BEGIN SELECT RAISE(ABORT,'fixture audit failure'); END").run();
    await expect(executeAdminOperation(db, context('rollback'), plan('rollback'))).rejects.toThrow();
    expect(await db.prepare("SELECT version FROM fixture_resource WHERE id='rollback'").first()).toEqual({ version: 1 });
    expect(await db.prepare("SELECT id FROM fixture_effect WHERE id='rollback'").first()).toBeNull();
    expect(await db.prepare("SELECT id FROM admin_operations WHERE idempotency_key='rollback'").first()).toBeNull();
  });

  it('deduplicates concurrent D1 requests for the same operation key', async () => {
    await db.prepare("INSERT INTO fixture_resource VALUES ('concurrent',1)").run();
    const results = await Promise.all([
      executeAdminOperation(db, context('concurrent'), plan('concurrent')),
      executeAdminOperation(db, { ...context('concurrent'), requestId: 'concurrent-second' }, plan('concurrent')),
    ]);
    expect(new Set(results.map((result) => result.operationId)).size).toBe(1);
    expect(results.filter((result) => !result.replayed)).toHaveLength(1);
    expect(await db.prepare("SELECT version FROM fixture_resource WHERE id='concurrent'").first()).toEqual({ version: 2 });
  });

  it('rejects an already-revoked principal without touching business records', async () => {
    await revokeAdminPrincipal(db, { id: 'd1-principal', requestId: 'revoke', reason: '撤权演练', operatorSafeRef: 'local-test' });
    await expect(executeAdminOperation(db, context('revoked'), plan('success'))).rejects.toMatchObject({ status: 403 });
    expect(await db.prepare("SELECT version FROM fixture_resource WHERE id='success'").first()).toEqual({ version: 2 });
  });

  const recoveryInput = (id: string) => ({id, verifiedIdentity: {issuer: 'https://fixture.cloudflareaccess.com', subject: id, kind: 'human' as const},
    capabilities: ['audit.read'], allowedCapabilities: ['users.write','audit.read'], requestId: crypto.randomUUID(), reason: '受控恢复演练', operatorSafeRef: 'local-control'});
  const disabledPrincipal = async (id: string) => {
    await bootstrapAdminPrincipal(db, {...recoveryInput(id), capabilities: ['users.write']});
    await revokeAdminPrincipal(db, {id, requestId: crypto.randomUUID(), reason: '撤权后恢复演练', operatorSafeRef: 'local-control'});
  };
  it('restores only the same disabled human identity with explicit capabilities and one successful audit', async () => {
    await disabledPrincipal('restore-human');
    const input = recoveryInput('restore-human');
    await expect(restoreAdminPrincipal(db, {...input, verifiedIdentity: {...input.verifiedIdentity, subject: 'different-human'}})).rejects.toThrow('ADMIN_PRINCIPAL_RESTORE_DENIED');
    await expect(restoreAdminPrincipal(db, {...input, verifiedIdentity: {...input.verifiedIdentity, kind: 'service'}})).rejects.toThrow('ADMIN_PRINCIPAL_RESTORE_DENIED');
    const outcomes = await Promise.allSettled([restoreAdminPrincipal(db, input), restoreAdminPrincipal(db, {...input, requestId: crypto.randomUUID()})]);
    expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(await db.prepare("SELECT status,capabilities_json FROM admin_principals WHERE id='restore-human'").first()).toEqual({status: 'active', capabilities_json: '["audit.read"]'});
    expect(await db.prepare("SELECT count(*) AS n FROM admin_audit_events WHERE target_id='restore-human' AND action='admin.principal.restore' AND result='success'").first()).toEqual({n: 1});
  });
  it('rolls back disabled-to-active recovery when its success audit fails', async () => {
    await disabledPrincipal('restore-rollback');
    await db.prepare("CREATE TRIGGER fail_restore_audit BEFORE INSERT ON admin_audit_events WHEN NEW.action='admin.principal.restore' AND NEW.target_id='restore-rollback' BEGIN SELECT RAISE(ABORT,'fixture audit failure'); END").run();
    await expect(restoreAdminPrincipal(db, recoveryInput('restore-rollback'))).rejects.toThrow();
    expect(await db.prepare("SELECT status,capabilities_json FROM admin_principals WHERE id='restore-rollback'").first()).toEqual({status: 'disabled', capabilities_json: '["users.write"]'});
  });
  it('never bootstraps a missing identity or broadens an active principal through restore', async () => {
    await expect(restoreAdminPrincipal(db, recoveryInput('restore-missing'))).rejects.toThrow('ADMIN_PRINCIPAL_RESTORE_DENIED');
    expect(await db.prepare("SELECT id FROM admin_principals WHERE id='restore-missing'").first()).toBeNull();
    await bootstrapAdminPrincipal(db, {...recoveryInput('restore-active'), capabilities: ['users.write']});
    await expect(restoreAdminPrincipal(db, recoveryInput('restore-active'))).rejects.toThrow('ADMIN_PRINCIPAL_RESTORE_DENIED');
    expect(await db.prepare("SELECT capabilities_json FROM admin_principals WHERE id='restore-active'").first()).toEqual({capabilities_json: '["users.write"]'});
  });

});
