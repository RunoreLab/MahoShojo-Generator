import { generateRecoveryToken, hashRecoveryToken, RECOVERY_TOKEN_TTL_SECONDS } from '@/lib/auth/recovery-token';
import { getDrizzleDbFromRuntime } from '@/lib/db/drizzle';
import { getBusinessUserByUsername } from '@/lib/db/repositories/business-users';
import {
  consumePasswordResetTokenById,
  createPasswordResetToken,
} from '@/lib/db/repositories/password-reset-tokens';
import { getUserByUsername } from '@/lib/database/users';
import { verifyTurnstileToken } from '@/lib/turnstile';

export const runtime = 'edge';

const GENERIC_MESSAGE = '如果您输入的信息正确，系统会向邮箱发送一次性重置链接，请在 15 分钟内完成重置。';

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

const sendResetLinkEmail = async (params: {
  apiKey: string;
  to: string;
  username: string;
  resetUrl: string;
  expiresInMinutes: number;
}): Promise<boolean> => {
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.apiKey}`,
      },
      body: JSON.stringify({
        from: '魔事院档案馆 <recovery@send.colanns.me>',
        to: [params.to],
        subject: '魔法少女生成器 ~ 登录密钥重置链接',
        html: `<p>您好 <strong>${params.username}</strong>,</p>
<p>请点击下方一次性链接重置登录密钥（有效期 ${params.expiresInMinutes} 分钟，仅可使用一次）：</p>
<p><a href="${params.resetUrl}">${params.resetUrl}</a></p>
<p>如果这不是您的操作，请忽略本邮件。</p>`,
        text: `您好 ${params.username},\n\n请访问以下一次性链接重置登录密钥（有效期 ${params.expiresInMinutes} 分钟，仅可使用一次）：\n${params.resetUrl}\n\n如果这不是您的操作，请忽略本邮件。`,
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

export async function POST(req: Request): Promise<Response> {
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

  const { username, email, turnstileToken } = payload;
  if (!username || !email || !turnstileToken) {
    return new Response(JSON.stringify({ success: false, error: '用户名、邮箱和验证码均不能为空' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const isTurnstileValid = await verifyTurnstileToken(turnstileToken);
  if (!isTurnstileValid) {
    return new Response(JSON.stringify({ success: false, error: '安全验证失败，请重新验证' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const db = getDrizzleDbFromRuntime();
  if (!db) {
    return new Response(JSON.stringify({ success: false, error: '数据库绑定不可用，请稍后重试' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const normalizedUsername = username.trim();

  try {
    const userFromDb = await getBusinessUserByUsername(db, normalizedUsername);
    const legacyUser = userFromDb ?? (await getUserByUsername(normalizedUsername));
    const userId = typeof legacyUser?.id === 'number' && Number.isSafeInteger(legacyUser.id) ? legacyUser.id : null;
    const storedEmail = toNonEmptyString(legacyUser?.email)?.toLowerCase() ?? null;
    const safeUsername = toNonEmptyString(legacyUser?.username) ?? normalizedUsername;

    if (userId && storedEmail === normalizedEmail) {
      const apiKey = process.env.RESEND_API_KEY?.trim();
      if (!apiKey) {
        console.error('RESEND_API_KEY is not configured.');
      } else {
        const rawToken = generateRecoveryToken();
        const tokenHash = await hashRecoveryToken(rawToken);
        const nowEpochSeconds = Math.floor(Date.now() / 1000);
        const expiresAt = nowEpochSeconds + RECOVERY_TOKEN_TTL_SECONDS;
        const tokenRow = await createPasswordResetToken(db, {
          userId,
          tokenHash,
          expiresAt,
          requestedIp: extractRequestIp(req),
          requestedUserAgent: req.headers.get('user-agent'),
          nowEpochSeconds,
        });

        if (!tokenRow) {
          console.error('Create password reset token failed:', { userId });
        } else {
          const requestUrl = new URL(req.url);
          const resetUrl = new URL('/password-recovery', requestUrl.origin);
          resetUrl.searchParams.set('token', rawToken);

          const sent = await sendResetLinkEmail({
            apiKey,
            to: normalizedEmail,
            username: safeUsername,
            resetUrl: resetUrl.toString(),
            expiresInMinutes: Math.floor(RECOVERY_TOKEN_TTL_SECONDS / 60),
          });

          if (!sent) {
            await consumePasswordResetTokenById(db, tokenRow.id, nowEpochSeconds);
          }
        }
      }
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
}
