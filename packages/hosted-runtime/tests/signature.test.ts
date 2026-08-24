import { createSignatureService, type SigningKey } from '../src/signature';

const importSigningKey = async (secret: string): Promise<SigningKey> => {
  return globalThis.crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
};

const createService = (secret: string) => {
  let imports = 0;
  const keyPromise = importSigningKey(secret);
  const service = createSignatureService({
    getSigningKey: async () => {
      imports += 1;
      return keyPromise;
    },
  });

  return { service, getImportCount: () => imports };
};

describe('package-owned signature service', () => {
  test('稳定排序并默认递归忽略私有字段，且不修改输入', async () => {
    const { service } = createService('stable-secret');
    const first = {
      z: 2,
      nested: { b: 2, _transient: 'first', a: 1 },
      _runtime: { requestId: 'request-a' },
    };
    const second = {
      _runtime: { requestId: 'request-b' },
      nested: { a: 1, _transient: 'second', b: 2 },
      z: 2,
    };
    const before = structuredClone(first);

    await expect(service.generateSignature(first)).resolves.toBe(
      await service.generateSignature(second),
    );
    expect(first).toEqual(before);
  });

  test('兼容顶层、metadata 和旧版未清洗签名', async () => {
    const { service } = createService('compatibility-secret');
    const base = {
      name: '魔法少女',
      _legacyRuntimeField: '保留于旧签名',
      metadata: { createdAt: '2026-08-24' },
    };
    const canonicalSignature = await service.generateSignature(base);
    const legacySignature = await service.generateSignature(base, {
      sanitizeIgnoredKeys: false,
    });

    expect(canonicalSignature).not.toBeNull();
    expect(legacySignature).not.toBeNull();
    const signedAtTop = { ...base, signature: canonicalSignature };
    const beforeVerification = structuredClone(signedAtTop);
    await expect(service.verifySignature(signedAtTop)).resolves.toBe(true);
    await expect(
      service.verifySignature({
        ...base,
        metadata: { ...base.metadata, signature: canonicalSignature },
      }),
    ).resolves.toBe(true);
    await expect(service.verifySignature({ ...base, signature: legacySignature })).resolves.toBe(true);
    expect(signedAtTop).toEqual(beforeVerification);
  });

  test('拒绝畸形或篡改签名', async () => {
    const { service } = createService('tamper-secret');
    const signature = await service.generateSignature({ value: 1 });
    const verify = vi.spyOn(globalThis.crypto.subtle, 'verify');

    try {
      await expect(service.verifySignature({ value: 2, signature })).resolves.toBe(false);
      const callsAfterValidLength = verify.mock.calls.length;
      await expect(service.verifySignature({ value: 1, signature: 'not-hex' })).resolves.toBe(false);
      await expect(service.verifySignature({ value: 1, signature: '00' })).resolves.toBe(false);
      await expect(service.verifySignature({ value: 1, signature: 'a'.repeat(2_000_000) })).resolves.toBe(false);
      expect(verify).toHaveBeenCalledTimes(callsAfterValidLength);
      await expect(service.verifySignature({ value: 1 })).resolves.toBe(false);
      await expect(service.verifySignature(null)).resolves.toBe(false);
    } finally {
      verify.mockRestore();
    }
  });

  test('缺少签名密钥时 fail closed', async () => {
    const service = createSignatureService({ getSigningKey: async () => null });

    await expect(service.generateSignature({ value: 1 })).resolves.toBeNull();
    await expect(service.verifySignature({ value: 1, signature: '00' })).resolves.toBe(false);
  });

  test('两个 runtime 实例不会共享或覆盖签名密钥', async () => {
    const first = createService('runtime-a');
    const second = createService('runtime-b');
    const payload = { value: 1 };
    const firstSignature = await first.service.generateSignature(payload);
    const secondSignature = await second.service.generateSignature(payload);

    expect(firstSignature).not.toBe(secondSignature);
    await expect(first.service.verifySignature({ ...payload, signature: firstSignature })).resolves.toBe(true);
    await expect(first.service.verifySignature({ ...payload, signature: secondSignature })).resolves.toBe(false);
    await expect(second.service.verifySignature({ ...payload, signature: secondSignature })).resolves.toBe(true);
    expect(first.getImportCount()).toBeGreaterThan(0);
    expect(second.getImportCount()).toBeGreaterThan(0);
  });
});
