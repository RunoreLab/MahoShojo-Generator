import { beforeEach, expect, test, vi } from 'vitest';
import type { AdminDatabase } from '@mahoshojo/hosted-runtime/admin/database';
import type { AdminPrivateBucket } from '@mahoshojo/hosted-runtime/admin/jobs';
const mocked = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('@mahoshojo/hosted-runtime/admin/ai-review', async importOriginal => ({
  ...await importOriginal<typeof import('@mahoshojo/hosted-runtime/admin/ai-review')>(),
  createAdminAiReviewJob: mocked.execute,
}));
import { createActions } from '../src/actions';
import { createAdminApp } from '../src/app';
import { createExtraReads } from '../src/extra-reads';
import { createPrincipalDirectory } from '../src/security/authorization';

const identity = { issuer: 'https://access.example.test', subject: 'operator', kind: 'human' as const };
const db = {} as AdminDatabase;
const bucket = {} as AdminPrivateBucket;
const providers = [{ name: 'configured', type: 'openai' as const, model: ['first-model', 'second-model'], apiKey: 'system-secret', baseUrl: 'https://upstream.example.test/v1' }];
const headers = { 'Cf-Access-Jwt-Assertion': 'test', Origin: 'https://admin.test', 'Sec-Fetch-Site': 'same-origin', 'X-Mahoshojo-Admin-CSRF': '1', 'Content-Type': 'application/json' };
const options = vi.fn(() => ({ providers, bucket }));
const app = (capabilities = ['admin.shell.read', 'ai.read', 'ai.review'], enabled = '["ai.review"]') => createAdminApp({
  accessVerifier: { verify: async () => identity },
  principals: createPrincipalDirectory([{ id: 'operator', externalIdentity: identity, status: 'active', capabilities }]),
  actions: createActions(() => db, enabled, undefined, options),
  extraReads: createExtraReads(() => db, () => bucket, { ADMIN_AI_PROVIDERS_CONFIG: JSON.stringify(providers) }),
});
beforeEach(() => { options.mockClear(); mocked.execute.mockReset().mockResolvedValue({ status: 'succeeded', result: { jobId: 'job', count: 1 } }); });
test('统一 AI 选择和临时 key 只传给受保护执行器，公开目录不含秘密', async () => {
  const body = { selection: { providerId: 'deepseek', modelId: 'model' }, apiKey: 'transient-secret', targets: [], reason: '审核', idempotencyKey: 'once' };
  const response = await app().request('https://admin.test/api/admin/v1/actions/ai.review', { method: 'POST', headers, body: JSON.stringify(body) });
  expect(response.status).toBe(200);
  expect(mocked.execute).toHaveBeenCalledWith(db, body, expect.objectContaining({ principalId: 'operator' }), { providers, bucket });
  expect(await response.text()).not.toContain('transient-secret');
  const catalog = await app().request('https://admin.test/api/admin/v1/models', { headers });
  expect(await catalog.json()).toEqual({ items: [{ provider: 'configured', model: 'first-model' }, { provider: 'configured', model: 'second-model' }], systemDefault: { provider: 'configured', model: 'first-model' } });
});
test('缺少权限、writer 未启用或跨源请求均在载入执行资源前拒绝 AI', async () => {
  for (const [instance, requestHeaders] of [
    [app(['admin.shell.read']), headers], [app(undefined, '[]'), headers], [app(), { ...headers, Origin: 'https://foreign.test' }],
  ] as const) {
    const response = await instance.request('https://admin.test/api/admin/v1/actions/ai.review', { method: 'POST', headers: requestHeaders, body: '{}' });
    expect(response.status).toBe(403);
  }
  expect(options).not.toHaveBeenCalled();
  expect(mocked.execute).not.toHaveBeenCalled();
});
