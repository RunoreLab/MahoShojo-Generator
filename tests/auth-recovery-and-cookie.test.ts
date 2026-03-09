import { describe, expect, test } from 'bun:test';
import { hasBetterAuthSessionCookie } from '@/lib/auth/better-auth';
import { generateRecoveryToken, hashRecoveryToken, normalizeLegacyAuthKey } from '@/lib/auth/recovery-token';

describe('auth/recovery-token', () => {
  test('generateRecoveryToken 生成固定长度十六进制串', () => {
    const token = generateRecoveryToken();
    expect(token).toHaveLength(64);
    expect(/^[0-9a-f]+$/.test(token)).toBeTrue();
  });

  test('hashRecoveryToken 对相同输入稳定、对不同输入可区分', async () => {
    const tokenA = 'a'.repeat(64);
    const tokenB = 'b'.repeat(64);

    const hashA1 = await hashRecoveryToken(tokenA);
    const hashA2 = await hashRecoveryToken(tokenA);
    const hashB = await hashRecoveryToken(tokenB);

    expect(hashA1).toBe(hashA2);
    expect(hashA1).not.toBe(hashB);
    expect(hashA1).toHaveLength(64);
  });

  test('normalizeLegacyAuthKey 仅接受合法格式', () => {
    expect(normalizeLegacyAuthKey('a'.repeat(16))).toBe('a'.repeat(16));
    expect(normalizeLegacyAuthKey('  abcdefghijklmnop  ')).toBe('abcdefghijklmnop');

    expect(normalizeLegacyAuthKey('short')).toBeNull();
    expect(normalizeLegacyAuthKey('a'.repeat(129))).toBeNull();
    expect(normalizeLegacyAuthKey('abc def ghijklmnop')).toBeNull();
    expect(normalizeLegacyAuthKey('   ')).toBeNull();
  });
});

describe('auth/better-auth cookie hint', () => {
  test('识别 Better Auth session cookie', () => {
    const reqSecureCookie = new Request('https://example.com/api/test', {
      headers: {
        cookie: '__Secure-better-auth.session_token=token1; foo=bar',
      },
    });
    expect(hasBetterAuthSessionCookie(reqSecureCookie)).toBeTrue();

    const reqNormalCookie = new Request('https://example.com/api/test', {
      headers: {
        cookie: 'foo=bar; better-auth.session_token=token2',
      },
    });
    expect(hasBetterAuthSessionCookie(reqNormalCookie)).toBeTrue();
  });

  test('无 session cookie 时返回 false', () => {
    const req = new Request('https://example.com/api/test', {
      headers: {
        cookie: 'foo=bar; hello=world',
      },
    });
    expect(hasBetterAuthSessionCookie(req)).toBeFalse();
  });
});
