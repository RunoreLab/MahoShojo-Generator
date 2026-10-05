import { z } from 'zod';
import { createAuthEndpoint, sessionMiddleware } from 'better-auth/api';
import { setSessionCookie } from 'better-auth/cookies';
import type { BetterAuthPlugin } from 'better-auth';

import {
  DESKTOP_AUTH_PROTOCOL_VERSION,
  DesktopAuthCodeVerifierSchema,
  DesktopAuthCodeSchema,
  DesktopAuthGrantRequestSchema,
} from '@mahoshojo/contracts/desktop-cloud';

import { recordAuthAuditLog } from '@/lib/auth/auth-audit';
import { acquireAuthAttemptRateLimit } from '@/lib/auth/attempt-rate-limit';
import {
  buildDesktopGrantRedirectUrl,
  decodeDesktopGrantRecord,
  desktopGrantIdentifierFromCode,
  encodeDesktopGrantRecord,
  generateDesktopGrantCode,
  verifyDesktopCodeVerifier,
  DESKTOP_GRANT_EXPIRES_IN_SECONDS,
} from '@/lib/auth/native-desktop';
import {
  ensureAuthUserLink,
  getLinkedBusinessUserByAuthUserId,
} from '@/lib/auth/user-auth-linking';

/**
 * `desktop-auth-v1` 窄授权协议的 Better Auth 插件面。
 *
 * 只暴露两个端点（挂在既有 `/api/auth` basePath 下，无需新增 Next route）：
 *
 * - `POST /native/grant`：要求已有浏览器会话（`sessionMiddleware`）。签发一次性、
 *   120 秒有效的 grant，绑定 PKCE challenge 与 loopback 回跳地址，只回传 redirectUrl。
 * - `POST /native/exchange`：无需会话。原子消费 grant（`consumeVerificationValue`
 *   保证不可重放），校验 S256 verifier 后用 `internalAdapter.createSession` +
 *   `setSessionCookie` 建立正式会话——不直接写 session 表、不依赖 BA 内部 API。
 *
 * 凭据边界：DB 只存 `sha256(code)` 派生键；code 明文只在回跳 URL 中出现一次；
 * 会话 cookie 由 BA cookie 管线签名下发，服务端与 native 都不自行构造。
 */

const DESKTOP_AUTH_SOURCE = 'better-auth' as const;
const GRANT_EVENT_TYPE = 'desktop_native_grant';
const EXCHANGE_EVENT_TYPE = 'desktop_native_exchange';

const toNonEmptyString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const isBusinessUserBanned = (row: { isBanned?: string | null } | null | undefined): boolean =>
  typeof row?.isBanned === 'string' && row.isBanned.trim().length > 0;

const jsonError = (status: number, code: string, message: string): Response =>
  new Response(
    JSON.stringify({ error: message, code }),
    { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } },
  );

const grantBodySchema = DesktopAuthGrantRequestSchema;

const exchangeBodySchema = z.object({
  protocolVersion: z.literal(DESKTOP_AUTH_PROTOCOL_VERSION),
  code: DesktopAuthCodeSchema,
  codeVerifier: DesktopAuthCodeVerifierSchema,
}).strict();

type GenericCtx = {
  request?: Request;
  context: {
    internalAdapter: {
      createVerificationValue(data: {
        identifier: string;
        value: string;
        expiresAt: Date;
      }): Promise<unknown>;
      consumeVerificationValue(identifier: string): Promise<{ value: string } | null>;
      createSession(
        userId: string,
        dontRememberMe?: boolean,
        override?: Record<string, unknown>,
      ): Promise<unknown>;
      findUserById(userId: string): Promise<unknown>;
    };
    session?: { user?: { id?: unknown; email?: unknown; name?: unknown } } | null;
  };
};

export const desktopNativeAuthPlugin = () => ({
  id: 'desktop-native-auth',
  endpoints: {
    /**
     * 浏览器侧（授权页）确认后调用。要求已有 BA 会话——未登录请求在
     * `sessionMiddleware` 被 401 拒绝，不进入本 handler。
     */
    nativeGrant: createAuthEndpoint(
      '/native/grant',
      {
        method: 'POST',
        body: grantBodySchema,
        use: [sessionMiddleware],
      },
      async (ctx) => {
        const genericCtx = ctx as unknown as GenericCtx;
        const req = genericCtx.request ?? new Request('http://localhost/');
        const sessionUser = genericCtx.context.session?.user;
        const authUserId = toNonEmptyString(sessionUser?.id);
        if (!authUserId) {
          return jsonError(401, 'unauthorized', '需要已登录会话才能授权桌面端');
        }

        const rate = acquireAuthAttemptRateLimit({
          req,
          actionType: 'native-grant',
          identifier: authUserId,
        });
        if (!rate.allowed) {
          await recordAuthAuditLog({
            req,
            eventType: GRANT_EVENT_TYPE,
            authSource: DESKTOP_AUTH_SOURCE,
            resultCode: 'RATE_LIMITED',
            authUserId,
          });
          return jsonError(429, 'rate-limited', `请求过于频繁，请在 ${rate.retryAfterSeconds} 秒后重试`);
        }

        const body = ctx.body as z.infer<typeof grantBodySchema>;

        const businessUser = await getLinkedBusinessUserByAuthUserId(authUserId)
          ?? await ensureAuthUserLink({
            authUserId,
            email: toNonEmptyString(sessionUser?.email),
            name: toNonEmptyString(sessionUser?.name),
          });

        if (!businessUser || isBusinessUserBanned(businessUser)) {
          await recordAuthAuditLog({
            req,
            eventType: GRANT_EVENT_TYPE,
            authSource: DESKTOP_AUTH_SOURCE,
            resultCode: 'ACCOUNT_UNAVAILABLE',
            authUserId,
            businessUserId: businessUser?.id ?? null,
          });
          return jsonError(409, 'account-unavailable', '当前账号状态不允许桌面端授权');
        }

        const code = generateDesktopGrantCode();
        const identifier = await desktopGrantIdentifierFromCode(code);
        const expiresAt = new Date(Date.now() + DESKTOP_GRANT_EXPIRES_IN_SECONDS * 1000);

        await genericCtx.context.internalAdapter.createVerificationValue({
          identifier,
          value: encodeDesktopGrantRecord({
            v: 1,
            authUserId,
            businessUserId: businessUser.id,
            codeChallenge: body.codeChallenge,
            redirectUri: body.redirectUri,
            state: body.state,
          }),
          expiresAt,
        });

        await recordAuthAuditLog({
          req,
          eventType: GRANT_EVENT_TYPE,
          authSource: DESKTOP_AUTH_SOURCE,
          resultCode: 'SUCCESS',
          authUserId,
          businessUserId: businessUser.id,
        });

        return ctx.json({
          protocolVersion: DESKTOP_AUTH_PROTOCOL_VERSION,
          redirectUrl: buildDesktopGrantRedirectUrl({
            redirectUri: body.redirectUri,
            code,
            state: body.state,
          }),
          expiresInSeconds: DESKTOP_GRANT_EXPIRES_IN_SECONDS,
        });
      },
    ),

    /**
     * native 侧回跳后调用。grant 一经消费即删除（包括校验失败的情况），
     * 因此对重放、穷举与过期请求统一返回 `invalid-grant`。
     */
    nativeExchange: createAuthEndpoint(
      '/native/exchange',
      {
        method: 'POST',
        body: exchangeBodySchema,
      },
      async (ctx) => {
        const genericCtx = ctx as unknown as GenericCtx;
        const req = genericCtx.request ?? new Request('http://localhost/');
        const body = ctx.body as z.infer<typeof exchangeBodySchema>;

        // 不做 identifier 维度：所有桌面用户共用同一桶会造成跨用户误限流；
        // grant 的一次性 code + PKCE + 原子消费已覆盖猜测/重放防护。
        const rate = acquireAuthAttemptRateLimit({
          req,
          actionType: 'native-exchange',
        });
        if (!rate.allowed) {
          await recordAuthAuditLog({
            req,
            eventType: EXCHANGE_EVENT_TYPE,
            authSource: DESKTOP_AUTH_SOURCE,
            resultCode: 'RATE_LIMITED',
          });
          return jsonError(429, 'rate-limited', `请求过于频繁，请在 ${rate.retryAfterSeconds} 秒后重试`);
        }

        const identifier = await desktopGrantIdentifierFromCode(body.code);
        const verification = await genericCtx.context.internalAdapter.consumeVerificationValue(identifier);
        const record = verification ? decodeDesktopGrantRecord(verification.value) : null;

        const verifierOk = record
          ? await verifyDesktopCodeVerifier(body.codeVerifier, record.codeChallenge)
          : false;

        if (!record || !verifierOk) {
          await recordAuthAuditLog({
            req,
            eventType: EXCHANGE_EVENT_TYPE,
            authSource: DESKTOP_AUTH_SOURCE,
            resultCode: 'INVALID_GRANT',
            authUserId: record?.authUserId ?? null,
            businessUserId: record?.businessUserId ?? null,
          });
          return jsonError(401, 'invalid-grant', '授权已失效，请回到应用重新发起登录');
        }

        const session = await genericCtx.context.internalAdapter.createSession(record.authUserId) as {
          expiresAt: Date;
        };
        const authUser = await genericCtx.context.internalAdapter.findUserById(record.authUserId);
        await setSessionCookie(ctx as Parameters<typeof setSessionCookie>[0], {
          session: session as Parameters<typeof setSessionCookie>[1]['session'],
          user: authUser as Parameters<typeof setSessionCookie>[1]['user'],
        });

        await recordAuthAuditLog({
          req,
          eventType: EXCHANGE_EVENT_TYPE,
          authSource: DESKTOP_AUTH_SOURCE,
          resultCode: 'SUCCESS',
          authUserId: record.authUserId,
          businessUserId: record.businessUserId,
        });

        // 业务账号摘要只回 non-secret 字段；session cookie 走 Set-Cookie，不进 body。
        const businessUser = await getLinkedBusinessUserByAuthUserId(record.authUserId);
        const authUserName = toNonEmptyString((authUser as { name?: unknown } | null)?.name);
        return ctx.json({
          protocolVersion: DESKTOP_AUTH_PROTOCOL_VERSION,
          account: {
            userId: record.businessUserId,
            username: businessUser?.username ?? `user-${record.businessUserId}`,
            displayName: authUserName ?? null,
          },
          sessionExpiresAt: session.expiresAt.toISOString(),
        });
      },
    ),
  },
}) satisfies BetterAuthPlugin;
