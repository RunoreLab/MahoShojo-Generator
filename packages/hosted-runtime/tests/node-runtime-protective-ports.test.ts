import { createContentSafetyService } from '../src/node-runtime/content-safety';
import { createEnvSignatureService } from '../src/node-runtime/env-signature';
import {
  buildPublicAiRateLimitResponse,
  createPublicAiRateLimiter,
} from '../src/node-runtime/public-rate-limit';
import {
  AI_PROVIDER_CATALOG,
  resolveAIProviderModel,
} from '../src/node-runtime/provider-catalog';
import { quickCheck } from '../src/node-runtime/sensitive-word-filter';
import { applyShieldWords } from '../src/node-runtime/shield-word-filter';

describe('package-owned protective Node ports', () => {
  test('provider alias 在纯 catalog 边界解析为 canonical modelId', () => {
    const provider = AI_PROVIDER_CATALOG.find((candidate) => candidate.id === 'deepseek');
    expect(provider).toBeDefined();
    if (!provider) return;

    expect(resolveAIProviderModel(provider, 'deepseek-v4-flash-0731')).toEqual({
      modelId: 'deepseek-v4-flash',
      isCustom: false,
    });
  });

  test('敏感词 quick-check 与 shield 实现均由 package 直接提供', async () => {
    await expect(quickCheck('大陆官方')).resolves.toMatchObject({
      hasSensitiveWords: true,
    });
    expect(applyShieldWords('我来自中国。')).toMatchObject({
      hasShieldWords: true,
      filteredText: '我来自【国度】。',
    });
  });

  test('rate limiter 只信任已验证 token，并保持 429 wire 与 Retry-After', async () => {
    const limiter = createPublicAiRateLimiter({
      verifyActivityToken: async (token) => token === 'valid'
        ? { userId: 7, expiresAt: '2026-12-31T00:00:00.000Z' }
        : null,
    });
    const buildRequest = (token: string) => new Request('https://example.com/api', {
      headers: {
        'x-mahoshojo-activity-token': token,
        'x-mahoshojo-user-id': '999',
        'cf-connecting-ip': '1.2.3.4',
      },
    });

    const first = await limiter.acquirePublicAiRateLimit({
      req: buildRequest('valid'),
      actionType: 'magical_girl_generate',
      providerMode: 'system',
      nowMs: 1_000,
    });
    expect(first).toMatchObject({ allowed: true, identityScope: 'user' });
    const second = await limiter.acquirePublicAiRateLimit({
      req: buildRequest('valid'),
      actionType: 'magical_girl_generate',
      providerMode: 'system',
      nowMs: 2_000,
    });
    expect(second).toMatchObject({
      allowed: false,
      identityScope: 'user',
      retryAfterSeconds: 59,
    });
    if (second.allowed) return;

    const response = buildPublicAiRateLimitResponse(second);
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('59');
    await expect(response.json()).resolves.toEqual({
      error: '请求过于频繁，请在 59 秒后重试',
      reason: 'identity_cooldown',
      retryAfter: 59,
      retryAfterSeconds: 59,
    });

    limiter.resetForTest();
    const forged = await limiter.acquirePublicAiRateLimit({
      req: buildRequest('forged'),
      actionType: 'magical_girl_generate',
      providerMode: 'system',
      nowMs: 3_000,
    });
    expect(forged).toMatchObject({ allowed: true, identityScope: 'ip' });
  });

  test('content safety 保持 local→AI 顺序、503 fail closed 且日志不含正文', async () => {
    const events: string[] = [];
    const error = vi.fn();
    const service = createContentSafetyService({
      defaults: { enableSensitiveWordFilter: true, enableAiSafetyCheck: true },
      quickCheck: async (text) => {
        events.push(`local:${text}`);
        return { hasSensitiveWords: false, detectedWords: [] };
      },
      generateWithAI: async (text) => {
        events.push(`ai:${text}`);
        throw new Error('secret=abc body=用户秘密正文');
      },
    });

    const response = await service.enforceTextSafety({
      text: '用户秘密正文',
      log: { warn: vi.fn(), error },
      logMeta: { requestId: 'request-1' },
    });
    expect(response?.status).toBe(503);
    expect(events).toEqual(['local:用户秘密正文', 'ai:用户秘密正文']);
    expect(JSON.stringify(error.mock.calls)).not.toMatch(/secret=abc|用户秘密正文/);
  });

  test('env signature 缺失或密钥导入失败均返回 null，不生成伪签名', async () => {
    const warn = vi.fn();
    const missing = createEnvSignatureService({ env: {}, logger: { warn, error: vi.fn() } });
    await expect(missing.generateSignature({ value: 1 })).resolves.toBeNull();
    expect(warn).toHaveBeenCalledOnce();

    const error = vi.fn();
    const subtle = {
      importKey: vi.fn(async () => { throw new Error('secret body'); }),
    } as unknown as typeof globalThis.crypto.subtle;
    const failed = createEnvSignatureService({
      env: { SIGNATURE_SECRET_KEY: 'secret' },
      logger: { warn: vi.fn(), error },
      subtle,
    });
    await expect(failed.generateSignature({ value: 1 })).resolves.toBeNull();
    expect(error).toHaveBeenCalledOnce();
    expect(JSON.stringify(error.mock.calls)).not.toContain('secret body');
  });
});
