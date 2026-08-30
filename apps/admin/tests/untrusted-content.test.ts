import { describe, expect, test } from 'vitest';

import { escapeUntrustedText, safeExternalHttpsUrl } from '../src/security/untrusted-content';

describe('Admin untrusted content boundary', () => {
  test('恶意 HTML fixture 只能作为文本渲染', () => {
    const hostile = '<img src=x onerror="globalThis.pwned=true"><script>alert(1)</script>&';

    expect(escapeUntrustedText(hostile)).toBe(
      '&lt;img src=x onerror=&quot;globalThis.pwned=true&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;&amp;',
    );
  });

  test.each([
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'https://user:password@example.com/private',
    '/relative/path',
  ])('拒绝不安全或歧义 URL: %s', (value) => {
    expect(safeExternalHttpsUrl(value)).toBeNull();
  });

  test('只接受无 credential/fragment 的绝对 HTTPS URL', () => {
    expect(safeExternalHttpsUrl('https://example.com/a?b=1')).toBe('https://example.com/a?b=1');
    expect(safeExternalHttpsUrl('https://example.com/a#secret')).toBeNull();
  });
});
