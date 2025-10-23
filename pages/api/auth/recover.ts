import { getUserByUsername } from '@/lib/d1';
import { verifyTurnstileToken } from '@/lib/turnstile';

export const runtime = 'edge';

const GENERIC_MESSAGE = '如果您输入的内容正确，密码则会发送到您的邮箱中。 \n 如果输入的内容不正确，则不会有密码发送。';

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ success: false, error: 'Method not allowed' }),
      {
        status: 405,
        headers: {
          'Content-Type': 'application/json',
          Allow: 'POST'
        }
      }
    );
  }

  let payload: { username?: string; email?: string; turnstileToken?: string };

  try {
    payload = await req.json();
  } catch (error) {
    console.error('Failed to parse recovery payload:', error);
    return new Response(
      JSON.stringify({ success: false, error: '请求体格式错误' }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }

  const { username, email, turnstileToken } = payload;

  if (!username || !email || !turnstileToken) {
    return new Response(
      JSON.stringify({ success: false, error: '用户名、邮箱和验证码均不能为空' }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }

  const isTurnstileValid = await verifyTurnstileToken(turnstileToken);

  if (!isTurnstileValid) {
    return new Response(
      JSON.stringify({ success: false, error: '安全验证失败，请重新验证' }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }

  const normalizedEmail = email.trim().toLowerCase();
  const normalizedUsername = username.trim();

  try {
    const user = await getUserByUsername(normalizedUsername);

    if (user && typeof user.email === 'string' && typeof user.auth_key === 'string') {
      const storedEmail = user.email.trim().toLowerCase();

      if (storedEmail === normalizedEmail) {
        const apiKey = process.env.RESEND_API_KEY;

        if (!apiKey) {
          console.error('RESEND_API_KEY is not configured.');
        } else {
          try {
            const response = await fetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`
              },
              body: JSON.stringify({
                from: '魔事院档案馆 <recovery@send.colanns.me>',
                to: [normalizedEmail],
                subject: '魔法少女生成器 ~ 密钥找回',
                html: `<p>您好 <strong>${user.username}</strong>,</p><p>以下是您请求找回的登录密钥，之后请妥善保管哦：</p><p style="font-size:16px;font-weight:bold;">${user.auth_key}</p><p>如果这不是您的操作，请忽略此邮件。</p>`,
                text: `您好 ${user.username},\n\n以下是您请求找回的登录密钥，之后请妥善保管哦：\n${user.auth_key}\n\n如果这不是您的操作，请忽略此邮件。`
              })
            });

            if (!response.ok) {
              const errorText = await response.text();
              console.error('Failed to send recovery email:', response.status, errorText);
            }
          } catch (emailError) {
            console.error('Failed to send recovery email:', emailError);
          }
        }
      }
    }

    return new Response(
      JSON.stringify({ success: true, message: GENERIC_MESSAGE }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  } catch (error) {
    console.error('Password recovery error:', error);
    return new Response(
      JSON.stringify({ success: false, error: '服务器错误，请稍后重试' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}
