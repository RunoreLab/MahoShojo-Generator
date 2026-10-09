import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  DESKTOP_AUTH_AUTHORIZE_PATH,
  DESKTOP_PUBLIC_CACHE_CARD_FIELDS,
  DESKTOP_PUBLIC_CACHE_SUMMARY_FIELDS,
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
  DesktopCardLibraryResponseSchema,
  DesktopCardLibraryRequestSchema,
  DesktopCardLibraryRouteIdSchema,
  DesktopCloudErrorCodeSchema,
  DesktopCloudLoginOutcomeSchema,
  DesktopCloudMeProfileSchema,
  DesktopCloudOnlineStatusSchema,
  DesktopCloudSessionStatusSchema,
  DesktopCloudSignOutResultSchema,
  DesktopHostedGenerateRequestSchema,
  DesktopHostedJsonRequestSchema,
  DesktopHostedJsonResponseSchema,
  HOSTED_GENERATION_BODY_DEFAULT_MAX_BYTES,
  HOSTED_GENERATION_BODY_ROUTE_MAX_BYTES,
  hostedGenerationBodyMaxBytes,
  HostedGenerationEventNameSchema,
  HostedGenerationRouteIdSchema,
  HostedJsonGenerationRouteIdSchema,
  MAX_DESKTOP_AUTH_CODE_VERIFIER_LENGTH,
  MAX_DESKTOP_AUTH_STATE_LENGTH,
  MIN_DESKTOP_AUTH_CODE_VERIFIER_LENGTH,
  PUBLIC_DATA_CARD_NOT_FOUND_CODE,
  isDesktopLoopbackRedirectUri,
  type HostedGenerationRouteId,
  type HostedJsonGenerationRouteId,
} from '../src/desktop-cloud';
import { DataCardSummarySchema } from '../src/data-cards';

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
  hostedBodyLimits: {
    defaultMaxBytes: number;
    routeMaxBytes: Record<string, number>;
  };
  validRedirectUris: string[];
  invalidRedirectUris: string[];
  validAuthorizeQuery: Record<string, unknown>;
  invalidAuthorizeQueries: Record<string, unknown>[];
  cardLibrary: {
    validRequests: unknown[];
    invalidFenceRequests: unknown[];
    routes: Record<string, { method: string; path: string; auth: string }>;
    publicReadCache: {
      sourceRouteId: string;
      singleCardQueryKey: string;
      summaryViewQueryKey: string;
      summaryViewQueryValue: string;
      requiredCacheControlToken: string;
      forbiddenCacheControlTokens: string[];
      withdrawalStatus: number;
      withdrawalErrorCode: string;
      summaryFields: string[];
      cardFields: string[];
    };
  };
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

  it('hosted 请求体预算与 fixture 同源（G2-r1 按路由区分）', () => {
    expect(HOSTED_GENERATION_BODY_DEFAULT_MAX_BYTES).toBe(fixture.hostedBodyLimits.defaultMaxBytes);
    expect(HOSTED_GENERATION_BODY_ROUTE_MAX_BYTES).toEqual(fixture.hostedBodyLimits.routeMaxBytes);
    for (const routeId of [...fixture.hostedGenerationRouteIds, ...fixture.hostedJsonRouteIds]) {
      const expected = fixture.hostedBodyLimits.routeMaxBytes[routeId]
        ?? fixture.hostedBodyLimits.defaultMaxBytes;
      expect(
        hostedGenerationBodyMaxBytes(routeId as HostedGenerationRouteId | HostedJsonGenerationRouteId),
        `routeId ${routeId} 的预算应与 fixture 一致`,
      ).toBe(expected);
    }
    // free 为附件保留 1 MiB，升华为原卡+参考保留 4 MiB；其余路由仍为 256 KiB。
    expect(hostedGenerationBodyMaxBytes('generate-free')).toBe(1024 * 1024);
    expect(hostedGenerationBodyMaxBytes('generate-free-stream')).toBe(1024 * 1024);
    expect(hostedGenerationBodyMaxBytes('generate-sublimation')).toBe(4 * 1024 * 1024);
    expect(hostedGenerationBodyMaxBytes('generate-sublimation-stream')).toBe(4 * 1024 * 1024);
    expect(hostedGenerationBodyMaxBytes('generate-scenario')).toBe(256 * 1024);
    expect(hostedGenerationBodyMaxBytes('generate-canshou-stream')).toBe(256 * 1024);
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

  it('me profile：userId 必填，头像只放行 data:image/webp;base64,', () => {
    expect(DesktopCloudMeProfileSchema.safeParse({ userId: 7 }).success).toBe(true);
    expect(DesktopCloudMeProfileSchema.safeParse({
      userId: 7,
      signature: '圆焰',
      avatarDataUrl: 'data:image/webp;base64,QUJD',
    }).success).toBe(true);

    // userId 是 renderer stale-response fence 的核对依据：缺失/非正整即违例。
    expect(DesktopCloudMeProfileSchema.safeParse({}).success).toBe(false);
    expect(DesktopCloudMeProfileSchema.safeParse({ userId: '7' }).success).toBe(false);
    expect(DesktopCloudMeProfileSchema.safeParse({ userId: 0 }).success).toBe(false);

    // 服务端只产出 webp：其余 data URL（含图片族的 png）一律拒绝。
    expect(DesktopCloudMeProfileSchema.safeParse({
      userId: 7,
      avatarDataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    }).success).toBe(false);
    expect(DesktopCloudMeProfileSchema.safeParse({
      userId: 7,
      avatarDataUrl: 'data:text/html;base64,PGI+',
    }).success).toBe(false);
    expect(DesktopCloudMeProfileSchema.safeParse({
      userId: 7,
      avatarDataUrl: 'https://evil.example.com/a.webp',
    }).success).toBe(false);

    // strict：多余字段拒收。
    expect(DesktopCloudMeProfileSchema.safeParse({
      userId: 7,
      cookie: 'session=tok',
    }).success).toBe(false);
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

  it('升华两命令保留独立路由白名单及严格的非秘密 IPC 输入', () => {
    const body = {
      name: '完整角色卡',
      content: '已有角色正文',
      arena_history: { entries: [{ id: 1, text: '保留历战' }] },
      narrativeHistory: '参考历史'.repeat(3_000),
      fieldsToPreserve: ['name'],
      questionnaires: [],
    };
    for (const [schema, routeId, otherRoute] of [
      [DesktopHostedGenerateRequestSchema, 'generate-sublimation-stream', 'generate-sublimation'],
      [DesktopHostedJsonRequestSchema, 'generate-sublimation', 'generate-sublimation-stream'],
    ] as const) {
      const request = { requestId: 'sublimation', routeId, body };
      expect(schema.parse(request).body).toEqual(body);
      expect(schema.safeParse({ ...request, routeId: otherRoute }).success).toBe(false);
      for (const route of [`/api/${routeId}`, `${routeId}?format=sse`, '../generate-sublimation']) {
        expect(schema.safeParse({ ...request, routeId: route }).success).toBe(false);
      }
      for (const extra of [
        { apiKey: 'renderer-key' },
        { secretRef: 'provider-key:renderer' },
        { url: 'https://example.com' },
        { path: '/api/admin' },
        { headers: { cookie: 'renderer-session' } },
        { method: 'GET' },
      ]) {
        expect(schema.safeParse({ ...request, ...extra }).success).toBe(false);
      }
      const presetConfig = { providerId: 'deepseek', modelId: 'custom-model' };
      expect(schema.safeParse({ ...request, presetConfig }).success).toBe(true);
      expect(schema.safeParse({ ...request, presetConfig: { ...presetConfig, apiKey: 'key' } }).success).toBe(false);
      expect(schema.safeParse({ ...request, presetConfig: { ...presetConfig, baseUrl: 'https://example.com' } }).success).toBe(false);
      expect(schema.safeParse({ ...request, presetConfig, systemConfig: {} }).success).toBe(false);
    }
  });

  it('hosted systemConfig：「使用系统默认配置」通道的非秘密偏好（D5.1-AIP-r1）', () => {
    // 显式系统模型选择（与 Web customProvider:{providerId:'system'} 同语义）。
    expect(DesktopHostedGenerateRequestSchema.safeParse({
      requestId: 'req-5',
      routeId: 'generate-magical-girl-details-stream',
      body: { answers: [] },
      systemConfig: { modelId: 'glm-5.3-flash' },
    }).success).toBe(true);

    // 模型选择 + 生成覆盖。
    expect(DesktopHostedGenerateRequestSchema.safeParse({
      requestId: 'req-6',
      routeId: 'generate-magical-girl-details-stream',
      body: { answers: [] },
      systemConfig: {
        modelId: 'default',
        generationOverrides: {
          temperature: 0.4,
          maxOutputTokens: 4096,
          thinking: { mode: 'enabled', effort: 'medium' },
        },
      },
    }).success).toBe(true);

    // 凭据字段在 systemConfig 内部同样 fail-closed（DESK-093 不松口）。
    for (const systemConfig of [
      { modelId: 'glm-5.3-flash', apiKey: 'sk-smuggled' },
      { modelId: 'glm-5.3-flash', providerId: 'deepseek' },
      { modelId: 'glm-5.3-flash', secretRef: 'provider-key:abc' },
      { modelId: 'glm-5.3-flash', baseUrl: 'https://api.example.com' },
    ]) {
      expect(DesktopHostedGenerateRequestSchema.safeParse({
        requestId: 'req-7',
        routeId: 'generate-magical-girl-details-stream',
        body: {},
        systemConfig,
      }).success).toBe(false);
    }

    // 形状校验：控制字符、超长、非 schema 覆盖项拒绝；
    // 「是否在系统清单内」归服务端裁决，契约层不做目录判断。
    expect(DesktopHostedGenerateRequestSchema.safeParse({
      requestId: 'req-8',
      routeId: 'generate-magical-girl-details-stream',
      body: {},
      systemConfig: { modelId: 'm\nx' },
    }).success).toBe(false);
    expect(DesktopHostedGenerateRequestSchema.safeParse({
      requestId: 'req-9',
      routeId: 'generate-magical-girl-details-stream',
      body: {},
      systemConfig: { modelId: 'm'.repeat(257) },
    }).success).toBe(false);
    expect(DesktopHostedGenerateRequestSchema.safeParse({
      requestId: 'req-10',
      routeId: 'generate-magical-girl-details-stream',
      body: {},
      systemConfig: { generationOverrides: { temperature: 'hot' } },
    }).success).toBe(false);
    expect(DesktopHostedGenerateRequestSchema.safeParse({
      requestId: 'req-11',
      routeId: 'generate-magical-girl-details-stream',
      body: {},
      systemConfig: { generationOverrides: { temperature: 0.5, extra: 1 } },
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

    // 非流式通路同样携带「使用系统默认配置」通道偏好。
    expect(DesktopHostedJsonRequestSchema.safeParse({
      requestId: 'req-5',
      routeId: 'generate-magical-girl-details',
      body: { answers: [] },
      systemConfig: { modelId: 'glm-5.3-flash' },
    }).success).toBe(true);
    expect(DesktopHostedJsonRequestSchema.safeParse({
      requestId: 'req-6',
      routeId: 'generate-magical-girl-details',
      body: {},
      systemConfig: { modelId: 'glm-5.3-flash', apiKey: 'sk-smuggled' },
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

describe('公开库持久缓存投影（D5.1-K1）', () => {
  const cache = fixture.cardLibrary.publicReadCache;

  it('缓存来源固定在 public-data-cards.query，且该路由是 optional 公开读', () => {
    expect(cache.sourceRouteId).toBe('public-data-cards.query');
    const route = fixture.cardLibrary.routes[cache.sourceRouteId];
    expect(route.method).toBe('GET');
    expect(route.auth).toBe('optional');
  });

  it('投影白名单与 fixture 同步，且摘要不越出共享 schema 字段集', () => {
    expect(cache.summaryFields).toEqual([...DESKTOP_PUBLIC_CACHE_SUMMARY_FIELDS]);
    expect(cache.cardFields).toEqual([...DESKTOP_PUBLIC_CACHE_CARD_FIELDS]);

    // 白名单必须落在共享摘要 schema 已声明的字段内——服务端 schema 收窄时
    // 缓存投影不能继续读已不存在的键。
    const summaryKeys = new Set(Object.keys(DataCardSummarySchema.shape));
    for (const field of cache.summaryFields) {
      expect(summaryKeys.has(field), `${field} 必须在 DataCardSummarySchema 中`).toBe(true);
    }
    // 账号关系字段不属于公开持久投影。
    expect(cache.summaryFields).not.toContain('favorited_at');
    expect(cache.cardFields).not.toContain('deleted_at');
  });

  it('缓存存储许可与撤回信号在 fixture 中被钉住', () => {
    expect(cache.requiredCacheControlToken).toBe('public');
    for (const token of cache.forbiddenCacheControlTokens) {
      expect(['no-store', 'private', 'no-cache']).toContain(token);
    }
    expect(cache.withdrawalStatus).toBe(404);
    // 撤回证据是稳定业务错误码——native 不凭裸 404 + success:false 失效缓存。
    expect(cache.withdrawalErrorCode).toBe(PUBLIC_DATA_CARD_NOT_FOUND_CODE);
  });

  it('卡库响应的 cache 报告字段是可选且 strict 的', () => {
    expect(DesktopCardLibraryResponseSchema.safeParse({
      status: 200,
      body: { success: true, cards: [] },
    }).success).toBe(true);
    expect(DesktopCardLibraryResponseSchema.safeParse({
      status: 200,
      body: { success: true, cards: [] },
      cache: { outcome: 'captured', captured: 2, skipped: 0 },
    }).success).toBe(true);
    expect(DesktopCardLibraryResponseSchema.safeParse({
      status: 404,
      body: { success: false },
      cache: { outcome: 'withdrawn', captured: 0, skipped: 0 },
    }).success).toBe(true);
    // 未知 outcome / 未知字段一律拒绝。
    expect(DesktopCardLibraryResponseSchema.safeParse({
      status: 200,
      body: {},
      cache: { outcome: 'cached', captured: 0, skipped: 0 },
    }).success).toBe(false);
    expect(DesktopCardLibraryResponseSchema.safeParse({
      status: 200,
      body: {},
      cache: { outcome: 'captured', captured: 0, skipped: 0, extra: 1 },
    }).success).toBe(false);
  });
});

describe('hosted preset BYOK 安全选择', () => {
  for (const [schema, routeId] of [
    [DesktopHostedGenerateRequestSchema, 'generate-free-stream'],
    [DesktopHostedJsonRequestSchema, 'generate-free'],
  ] as const) {
    it(`${routeId}: 接受稳定预设身份及即时模型，不接受秘密、URL 或双目标`, () => {
      const base = { requestId: 'byok-1', routeId, body: {}, presetConfig: {
        providerId: 'deepseek', modelId: ' custom-model ', generationOverrides: { temperature: 0.4 },
      } };
      expect(schema.parse(base).presetConfig?.modelId).toBe('custom-model');
      expect(schema.parse({ ...base, presetConfig: { ...base.presetConfig, modelId: '\uFEFF custom-model \uFEFF' } }).presetConfig?.modelId).toBe('custom-model');
      expect(schema.safeParse({ ...base, presetConfig: null }).success).toBe(false);
      expect(schema.safeParse({ ...base, presetConfig: { ...base.presetConfig, generationOverrides: null } }).success).toBe(false);
      expect(schema.parse({ ...base, presetConfig: { ...base.presetConfig, modelId: '😀'.repeat(100) } }).presetConfig?.modelId).toHaveLength(200);
      for (const providerId of ['DeepSeek', 'deep.seek', 'deep_seek', 'a'.repeat(101)]) {
        expect(schema.safeParse({ ...base, presetConfig: { ...base.presetConfig, providerId } }).success).toBe(false);
      }
      for (const forbidden of ['apiKey', 'secretRef', 'baseUrl', 'endpoint', 'profileId']) {
        expect(schema.safeParse({ ...base, presetConfig: { ...base.presetConfig, [forbidden]: 'secret' } }).success).toBe(false);
      }
      expect(schema.safeParse({ ...base, systemConfig: { modelId: 'default' } }).success).toBe(false);
      for (const modelId of ['', 'a\nb', 'x'.repeat(201), 'a\u0085b', 'a\u009fb', '😀'.repeat(101)]) {
        expect(schema.safeParse({ ...base, presetConfig: { ...base.presetConfig, modelId } }).success).toBe(false);
      }
    });
  }
});

describe('card-library account-fenced wire contract', () => {
  it('keeps the typed route allowlist aligned with native fixture', () => {
    expect([...DesktopCardLibraryRouteIdSchema.options].sort()).toEqual(Object.keys(fixture.cardLibrary.routes).sort());
    expect(fixture.cardLibrary.routes['user-capacity.query']).toEqual({ method: 'GET', path: '/api/user-capacity', auth: 'required' });
  });
  it('accepts frozen account IDs and legacy requests', () => {
    for (const wire of fixture.cardLibrary.validRequests) {
      expect(DesktopCardLibraryRequestSchema.safeParse(wire).success).toBe(true);
    }
  });
  it('rejects unsafe IDs, non-camelCase fields and arbitrary URLs', () => {
    for (const wire of fixture.cardLibrary.invalidFenceRequests) {
      expect(DesktopCardLibraryRequestSchema.safeParse(wire).success).toBe(false);
    }
  });
});
