import { generateRecoveryToken, hashRecoveryToken, RECOVERY_TOKEN_TTL_SECONDS } from '@/lib/auth/recovery-token';
import { guardMailSendByAudit } from '@/lib/auth/mail-send-guard';
import { recordAuthAuditLog } from '@/lib/auth/auth-audit';
import { getDrizzleDbFromRuntime } from '@/lib/db/drizzle';
import {
  getBusinessUserByUsername,
  listBusinessUsersByEmailInsensitive,
} from '@/lib/db/repositories/business-users';
import {
  consumePasswordResetTokenById,
  createPasswordResetToken,
} from '@/lib/db/repositories/password-reset-tokens';
import { getUserByUsername } from '@/lib/database/users';
import { verifyTurnstileToken } from '@/lib/turnstile';

export const runtime = 'edge';

const GENERIC_MESSAGE = '如果您输入的信息正确，系统会向邮箱发送一次性重置链接，请在 15 分钟内完成重置。';
const LEGACY_RECOVERY_EVENT_TYPE = 'legacy_password_recovery_request';

type RecoveryUserCandidate = {
  id: number;
  username: string;
};

const toNonEmptyString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const extractRequestIp = (req: Request): string | null => {
  const cfIp = toNonEmptyString(req.headers.get('cf-connecting-ip'));
  if (cfIp) return cfIp;

  const xForwardedFor = toNonEmptyString(req.headers.get('x-forwarded-for'));
  if (!xForwardedFor) return null;
  const first = xForwardedFor.split(',')[0]?.trim();
  return first || null;
};

type RecoverDeps = {
  generateRecoveryToken: typeof generateRecoveryToken;
  hashRecoveryToken: typeof hashRecoveryToken;
  recoveryTokenTtlSeconds: number;
  getDrizzleDbFromRuntime: typeof getDrizzleDbFromRuntime;
  getBusinessUserByUsername: typeof getBusinessUserByUsername;
  listBusinessUsersByEmailInsensitive: typeof listBusinessUsersByEmailInsensitive;
  consumePasswordResetTokenById: typeof consumePasswordResetTokenById;
  createPasswordResetToken: typeof createPasswordResetToken;
  getUserByUsername: typeof getUserByUsername;
  verifyTurnstileToken: typeof verifyTurnstileToken;
  fetchImpl: typeof fetch;
  getResendApiKey: () => string | undefined;
  now: () => number;
};

const defaultRecoverDeps: RecoverDeps = {
  generateRecoveryToken,
  hashRecoveryToken,
  recoveryTokenTtlSeconds: RECOVERY_TOKEN_TTL_SECONDS,
  getDrizzleDbFromRuntime,
  getBusinessUserByUsername,
  listBusinessUsersByEmailInsensitive,
  consumePasswordResetTokenById,
  createPasswordResetToken,
  getUserByUsername,
  verifyTurnstileToken,
  fetchImpl: fetch,
  getResendApiKey: () => process.env.RESEND_API_KEY,
  now: () => Date.now(),
};

const buildRecoverHandler = (deps: RecoverDeps): ((req: Request) => Promise<Response>) => {
  const sendResetLinkEmail = async (params: {
    apiKey: string;
    to: string;
    username: string;
    resetUrl: string;
    expiresInMinutes: number;
  }): Promise<boolean> => {
    try {
      const response = await deps.fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${params.apiKey}`,
        },
        body: JSON.stringify({
          from: '魔事院档案馆 <recovery@send.colanns.me>',
          to: [params.to],
          subject: '魔法少女生成器 ~ 密码重置链接',
          html: `<p>您好 <strong>${params.username}</strong>,</p>
<p>请点击下方一次性链接设置新密码（有效期 ${params.expiresInMinutes} 分钟，仅可使用一次）：</p>
<p><a href="${params.resetUrl}">${params.resetUrl}</a></p>
<p>如果这不是您的操作，请忽略本邮件。</p>`,
          text: `您好 ${params.username},\n\n请访问以下一次性链接设置新密码（有效期 ${params.expiresInMinutes} 分钟，仅可使用一次）：\n${params.resetUrl}\n\n如果这不是您的操作，请忽略本邮件。`,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Failed to send reset link email:', response.status, errorText);
        return false;
      }

      return true;
    } catch (error) {
      console.error('Failed to send reset link email:', error);
      return false;
    }
  };

  return async (req: Request): Promise<Response> => {
    let payload: { username?: string; email?: string; turnstileToken?: string };

    try {
      payload = await req.json();
    } catch (error) {
      console.error('Failed to parse recovery payload:', error);
      return new Response(JSON.stringify({ success: false, error: '请求体格式错误' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const { email, turnstileToken } = payload;
    if (!email || !turnstileToken) {
      await recordAuthAuditLog({
        req,
        eventType: LEGACY_RECOVERY_EVENT_TYPE,
        authSource: 'legacy',
        identifierType: 'email',
        resultCode: 'INVALID_PAYLOAD',
      });
      return new Response(JSON.stringify({ success: false, error: '邮箱和验证码均不能为空' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const isTurnstileValid = await deps.verifyTurnstileToken(turnstileToken);
    if (!isTurnstileValid) {
      await recordAuthAuditLog({
        req,
        eventType: LEGACY_RECOVERY_EVENT_TYPE,
        authSource: 'legacy',
        identifierType: 'email',
        resultCode: 'TURNSTILE_INVALID',
      });
      return new Response(JSON.stringify({ success: false, error: '安全验证失败，请重新验证' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const db = deps.getDrizzleDbFromRuntime();
    if (!db) {
      return new Response(JSON.stringify({ success: false, error: '数据库绑定不可用，请稍后重试' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    try {
      const emailCandidates = await deps.listBusinessUsersByEmailInsensitive(db, normalizedEmail, 2);
      const recoveryUser: RecoveryUserCandidate | null =
        emailCandidates.length === 1
          ? {
              id: emailCandidates[0].id,
              username: emailCandidates[0].username,
            }
          : null;

      if (recoveryUser) {
        const userId = recoveryUser.id;
        const safeUsername = toNonEmptyString(recoveryUser.username) ?? '用户';
        const guard = await guardMailSendByAudit({
          db,
          req,
          eventType: LEGACY_RECOVERY_EVENT_TYPE,
          businessUserId: userId,
          minIntervalSeconds: 60,
          maxPerUserWindow: {
            windowSeconds: 30 * 60,
            max: 3,
          },
          maxPerIpWindow: {
            windowSeconds: 30 * 60,
            max: 12,
          },
        });
        if (!guard.allowed) {
          await recordAuthAuditLog({
            req,
            eventType: LEGACY_RECOVERY_EVENT_TYPE,
            authSource: 'legacy',
            businessUserId: userId,
            identifierType: 'email',
            resultCode: 'RATE_LIMITED',
            resultMessage: `reason=${guard.reason}`,
            metadata: {
              retryAfterSeconds: guard.retryAfterSeconds,
            },
          });
          return new Response(JSON.stringify({ success: true, message: GENERIC_MESSAGE }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        const apiKey = deps.getResendApiKey()?.trim();
        if (!apiKey) {
          console.error('RESEND_API_KEY is not configured.');
          await recordAuthAuditLog({
            req,
            eventType: LEGACY_RECOVERY_EVENT_TYPE,
            authSource: 'legacy',
            businessUserId: userId,
            identifierType: 'email',
            resultCode: 'MAIL_PROVIDER_MISCONFIGURED',
          });
        } else {
          const rawToken = deps.generateRecoveryToken();
          const tokenHash = await deps.hashRecoveryToken(rawToken);
          const nowEpochSeconds = Math.floor(deps.now() / 1000);
          const expiresAt = nowEpochSeconds + deps.recoveryTokenTtlSeconds;
          const tokenRow = await deps.createPasswordResetToken(db, {
            userId,
            tokenHash,
            expiresAt,
            requestedIp: extractRequestIp(req),
            requestedUserAgent: req.headers.get('user-agent'),
            nowEpochSeconds,
          });

          if (!tokenRow) {
            console.error('Create password reset token failed:', { userId });
            await recordAuthAuditLog({
              req,
              eventType: LEGACY_RECOVERY_EVENT_TYPE,
              authSource: 'legacy',
              businessUserId: userId,
              identifierType: 'email',
              resultCode: 'TOKEN_CREATE_FAILED',
            });
          } else {
            const requestUrl = new URL(req.url);
            const resetUrl = new URL('/password-recovery', requestUrl.origin);
            resetUrl.searchParams.set('token', rawToken);

            const sent = await sendResetLinkEmail({
              apiKey,
              to: normalizedEmail,
              username: safeUsername,
              resetUrl: resetUrl.toString(),
              expiresInMinutes: Math.floor(deps.recoveryTokenTtlSeconds / 60),
            });

            if (!sent) {
              await deps.consumePasswordResetTokenById(db, tokenRow.id, nowEpochSeconds);
              await recordAuthAuditLog({
                req,
                eventType: LEGACY_RECOVERY_EVENT_TYPE,
                authSource: 'legacy',
                businessUserId: userId,
                identifierType: 'email',
                resultCode: 'EMAIL_SEND_FAILED',
              });
            } else {
              await recordAuthAuditLog({
                req,
                eventType: LEGACY_RECOVERY_EVENT_TYPE,
                authSource: 'legacy',
                businessUserId: userId,
                identifierType: 'email',
                resultCode: 'SUCCESS',
              });
            }
          }
        }
      } else {
        await recordAuthAuditLog({
          req,
          eventType: LEGACY_RECOVERY_EVENT_TYPE,
          authSource: 'legacy',
          identifierType: 'email',
          resultCode: emailCandidates.length > 1 ? 'EMAIL_RECOVERY_CONFLICT' : 'USER_EMAIL_MISMATCH',
          metadata: emailCandidates.length > 1 ? { candidateCount: emailCandidates.length } : undefined,
        });
      }

      return new Response(JSON.stringify({ success: true, message: GENERIC_MESSAGE }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      console.error('Password recovery error:', error);
      return new Response(JSON.stringify({ success: false, error: '服务器错误，请稍后重试' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  };
};

export const createRecoverHandler = (overrides: Partial<RecoverDeps> = {}): ((req: Request) => Promise<Response>) => {
  return buildRecoverHandler({ ...defaultRecoverDeps, ...overrides });
};

export const POST = createRecoverHandler();
