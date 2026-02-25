import { hashRecoveryToken, normalizeLegacyAuthKey } from '@/lib/auth/recovery-token';
import { getDrizzleDbFromRuntime } from '@/lib/db/drizzle';
import {
  consumePasswordResetTokenByHash,
  invalidateActivePasswordResetTokensByUserId,
} from '@/lib/db/repositories/password-reset-tokens';
import { updateUserAuthKey } from '@/lib/d1';

export const runtime = 'nodejs';

const json = (payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const toNonEmptyString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export async function POST(req: Request): Promise<Response> {
  let payload: { token?: string; newAuthKey?: string };
  try {
    payload = await req.json();
  } catch {
    return json({ success: false, error: '请求体格式错误' }, 400);
  }

  const token = toNonEmptyString(payload.token);
  const newAuthKey = normalizeLegacyAuthKey(payload.newAuthKey);
  if (!token || !newAuthKey) {
    return json({ success: false, error: '重置令牌或新登录密钥不合法' }, 400);
  }

  const db = getDrizzleDbFromRuntime();
  if (!db) {
    return json({ success: false, error: '数据库绑定不可用，请稍后重试' }, 503);
  }

  try {
    const tokenHash = await hashRecoveryToken(token);
    const nowEpochSeconds = Math.floor(Date.now() / 1000);
    const consumed = await consumePasswordResetTokenByHash(db, tokenHash, nowEpochSeconds);
    if (!consumed) {
      return json({ success: false, error: '重置链接无效或已过期，请重新发起找回流程' }, 400);
    }

    const updated = await updateUserAuthKey(consumed.userId, newAuthKey);
    if (!updated) {
      return json({ success: false, error: '重置失败，请稍后重试' }, 500);
    }

    await invalidateActivePasswordResetTokensByUserId(db, consumed.userId, nowEpochSeconds);

    return json({
      success: true,
      message: '登录密钥已重置成功，请使用新密钥登录。',
    });
  } catch (error) {
    console.error('Password recovery reset error:', error);
    return json({ success: false, error: '服务器错误，请稍后重试' }, 500);
  }
}
