import {
  createSignatureService,
  type SignatureService,
  type SigningKey,
} from '../signature';

export type EnvSignatureLogger = Pick<Console, 'warn' | 'error'>;

export type EnvSignatureServiceOptions = {
  env?: Readonly<Record<string, string | undefined>>;
  logger?: EnvSignatureLogger;
  subtle?: typeof globalThis.crypto.subtle;
};

export const createEnvSignatureService = (
  options: EnvSignatureServiceOptions = {},
): SignatureService => {
  const env = options.env ?? process.env;
  const logger = options.logger ?? console;
  const subtle = options.subtle ?? globalThis.crypto.subtle;
  let secretKeyPromise: Promise<SigningKey | null> | null = null;

  const getSigningKey = (): Promise<SigningKey | null> => {
    if (secretKeyPromise) return secretKeyPromise;

    secretKeyPromise = (async () => {
      const secret = env.SIGNATURE_SECRET_KEY;
      if (!secret) {
        logger.warn(
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
      } catch {
        logger.error('导入HMAC密钥失败，数据签名功能已禁用。');
        return null;
      }
    })();

    return secretKeyPromise;
  };

  return createSignatureService({ getSigningKey, subtle });
};

const envSignatureService = createEnvSignatureService();

export const generateSignature = envSignatureService.generateSignature;
export const verifySignature = envSignatureService.verifySignature;
