import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { parse } from 'yaml';
import { auditAutoReviewConfig, summarizeAutoReviewConfig } from '../scripts/audit-auto-review-config.mjs';

const accountId = 'a'.repeat(32);
const token = 'synthetic-cloudflare-token';
const privateMarker = 'SYNTHETIC_PRIVATE_MATERIAL';
const providersName = 'AI_REVIEW_PROVIDERS_CONFIG';
const decisionsEndpoint = 'https://openrouter.ai/api/alpha/decisions';
const decisionsEntry = {
  kind: 'jev-decisions',
  endpoint: decisionsEndpoint,
  model: 'respan/span-01-lite:free',
  apiKeyEnv: `${privateMarker}_CREDENTIAL_REF`,
};

describe('自动审核配置脱敏', () => {
  test('仅汇报绑定状态、已知模型及 OpenRouter 凭据是否配置', () => {
    const providerText = JSON.stringify([
      { ...decisionsEntry, id: `${privateMarker}_ID`, apiKey: `${privateMarker}_KEY` },
      { ...decisionsEntry, model: 'inception/mercury-decide' },
      { ...decisionsEntry, model: 'perplexity/pplx-decider-flash-v1.3:free' },
      {
        id: `${privateMarker}_ID`,
        name: `${privateMarker}_PROVIDER`,
        model: `${privateMarker}_MODEL`,
        endpoint: `https://example.invalid/${privateMarker}`,
        accountId,
      },
      null,
      JSON.parse(`{"__proto__":{"model":"inception/mercury-decide:free","${privateMarker}":true}}`),
    ]);
    const summary = summarizeAutoReviewConfig([
      { name: providersName, type: 'plain_text', text: providerText },
      { name: 'AI_REVIEW_ROUTING', type: `${privateMarker}_TYPE`, text: privateMarker },
      { name: `${privateMarker}_UNRELATED_BINDING`, type: 'plain_text', text: token },
    ], []);

    expect(summary).toEqual({
      bindings: {
        [providersName]: { present: true, type: 'plain_text' },
        AI_REVIEW_ROUTING: { present: true, type: 'other' },
        AI_REVIEW_POLICY: { present: false, type: 'missing' },
      },
      providers: {
        readable: true,
        validArray: true,
        error: null,
        configuredOpenRouterModels: {
          'respan/span-01-lite': false,
          'respan/span-01-lite:free': true,
          'inception/mercury-decide': true,
          'inception/mercury-decide:free': false,
          'perplexity/pplx-decider-v1.3:free': false,
          'perplexity/pplx-decider-flash-v1.3:free': true,
        },
        openRouterDecisions: { present: true, hasCredentialReference: true, hasDirectCredential: true },
      },
    });
    const serialized = JSON.stringify(summary);
    for (const value of [privateMarker, accountId, token, decisionsEndpoint]) {
      expect(serialized).not.toContain(value);
    }
  });

  test('其他 kind 或 endpoint 的同名模型不计入 OpenRouter decisions', () => {
    const text = JSON.stringify([
      { ...decisionsEntry, kind: 'omni-moderation', model: 'respan/span-01-lite' },
      { ...decisionsEntry, endpoint: 'workers-ai', model: 'inception/mercury-decide' },
      {
        ...decisionsEntry,
        endpoint: 'https://openrouter.ai.example.invalid/api/alpha/decisions',
        model: 'perplexity/pplx-decider-v1.3:free',
      },
    ]);
    const summary = summarizeAutoReviewConfig([{ name: providersName, type: 'plain_text', text }], []);
    expect(summary.providers.validArray).toBe(true);
    expect(Object.values(summary.providers.configuredOpenRouterModels)).toEqual(Array(6).fill(false));
    expect(summary.providers.openRouterDecisions).toEqual({
      present: false,
      hasCredentialReference: false,
      hasDirectCredential: false,
    });
  });

  test('secret_text 及 secrets 列表只提供绑定元数据', () => {
    const text = JSON.stringify([decisionsEntry]);
    const secret = { name: providersName, type: 'secret_text', text };
    const summaries = [
      summarizeAutoReviewConfig([secret], []),
      summarizeAutoReviewConfig(null, [secret]),
      summarizeAutoReviewConfig([], [{ ...secret, type: 'plain_text' }]),
    ];

    expect(summaries[0].bindings[providersName]).toEqual({ present: true, type: 'secret_text' });
    expect(summaries[1].bindings[providersName]).toEqual({ present: true, type: 'secret_text' });
    expect(summaries[1].bindings.AI_REVIEW_ROUTING).toBeNull();
    for (const summary of summaries) {
      expect(summary.providers).toMatchObject({
        readable: false,
        validArray: false,
        openRouterDecisions: { present: null, hasCredentialReference: null, hasDirectCredential: null },
      });
      expect(Object.values(summary.providers.configuredOpenRouterModels)).toEqual(Array(6).fill(null));
      expect(JSON.stringify(summary)).not.toContain(privateMarker);
    }
  });

  test.each([
    [`{${privateMarker}`, 'INVALID_PROVIDERS_JSON'],
    [JSON.stringify({ value: privateMarker }), 'PROVIDERS_NOT_ARRAY'],
  ])('读取到无效配置时返回固定错误码', (text, error) => {
    const summary = summarizeAutoReviewConfig([{ name: providersName, type: 'plain_text', text }], []);
    expect(summary.providers).toMatchObject({
      readable: true,
      validArray: false,
      error,
      openRouterDecisions: { present: null, hasCredentialReference: null, hasDirectCredential: null },
    });
    expect(Object.values(summary.providers.configuredOpenRouterModels)).toEqual(Array(6).fill(null));
    expect(JSON.stringify(summary)).not.toContain(privateMarker);
  });

  test.each([
    [[{ ...decisionsEntry, apiKeyEnv: ' ', apiKey: privateMarker }]],
    [JSON.stringify([{ ...decisionsEntry, apiKeyEnv: ' ', apiKey: privateMarker }])],
  ])('识别 JSON 绑定中的数组，credential 引用只检查 apiKeyEnv', (json) => {
    const summary = summarizeAutoReviewConfig([{ name: providersName, type: 'json', json }], []);
    expect(summary.providers).toMatchObject({
      readable: true,
      validArray: true,
      openRouterDecisions: { present: true, hasCredentialReference: false, hasDirectCredential: true },
    });
    expect(JSON.stringify(summary)).not.toContain(privateMarker);
  });

  test('合法空数组可确认没有配置模型和 OpenRouter 条目', () => {
    const summary = summarizeAutoReviewConfig([{ name: providersName, type: 'plain_text', text: '[]' }], []);
    expect(summary.providers).toMatchObject({
      readable: true,
      validArray: true,
      openRouterDecisions: { present: false, hasCredentialReference: false, hasDirectCredential: false },
    });
    expect(Object.values(summary.providers.configuredOpenRouterModels)).toEqual(Array(6).fill(false));
  });
});

describe('Cloudflare 只读查询', () => {
  beforeEach(() => {
    vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', accountId);
    vi.stubEnv('CLOUDFLARE_API_TOKEN', token);
  });

  afterEach(() => vi.unstubAllEnvs());

  test('仅 GET 固定 Worker 的两个端点，请求禁止跟随重定向', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ success: true, result: { bindings: [] } }))
      .mockResolvedValueOnce(Response.json({ success: true, result: [], messages: [privateMarker] }));

    const summary = await auditAutoReviewConfig(fetchImpl);
    const base = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/mahoshojo-next`;
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    for (const [index, path] of ['settings', 'secrets'].entries()) {
      expect(fetchImpl).toHaveBeenNthCalledWith(index + 1, `${base}/${path}`, {
        method: 'GET',
        headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
        redirect: 'manual',
        signal: expect.any(AbortSignal),
      });
    }
    expect(summary.requests).toEqual({
      settings: { status: 200, error: null },
      secrets: { status: 200, error: null },
    });
    for (const value of [privateMarker, accountId, token]) {
      expect(JSON.stringify(summary)).not.toContain(value);
    }
  });

  test.each([
    ['CLOUDFLARE_ACCOUNT_ID', `${accountId}/../${privateMarker}`, 'INVALID_ACCOUNT_ID'],
    ['CLOUDFLARE_API_TOKEN', '', 'MISSING_API_TOKEN'],
  ])('缺少凭据或账户格式无效时不发送请求', async (name, value, error) => {
    vi.stubEnv(name, value);
    const fetchImpl = vi.fn<typeof fetch>();
    expect(await auditAutoReviewConfig(fetchImpl)).toEqual({ error });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('保留拒绝访问和重定向的状态码，不读取响应正文', async () => {
    const forbidden = new Response(privateMarker, { status: 403 });
    const redirected = new Response(privateMarker, {
      status: 302,
      headers: { Location: `https://example.invalid/${privateMarker}` },
    });
    const forbiddenJson = vi.spyOn(forbidden, 'json');
    const redirectedJson = vi.spyOn(redirected, 'json');
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(forbidden).mockResolvedValueOnce(redirected);
    const summary = await auditAutoReviewConfig(fetchImpl);

    expect(summary.requests).toEqual({
      settings: { status: 403, error: 'HTTP_ERROR' },
      secrets: { status: 302, error: 'HTTP_ERROR' },
    });
    expect(forbiddenJson).not.toHaveBeenCalled();
    expect(redirectedJson).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(summary)).not.toContain(privateMarker);
  });

  test('响应解析和网络异常只保留固定错误码', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(`{${privateMarker}`))
      .mockRejectedValueOnce(new TypeError(`${privateMarker} ${token} ${accountId}`));
    const summary = await auditAutoReviewConfig(fetchImpl);
    expect(summary.requests).toEqual({
      settings: { status: 200, error: 'INVALID_RESPONSE_JSON' },
      secrets: { status: null, error: 'NETWORK_ERROR' },
    });
    for (const value of [privateMarker, token, accountId]) {
      expect(JSON.stringify(summary)).not.toContain(value);
    }
  });
});

test.each([
  { env: {}, error: 'MISSING_API_TOKEN' },
  { env: { CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: privateMarker }, error: 'INVALID_ACCOUNT_ID' },
])('CLI 以退出码 1 和脱敏摘要报告 $error', ({ env, error }) => {
  const script = fileURLToPath(new URL('../scripts/audit-auto-review-config.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [script], { env, encoding: 'utf8', timeout: 5_000 });

  expect(result.error).toBeUndefined();
  expect(result.status).toBe(1);
  expect(result.stderr).toBe('');
  expect(JSON.parse(result.stdout)).toEqual({ error });
});

test('核查工作流仅手动运行，凭据只传给固定的 Node 核查步骤', () => {
  const workflow = parse(readFileSync('.github/workflows/audit-auto-review-config.yml', 'utf8'));
  expect(workflow.on).toEqual({ workflow_dispatch: null });
  expect(workflow.permissions).toEqual({ contents: 'read' });
  expect(workflow.jobs.audit).toEqual({
    if: "github.ref == 'refs/heads/feature/v0.2.0_Battle_Growth_MahoShojo'",
    'runs-on': 'ubuntu-latest',
    environment: { name: 'production', deployment: false },
    'timeout-minutes': 3,
    steps: [
      { uses: 'actions/checkout@v6', with: { 'persist-credentials': false } },
      { uses: 'actions/setup-node@v6', with: { 'node-version': '24.22.1', 'package-manager-cache': false } },
      {
        name: '读取审核配置并输出脱敏摘要',
        env: {
          CLOUDFLARE_API_TOKEN: '${{ secrets.CLOUDFLARE_API_TOKEN }}',
          CLOUDFLARE_ACCOUNT_ID: '${{ secrets.CLOUDFLARE_ACCOUNT_ID }}',
        },
        run: 'node scripts/audit-auto-review-config.mjs',
      },
    ],
  });
});
