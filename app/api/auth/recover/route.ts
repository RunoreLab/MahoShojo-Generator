import { getSecureRandomValues } from '@/lib/crypto';
import { getUserByUsername, updateUserAuthKey } from '@/lib/d1';
import { verifyTurnstileToken } from '@/lib/turnstile';

export const runtime = 'edge';

const GENERIC_MESSAGE = '如果您输入的信息正确，系统会向邮箱发送新的登录密钥，旧密钥将自动失效。';

const toNonEmptyString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const generateAuthKey = (): string => {
  const bytes = new Uint8Array(32);
  getSecureRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
};

const sendResetKeyEmail = async (params: {
  apiKey: string;
  to: string;
  username: string;
  nextAuthKey: string;
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
        subject: '魔法少女生成器 ~ 登录密钥重置',
        html: `<p>您好 <strong>${params.username}</strong>,</p><p>您的登录密钥已被重置，旧密钥现在已失效。</p><p style="font-size:16px;font-weight:bold;">${params.nextAuthKey}</p><p>如果这不是您的操作，请尽快再次重置并联系管理员。</p>`,
        text: `您好 ${params.username},\n\n您的登录密钥已被重置，旧密钥现在已失效。\n${params.nextAuthKey}\n\n如果这不是您的操作，请尽快再次重置并联系管理员。`,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Failed to send reset auth key email:', response.status, errorText);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Failed to send reset auth key email:', error);
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

  const normalizedEmail = email.trim().toLowerCase();
  const normalizedUsername = username.trim();

  try {
    const user = await getUserByUsername(normalizedUsername);
    const userId = typeof user?.id === 'number' && Number.isSafeInteger(user.id) ? user.id : null;
    const storedEmail = toNonEmptyString(user?.email)?.toLowerCase() ?? null;
    const previousAuthKey = toNonEmptyString(user?.auth_key);
    const safeUsername = toNonEmptyString(user?.username) ?? normalizedUsername;

    if (userId && storedEmail === normalizedEmail && previousAuthKey) {
      const apiKey = process.env.RESEND_API_KEY?.trim();
      if (!apiKey) {
        console.error('RESEND_API_KEY is not configured.');
      } else {
        const nextAuthKey = generateAuthKey();
        const rotated = await updateUserAuthKey(userId, nextAuthKey);
        if (!rotated) {
          console.error('Rotate auth key failed:', { userId });
        } else {
          const sent = await sendResetKeyEmail({
            apiKey,
            to: normalizedEmail,
            username: safeUsername,
            nextAuthKey,
          });

          if (!sent) {
            const rollback = await updateUserAuthKey(userId, previousAuthKey);
            if (!rollback) {
              console.error('Reset auth key email failed and rollback failed:', { userId });
            }
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
