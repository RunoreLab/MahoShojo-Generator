import { afterEach, describe, expect, it, vi } from 'vitest';
import { readHonoServerConfig } from '@/server/config';

const stubValidBearerProductionEnv = (): void => {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('HONO_AUTH_MODE', 'bearer');
  vi.stubEnv('HONO_CORS_ORIGINS', 'https://*.colanns.me');
  vi.stubEnv('REDIS_URL', 'redis://default:secret@redis:6379');
  vi.stubEnv('AI_API_KEY', 'test-ai-key');
  vi.stubEnv('SIGNATURE_SECRET_KEY', 'a'.repeat(32));
  vi.stubEnv('D1_GATEWAY_URL', 'https://d1.example.com');
  vi.stubEnv('D1_GATEWAY_HMAC_SECRET', 'b'.repeat(32));
  vi.stubEnv('BETTER_AUTH_SECRET', '');
  vi.stubEnv('BETTER_AUTH_URL', '');
};

describe('Hono server config', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('bearer 生产模式不要求 Better Auth 配置', () => {
    stubValidBearerProductionEnv();
    expect(readHonoServerConfig()).toMatchObject({
      nodeEnv: 'production',
      authMode: 'bearer',
      corsOrigins: ['https://*.colanns.me'],
    });
  });

  it('hybrid 生产模式仍要求 Better Auth 配置', () => {
    stubValidBearerProductionEnv();
    vi.stubEnv('HONO_AUTH_MODE', 'hybrid');
    expect(() => readHonoServerConfig()).toThrow(/BETTER_AUTH_SECRET.*BETTER_AUTH_URL/);
  });

  it('hybrid 生产模式拒绝不安全的 Better Auth URL', () => {
    stubValidBearerProductionEnv();
    vi.stubEnv('HONO_AUTH_MODE', 'hybrid');
    vi.stubEnv('BETTER_AUTH_SECRET', 'c'.repeat(32));
    vi.stubEnv('BETTER_AUTH_URL', 'http://auth.example.com');
    expect(() => readHonoServerConfig()).toThrow(/BETTER_AUTH_URL.*HTTPS/);
  });

  it('生产配置不完整时聚合报告缺失项', () => {
    stubValidBearerProductionEnv();
    vi.stubEnv('REDIS_URL', '');
    vi.stubEnv('REDIS_HOST', '');
    vi.stubEnv('SIGNATURE_SECRET_KEY', 'short');
    expect(() => readHonoServerConfig()).toThrow(/Redis 未配置.*SIGNATURE_SECRET_KEY/);
  });

  it('拒绝未知鉴权模式', () => {
    vi.stubEnv('HONO_AUTH_MODE', 'cookie-only');
    expect(() => readHonoServerConfig()).toThrow(/HONO_AUTH_MODE 必须是 hybrid 或 bearer/);
  });
});
