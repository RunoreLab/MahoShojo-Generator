import 'server-only';
import { z } from 'zod';
import { APIError, createAuthEndpoint, createAuthMiddleware, sensitiveSessionMiddleware } from 'better-auth/api';
import { setSessionCookie } from 'better-auth/cookies';
import type { BetterAuthPlugin, GenericEndpointContext } from 'better-auth';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import { acquireAuthAttemptRateLimit } from '@/lib/auth/attempt-rate-limit';
import { recordAuthAuditLog } from '@/lib/auth/auth-audit';
import type { PasskeyConfig } from '@/lib/auth/passkey-config';
import {
  PASSKEY_API_PREFIX, PASSKEY_MAX_CREDENTIALS, PASSKEY_ROUTES,
  PasskeyAssertionSchema, PasskeyDeleteSchema, PasskeyManagementActionSchema,
  PasskeyRegisterOptionsSchema, PasskeyRegisterSchema, PasskeyRenameSchema,
  type PasskeyConfirmation, type PasskeyManagementAction,
} from '@/lib/auth/passkey-contract';
import {
  PASSKEY_CHALLENGE_TTL_MS, createAssertionOptions, createRegistrationOptions,
  verifyPasskeyAssertion, verifyPasskeyRegistration,
} from '@/lib/auth/passkey-webauthn';
import { getLinkedBusinessUserByAuthUserId } from '@/lib/auth/user-auth-linking';
import { createDrizzleDb, getRuntimeD1ClientWithoutHttpFallback, type AppDrizzleDb } from '@/lib/db/drizzle';
import {
  addPasskey, consumePasskeyChallenge, deletePasskey, findPasskey, listOwnedPasskeys,
  recordPasskeyUse, renamePasskey, savePasskeyChallenge, toPasskeySummary, type PasskeyActor,
} from '@/lib/db/repositories/passkeys';

const MAX_BODY_BYTES = 24 * 1024;
const LOGIN_COOKIE = 'passkey_login';
const EMPTY_BODY = z.object({}).strict();
const NO_STORE = { 'Cache-Control': 'no-store' };
const PASSKEY_HTTP_PATHS = new Set(Object.values(PASSKEY_ROUTES).map((path) => PASSKEY_API_PREFIX + path));

const unavailable = () =>
  new APIError('SERVICE_UNAVAILABLE', { code: 'PASSKEY_UNAVAILABLE', message: '通行密钥服务暂不可用。' });
const invalidProof = () =>
  new APIError('UNAUTHORIZED', { code: 'PASSKEY_NOT_VERIFIED', message: '未能确认通行密钥，请重试或使用密码。' });
const passwordRequired = () =>
  new APIError('FORBIDDEN', { code: 'PASSKEY_PASSWORD_REQUIRED', message: '这项操作需要确认当前密码。' });
const stale = () =>
  new APIError('CONFLICT', { code: 'PASSKEY_STATE_CHANGED', message: '通行密钥列表或会话已变化，请刷新后重试。' });

type Limiter = { limit(input: { key: string }): Promise<{ success: boolean }> };
function getLimiter(name: 'PASSKEY_REQUEST_LIMITER' | 'PASSKEY_CONFIRM_LIMITER'): Limiter | undefined {
  try {
    return (getCloudflareContext().env as Partial<Record<typeof name, Limiter>>)[name];
  } catch {
    return undefined;
  }
}

async function rateLimit(config: PasskeyConfig, req: Request, authUserId?: string) {
  const limiter = getLimiter(authUserId ? 'PASSKEY_CONFIRM_LIMITER' : 'PASSKEY_REQUEST_LIMITER');
  let allowed: boolean;
  if (limiter) {
    const key = authUserId ?? req.headers.get('cf-connecting-ip') ?? 'unknown';
    try {
      allowed = (await limiter.limit({ key })).success;
    } catch {
      throw unavailable();
    }
  } else {
    if (!config.local) throw unavailable();
    allowed = acquireAuthAttemptRateLimit({
      req, actionType: authUserId ? 'passkey-confirm' : 'passkey', identifier: authUserId,
    }).allowed;
  }
  if (!allowed) {
    throw new APIError('TOO_MANY_REQUESTS', { code: 'PASSKEY_RATE_LIMITED', message: '操作太频繁，请稍后重试。' });
  }
}

async function boundRequest(req: Request) {
  const error = () => ({
    response: Response.json({ code: 'PASSKEY_BODY_TOO_LARGE', message: '请求内容过长。' }, { status: 413, headers: NO_STORE }),
  });
  if (Number(req.headers.get('content-length')) > MAX_BODY_BYTES) return error();
  if (!req.body) return;
  const reader = req.body.getReader();
  const bytes = new Uint8Array(MAX_BODY_BYTES);
  let length = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    if (length + result.value.length > MAX_BODY_BYTES) {
      void reader.cancel().catch(() => undefined);
      return error();
    }
    bytes.set(result.value, length);
    length += result.value.length;
  }
  // Next 的 Route Handler 可能用 Proxy 封装 Request，构造器需要普通字段。
  return {
    request: new Request(req.url, {
      method: req.method, headers: req.headers, signal: req.signal, body: bytes.subarray(0, length),
    }),
  };
}

type Management = { actor: PasskeyActor; username: string };
type ChallengePurpose = Parameters<typeof consumePasskeyChallenge>[1]['purpose'];

function confirmationScope(actor: PasskeyActor, action: PasskeyManagementAction) {
  return action.kind === 'register'
    ? { purpose: 'confirm-register' as const, binding: actor.sessionId }
    : { purpose: 'confirm-delete' as const, binding: JSON.stringify([actor.sessionId, action.id]) };
}

export function passkeyAuthPlugin(config: PasskeyConfig) {
  const browserContext = createAuthMiddleware(async (ctx) => {
    ctx.setHeader('Cache-Control', 'no-store');
    const request = ctx.request;
    const url = request && new URL(request.url);
    if (!request || !url || url.origin !== config.origin || !PASSKEY_HTTP_PATHS.has(url.pathname)
      || (request.method === 'POST' && request.headers.get('origin') !== config.origin)) {
      throw new APIError('FORBIDDEN', { code: 'PASSKEY_ORIGIN', message: '请从受信任的站点打开通行密钥。' });
    }
    if (request.method === 'POST') await rateLimit(config, request);
    const runtime = getRuntimeD1ClientWithoutHttpFallback();
    if (!runtime) throw unavailable();
    return { passkeyDb: createDrizzleDb(runtime), passkeyRequest: request };
  });
  const ownerContext = createAuthMiddleware(async (ctx) => {
    const session = ctx.context.session;
    if (!session?.session || session.session.userId !== session.user.id) throw invalidProof();
    const business = await getLinkedBusinessUserByAuthUserId(session.user.id);
    if (!business || business.isBanned?.trim()) {
      throw new APIError('FORBIDDEN', { code: 'PASSKEY_ACCOUNT_UNAVAILABLE', message: '当前账号无法管理通行密钥。' });
    }
    const management: Management = {
      actor: {
        rpId: config.rpId, authUserId: session.user.id, sessionId: session.session.id,
        businessUserId: business.id,
      },
      username: business.username,
    };
    return { management };
  });
  const browserUse = [browserContext];
  const managementUse = [browserContext, sensitiveSessionMiddleware, ownerContext];

  async function issueChallenge(db: AppDrizzleDb, input: {
    purpose: ChallengePurpose;
    binding: string;
    challenge: string;
    confirmedByPasskeyId?: string | null;
  }) {
    const id = crypto.randomUUID();
    const now = Date.now();
    await savePasskeyChallenge(db, {
      id, rpId: config.rpId, ...input, confirmedByPasskeyId: input.confirmedByPasskeyId ?? null,
      expiresAt: now + PASSKEY_CHALLENGE_TTL_MS,
    }, now);
    return id;
  }

  async function confirm(
    ctx: GenericEndpointContext,
    db: AppDrizzleDb,
    req: Request,
    actor: PasskeyActor,
    action: PasskeyManagementAction,
    confirmation: PasskeyConfirmation,
  ): Promise<string | null> {
    await rateLimit(config, req, actor.authUserId);
    if (confirmation.method === 'password') {
      const account = await ctx.context.internalAdapter.findCredentialAccount(actor.authUserId);
      if (!account?.password || confirmation.password.length > ctx.context.password.config.maxPasswordLength
        || !(await ctx.context.password.verify({ hash: account.password, password: confirmation.password }))) {
        throw new APIError('UNAUTHORIZED', { code: 'PASSKEY_WRONG_PASSWORD', message: '当前密码不正确。' });
      }
      return null;
    }
    const challenge = await consumePasskeyChallenge(db, {
      id: confirmation.flowId, rpId: config.rpId, ...confirmationScope(actor, action),
    }, Date.now());
    if (!challenge) throw invalidProof();
    const passkey = await findPasskey(db, config.rpId, confirmation.response.id);
    if (!passkey || passkey.authUserId !== actor.authUserId) throw invalidProof();
    const counter = await verifyPasskeyAssertion(config, challenge.challenge, confirmation.response, passkey, false);
    if (counter === null || !(await recordPasskeyUse(db, passkey, counter, Date.now()))) throw invalidProof();
    return passkey.id;
  }

  return {
    id: 'mahoshojo-passkeys',
    onRequest: async (req) => req.method === 'POST' && PASSKEY_HTTP_PATHS.has(new URL(req.url).pathname)
      ? boundRequest(req)
      : undefined,
    endpoints: {
      passkeyStatus: createAuthEndpoint(PASSKEY_ROUTES.status, { method: 'GET', use: browserUse }, async (ctx) =>
        ctx.json({ enabled: true })),
      passkeyList: createAuthEndpoint(PASSKEY_ROUTES.list, { method: 'GET', use: managementUse }, async (ctx) => {
        const keys = await listOwnedPasskeys(ctx.context.passkeyDb, ctx.context.management.actor);
        return ctx.json({ passkeys: keys.map(toPasskeySummary), limit: PASSKEY_MAX_CREDENTIALS });
      }),
      passkeyLoginOptions: createAuthEndpoint(
        PASSKEY_ROUTES.loginOptions, { method: 'POST', body: EMPTY_BODY, use: browserUse },
        async (ctx) => {
          const options = await createAssertionOptions(config);
          const flowId = await issueChallenge(ctx.context.passkeyDb, {
            purpose: 'login', binding: '', challenge: options.challenge,
          });
          const cookie = ctx.context.createAuthCookie(LOGIN_COOKIE);
          await ctx.setSignedCookie(cookie.name, flowId, ctx.context.secret, {
            ...cookie.attributes, sameSite: 'strict', maxAge: PASSKEY_CHALLENGE_TTL_MS / 1000,
          });
          return ctx.json({ flowId, options });
        },
      ),
      passkeyLogin: createAuthEndpoint(
        PASSKEY_ROUTES.login, { method: 'POST', body: PasskeyAssertionSchema, use: browserUse },
        async (ctx) => {
          const { passkeyDb: db, passkeyRequest: req, internalAdapter } = ctx.context;
          const { flowId, response } = ctx.body;
          const cookie = ctx.context.createAuthCookie(LOGIN_COOKIE);
          const flowCookie = await ctx.getSignedCookie(cookie.name, ctx.context.secret);
          if (flowCookie !== flowId) throw invalidProof();
          const challenge = await consumePasskeyChallenge(db, {
            id: flowId, rpId: config.rpId, purpose: 'login', binding: '',
          }, Date.now());
          if (!challenge) throw invalidProof();
          const passkey = await findPasskey(db, config.rpId, response.id);
          if (!passkey) throw invalidProof();
          const counter = await verifyPasskeyAssertion(config, challenge.challenge, response, passkey, true);
          if (counter === null) throw invalidProof();
          const business = await getLinkedBusinessUserByAuthUserId(passkey.authUserId);
          const user = await internalAdapter.findUserById(passkey.authUserId);
          if (!business || business.isBanned?.trim() || !user
            || !(await recordPasskeyUse(db, passkey, counter, Date.now()))) throw invalidProof();
          const session = await internalAdapter.createSession(user.id);
          if (!session) throw unavailable();
          ctx.setCookie(cookie.name, '', { ...cookie.attributes, sameSite: 'strict', maxAge: 0 });
          await setSessionCookie(ctx, { session, user });
          await recordAuthAuditLog({ req, eventType: 'passkey_login', authSource: 'better-auth',
            authUserId: user.id, businessUserId: business.id, resultCode: 'SUCCESS' });
          return ctx.json({ success: true as const, userId: business.id });
        },
      ),
      passkeyConfirmOptions: createAuthEndpoint(
        PASSKEY_ROUTES.confirmOptions, { method: 'POST', body: PasskeyManagementActionSchema, use: managementUse },
        async (ctx) => {
          const { passkeyDb: db, management: { actor } } = ctx.context;
          const keys = await listOwnedPasskeys(db, actor);
          if (ctx.body.kind === 'delete') {
            const id = ctx.body.id;
            if (!keys.some((key) => key.id === id)) throw stale();
            if (keys.length <= 1) throw passwordRequired();
          }
          if (!keys.length) throw passwordRequired();
          const options = await createAssertionOptions(config, keys);
          const flowId = await issueChallenge(db, { ...confirmationScope(actor, ctx.body), challenge: options.challenge });
          return ctx.json({ flowId, options });
        },
      ),
      passkeyRegisterOptions: createAuthEndpoint(
        PASSKEY_ROUTES.registerOptions, { method: 'POST', body: PasskeyRegisterOptionsSchema, use: managementUse },
        async (ctx) => {
          const { passkeyDb: db, passkeyRequest: req, management: { actor, username } } = ctx.context;
          const keys = await listOwnedPasskeys(db, actor);
          if (keys.length >= PASSKEY_MAX_CREDENTIALS) {
            throw new APIError('CONFLICT', { code: 'PASSKEY_LIMIT', message: '通行密钥数量已达上限。' });
          }
          if (!keys.length && ctx.body.confirmation.method !== 'password') throw passwordRequired();
          const confirmedByPasskeyId = await confirm(ctx, db, req, actor, { kind: 'register' }, ctx.body.confirmation);
          const options = await createRegistrationOptions(config, { id: actor.authUserId, username }, keys);
          const flowId = await issueChallenge(db, {
            purpose: 'register', binding: actor.sessionId, challenge: options.challenge, confirmedByPasskeyId,
          });
          return ctx.json({ flowId, options });
        },
      ),
      passkeyRegister: createAuthEndpoint(
        PASSKEY_ROUTES.register, { method: 'POST', body: PasskeyRegisterSchema, use: managementUse },
        async (ctx) => {
          const { passkeyDb: db, passkeyRequest: req, management: { actor } } = ctx.context;
          const challenge = await consumePasskeyChallenge(db, {
            id: ctx.body.flowId, rpId: config.rpId, purpose: 'register', binding: actor.sessionId,
          }, Date.now());
          if (!challenge) throw invalidProof();
          const credential = await verifyPasskeyRegistration(config, challenge.challenge, ctx.body.response);
          if (!credential) throw invalidProof();
          const entry = {
            ...credential, id: crypto.randomUUID(), name: ctx.body.name ?? '通行密钥', createdAt: Date.now(),
          };
          if (!(await addPasskey(db, actor, entry, challenge.confirmedByPasskeyId))) throw stale();
          await recordAuthAuditLog({ req, eventType: 'passkey_add', authSource: 'better-auth',
            authUserId: actor.authUserId, businessUserId: actor.businessUserId, resultCode: 'SUCCESS' });
          return ctx.json({ passkey: toPasskeySummary({ ...entry, lastUsedAt: null }) });
        },
      ),
      passkeyRename: createAuthEndpoint(
        PASSKEY_ROUTES.rename, { method: 'POST', body: PasskeyRenameSchema, use: managementUse },
        async (ctx) => {
          const { passkeyDb: db, management: { actor } } = ctx.context;
          if (!(await renamePasskey(db, actor, ctx.body.id, ctx.body.name))) throw stale();
          return ctx.json({ success: true as const });
        },
      ),
      passkeyDelete: createAuthEndpoint(
        PASSKEY_ROUTES.delete, { method: 'POST', body: PasskeyDeleteSchema, use: managementUse },
        async (ctx) => {
          const { passkeyDb: db, passkeyRequest: req, management: { actor } } = ctx.context;
          const keys = await listOwnedPasskeys(db, actor);
          if (!keys.some((key) => key.id === ctx.body.id)) throw stale();
          if (keys.length === 1 && ctx.body.confirmation.method !== 'password') throw passwordRequired();
          const confirmedByPasskeyId = await confirm(
            ctx, db, req, actor, { kind: 'delete', id: ctx.body.id }, ctx.body.confirmation,
          );
          if (!(await deletePasskey(db, actor, ctx.body.id, confirmedByPasskeyId))) throw stale();
          await recordAuthAuditLog({ req, eventType: 'passkey_delete', authSource: 'better-auth',
            authUserId: actor.authUserId, businessUserId: actor.businessUserId, resultCode: 'SUCCESS' });
          return ctx.json({ success: true as const });
        },
      ),
    },
  } satisfies BetterAuthPlugin;
}
