import { afterAll, beforeAll, expect, test } from 'vitest';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createLocalFixture, initializeLocalFixture, splitFixtureSql, syntheticReviewFetch } from '../scripts/local-fixture';
import { revokeAdminPrincipal } from '@mahoshojo/hosted-runtime/admin/principals';
let fixture: Awaited<ReturnType<typeof createLocalFixture>>;
const repositoryRoot = path.resolve(import.meta.dirname, '../../..');
beforeAll(async () => { fixture = await createLocalFixture(repositoryRoot); }, 30_000);
afterAll(async () => { await fixture?.dispose(); });
const request = (url: string, token = fixture.token) => fixture.worker.fetch(new Request('http://127.0.0.1:8799' + url,
  {headers: token ? {'Cf-Access-Jwt-Assertion': token} : {}}), fixture.env);
test('合成SQL分隔器保留literal内分号与转义引号', () => {
  expect(splitFixtureSql("-- comment;\n SELECT 'a;b','it''s'; SELECT 2; ")).toEqual(["SELECT 'a;b','it''s'", 'SELECT 2']);
});
test('真实本地D1初始化可重入，session与业务读取使用真实JWT及principal', async () => {
  await initializeLocalFixture(fixture.db, repositoryRoot);
  expect((await request('/api/admin/session', '')).status).toBe(401);
  expect((await request('/api/admin/session', 'invalid-fixture-assertion')).status).toBe(401);
  expect((await request('/api/admin/session')).status).toBe(200);
  const response = await request('/api/admin/v1/users');
  expect(response.status).toBe(200);
  const text = await response.text();
  expect(text).toContain('本地合成用户');
  expect(text).not.toContain('fixture-not-a-real-auth-key');
  expect(text).not.toContain('fixture@example.invalid');
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect((await request('/api/admin/v1/not-registered')).status).toBe(403);
});
test('真实D1记录撤权后session与资源立即拒绝；初始化不恢复已撤权主体', async () => {
  await revokeAdminPrincipal(fixture.db, {id: 'local-fixture-admin', requestId: crypto.randomUUID(), reason: '验证本地撤权', operatorSafeRef: 'local-fixture-test'});
  await initializeLocalFixture(fixture.db, repositoryRoot);
  expect((await request('/api/admin/session')).status).toBe(403);
  expect((await request('/assets/app.js')).status).toBe(403);
  expect(await fixture.db.prepare("SELECT count(*) AS n FROM admin_audit_events WHERE action='admin.principal.revoke'").first()).toEqual({n: 1});
});

test('本地writer经正式HTTP协议执行CAS与幂等，付费和维护操作未开启', async () => {
  const writer = await createLocalFixture(repositoryRoot, undefined, true);
  try {
    const headers = {'Cf-Access-Jwt-Assertion': writer.token, Origin: 'http://127.0.0.1:8799', 'Sec-Fetch-Site': 'same-origin',
      'X-Mahoshojo-Admin-CSRF': '1', 'Content-Type': 'application/json'};
    const fetch = (url: string, init?: RequestInit) => writer.worker.fetch(new Request('http://127.0.0.1:8799' + url, {headers, ...init}), writer.env);
    const list = await (await fetch('/api/admin/v1/data-cards?id=fixture-card-1')).json() as {items: {expectedVersion: string}[]};
    const input = {id: 'fixture-card-1', expectedVersion: list.items[0].expectedVersion, reason: '本地CAS与重试验证', idempotencyKey: 'local-update', name: '合成卡更新', description: '本地内容'};
    const mutate = (body = input) => fetch('/api/admin/v1/actions/cards.metadata', {method: 'POST', body: JSON.stringify(body)});
    const first = await (await mutate()).json() as {operationId: string; status: string};
    expect(first.status).toBe('succeeded');
    expect(await (await mutate()).json()).toMatchObject({operationId: first.operationId, replayed: true});
    expect(await (await mutate({...input, idempotencyKey: 'stale-version'})).json()).toMatchObject({status: 'conflict'});
    expect((await fetch('/api/admin/v1/actions/cards.metadata', {method: 'POST', headers: {...headers, Origin: 'http://attacker.invalid'}, body: JSON.stringify(input)})).status).toBe(403);
    const actions = await (await fetch('/api/admin/v1/actions')).text();
    expect(actions).not.toContain('ai.review'); expect(actions).not.toContain('jobs.');
  } finally { await writer.dispose(); }
}, 30_000);


test('Miniflare v5显式持久路径在进程重启后保留业务与撤权记录', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'admin-local-fixture-'));
  let persisted: Awaited<ReturnType<typeof createLocalFixture>> | undefined;
  try {
    persisted = await createLocalFixture(repositoryRoot, directory);
    await persisted.db.prepare("UPDATE users SET username='重启后仍保留' WHERE id=1").run();
    await revokeAdminPrincipal(persisted.db, {id: 'local-fixture-admin', requestId: crypto.randomUUID(), reason: '验证持久撤权', operatorSafeRef: 'local-test'});
    await persisted.dispose(); persisted = undefined;
    persisted = await createLocalFixture(repositoryRoot, directory);
    expect(await persisted.db.prepare('SELECT username FROM users WHERE id=1').first()).toEqual({username: '重启后仍保留'});
    expect(await persisted.db.prepare("SELECT status FROM admin_principals WHERE id='local-fixture-admin'").first()).toEqual({status: 'disabled'});
  } finally {
    await persisted?.dispose();
    if (path.dirname(directory) !== path.resolve(tmpdir()) || !path.basename(directory).startsWith('admin-local-fixture-')) throw new Error('Unexpected fixture cleanup path');
    await rm(directory, {recursive: true, force: true});
  }
}, 30_000);

test('显式review fixture提供合成系统和BYOK建议、人工裁决与私有导出，不持久化BYOK', async () => {
  const reviewer = await createLocalFixture(repositoryRoot, undefined, false, true);
  try {
    const headers = {'Cf-Access-Jwt-Assertion': reviewer.token, Origin: 'http://127.0.0.1:8799', 'Sec-Fetch-Site': 'same-origin',
      'X-Mahoshojo-Admin-CSRF': '1', 'Content-Type': 'application/json'};
    const fetch = (url: string, body?: unknown) => reviewer.worker.fetch(new Request('http://127.0.0.1:8799' + url,
      {headers, ...(body ? {method: 'POST', body: JSON.stringify(body)} : {})}), reviewer.env);
    const targets = await Promise.all(['fixture-card-1', 'fixture-card-reject'].map(async id => {
      const detail = await (await fetch('/api/admin/v1/data-cards?id=' + id)).json() as {items: {expectedVersion: string}[]};
      return {kind: 'card', id, expectedVersion: detail.items[0].expectedVersion};
    }));
    const createReview = async (selection: {providerId: string; modelId: string}, key: string, apiKey?: string) => {
      const body = {reason: '本地合成建议验收', idempotencyKey: key, targets, selection, ...(apiKey ? {apiKey} : {})};
      const response = await fetch('/api/admin/v1/actions/ai.review', body);
      expect(response.status, await response.clone().text()).toBe(200);
      const operation = await response.json() as {result: {jobId: string}};
      await reviewer.drainJobs();
      const result = await fetch('/api/admin/v1/ai-review-result?id=' + operation.result.jobId);
      expect(result.status).toBe(200);
      expect(await result.json()).toMatchObject({reviews: [{id: 'card:fixture-card-1', suggestion: 'approved'}, {id: 'card:fixture-card-reject', suggestion: 'rejected'}]});
      expect(await (await fetch('/api/admin/v1/actions/ai.review', body)).json()).toMatchObject({replayed: true, result: {jobId: operation.result.jobId}});
      return operation.result.jobId;
    };
    await createReview({providerId: 'system', modelId: 'default'}, 'fixture-system-review');
    await createReview({providerId: 'system', modelId: 'deepseek-v4-flash-0731'}, 'fixture-system-model');
    const apiKey = 'synthetic-byok-for-local-test-only';
    await createReview({providerId: 'kourichat', modelId: 'fixture-openai-model'}, 'fixture-byok-review', apiKey);
    await createReview({providerId: 'google-cloudflare', modelId: 'fixture-google-model'}, 'fixture-google-review', apiKey);
    const durable = await reviewer.db.prepare('SELECT scope_json,cursor_json FROM admin_jobs').all();
    expect(JSON.stringify(durable)).not.toContain(apiKey);
    expect((await reviewer.db.prepare("SELECT review_status FROM data_cards WHERE id='fixture-card-reject'").first())).toEqual({review_status: 'pending'});
    const decision = await fetch('/api/admin/v1/actions/cards.review', {...targets[1], kind: undefined, reason: '人工确认合成拒绝建议', idempotencyKey: 'fixture-manual-reject', decision: 'rejected'});
    expect(decision.status).toBe(200);
    expect((await reviewer.db.prepare("SELECT review_status FROM data_cards WHERE id='fixture-card-reject'").first())).toEqual({review_status: 'rejected'});
    const exported = await fetch('/api/admin/v1/actions/jobs.export', {target: 'data-cards', ids: ['fixture-card-reject'], reason: '验收私有合成导出', idempotencyKey: 'fixture-export'});
    expect(exported.status).toBe(200);
    const exportJob = await exported.json() as {result: {jobId: string}};
    await reviewer.drainJobs();
    const download = await fetch('/api/admin/v1/export-download?id=' + exportJob.result.jobId + '&part=0');
    expect(download.status).toBe(200);
    expect(await download.text()).toContain('fixture-card-reject');
    const actions = await (await fetch('/api/admin/v1/actions')).text();
    expect(actions).not.toContain('jobs.cleanup');
    expect(actions).not.toContain('cards.metrics');
  } finally { await reviewer.dispose(); }
}, 30_000);

test('合成AI拒绝非fixture目标，绝不回退真实请求', async () => {
  await expect(syntheticReviewFetch('https://not-a-real-provider.invalid/v1/chat/completions', {method: 'POST', body: JSON.stringify({messages: [{content: '待审查列表（JSON）：\n[\n{"id":"card:real-card"}\n]'}]})}))
    .rejects.toThrow('Synthetic review only accepts fixture targets');
});
