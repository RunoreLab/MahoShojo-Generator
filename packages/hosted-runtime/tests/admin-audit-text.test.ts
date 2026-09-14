import { describe, expect, it } from 'vitest';
import { assertSafeAuditText } from '../src/admin/audit-text';

describe('safe Admin audit text', () => {
  it.each(['审核通过：内容符合规则', 'INC-1234：撤销丢失设备权限', 'sha256:0123456789abcdef',
    'cloudflare-account-control', 'https://service.invalid/help', '轮换 API key 后恢复服务', 'secret 已轮换'])('accepts a non-secret reference or reason: %s', (value) => {
    expect(() => assertSafeAuditText(value)).not.toThrow();
  });
  it.each([undefined, null, 123, '', '  ', 'a\nb', 'a\u0000b', 'x'.repeat(1025)])('rejects invalid text without echoing it', (value) => {
    expect(() => assertSafeAuditText(value)).toThrow('ADMIN_AUDIT_TEXT_INVALID');
  });
  it('keeps narrower version limits and never echoes rejected credentials', () => {
    expect(() => assertSafeAuditText('x'.repeat(257), 256)).toThrow('ADMIN_AUDIT_TEXT_INVALID');
    expect(() => assertSafeAuditText('Bearer opaque-fixture-token')).toThrow(/^ADMIN_AUDIT_TEXT_UNSAFE$/);
  });
});
