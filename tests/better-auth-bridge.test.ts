import { describe, expect, test } from 'vitest';
import { appendSetCookieHeaders, splitSetCookieHeaderValue } from '@/lib/auth/set-cookie';

describe('auth/better-auth-bridge', () => {
  test('splitSetCookieHeaderValue 能正确处理 Expires 字段中的逗号', () => {
    const raw =
      'first=alpha; Path=/; HttpOnly, second=beta; Expires=Wed, 21 Oct 2015 07:28:00 GMT; Path=/; Secure';
    const cookies = splitSetCookieHeaderValue(raw);

    expect(cookies).toHaveLength(2);
    expect(cookies[0]).toContain('first=alpha');
    expect(cookies[1]).toContain('second=beta');
    expect(cookies[1]).toContain('Expires=Wed, 21 Oct 2015 07:28:00 GMT');
  });

  test('appendSetCookieHeaders 在无 getSetCookie 时会拆分并逐条追加', () => {
    const source = new Headers();
    source.set(
      'set-cookie',
      'a=1; Path=/; HttpOnly, b=2; Expires=Wed, 21 Oct 2015 07:28:00 GMT; Path=/; Secure',
    );

    const target = new Headers();
    appendSetCookieHeaders(target, source);

    const merged = target.get('set-cookie') ?? '';
    expect(merged.includes('a=1')).toBe(true);
    expect(merged.includes('b=2')).toBe(true);
    expect(merged.includes('Expires=Wed, 21 Oct 2015 07:28:00 GMT')).toBe(true);
  });
});
