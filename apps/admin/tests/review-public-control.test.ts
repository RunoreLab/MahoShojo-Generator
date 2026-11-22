import { afterEach, beforeEach, expect, test } from 'vitest';
import path from 'node:path';
import { createLocalFixture } from '../scripts/local-fixture';
import { executeReviewItem, hashReviewedCard, inspectReviewCard, previewReviewItem, validateReviewPlan, verifyControlIdentity, type CardSnapshot } from '../scripts/review-public-control';
import { createD1HttpTransport, createHttpD1Client } from '@mahoshojo/hosted-runtime/d1-http-client';
import type { AdminDatabase, AdminPreparedStatement } from '@mahoshojo/hosted-runtime/admin/database';

const repositoryRoot = path.resolve(import.meta.dirname, '../../..');
const accountId = 'a'.repeat(32);
const databaseId = '11111111-1111-4111-8111-111111111111';
const actorRef = 'cf-user-token:' + 'b'.repeat(64);
const cardSql = 'SELECT id,user_id,type,name,description,data,is_public,public_since,review_status,is_recommended,updated_at,deleted_at FROM data_cards WHERE id=?';
let fixture: Awaited<ReturnType<typeof createLocalFixture>>;

beforeEach(async () => {
  fixture = await createLocalFixture(repositoryRoot);
  await fixture.db.prepare("UPDATE data_cards SET is_public=1,public_since='2026-11-22T00:00:00.000Z',review_status='pending',deleted_at=NULL WHERE id='fixture-card-1'").run();
});
afterEach(async () => { await fixture?.dispose(); });

async function plan(id = 'fixture-card-1') {
  const row = await fixture.db.prepare(cardSql).bind(id).first<CardSnapshot>();
  if (!row) throw new Error(`Missing fixture card ${id}`);
  return { version: 1 as const, accountId, databaseId, requestId: crypto.randomUUID(), createdAt: new Date().toISOString(), reason: '合成人工审核通过',
    items: [{id, reviewedHash: await hashReviewedCard(row)}] };
}
async function auditRows() {
  return fixture.db.prepare("SELECT * FROM admin_audit_events WHERE source_context_safe='cloudflare-d1-control-tool' ORDER BY id").all<Record<string, unknown>>();
}

test('公开待审卡通过时只改变审核状态与更新时间，并写入最小身份审计', async () => {
  const review = await plan();
  const before = await fixture.db.prepare(cardSql).bind('fixture-card-1').first<Record<string, unknown>>();
  const result = await executeReviewItem(fixture.db, review, review.items[0], actorRef);
  const after = await fixture.db.prepare(cardSql).bind('fixture-card-1').first<Record<string, unknown>>();
  expect(result).toEqual({id: 'fixture-card-1', status: 'success', replayed: false});
  expect(after).toMatchObject({is_public: 1, review_status: 'approved', name: before?.name, description: before?.description, data: before?.data, type: before?.type});
  expect(after?.updated_at).not.toBe(before?.updated_at);
  const rows = await auditRows();
  expect(rows.results).toHaveLength(1);
  expect(rows.results[0]).toMatchObject({actor_principal_id: null, operation_id: null, authn_context_safe_ref: actorRef,
    capability: 'content.review.control', action: 'cards.review.control.approve', target_type: 'data-cards', target_id: 'fixture-card-1',
    request_id: review.requestId, reason: review.reason, expected_version: review.items[0].reviewedHash,
    result: 'success', source_context_safe: 'cloudflare-d1-control-tool'});
  expect(JSON.stringify(rows.results[0])).not.toContain(String(before?.data));
  // The safe reference labels its credential class as a token, but never stores the credential itself.
  expect(JSON.stringify(rows.results[0])).not.toContain('synthetic-secret');
});

test('同 request 重放幂等；reason、fingerprint 或身份变化拒绝覆盖原请求', async () => {
  const review = await plan(); const item = review.items[0];
  expect(await executeReviewItem(fixture.db, review, item, actorRef)).toMatchObject({status: 'success', replayed: false});
  const updatedAt = (await fixture.db.prepare(cardSql).bind(item.id).first<{updated_at: string}>())?.updated_at;
  expect(await executeReviewItem(fixture.db, review, item, actorRef)).toMatchObject({status: 'success', replayed: true});
  expect((await fixture.db.prepare(cardSql).bind(item.id).first<{updated_at: string}>())?.updated_at).toBe(updatedAt);
  await expect(executeReviewItem(fixture.db, {...review, reason: '变更原因'}, item, actorRef)).rejects.toThrow();
  await expect(executeReviewItem(fixture.db, {...review, items: [{...item, reviewedHash: 'f'.repeat(64)}]}, {...item, reviewedHash: 'f'.repeat(64)}, actorRef)).rejects.toThrow();
  await expect(executeReviewItem(fixture.db, review, item, 'cf-user-token:' + 'c'.repeat(64))).rejects.toThrow();
  expect((await auditRows()).results).toHaveLength(1);
});

test('同 request 不得增加、减少或重排计划目标', async () => {
  const review = await plan();
  await fixture.db.prepare("UPDATE data_cards SET is_public=1,review_status='pending' WHERE id='fixture-card-2'").run();
  const second = await fixture.db.prepare(cardSql).bind('fixture-card-2').first<CardSnapshot>();
  if (!second) throw new Error('Missing fixture card');
  const secondItem = {id: second.id, reviewedHash: hashReviewedCard(second)};
  expect(await executeReviewItem(fixture.db, review, review.items[0], actorRef)).toMatchObject({status: 'success'});
  const expanded = {...review, items: [...review.items, secondItem]};
  await expect(executeReviewItem(fixture.db, expanded, secondItem, actorRef)).rejects.toThrow('CONTROL_IDEMPOTENCY_CONFLICT');
  expect((await fixture.db.prepare(cardSql).bind(second.id).first<{review_status: string}>())?.review_status).toBe('pending');
  expect((await auditRows()).results).toHaveLength(1);
});

test('不同计划并发争用同一 request 时最多一份获准执行', async () => {
  const first = await plan();
  await fixture.db.prepare("UPDATE data_cards SET is_public=1,review_status='pending' WHERE id='fixture-card-2'").run();
  const second = await fixture.db.prepare(cardSql).bind('fixture-card-2').first<CardSnapshot>();
  if (!second) throw new Error('Missing fixture card');
  const secondItem = {id: second.id, reviewedHash: hashReviewedCard(second)};
  const other = {...first, items: [secondItem]};
  const results = await Promise.allSettled([
    executeReviewItem(fixture.db, first, first.items[0], actorRef),
    executeReviewItem(fixture.db, other, secondItem, actorRef),
  ]);
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
  const cards = await fixture.db.prepare("SELECT review_status FROM data_cards WHERE id IN ('fixture-card-1','fixture-card-2')").all<{review_status: string}>();
  expect(cards.results.filter(card => card.review_status === 'approved')).toHaveLength(1);
  expect((await auditRows()).results).toHaveLength(1);
});

test('计划锚提交后回执丢失时验证同一锚并继续', async () => {
  const review = await plan();
  const lostAnchor: AdminDatabase = {
    prepare(sql) {
      const statement = fixture.db.prepare(sql);
      if (!sql.trimStart().startsWith('INSERT INTO admin_audit_events')
        || !sql.includes("SELECT ?,NULL,NULL,?,?,?,'data-card-review-plan'")) return statement;
      const wrap = (inner: AdminPreparedStatement): AdminPreparedStatement => ({
        bind: (...values) => wrap(inner.bind(...values)),
        all: <T>() => inner.all<T>(), first: <T>() => inner.first<T>(),
        async run() { await inner.run(); throw new Error('synthetic lost plan receipt'); },
      });
      return wrap(statement);
    },
    batch: fixture.db.batch.bind(fixture.db),
  };
  expect(await executeReviewItem(lostAnchor, review, review.items[0], actorRef)).toMatchObject({status: 'success'});
  expect((await auditRows()).results).toHaveLength(1);
});

test('预览只读取，计划外目标不能提交', async () => {
  const review = await plan();
  expect(await inspectReviewCard(fixture.db, 'fixture-card-1')).toMatchObject({id: 'fixture-card-1', data: '{}', reviewedHash: review.items[0].reviewedHash});
  await expect(inspectReviewCard(fixture.db, 'fixture-card-2')).rejects.toThrow('CONTROL_CARD_NOT_PENDING');
  expect(await previewReviewItem(fixture.db, review, review.items[0], actorRef)).toMatchObject({status: 'ready'});
  await expect(executeReviewItem(fixture.db, review, {id: 'fixture-card-2', reviewedHash: 'a'.repeat(64)}, actorRef))
    .rejects.toThrow('CONTROL_PLAN_INVALID');
  expect((await auditRows()).results).toHaveLength(0);
  expect((await fixture.db.prepare(cardSql).bind('fixture-card-1').first<{review_status: string}>())?.review_status).toBe('pending');
});

test('读到已审快照后、批次执行前的同秒内容变更仍触发冲突', async () => {
  const review = await plan();
  const racing: AdminDatabase = { prepare: fixture.db.prepare.bind(fixture.db), async batch(statements) {
    await fixture.db.prepare("UPDATE data_cards SET data='{\"changed\":true}' WHERE id='fixture-card-1'").run();
    return fixture.db.batch(statements);
  } };
  expect(await executeReviewItem(racing, review, review.items[0], actorRef)).toMatchObject({status: 'conflict'});
  expect((await fixture.db.prepare(cardSql).bind('fixture-card-1').first<{review_status: string}>())?.review_status).toBe('pending');
  expect((await auditRows()).results[0]).toMatchObject({result: 'conflict'});
});

test('事务已提交但回执丢失时按同一审计 ID 找回结果', async () => {
  const review = await plan();
  const lostReceipt: AdminDatabase = { prepare: fixture.db.prepare.bind(fixture.db), async batch(statements) {
    await fixture.db.batch(statements);
    throw new Error('synthetic lost response');
  } };
  expect(await executeReviewItem(lostReceipt, review, review.items[0], actorRef)).toEqual({
    id: 'fixture-card-1', status: 'success', replayed: true,
  });
  expect((await auditRows()).results).toHaveLength(1);
  expect((await fixture.db.prepare(cardSql).bind('fixture-card-1').first<{review_status: string}>())?.review_status).toBe('approved');
});

test.each([
  ['content changed', "UPDATE data_cards SET description='changed' WHERE id='fixture-card-1'"],
  ['timestamp changed', "UPDATE data_cards SET updated_at='2099-01-01T00:00:00.000Z' WHERE id='fixture-card-1'"],
  ['no longer pending', "UPDATE data_cards SET review_status='approved' WHERE id='fixture-card-1'"],
  ['not public', "UPDATE data_cards SET is_public=0 WHERE id='fixture-card-1'"],
  ['deleted', "UPDATE data_cards SET deleted_at='2026-11-22T01:00:00.000Z' WHERE id='fixture-card-1'"],
])('CAS 拒绝已变更卡片：%s', async (_label, sql) => {
  const review = await plan(); await fixture.db.prepare(sql).run();
  expect(await executeReviewItem(fixture.db, review, review.items[0], actorRef)).toMatchObject({id: 'fixture-card-1', status: 'conflict'});
  expect((await auditRows()).results).toHaveLength(1);
  expect((await auditRows()).results[0]).toMatchObject({result: 'conflict', error_code_safe: 'CONTROL_VERSION_CONFLICT'});
});

test('强制审计插入失败时 D1 batch 回滚审核更新', async () => {
  const review = await plan();
  await fixture.db.prepare(`CREATE TRIGGER reject_public_review_audit BEFORE INSERT ON admin_audit_events WHEN NEW.source_context_safe='cloudflare-d1-control-tool' BEGIN SELECT RAISE(ABORT, 'synthetic audit failure'); END`).run();
  await expect(executeReviewItem(fixture.db, review, review.items[0], actorRef)).rejects.toThrow();
  expect((await fixture.db.prepare(cardSql).bind('fixture-card-1').first<{review_status: string}>())?.review_status).toBe('pending');
  expect((await auditRows()).results).toHaveLength(0);
});

test('审计插入被静默忽略时仍回滚审核更新', async () => {
  const review = await plan();
  await fixture.db.prepare(`CREATE TRIGGER ignore_public_review_audit BEFORE INSERT ON admin_audit_events WHEN NEW.source_context_safe='cloudflare-d1-control-tool' BEGIN SELECT RAISE(IGNORE); END`).run();
  await expect(executeReviewItem(fixture.db, review, review.items[0], actorRef)).rejects.toThrow('CONTROL_OUTCOME_UNCERTAIN');
  expect(await fixture.db.prepare(cardSql).bind('fixture-card-1').first()).toMatchObject({
    name: '合成待审核卡', review_status: 'pending',
  });
  expect((await auditRows()).results).toHaveLength(0);
});

test('生产 HTTP adapter 将业务、审计和断言发送为一个 D1 batch', async () => {
  const review = await plan();
  const batches: number[] = [];
  const transport = createD1HttpTransport({ kind: 'cloudflare-api', queryUrl: 'https://example.invalid/query',
    rawUrl: 'https://example.invalid/raw', apiToken: 'synthetic-secret', fetch: async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { sql?: string; params?: unknown[]; batch?: Array<{sql: string; params: unknown[]}> };
      const prepare = (entry: {sql: string; params?: unknown[]}) => fixture.db.prepare(entry.sql).bind(...(entry.params ?? []));
      if (body.batch) {
        batches.push(body.batch.length);
        return Response.json({success: true, result: await fixture.db.batch(body.batch.map(prepare))});
      }
      if (!body.sql) throw new Error('Unexpected synthetic request');
      return Response.json({success: true, result: [await prepare({sql: body.sql, params: body.params}).all()]});
    } });
  const httpDb = createHttpD1Client(transport) as AdminDatabase;
  expect(await executeReviewItem(httpDb, review, review.items[0], actorRef)).toMatchObject({status: 'success'});
  expect(batches).toEqual([3]);
  expect((await auditRows()).results).toHaveLength(1);
});

test('计划缺字段、超范围、重复 ID、非法 fingerprint 或账号库不匹配均在写入前拒绝', async () => {
  const valid = await plan();
  const invalid: unknown[] = [
    {...valid, reason: ''},
    {...valid, reason: 'Bearer synthetic-secret'},
    {...valid, createdAt: '2000-01-01T00:00:00.000Z'},
    {...valid, createdAt: '2999-01-01T00:00:00.000Z'},
    {...valid, items: Array.from({length: 21}, (_, i) => ({id: `card-${i}`, reviewedHash: 'a'.repeat(64)}))},
    {...valid, items: [valid.items[0], valid.items[0]]},
    {...valid, items: [{...valid.items[0], reviewedHash: 'not-a-fingerprint'}]},
    {...valid, accountId: 'c'.repeat(32)},
    {...valid, databaseId: '22222222-2222-4222-8222-222222222222'},
    {...valid, requestId: undefined},
  ];
  for (const value of invalid) expect(() => validateReviewPlan(value, {accountId, databaseId})).toThrow();
  expect((await auditRows()).results).toHaveLength(0);
  expect((await fixture.db.prepare(cardSql).bind('fixture-card-1').first<{review_status: string}>())?.review_status).toBe('pending');
});

test('身份验证仅请求固定 Cloudflare HTTPS 地址并返回不可逆安全引用', async () => {
  const urls: string[] = []; let authorization = '';
  const actor = await verifyControlIdentity(accountId, 'synthetic-secret', async (input, init) => {
    urls.push(String(input)); authorization = new Headers(init?.headers).get('Authorization') ?? '';
    expect(init?.redirect).toBe('manual');
    return Response.json({success: true, result: {status: 'active', id: 'd'.repeat(32)}});
  });
  expect(actor).toMatch(/^cf-user-token:[0-9a-f]{64}$/);
  expect(urls).toEqual(['https://api.cloudflare.com/client/v4/user/tokens/verify']);
  expect(authorization).toBe('Bearer synthetic-secret');
  expect(actor).not.toContain('synthetic-secret');
  await expect(verifyControlIdentity(accountId, 'synthetic-secret', async () => Response.json({success: true, result: {status: 'inactive', id: 'd'.repeat(32)}})))
    .rejects.toThrow('CONTROL_IDENTITY_INVALID');
  await expect(verifyControlIdentity(accountId, 'synthetic-secret', async () => Response.json({success: true, result: {status: 'active', id: 'bad'}})))
    .rejects.toThrow('CONTROL_IDENTITY_INVALID');
});
