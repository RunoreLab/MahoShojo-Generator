import { describe, expect, it } from 'vitest';

import { maskApiKeyForDisplay } from '@/lib/client/mask-api-key';

describe('maskApiKeyForDisplay', () => {
  it('空值返回空字符串', () => {
    expect(maskApiKeyForDisplay('')).toBe('');
    expect(maskApiKeyForDisplay('   ')).toBe('');
  });

  it('长 key 只保留前 6 位并追加固定掩码', () => {
    expect(maskApiKeyForDisplay('sk-1234567890abcdef')).toBe('sk-123********');
  });

  it('支持自定义前缀保留长度', () => {
    expect(maskApiKeyForDisplay('abcdef123456', 4)).toBe('abcd********');
  });

  it('长度不足时直接返回可见部分', () => {
    expect(maskApiKeyForDisplay('short', 6)).toBe('short');
  });
});
