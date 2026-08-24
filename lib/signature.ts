import { createSignatureService } from '@mahoshojo/hosted-runtime/signature';

const subtle = globalThis.crypto.subtle;
let secretKeyPromise: Promise<CryptoKey | null> | null = null;

const getSecretKey = (): Promise<CryptoKey | null> => {
  if (secretKeyPromise) return secretKeyPromise;

  secretKeyPromise = (async () => {
    const secret = process.env.SIGNATURE_SECRET_KEY;
    if (!secret) {
      console.warn(
        '⚠️ 警告: SIGNATURE_SECRET_KEY 环境变量未配置。数据签名功能已禁用，所有生成的数据将不包含原生签名。',
      );
      return null;
    }

    try {
      return await subtle.importKey(
        'raw',
        new TextEncoder().encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign', 'verify'],
      );
    } catch (error) {
      console.error('导入HMAC密钥失败:', error);
      return null;
    }
  })();

  return secretKeyPromise;
};

const signatureService = createSignatureService({ getSigningKey: getSecretKey });

export const generateSignature = signatureService.generateSignature;
export const verifySignature = signatureService.verifySignature;
