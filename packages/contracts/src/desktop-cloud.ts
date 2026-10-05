import { z } from './zod';

import { SafeJsonValueSchema } from './json-value';

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
        message: 'redirectUri must be http://127.0.0.1:<port>/callback or http://[::1]:<port>/callback',
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

/** hosted 适配层允许选择的路由标识白名单（D5.0c 最小集）。 */
export const HostedGenerationRouteIdSchema = z.enum([
  'generate-magical-girl-details-stream',
]);
export type HostedGenerationRouteId = z.infer<typeof HostedGenerationRouteIdSchema>;

/**
 * hosted 生成 IPC 输入。`body` 是目标路由的业务载荷（如
 * `{answers, questionnaires, language}`），**不得**携带 `customProvider`——
 * native 是唯一注入方，renderer 注入的字段一律拒绝。
 *
 * 服务器 BYOK 在 native 持有并校验的 Provider 绑定落地前保持关闭（DESK-093）：
 * 本契约不提供 `byok`/`secretRef`/`providerId`/`modelId` 等凭据字段，renderer
 * 携带这些字段即被 strict 校验拒绝。当前只开放系统默认通道。
 */
export const DesktopHostedGenerateRequestSchema = z.object({
  requestId: z.string().min(1).max(128),
  routeId: HostedGenerationRouteIdSchema,
  body: SafeJsonValueSchema,
}).strict();
export type DesktopHostedGenerateRequest = z.infer<typeof DesktopHostedGenerateRequestSchema>;
