import { createUser, getUserByUsername, getUserByEmail } from '@/lib/d1';
import { issueActivityToken } from '@/lib/auth/activity-token';
import { verifyTurnstileToken } from '@/lib/turnstile';
import { quickCheck } from '@/lib/sensitive-word-filter';
import { getSecureRandomValues } from '@/lib/crypto';

export const runtime = 'edge';

const getRandomValues = getSecureRandomValues;

// Email validation function
function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

// Generate auth key using Web Crypto API
async function generateAuthKey(): Promise<string> {
  const array = new Uint8Array(32);
  getRandomValues(array);
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const { username, email, turnstileToken } = await req.json();

    if (!username || !email || !turnstileToken) {
      return new Response(JSON.stringify({ error: '用户名、邮箱和安全验证不能为空' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 验证 Turnstile token
    const isTurnstileValid = await verifyTurnstileToken(turnstileToken);
    if (!isTurnstileValid) {
      return new Response(JSON.stringify({ error: '安全验证失败，请重新验证' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (username.length < 2 || username.length > 20) {
      return new Response(JSON.stringify({ error: '用户名长度必须在2-20个字符之间' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 验证邮箱格式
    if (!isValidEmail(email)) {
      return new Response(JSON.stringify({ error: '请输入有效的邮箱地址' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 验证用户名是否包含敏感词
    try {
      const sensitiveCheck = await quickCheck(username);
      if (sensitiveCheck.hasSensitiveWords) {
        return new Response(JSON.stringify({ error: '用户名包含不当内容，请重新输入' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    } catch (error) {
      console.error('Sensitive word check failed:', error);
      // 敏感词检查失败时继续执行，但记录错误
    }

    // 检查用户名是否已存在
    const existingUser = await getUserByUsername(username);
    if (existingUser) {
      return new Response(JSON.stringify({ error: '用户名已存在' }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 检查邮箱是否已存在
    const existingEmail = await getUserByEmail(email);
    if (existingEmail) {
      return new Response(JSON.stringify({ error: '邮箱已被注册' }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 生成唯一的认证密钥
    const authKey = await generateAuthKey();

    // 创建用户
    const userId = await createUser(username, email, authKey);
    
    if (!userId) {
      return new Response(JSON.stringify({ error: '创建用户失败' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const activityToken = await issueActivityToken(userId);

    return new Response(JSON.stringify({
      success: true,
      user: {
        id: userId,
        username,
        prefix: null
      },
      username,
      email,
      authKey,
      activityToken: activityToken ?? null,
      message: '注册成功！请妥善保存您的登录密钥'
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Registration error:', error);
    return new Response(JSON.stringify({ error: '注册失败，请稍后重试' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
