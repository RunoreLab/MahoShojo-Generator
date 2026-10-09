import { z } from './zod';

import { SafeJsonValueSchema } from './json-value';
import { ProviderModelIdSchema, ProviderPresetIdSchema } from './provider-target';

/**
 * Desktop ↔ 项目服务的云端窄契约（D5.0c，`SPEC-desktop-online-ai-integration-v1`
 * DESK-ONLINE-005 / 012 / 013）。
 *
 * 本模块定义两段边界，且只定义**非秘密字段**：
 *
 * 1. `desktop-auth-v1` 原生授权 HTTP 协议：系统浏览器打开受控授权页 → 服务端签发
 *    一次性短时效 grant（绑定 PKCE S256 challenge 与 loopback 回跳地址）→ native
 *    侧以 code + verifier 交换 Better Auth 会话 cookie。grant code、code verifier、
 *    session cookie 均为凭据：只存在 native 侧与服务端存储，绝不进 renderer、URL
 *    query（回跳参数除外）、导出包、日志或本地库。
 * 2. renderer ↔ native 的 IPC 投影：账号摘要、登录结果、会话状态、在线探测结果。
 *    renderer 只能看到「是否已登录 / 谁」，看不到任何可重放凭据。
 */

/* ── 协议常量 ──────────────────────────────────────────────────────────── */

export const DESKTOP_AUTH_PROTOCOL_VERSION = 'desktop-auth-v1' as const;
export const DesktopAuthProtocolVersionSchema = z.literal(DESKTOP_AUTH_PROTOCOL_VERSION);

/** 授权页路径（同源 GET，系统浏览器打开）。 */
export const DESKTOP_AUTH_AUTHORIZE_PATH = '/auth/desktop' as const;
/** grant 签发端点（Better Auth basePath 下的插件端点全路径）。 */
export const DESKTOP_AUTH_GRANT_PATH = '/api/auth/native/grant' as const;
/** grant 交换端点。 */
export const DESKTOP_AUTH_EXCHANGE_PATH = '/api/auth/native/exchange' as const;

/** grant 的签发后有效期（秒）。一次性且短时效，防回放窗口足够小即可。 */
export const DESKTOP_AUTH_GRANT_TTL_SECONDS = 120;

/** state / code / challenge / verifier 的形态约束（RFC 8252 §4.1、RFC 7636）。 */
export const MAX_DESKTOP_AUTH_STATE_LENGTH = 128;
export const DESKTOP_AUTH_CODE_LENGTH = 43;
export const DESKTOP_AUTH_CODE_CHALLENGE_LENGTH = 43;
export const MIN_DESKTOP_AUTH_CODE_VERIFIER_LENGTH = 43;
export const MAX_DESKTOP_AUTH_CODE_VERIFIER_LENGTH = 128;

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;
const CODE_VERIFIER_PATTERN = /^[A-Za-z0-9\-._~]+$/u;

/** loopback 回跳地址允许的唯一路径。 */
export const DESKTOP_AUTH_LOOPBACK_CALLBACK_PATH = '/callback' as const;

/**
 * 原生回跳地址只接受 IPv4/IPv6 loopback 字面量（RFC 8252 §7.3 / §8.3）。
 * 不接受 `localhost` 主机名（DNS 解析不在本项目控制面内），不接受 query/fragment。
 */
export const isDesktopLoopbackRedirectUri = (value: string): boolean => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:') return false;
  const host = url.hostname.toLowerCase();
  if (host !== '127.0.0.1' && host !== '[::1]') return false;
  const port = Number(url.port || '80');
  if (!Number.isInteger(port) || port < 1 || port > 65535) return false;
  return url.pathname === DESKTOP_AUTH_LOOPBACK_CALLBACK_PATH
    && url.search === ''
    && url.hash === ''
    && url.username === ''
    && url.password === '';
};

export const DesktopLoopbackRedirectUriSchema = z
  .string()
  .min(1)
  .max(256)
  .superRefine((value, context) => {
    if (!isDesktopLoopbackRedirectUri(value)) {
      context.addIssue({
        code: 'custom',
        message: 'redirectUri must use HTTP, host 127.0.0.1 or [::1], port 1–65535 (default 80), path /callback, and no credentials, query or fragment',
      });
    }
  });
export type DesktopLoopbackRedirectUri = z.infer<typeof DesktopLoopbackRedirectUriSchema>;

export const DesktopAuthStateSchema = z
  .string()
  .min(1)
  .max(MAX_DESKTOP_AUTH_STATE_LENGTH)
  .regex(BASE64URL_PATTERN, 'state must be base64url');
export const DesktopAuthCodeChallengeSchema = z
  .string()
  .length(DESKTOP_AUTH_CODE_CHALLENGE_LENGTH)
  .regex(BASE64URL_PATTERN, 'codeChallenge must be a base64url-encoded SHA-256 digest');
export const DesktopAuthCodeVerifierSchema = z
  .string()
  .min(MIN_DESKTOP_AUTH_CODE_VERIFIER_LENGTH)
  .max(MAX_DESKTOP_AUTH_CODE_VERIFIER_LENGTH)
  .regex(CODE_VERIFIER_PATTERN, 'codeVerifier must use RFC 7636 unreserved characters');
export const DesktopAuthCodeSchema = z
  .string()
  .length(DESKTOP_AUTH_CODE_LENGTH)
  .regex(BASE64URL_PATTERN, 'code must be base64url');

/* ── 授权页 query（浏览器 GET，服务端同源渲染消费） ─────────────────────── */

export const DesktopAuthorizeQuerySchema = z.object({
  state: DesktopAuthStateSchema,
  code_challenge: DesktopAuthCodeChallengeSchema,
  code_challenge_method: z.literal('S256'),
  redirect_uri: DesktopLoopbackRedirectUriSchema,
}).strict();
export type DesktopAuthorizeQuery = z.infer<typeof DesktopAuthorizeQuerySchema>;

/* ── grant / exchange HTTP DTO ─────────────────────────────────────────── */

export const DesktopAuthGrantRequestSchema = z.object({
  state: DesktopAuthStateSchema,
  codeChallenge: DesktopAuthCodeChallengeSchema,
  codeChallengeMethod: z.literal('S256'),
  redirectUri: DesktopLoopbackRedirectUriSchema,
}).strict();
export type DesktopAuthGrantRequest = z.infer<typeof DesktopAuthGrantRequestSchema>;

export const DesktopAuthGrantResponseSchema = z.object({
  protocolVersion: DesktopAuthProtocolVersionSchema,
  /** 浏览器直接导航到该地址即完成回跳；由服务端根据已存 redirectUri 拼出。 */
  redirectUrl: z.string().min(1).max(512),
  expiresInSeconds: z.number().int().positive(),
}).strict();
export type DesktopAuthGrantResponse = z.infer<typeof DesktopAuthGrantResponseSchema>;

export const DesktopAuthExchangeRequestSchema = z.object({
  protocolVersion: DesktopAuthProtocolVersionSchema,
  code: DesktopAuthCodeSchema,
  codeVerifier: DesktopAuthCodeVerifierSchema,
}).strict();
export type DesktopAuthExchangeRequest = z.infer<typeof DesktopAuthExchangeRequestSchema>;

/** 非秘密账号摘要：可回 renderer、可落本地偏好，但绝不包含任何可重放凭据。 */
export const DesktopCloudAccountSummarySchema = z.object({
  /** 业务 users.id（数值型业务主键）。 */
  userId: z.number().int().positive(),
  username: z.string().min(1).max(64),
  /** 展示名（BA 账号 name / 昵称），可为 null。 */
  displayName: z.string().max(128).nullable().optional(),
}).strict();
export type DesktopCloudAccountSummary = z.infer<typeof DesktopCloudAccountSummarySchema>;

export const DesktopAuthExchangeResponseSchema = z.object({
  protocolVersion: DesktopAuthProtocolVersionSchema,
  account: DesktopCloudAccountSummarySchema,
  /** ISO 8601；会话具体过期时刻，native 只做展示与提前失效诊断，不做续约依据。 */
  sessionExpiresAt: z.string().datetime({ offset: true }),
}).strict();
export type DesktopAuthExchangeResponse = z.infer<typeof DesktopAuthExchangeResponseSchema>;

/**
 * 窄协议错误码。`invalid-grant` 刻意不区分「不存在 / 已消费 / 已过期 /
 * verifier 不匹配」——code 在服务端被原子消费，重放与猜测的反馈必须一致。
 */
export const DesktopAuthErrorCodeSchema = z.enum([
  'invalid-request',
  'unauthorized',
  'invalid-grant',
  'protocol-mismatch',
  'rate-limited',
  'account-unavailable',
  'internal-error',
]);
export type DesktopAuthErrorCode = z.infer<typeof DesktopAuthErrorCodeSchema>;
export const DesktopAuthErrorSchema = z.object({
  error: z.string().min(1).max(256),
  code: DesktopAuthErrorCodeSchema.optional(),
}).strict();
export type DesktopAuthError = z.infer<typeof DesktopAuthErrorSchema>;

/* ── renderer ↔ native IPC 投影 ────────────────────────────────────────── */

export const DesktopCloudLoginBeginResponseSchema = z.object({
  /** native 侧 login flow 的标识；await/cancel 以此选择。 */
  flowId: z.string().min(1).max(128),
  /** 已打开的授权页完整 URL，供「浏览器未弹出」时手动复制。 */
  authorizeUrl: z.string().min(1).max(2048),
}).strict();
export type DesktopCloudLoginBeginResponse = z.infer<typeof DesktopCloudLoginBeginResponseSchema>;

export const DesktopCloudLoginOutcomeSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('signed-in'),
    account: DesktopCloudAccountSummarySchema,
    sessionExpiresAt: z.string().datetime({ offset: true }),
  }).strict(),
  z.object({ status: z.literal('cancelled') }).strict(),
  z.object({
    status: z.literal('failed'),
    code: z.string().min(1).max(64),
    message: z.string().min(1).max(512),
  }).strict(),
]);
export type DesktopCloudLoginOutcome = z.infer<typeof DesktopCloudLoginOutcomeSchema>;

/**
 * 会话状态的公开投影。
 * `unreachable` 表示网络/服务不可用——此时本地凭据保留，绝不能误判为已注销。
 */
export const DesktopCloudSessionStatusSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('signed-out') }).strict(),
  z.object({
    state: z.literal('active'),
    account: DesktopCloudAccountSummarySchema,
    sessionExpiresAt: z.string().datetime({ offset: true }).optional(),
  }).strict(),
  z.object({ state: z.literal('expired') }).strict(),
  z.object({ state: z.literal('unreachable') }).strict(),
]);
export type DesktopCloudSessionStatus = z.infer<typeof DesktopCloudSessionStatusSchema>;

/**
 * `cloud_cached_account` 的返回：本机凭据存储中的账号摘要投影。
 *
 * 这是 cached-first 启动身份：OS credential store 里 `StoredSession` 保存的
 * 非秘密摘要，**未经服务端确认**——renderer 据此先把顶栏画成已登录用户名，
 * 再由后台 `cloud_auth_status` 给出验证结论。载荷不含 cookie 或任何可重放
 * 凭据；native 返回 `null` 表示本机没有已保存账号（确认可显示登录入口）。
 */
export const DesktopCloudCachedAccountSchema = z.object({
  account: DesktopCloudAccountSummarySchema,
  sessionExpiresAt: z.string().datetime({ offset: true }).optional(),
}).strict();
export type DesktopCloudCachedAccount = z.infer<typeof DesktopCloudCachedAccountSchema>;

/**
 * `cloud_me_profile` 的字段边界（native 侧另有独立形状校验）。
 * 服务端 `MAX_SIGNATURE_LENGTH` 是 120，这里放宽到 1024 仅作防御性上限；
 * 头像只接受 `data:image/webp;base64,` 的 data URL——服务端
 * `/api/me/profile` 明确只产出 webp，不为不存在的格式留扩展口。
 */
export const DESKTOP_ME_PROFILE_SIGNATURE_MAX_CHARS = 1024;
export const DESKTOP_ME_PROFILE_AVATAR_MAX_CHARS = 512 * 1024;
export const DESKTOP_ME_PROFILE_AVATAR_DATA_URL_PREFIX = 'data:image/webp;base64,' as const;

/**
 * `cloud_me_profile` 的返回：当前会话账号的资料投影（`/api/me/profile`
 * 固定路由，native 注入会话 cookie）。`avatarDataUrl` 供顶栏直接使用；
 * 无头像/字段缺省为 `undefined`，由 UI 回退首字母。
 *
 * `userId` 是 native 持有的当前凭据对应账号：renderer 用它做
 * stale-response fence——写缓存前核对与请求时的目标 userId 一致，
 * 登出/换号竞态下达的迟到响应不会写进错误账号的缓存槽。
 */
export const DesktopCloudMeProfileSchema = z.object({
  userId: z.number().int().positive(),
  signature: z
    .string()
    .max(DESKTOP_ME_PROFILE_SIGNATURE_MAX_CHARS)
    .optional(),
  avatarDataUrl: z
    .string()
    .max(DESKTOP_ME_PROFILE_AVATAR_MAX_CHARS)
    .startsWith(DESKTOP_ME_PROFILE_AVATAR_DATA_URL_PREFIX)
    .optional(),
}).strict();
export type DesktopCloudMeProfile = z.infer<typeof DesktopCloudMeProfileSchema>;

/** 个性签名写入只开放当前账号的有界文本，不开放头像/任意资料或 HTTP 参数。 */
export const DESKTOP_PROFILE_SIGNATURE_MAX_LENGTH = 120;
const DesktopProfileSignatureSchema = z.string()
  .max(DESKTOP_PROFILE_SIGNATURE_MAX_LENGTH)
  // Rust String 只接受 Unicode scalar；u 模式不会把合法 emoji 的代理对误判成孤立代理项。
  .refine((value) => !/[\uD800-\uDFFF]/u.test(value), 'signature 包含不完整的 Unicode 字符');

/**
 * renderer 的账号身份是写入前置条件，native 必须与其凭据账号匹配后才能发送。
 * CRLF 与 Web 一样转为 LF；越界值直接拒绝，不在 IPC 层静默截断。
 */
export const DesktopCloudSaveSignatureRequestSchema = z.object({
  expectedUserId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  signature: z.string()
    .max(DESKTOP_PROFILE_SIGNATURE_MAX_LENGTH * 2)
    .transform((value) => value.replace(/\r\n/g, '\n'))
    .pipe(DesktopProfileSignatureSchema),
}).strict();
export type DesktopCloudSaveSignatureRequest = z.infer<typeof DesktopCloudSaveSignatureRequestSchema>;

/** 必填 signature 只能来自成功响应；userId 固定为发起时使用的凭据账号。 */
export const DesktopCloudSaveSignatureResultSchema = z.object({
  userId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  signature: DesktopProfileSignatureSchema,
}).strict();
export type DesktopCloudSaveSignatureResult = z.infer<typeof DesktopCloudSaveSignatureResultSchema>;

/** 登出结果：本地凭据无条件删除，`revoked` 只反映服务端会话是否同步作废。 */
export const DesktopCloudSignOutResultSchema = z.object({
  revoked: z.boolean(),
}).strict();
export type DesktopCloudSignOutResult = z.infer<typeof DesktopCloudSignOutResultSchema>;

/** 在线能力探测结果（只覆盖本次主动使用的操作，DESK-ONLINE-013）。 */
export const DesktopCloudOnlineStatusSchema = z.object({
  reachable: z.boolean(),
  contractVersion: z.string().max(64).optional(),
  /** 客户端与服务端契约是否兼容；不可达或未声明时为 null。 */
  compatible: z.boolean().nullable(),
}).strict();
export type DesktopCloudOnlineStatus = z.infer<typeof DesktopCloudOnlineStatusSchema>;

export const DesktopCloudErrorCodeSchema = z.enum([
  'not-authenticated',
  'flow-not-found',
  'flow-in-progress',
  'cancelled',
  'timeout',
  'state-mismatch',
  'protocol-mismatch',
  'network-error',
  'server-unavailable',
  'invalid-response',
  'storage-unavailable',
  'invalid-request',
  'internal-error',
]);
export type DesktopCloudErrorCode = z.infer<typeof DesktopCloudErrorCodeSchema>;
export const DesktopCloudErrorSchema = z.object({
  code: DesktopCloudErrorCodeSchema,
  message: z.string().min(1).max(512),
}).strict();
export type DesktopCloudError = z.infer<typeof DesktopCloudErrorSchema>;

/* ── hosted 生成 SSE 的客户端视图（D5.0c 适配层，D5.1a 起接 UI） ────────── */

/** 服务器生成流的事件名集合（reasoning SSE 桥，见 hosted-runtime reasoning-sse）。 */
export const HostedGenerationEventNameSchema = z.enum([
  'markdown',
  'reasoning',
  'reasoning_done',
  'telemetry',
  'done',
  'error',
]);
export type HostedGenerationEventName = z.infer<typeof HostedGenerationEventNameSchema>;

export const HostedGenerationEventSchema = z.object({
  event: HostedGenerationEventNameSchema,
  data: SafeJsonValueSchema,
}).strict();
export type HostedGenerationEvent = z.infer<typeof HostedGenerationEventSchema>;

/** hosted 适配层允许选择的路由标识白名单（D5.0c 起，D5.1-G1 增残兽，D5.1-G2 增自由/情景，D5.1-G3 增创作工房，D5.1-G4 增升华）。 */
export const HostedGenerationRouteIdSchema = z.enum([
  'generate-magical-girl-details-stream',
  'generate-canshou-stream',
  'generate-free-stream',
  'generate-scenario-stream',
  'generate-creator-stream',
  'generate-sublimation-stream',
]);
export type HostedGenerationRouteId = z.infer<typeof HostedGenerationRouteIdSchema>;

/* ── hosted「使用系统默认配置」通道的非秘密偏好（D5.1-AIP-r1） ─────────────
 *
 * 与 Web `customProvider:{providerId:'system'}` 同语义：renderer 只声明
 * 系统通道的模型选择与逐模型生成覆盖——`modelId` 从公开系统模型清单选择
 * （'default' = 服务器默认顺序），生成覆盖按 `UserGenerationOverrides`
 * wire 形状镜像。凭据从定义上不存在：native 注入 `customProvider` 时固定
 * `providerId:'system'` + 空 `apiKey`，服务端 BYOK 另由 presetConfig 显式选择。字段均为 additive-optional——缺省即普通系统默认，
 * 与 Web 折叠语义一致。
 */

/** `UserGenerationOverrides.thinking` 的 zod4 wire 镜像（与 ai-core zod3 同形）。 */
export const DesktopHostedThinkingOverrideSchema = z.union([
  z.object({ mode: z.literal('default') }).strict(),
  z.object({ mode: z.literal('disabled') }).strict(),
  z.object({
    mode: z.literal('enabled'),
    effort: z.enum(['minimal', 'low', 'medium', 'high', 'xhigh', 'max']).optional(),
  }).strict(),
]);
export type DesktopHostedThinkingOverride = z.infer<
  typeof DesktopHostedThinkingOverrideSchema
>;

/** `UserGenerationOverrides` 的 zod4 wire 镜像；上限与 ai-core `MAX_CUSTOM_PROVIDER_OUTPUT_TOKENS` 同源。 */
export const DesktopHostedGenerationOverridesSchema = z.object({
  maxOutputTokens: z.number().int().min(1).max(1_000_000).optional(),
  temperature: z.number().finite().min(0).optional(),
  thinking: DesktopHostedThinkingOverrideSchema.optional(),
}).strict();
export type DesktopHostedGenerationOverrides = z.infer<
  typeof DesktopHostedGenerationOverridesSchema
>;

/**
 * hosted 系统通道偏好。`modelId` 只允许非空短字符串且无控制字符——
 * 「是否在系统公开清单内」由服务端 `resolveCustomProviderRuntime` 裁决
 * （系统目录的唯一事实源在服务端，native 不复制清单）。
 */
export const DesktopHostedSystemConfigSchema = z.object({
  modelId: z
    .string()
    .min(1)
    .max(256)
    .regex(/^[^\u0000-\u001f\u007f]+$/u, 'modelId 不得包含控制字符')
    .optional(),
  generationOverrides: DesktopHostedGenerationOverridesSchema.optional(),
}).strict();
export type DesktopHostedSystemConfig = z.infer<typeof DesktopHostedSystemConfigSchema>;

/** 服务器 BYOK 只声明目录身份；URL/Key/secretRef 均由 native 决定。 */
export const DesktopHostedPresetConfigSchema = z.object({
  providerId: ProviderPresetIdSchema,
  modelId: ProviderModelIdSchema,
  generationOverrides: DesktopHostedGenerationOverridesSchema.optional(),
}).strict();
export type DesktopHostedPresetConfig = z.infer<typeof DesktopHostedPresetConfigSchema>;

/**
 * hosted 生成 IPC 输入。`body` 是目标路由的业务载荷（如
 * `{answers, questionnaires, language}`），**不得**携带 `customProvider`——
 * native 是唯一注入方，renderer 注入的字段一律拒绝。
 *
 * `systemConfig` 是「使用系统默认配置」通道的非秘密偏好（additive-optional），
 * 与 Web `customProvider:{providerId:'system'}` 同语义；服务器 BYOK 在
 * native 持有并校验的 presetConfig 绑定下开放；本契约不提供
 * `byok`/`secretRef`/`providerId`/`apiKey` 等凭据字段，renderer 携带这些字段
 * 即被 strict 校验拒绝。
 */
export const DesktopHostedGenerateRequestSchema = z.object({
  requestId: z.string().min(1).max(128),
  routeId: HostedGenerationRouteIdSchema,
  body: SafeJsonValueSchema,
  systemConfig: DesktopHostedSystemConfigSchema.optional(),
  presetConfig: DesktopHostedPresetConfigSchema.optional(),
}).strict().refine((value) => !(value.systemConfig && value.presetConfig), {
  message: 'systemConfig 与 presetConfig 不可同时指定',
});
export type DesktopHostedGenerateRequest = z.infer<typeof DesktopHostedGenerateRequestSchema>;

/* ── hosted 非流式 JSON 生成（D5.1a，`/details` 双执行的服务器端非流式通路） ── */

/**
 * hosted 非流式 JSON 生成允许的路由标识白名单。与流式路由分开枚举：
 * 两条命令各自的合法 routeId 集合不同，单侧扩张不会顺带放宽另一侧。
 */
export const HostedJsonGenerationRouteIdSchema = z.enum([
  'generate-magical-girl-details',
  'generate-canshou',
  'generate-free',
  'generate-scenario',
  'generate-creator',
  'generate-sublimation',
]);
export type HostedJsonGenerationRouteId = z.infer<typeof HostedJsonGenerationRouteIdSchema>;

/**
 * hosted 非流式生成 IPC 输入。与 `DesktopHostedGenerateRequestSchema` 同形、
 * 同一套凭据边界：`body` 不得携带 `customProvider`（native 是唯一注入方），
 * systemConfig / presetConfig 二选一；前者系统默认，后者受信任目录 BYOK。
 * 顶层 `byok`/`secretRef`/`providerId`/`apiKey` 及预设内的秘密/URL 均拒绝。
 */
export const DesktopHostedJsonRequestSchema = z.object({
  requestId: z.string().min(1).max(128),
  routeId: HostedJsonGenerationRouteIdSchema,
  body: SafeJsonValueSchema,
  systemConfig: DesktopHostedSystemConfigSchema.optional(),
  presetConfig: DesktopHostedPresetConfigSchema.optional(),
}).strict().refine((value) => !(value.systemConfig && value.presetConfig), {
  message: 'systemConfig 与 presetConfig 不可同时指定',
});
export type DesktopHostedJsonRequest = z.infer<typeof DesktopHostedJsonRequestSchema>;

/**
 * hosted 非流式生成 IPC 输出：「HTTP 状态 + JSON 正文」透传。
 * native 只做传输——`{data, aiMeta}` 解包与 `{error, retryAfterSeconds}`
 * 诊断映射在 renderer 适配层完成；非 JSON 错误页（如网关 524 HTML）投影为
 * `body: null`，HTTP status 本身就是诊断信号。
 */
export const DesktopHostedJsonResponseSchema = z.object({
  status: z.number().int().min(100).max(599),
  body: SafeJsonValueSchema,
}).strict();
export type DesktopHostedJsonResponse = z.infer<typeof DesktopHostedJsonResponseSchema>;

/* ── hosted 生成请求体预算（bounded input） ──────────────────────────────
 *
 * `body` 序列化后的 UTF-8 字节上限按路由区分，与 `fixtures/desktop-cloud.json`
 * 的 `hostedBodyLimits` 同源；native `build_hosted_request_body` 做最终检查，
 * renderer 用同一份数值在派发前预检并如实提示。
 */
export const HOSTED_GENERATION_BODY_DEFAULT_MAX_BYTES = 256 * 1024;
/**
 * 按路由放宽的请求体上限：free 两路由须容纳附件预算（wire 侧附件正文合计
 * ≤200k 字符，CJK 按 UTF-8 最坏 ~4B/字符约 800KB，加 prompt 与 JSON 包装
 * 余量取整 1 MiB）。升华上行是完整原卡 + 问卷 + 历史，而非短问卷答案：
 * 为 1 MiB 可流通卡与额外参考文本保留空间，独立设 4 MiB 传输上限。
 * 此值是 Desktop 聚合载荷预算，不是服务端字段上限；JSON 历史没有字符截断，
 * stream 的 8,000 字符截断发生在服务端解析后，不能据此把 wire 预算缩小。
 * 超限明确拒绝，不截断原卡或历史；其余生成路由不随这两族自动放宽。
 */
export const HOSTED_GENERATION_BODY_ROUTE_MAX_BYTES: Readonly<Record<string, number>> = {
  'generate-free': 1024 * 1024,
  'generate-free-stream': 1024 * 1024,
  'generate-sublimation': 4 * 1024 * 1024,
  'generate-sublimation-stream': 4 * 1024 * 1024,
};

/** routeId → 请求体字节上限；未列入放宽表的路由一律回落默认值。 */
export const hostedGenerationBodyMaxBytes = (
  routeId: HostedGenerationRouteId | HostedJsonGenerationRouteId,
): number =>
  HOSTED_GENERATION_BODY_ROUTE_MAX_BYTES[routeId] ?? HOSTED_GENERATION_BODY_DEFAULT_MAX_BYTES;

/* ── 数据卡库云端通路（D5.0e，`DESK-ONLINE-010`） ────────────────────────
 *
 * 与 hosted 生成同一套边界：renderer 只能给「路由标识 + 业务参数」，method、
 * path、凭据注入全部在 native 的固定路由表里。任何白名单外的标识、给 GET
 * 路由带 body、或注入 `authorization`/`cookie`/`path`/`url`/`method` 等字段的
 * 尝试都在 IPC 边界被 strict/枚举拒绝。
 */

/**
 * 数据卡库允许的路由标识白名单。与 `fixtures/desktop-cloud.json` 的
 * `cardLibrary.routes` 同源——任一侧增删路由而另一侧未同步时，Rust 侧的
 * fixture 对拍测试必须失败。
 */
export const DesktopCardLibraryRouteIdSchema = z.enum([
  // 需要账号会话（无会话时 native 直接 `not-authenticated` fail-closed）
  'data-cards.query',
  'data-cards.create',
  'favorites.query',
  'favorites.add',
  'favorites.remove',
  'decks.query',
  'deck-cards.query',
  // 公开可读；有会话时 native 附带会话（个性化/审计由服务端决定）
  'public-data-cards.query',
  'tags.query',
  'data-card-stats.report',
  'data-card-meta-batch.query',
  'badges-batch.query',
]);
export type DesktopCardLibraryRouteId = z.infer<typeof DesktopCardLibraryRouteIdSchema>;

/**
 * 数据卡库 IPC 输入。
 * - `query`：拼到路由对应 path 的 query string；键值都是字符串；
 * - `body`：仅允许对非 GET 路由携带，序列化后受 native 侧大小上限约束；
 * - 不提供 `path`/`url`/`method`/`headers` 字段——这些全是 native 的私有事实。
 */
export const DesktopCardLibraryRequestSchema = z.object({
  routeId: DesktopCardLibraryRouteIdSchema,
  query: z.record(z.string().max(64), z.string().max(1024)).optional(),
  body: SafeJsonValueSchema.optional(),
}).strict();
export type DesktopCardLibraryRequest = z.infer<typeof DesktopCardLibraryRequestSchema>;

/**
 * `?id=` 单卡 404 响应里确认「业务级不可用」的稳定错误码（D5.1-K1-r1，
 * DESK-CACHE-006）。`/api/public-data-cards` 的真实「不存在」响应回写
 * `{success:false, code: PUBLIC_DATA_CARD_NOT_FOUND_CODE, error}`；native
 * 只认这个码才把缓存行标记为撤回——路由/版本错误凑巧 404 + success:false
 * 不构成撤回证据。与 fixture `cardLibrary.publicReadCache.withdrawalErrorCode`
 * 同源对拍。
 */
export const PUBLIC_DATA_CARD_NOT_FOUND_CODE = 'PUBLIC_DATA_CARD_NOT_FOUND';

/**
 * 公开摘要响应允许进入持久缓存的字段白名单（D5.1-K1，DESK-CACHE-004）。
 *
 * `favorited_at` 等账号关系字段刻意**不在**名单内——公开摘要接口里它恒为
 * null，但若服务端哪天开始回传真实收藏关系，白名单会让它进不了缓存，
 * 而不是跟着响应一起落盘。native 按 fixture `cardLibrary.publicReadCache`
 * 投影；本常量是该名单的 TS 镜像，fixture 对拍测试保证两侧不漂移。
 */
export const DESKTOP_PUBLIC_CACHE_SUMMARY_FIELDS = [
  'id',
  'user_id',
  'type',
  'name',
  'description',
  'is_public',
  'review_status',
  'created_at',
  'updated_at',
  'usage_count',
  'like_count',
  'favorite_count',
  'is_recommended',
  'username',
  'roleType',
  'nativeAllowed',
  'has_pending_update',
  'tag_ids',
  'isLegacyQuestionnaire',
] as const;

/**
 * 单卡完整响应允许进入持久缓存的字段白名单。`deleted_at`、软删内部字段与
 * 任何身份/凭据字段刻意不在内——缓存只保留「公开卡本体」。
 */
export const DESKTOP_PUBLIC_CACHE_CARD_FIELDS = [
  'id',
  'user_id',
  'type',
  'name',
  'description',
  'data',
  'is_public',
  'public_since',
  'review_status',
  'is_recommended',
  'usage_count',
  'like_count',
  'favorite_count',
  'created_at',
  'updated_at',
  'username',
  'tag_ids',
  'tagIds',
] as const;

/**
 * `public-data-cards.query` 响应附带的公开缓存捕获结果（D5.1-K1，
 * DESK-CACHE-004..008）。native 在写盘前按受控投影与并发守卫收口——
 * 这个枚举是「这次响应与缓存的关系」的如实报告，不代表业务成败：
 *
 * - `captured`/`partial`：安全投影已全部/部分写入持久缓存；
 * - `paused`：预算满且策略为暂停（或缓存策略已降级）——新读取未进缓存；
 * - `disabled`：`publicLibraryCache.captureEnabled` 关闭；
 * - `unavailable`：缓存库不可用（打开/schema/IO 失败），在线结果不受影响；
 * - `withdrawn`：业务级 404 已确认——对应卡已从公开缓存可见集移出；
 * - `stale`：响应早于一次清理/禁用/撤回，被 epoch/revision 守卫丢弃；
 * - `ignored`：响应对缓存不可分类（非 200/404、无公开存储许可或形状不符）。
 */
export const DesktopCardLibraryCacheOutcomeSchema = z.enum([
  'captured',
  'partial',
  'paused',
  'disabled',
  'unavailable',
  'withdrawn',
  'stale',
  'ignored',
]);
export type DesktopCardLibraryCacheOutcome = z.infer<
  typeof DesktopCardLibraryCacheOutcomeSchema
>;

export const DesktopCardLibraryCacheReportSchema = z
  .object({
    outcome: DesktopCardLibraryCacheOutcomeSchema,
    /** 本次实际写入持久缓存的条目数。 */
    captured: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    /** 被跳过的条目数（投影不合法、预算不足或并发守卫拒绝）。 */
    skipped: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  })
  .strict();
export type DesktopCardLibraryCacheReport = z.infer<
  typeof DesktopCardLibraryCacheReportSchema
>;

/**
 * 数据卡库 IPC 输出。业务响应体的形状因路由而异，契约层只保证
 * 「HTTP 状态 + JSON 正文」；各路由的业务校验在 renderer 适配层完成
 * （失败统一投影为传输/契约错误，不冒充业务失败）。
 *
 * `cache` 只出现在可缓存的公开路由（`public-data-cards.query`）上；
 * 其余路由与不参与捕获的响应没有该字段。
 */
export const DesktopCardLibraryResponseSchema = z.object({
  status: z.number().int().min(100).max(599),
  body: SafeJsonValueSchema,
  cache: DesktopCardLibraryCacheReportSchema.optional(),
}).strict();
export type DesktopCardLibraryResponse = z.infer<typeof DesktopCardLibraryResponseSchema>;

/* ── 消息中心固定路由（D5.1d-1，`/messages` 消息面与顶栏未读摘要） ────────── */

/**
 * 消息中心允许的路由标识白名单。与 `fixtures/desktop-cloud.json` 的
 * `messages.routes` 同源——任一侧增删路由而另一侧未同步时，Rust 侧的
 * fixture 对拍测试必须失败。
 */
export const DesktopMessagesRouteIdSchema = z.enum([
  // 需要账号会话（无会话时 native 直接 `not-authenticated` fail-closed；
  // 服务端对这些路由回 401 时按凭据被拒清本地会话）
  'messages.summary',
  'messages.read',
  'messages.read-all',
  // 公开可读（未登录仅全站可见）；有会话时 native 附带会话
  'messages.list',
]);
export type DesktopMessagesRouteId = z.infer<typeof DesktopMessagesRouteIdSchema>;

/**
 * 消息中心 IPC 输入：与 `DesktopCardLibraryRequestSchema` 同一窄边界——
 * renderer 只给 `routeId` + `query` + `body`；method/path/cookie 全是
 * native 的私有事实。
 */
export const DesktopMessagesRequestSchema = z.object({
  routeId: DesktopMessagesRouteIdSchema,
  query: z.record(z.string().max(64), z.string().max(1024)).optional(),
  body: SafeJsonValueSchema.optional(),
}).strict();
export type DesktopMessagesRequest = z.infer<typeof DesktopMessagesRequestSchema>;

/**
 * 消息中心 IPC 输出：「HTTP 状态 + JSON 正文」透传；`MessageListDto` /
 * `MessageSummaryDto` 等业务校验在 renderer 适配层按 `@mahoshojo/contracts/messages`
 * 的 schema 完成。
 */
export const DesktopMessagesResponseSchema = z.object({
  status: z.number().int().min(100).max(599),
  body: SafeJsonValueSchema,
}).strict();
export type DesktopMessagesResponse = z.infer<typeof DesktopMessagesResponseSchema>;
