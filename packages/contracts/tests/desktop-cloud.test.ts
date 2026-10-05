import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  DESKTOP_AUTH_AUTHORIZE_PATH,
  DESKTOP_AUTH_CODE_CHALLENGE_LENGTH,
  DESKTOP_AUTH_CODE_LENGTH,
  DESKTOP_AUTH_EXCHANGE_PATH,
  DESKTOP_AUTH_GRANT_PATH,
  DESKTOP_AUTH_GRANT_TTL_SECONDS,
  DESKTOP_AUTH_LOOPBACK_CALLBACK_PATH,
  DESKTOP_AUTH_PROTOCOL_VERSION,
  DesktopAuthCodeChallengeSchema,
  DesktopAuthCodeSchema,
  DesktopAuthCodeVerifierSchema,
  DesktopAuthErrorCodeSchema,
  DesktopAuthExchangeRequestSchema,
  DesktopAuthExchangeResponseSchema,
  DesktopAuthGrantRequestSchema,
  DesktopAuthGrantResponseSchema,
  DesktopAuthStateSchema,
  DesktopAuthorizeQuerySchema,
  DesktopCloudErrorCodeSchema,
  DesktopCloudLoginOutcomeSchema,
  DesktopCloudOnlineStatusSchema,
  DesktopCloudSessionStatusSchema,
  DesktopCloudSignOutResultSchema,
  DesktopHostedGenerateRequestSchema,
  DesktopHostedJsonRequestSchema,
  DesktopHostedJsonResponseSchema,
  HostedGenerationEventNameSchema,
  HostedGenerationRouteIdSchema,
  HostedJsonGenerationRouteIdSchema,
  MAX_DESKTOP_AUTH_CODE_VERIFIER_LENGTH,
  MAX_DESKTOP_AUTH_STATE_LENGTH,
  MIN_DESKTOP_AUTH_CODE_VERIFIER_LENGTH,
  isDesktopLoopbackRedirectUri,
} from '../src/desktop-cloud';

/**
 * `desktop-cloud.json` 是 `desktop-auth-v1` 窄协议两侧（TS 与 Rust）共同读取的
 * 事实源：路径、长度上限、错误码枚举必须在两边完全一致（DESK-033 同款门禁）。
 */
type DesktopCloudFixture = {
  protocolVersion: string;
  paths: Record<string, string>;
  limits: Record<string, number>;
  authErrorCodes: string[];
  ipcErrorCodes: string[];
  hostedGenerationEventNames: string[];
  hostedGenerationRouteIds: string[];
  hostedJsonRouteIds: string[];
  validRedirectUris: string[];
  invalidRedirectUris: string[];
  validAuthorizeQuery: Record<string, unknown>;
  invalidAuthorizeQueries: Record<string, unknown>[];
};

const fixture: DesktopCloudFixture = JSON.parse(
  readFileSync(
    path.join(import.meta.dirname, '..', 'fixtures', 'desktop-cloud.json'),
    'utf8',
  ),
);

describe('desktop-cloud 协议常量与 fixture 同步', () => {
  it('protocolVersion 与路径常量一致', () => {
    expect(DESKTOP_AUTH_PROTOCOL_VERSION).toBe(fixture.protocolVersion);
    expect(DESKTOP_AUTH_AUTHORIZE_PATH).toBe(fixture.paths.authorize);
    expect(DESKTOP_AUTH_GRANT_PATH).toBe(fixture.paths.grant);
    expect(DESKTOP_AUTH_EXCHANGE_PATH).toBe(fixture.paths.exchange);
    expect(DESKTOP_AUTH_LOOPBACK_CALLBACK_PATH).toBe(fixture.paths.loopbackCallback);
  });

  it('长度与时效上限一致', () => {
    expect(MAX_DESKTOP_AUTH_STATE_LENGTH).toBe(fixture.limits.maxStateLength);
    expect(DESKTOP_AUTH_CODE_LENGTH).toBe(fixture.limits.codeLength);
    expect(DESKTOP_AUTH_CODE_CHALLENGE_LENGTH).toBe(fixture.limits.codeChallengeLength);
    expect(MIN_DESKTOP_AUTH_CODE_VERIFIER_LENGTH).toBe(fixture.limits.minCodeVerifierLength);
    expect(MAX_DESKTOP_AUTH_CODE_VERIFIER_LENGTH).toBe(fixture.limits.maxCodeVerifierLength);
    expect(DESKTOP_AUTH_GRANT_TTL_SECONDS).toBe(fixture.limits.grantTtlSeconds);
  });

  it('错误码枚举一致', () => {
    expect(DesktopAuthErrorCodeSchema.options).toEqual(fixture.authErrorCodes);
    expect(DesktopCloudErrorCodeSchema.options).toEqual(fixture.ipcErrorCodes);
    expect(HostedGenerationEventNameSchema.options).toEqual(fixture.hostedGenerationEventNames);
    expect(HostedGenerationRouteIdSchema.options).toEqual(fixture.hostedGenerationRouteIds);
    expect(HostedJsonGenerationRouteIdSchema.options).toEqual(fixture.hostedJsonRouteIds);
  });
});

describe('loopback 回跳地址', () => {
  it('接受 fixture 中全部合法地址', () => {
    for (const uri of fixture.validRedirectUris) {
      expect(isDesktopLoopbackRedirectUri(uri), uri).toBe(true);
    }
  });

  it('拒绝 fixture 中全部非法地址', () => {
    for (const uri of fixture.invalidRedirectUris) {
      expect(isDesktopLoopbackRedirectUri(uri), uri).toBe(false);
    }
  });
});

describe('授权页 query 契约', () => {
  it('接受 fixture 中的合法 query', () => {
    const parsed = DesktopAuthorizeQuerySchema.safeParse(fixture.validAuthorizeQuery);
    expect(parsed.success).toBe(true);
  });

  it('拒绝 fixture 中全部非法 query', () => {
    expect(fixture.invalidAuthorizeQueries.length).toBeGreaterThan(0);
    for (const query of fixture.invalidAuthorizeQueries) {
      expect(DesktopAuthorizeQuerySchema.safeParse(query).success).toBe(false);
    }
  });
});

describe('grant / exchange wire DTO', () => {
  const state = 'AbC123_-xyz';
  const challenge = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ';
  const redirectUri = 'http://127.0.0.1:45231/callback';
  const code = '1234567890abcdefghijklmnopqrstuvwxyzABCDEFG'; // 43
  const verifier = 'a'.repeat(50);

  it('grant request 逐字段校验', () => {
    expect(DesktopAuthGrantRequestSchema.safeParse({
      state,
      codeChallenge: challenge,
      codeChallengeMethod: 'S256',
      redirectUri,
    }).success).toBe(true);
    expect(DesktopAuthGrantRequestSchema.safeParse({
      state,
      codeChallenge: challenge,
      codeChallengeMethod: 'plain',
      redirectUri,
    }).success).toBe(false);
    expect(DesktopAuthGrantRequestSchema.safeParse({
      state,
      codeChallenge: challenge,
      codeChallengeMethod: 'S256',
      redirectUri: 'http://localhost:1/callback',
    }).success).toBe(false);
    // 未知字段被拒绝（strict）
    expect(DesktopAuthGrantRequestSchema.safeParse({
      state,
      codeChallenge: challenge,
      codeChallengeMethod: 'S256',
      redirectUri,
      extra: 1,
    }).success).toBe(false);
  });

  it('exchange request 校验协议版本与 verifier 形态', () => {
    expect(DesktopAuthExchangeRequestSchema.safeParse({
      protocolVersion: 'desktop-auth-v1',
      code,
      codeVerifier: verifier,
    }).success).toBe(true);
    expect(DesktopAuthExchangeRequestSchema.safeParse({
      protocolVersion: 'desktop-auth-v2',
      code,
      codeVerifier: verifier,
    }).success).toBe(false);
    expect(DesktopAuthExchangeRequestSchema.safeParse({
      protocolVersion: 'desktop-auth-v1',
      code: 'short',
      codeVerifier: verifier,
    }).success).toBe(false);
    expect(DesktopAuthExchangeRequestSchema.safeParse({
      protocolVersion: 'desktop-auth-v1',
      code,
      codeVerifier: 'has space not allowed ...........................',
    }).success).toBe(false);
  });

  it('exchange/grant response 形状', () => {
    expect(DesktopAuthGrantResponseSchema.safeParse({
      protocolVersion: 'desktop-auth-v1',
      redirectUrl: `${redirectUri}?code=${code}&state=${state}`,
      expiresInSeconds: 120,
    }).success).toBe(true);
    expect(DesktopAuthExchangeResponseSchema.safeParse({
      protocolVersion: 'desktop-auth-v1',
      account: { userId: 7, username: 'homura', displayName: '晓美焰' },
      sessionExpiresAt: '2026-10-12T00:00:00.000Z',
    }).success).toBe(true);
    expect(DesktopAuthExchangeResponseSchema.safeParse({
      protocolVersion: 'desktop-auth-v1',
      account: { userId: 'not-a-number', username: 'homura' },
      sessionExpiresAt: '2026-10-12T00:00:00.000Z',
    }).success).toBe(false);
  });

  it('state/code/challenge/verifier 各自的边界', () => {
    expect(DesktopAuthStateSchema.safeParse('').success).toBe(false);
    expect(DesktopAuthStateSchema.safeParse('x'.repeat(129)).success).toBe(false);
    expect(DesktopAuthCodeSchema.safeParse('x'.repeat(43)).success).toBe(true);
    expect(DesktopAuthCodeSchema.safeParse('x'.repeat(44)).success).toBe(false);
    expect(DesktopAuthCodeChallengeSchema.safeParse('x'.repeat(43)).success).toBe(true);
    expect(DesktopAuthCodeVerifierSchema.safeParse('x'.repeat(42)).success).toBe(false);
    expect(DesktopAuthCodeVerifierSchema.safeParse('x'.repeat(129)).success).toBe(false);
  });
});

describe('renderer IPC 投影', () => {
  const account = { userId: 3, username: 'madoka', displayName: null };

  it('登录结果 union', () => {
    expect(DesktopCloudLoginOutcomeSchema.safeParse({
      status: 'signed-in',
      account,
      sessionExpiresAt: '2026-10-12T00:00:00.000Z',
    }).success).toBe(true);
    expect(DesktopCloudLoginOutcomeSchema.safeParse({ status: 'cancelled' }).success).toBe(true);
    expect(DesktopCloudLoginOutcomeSchema.safeParse({
      status: 'failed',
      code: 'timeout',
      message: '等待浏览器授权超时',
    }).success).toBe(true);
    expect(DesktopCloudLoginOutcomeSchema.safeParse({ status: 'unknown' }).success).toBe(false);
  });

  it('会话状态 union：unreachable 不携带账号', () => {
    expect(DesktopCloudSessionStatusSchema.safeParse({ state: 'signed-out' }).success).toBe(true);
    expect(DesktopCloudSessionStatusSchema.safeParse({
      state: 'active',
      account,
      sessionExpiresAt: '2026-10-12T00:00:00.000Z',
    }).success).toBe(true);
    expect(DesktopCloudSessionStatusSchema.safeParse({ state: 'expired' }).success).toBe(true);
    expect(DesktopCloudSessionStatusSchema.safeParse({ state: 'unreachable' }).success).toBe(true);
    expect(DesktopCloudSessionStatusSchema.safeParse({
      state: 'unreachable',
      account,
    }).success).toBe(false);
  });

  it('登出结果', () => {
    expect(DesktopCloudSignOutResultSchema.safeParse({ revoked: true }).success).toBe(true);
    expect(DesktopCloudSignOutResultSchema.safeParse({ revoked: false }).success).toBe(true);
    expect(DesktopCloudSignOutResultSchema.safeParse({}).success).toBe(false);
  });

  it('hosted 生成请求：系统默认通道，BYOK 字段一律拒绝', () => {
    // 系统默认通道：routeId + 业务 body。
    expect(DesktopHostedGenerateRequestSchema.safeParse({
      requestId: 'req-2',
      routeId: 'generate-magical-girl-details-stream',
      body: { answers: [] },
    }).success).toBe(true);

    // BYOK 在 native Provider 绑定落地前保持关闭：任何凭据字段都 fail-closed。
    expect(DesktopHostedGenerateRequestSchema.safeParse({
      requestId: 'req-1',
      routeId: 'generate-magical-girl-details-stream',
      body: { answers: [], questionnaires: [], language: 'zh-CN' },
      byok: {
        providerId: 'deepseek',
        modelId: 'deepseek-v4-flash',
        secretRef: 'provider:conn_1:api-key',
      },
    }).success).toBe(false);
    expect(DesktopHostedGenerateRequestSchema.safeParse({
      requestId: 'req-4',
      routeId: 'generate-magical-girl-details-stream',
      body: {},
      secretRef: 'provider:conn_1:api-key',
    }).success).toBe(false);

    // 白名单外路由拒绝。
    expect(DesktopHostedGenerateRequestSchema.safeParse({
      requestId: 'req-3',
      routeId: 'some-other-route',
      body: {},
    }).success).toBe(false);
  });

  it('hosted 非流式请求：独立路由白名单，凭据字段同样 fail-closed', () => {
    expect(DesktopHostedJsonRequestSchema.safeParse({
      requestId: 'req-1',
      routeId: 'generate-magical-girl-details',
      body: { answers: [], allowNativeSignature: true },
    }).success).toBe(true);

    // 流式路由不属于非流式白名单（两侧枚举分开钉死）。
    expect(DesktopHostedJsonRequestSchema.safeParse({
      requestId: 'req-2',
      routeId: 'generate-magical-girl-details-stream',
      body: {},
    }).success).toBe(false);
    expect(DesktopHostedJsonRequestSchema.safeParse({
      requestId: 'req-3',
      routeId: 'some-other-route',
      body: {},
    }).success).toBe(false);
    expect(DesktopHostedJsonRequestSchema.safeParse({
      requestId: 'req-4',
      routeId: 'generate-magical-girl-details',
      body: {},
      secretRef: 'provider-key:abc',
    }).success).toBe(false);
  });

  it('hosted 非流式响应：HTTP 状态 + JSON 正文透传，错误页可投影为 null 正文', () => {
    expect(DesktopHostedJsonResponseSchema.safeParse({
      status: 200,
      body: { data: { codename: 'homura' }, aiMeta: { aiModel: 'glm' } },
    }).success).toBe(true);
    expect(DesktopHostedJsonResponseSchema.safeParse({
      status: 524,
      body: null,
    }).success).toBe(true);
    expect(DesktopHostedJsonResponseSchema.safeParse({
      status: 99,
      body: {},
    }).success).toBe(false);
    expect(DesktopHostedJsonResponseSchema.safeParse({
      status: 200,
    }).success).toBe(false);
  });

  it('在线探测结果', () => {
    expect(DesktopCloudOnlineStatusSchema.safeParse({
      reachable: true,
      contractVersion: 'g25e1-v1',
      compatible: true,
    }).success).toBe(true);
    expect(DesktopCloudOnlineStatusSchema.safeParse({
      reachable: false,
      compatible: null,
    }).success).toBe(true);
  });
});
