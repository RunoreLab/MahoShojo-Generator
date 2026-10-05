import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  encodeUtf8,
  randomUUID,
  secureRandomUUID,
  sha256Hex,
} from '@/lib/crypto';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('browser crypto compatibility', () => {
  it('在只有 getRandomValues 的旧 WebView 中生成 RFC 4122 UUID', () => {
    vi.stubGlobal('crypto', {
      getRandomValues: (array: Uint8Array) => {
        array.fill(0);
        return array;
      },
    });

    expect(secureRandomUUID()).toBe('00000000-0000-4000-8000-000000000000');
    expect(randomUUID()).toBe('00000000-0000-4000-8000-000000000000');
  });

  it('没有安全随机源时给出可操作的竞技场兼容性错误', () => {
    vi.stubGlobal('crypto', {});

    expect(() => secureRandomUUID()).toThrow(
      '当前浏览器不支持竞技场所需的安全随机数，请使用 HTTPS 或更新浏览器后重试。',
    );
  });

  it('在 SubtleCrypto 和 TextEncoder 均不可用时仍保持 SHA-256 结果一致', async () => {
    vi.stubGlobal('crypto', {});
    vi.stubGlobal('TextEncoder', undefined);

    expect(Array.from(encodeUtf8('abc'))).toEqual([97, 98, 99]);
    const vectors = [
      ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
      ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
      ['你好🌸', 'fcd3cacb994875d6c57e9a6d95b24e87549c816d715321dc07df4904160a0e0d'],
      ['a'.repeat(56), 'b35439a4ac6f0948b6d6f9e3c6af0f5f590ce20f1bde7090ef7970686ec6738a'],
    ] as const;
    for (const [value, expected] of vectors) {
      await expect(sha256Hex(value)).resolves.toBe(expected);
    }
  });

  it('SubtleCrypto digest 在旧上下文中拒绝时回退到确定性实现', async () => {
    vi.stubGlobal('crypto', {
      subtle: {
        digest: vi.fn(async () => { throw new Error('insecure context'); }),
      },
    });

    await expect(sha256Hex('abc')).resolves.toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});
