describe('legacy signature runtime adapter', () => {
  const originalSecret = process.env.SIGNATURE_SECRET_KEY;

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    if (originalSecret === undefined) {
      delete process.env.SIGNATURE_SECRET_KEY;
    } else {
      process.env.SIGNATURE_SECRET_KEY = originalSecret;
    }
  });

  test('保持环境密钥、稳定签名与验证行为', async () => {
    process.env.SIGNATURE_SECRET_KEY = 'adapter-secret';
    const importKey = vi.spyOn(globalThis.crypto.subtle, 'importKey');
    const { generateSignature, verifySignature } = await import('@/lib/signature');
    const payload = { nested: { b: 2, a: 1 }, _requestOnly: 'ignored' };
    const signature = await generateSignature(payload);

    expect(signature).toMatch(/^[0-9a-f]{64}$/);
    await expect(
      generateSignature({ _requestOnly: 'changed', nested: { a: 1, b: 2 } }),
    ).resolves.toBe(signature);
    await expect(verifySignature({ ...payload, signature })).resolves.toBe(true);
    await expect(verifySignature({ ...payload, nested: { a: 1, b: 3 }, signature })).resolves.toBe(false);
    expect(importKey).toHaveBeenCalledOnce();
  });

  test('未配置环境密钥时生成与验证均 fail closed', async () => {
    delete process.env.SIGNATURE_SECRET_KEY;
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { generateSignature, verifySignature } = await import('@/lib/signature');

    await expect(generateSignature({ value: 1 })).resolves.toBeNull();
    await expect(verifySignature({ value: 1, signature: '00' })).resolves.toBe(false);
    expect(warning).toHaveBeenCalledTimes(1);
  });
});
