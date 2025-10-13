import type { NextApiRequest, NextApiResponse } from 'next';
import { Resend } from 'resend';
import { getUserByUsername } from '@/lib/d1';
import { verifyTurnstileToken } from '@/lib/turnstile';

const GENERIC_MESSAGE = '如果您输入的内容正确，密码则会发送到您的邮箱中。 \n 如果输入的内容不正确，则不会有密码发送。';

type RecoveryResponse =
  | { success: true; message: string }
  | { success: false; error: string };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<RecoveryResponse>
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { username, email, turnstileToken } = req.body as {
    username?: string;
    email?: string;
    turnstileToken?: string;
  };

  if (!username || !email || !turnstileToken) {
    return res.status(400).json({ success: false, error: '用户名、邮箱和验证码均不能为空' });
  }

  const isTurnstileValid = await verifyTurnstileToken(turnstileToken);

  if (!isTurnstileValid) {
    return res.status(400).json({ success: false, error: '安全验证失败，请重新验证' });
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
          const resend = new Resend(apiKey);
          try {
            await resend.emails.send({
              from: '魔事院档案馆 <recovery@send.colanns.me>',
              to: normalizedEmail,
              subject: '魔法少女生成器 ~ 密钥找回',
              text: `您好 ${user.username},\n\n以下是您请求找回的登录密钥，之后请妥善保管哦：\n${user.auth_key}\n\n如果这不是您的操作，请忽略此邮件。`,
              html: `<p>您好 <strong>${user.username}</strong>,</p><p>以下是您请求找回的登录密钥，之后请妥善保管哦：</p><p style="font-size:16px;font-weight:bold;">${user.auth_key}</p><p>如果这不是您的操作，请忽略此邮件。</p>`
            });
          } catch (emailError) {
            console.error('Failed to send recovery email:', emailError);
          }
        }
      }
    }

    return res.status(200).json({ success: true, message: GENERIC_MESSAGE });
  } catch (error) {
    console.error('Password recovery error:', error);
    return res.status(500).json({ success: false, error: '服务器错误，请稍后重试' });
  }
}
