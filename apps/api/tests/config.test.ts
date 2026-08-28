import { afterEach, describe, expect, it, vi } from 'vitest';
import { readHonoServerConfig } from '#/config';

const stubValidBearerProductionEnv = (): void => {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('HOSTED_API_ENVIRONMENT', 'production');
  vi.stubEnv('HONO_AUTH_MODE', 'bearer');
  vi.stubEnv('HONO_CORS_ORIGINS', 'https://*.colanns.me');
  vi.stubEnv('ARENA_ROOM_ALLOWED_ORIGINS', 'https://mahoshojo.colanns.me');
  vi.stubEnv('REDIS_URL', 'redis://default:secret@redis:6379');
  vi.stubEnv('REDIS_KEY_PREFIX', '');
  vi.stubEnv('AI_API_KEY', 'test-ai-key');
  vi.stubEnv('SIGNATURE_SECRET_KEY', 'a'.repeat(32));
  vi.stubEnv('D1_GATEWAY_URL', 'https://d1.example.com');
  vi.stubEnv('D1_GATEWAY_HMAC_SECRET', 'b'.repeat(32));
  vi.stubEnv('ARENA_FINALIZATION_URL', 'https://app.example.com');
  vi.stubEnv('ARENA_FINALIZATION_HMAC_SECRET', 'c'.repeat(32));
  vi.stubEnv('R2_ACCESS_KEY_ID', 'arena-r2-access-key');
  vi.stubEnv('R2_SECRET_ACCESS_KEY', 'arena-r2-secret-key');
  vi.stubEnv('R2_BUCKET_NAME', 'arena-generation-output');
  vi.stubEnv('R2_ACCOUNT_ID', 'cloudflare-account-id');
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
      arenaRoomAllowedOrigins: ['https://mahoshojo.colanns.me'],
      redisKeyPrefix: '',
      arenaMultiplayerEnabled: false,
    });
  });

  it('Arena multiplayer Development Gate 默认关闭，仅 local/test 可显式启用', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('HOSTED_API_ENVIRONMENT', 'local');
    expect(readHonoServerConfig().arenaMultiplayerEnabled).toBe(false);
    vi.stubEnv('ARENA_MULTIPLAYER_ENABLED', 'true');
    vi.stubEnv(
      'ARENA_ROOM_ALLOWED_ORIGINS',
      'http://localhost:3000,http://127.0.0.1:3000',
    );
    expect(readHonoServerConfig().arenaMultiplayerEnabled).toBe(true);
  });

  it.each([
    ['', /ARENA_ROOM_ALLOWED_ORIGINS.*非空/],
    ['*', /ARENA_ROOM_ALLOWED_ORIGINS.*wildcard/],
    ['https://*.example.com', /ARENA_ROOM_ALLOWED_ORIGINS.*wildcard/],
    ['https://app.example.com/path', /ARENA_ROOM_ALLOWED_ORIGINS/],
    ['http://app.example.com', /ARENA_ROOM_ALLOWED_ORIGINS/],
  ])('Arena multiplayer 拒绝非精确 Room Origin：%j', (origins, expected) => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('HOSTED_API_ENVIRONMENT', 'local');
    vi.stubEnv('HONO_CORS_ORIGINS', 'https://*.example.com');
    vi.stubEnv('ARENA_ROOM_ALLOWED_ORIGINS', origins);
    vi.stubEnv('ARENA_MULTIPLAYER_ENABLED', 'true');

    expect(() => readHonoServerConfig()).toThrow(expected);
  });

  it('Arena Room exact origin 必须同时被普通 Hosted CORS 覆盖', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('HOSTED_API_ENVIRONMENT', 'local');
    vi.stubEnv('HONO_CORS_ORIGINS', 'https://app.example.com');
    vi.stubEnv('ARENA_ROOM_ALLOWED_ORIGINS', 'https://other.example.com');
    vi.stubEnv('ARENA_MULTIPLAYER_ENABLED', 'true');

    expect(() => readHonoServerConfig()).toThrow(/ARENA_ROOM_ALLOWED_ORIGINS.*HONO_CORS_ORIGINS/);
  });

  it('Arena Room exact origin 可由普通 Hosted CORS 的受限子域规则覆盖', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('HOSTED_API_ENVIRONMENT', 'local');
    vi.stubEnv('HONO_CORS_ORIGINS', 'https://*.example.com');
    vi.stubEnv('ARENA_ROOM_ALLOWED_ORIGINS', 'https://app.example.com');
    vi.stubEnv('ARENA_MULTIPLAYER_ENABLED', 'true');

    expect(readHonoServerConfig().arenaRoomAllowedOrigins).toEqual(['https://app.example.com']);
  });

  it.each(['production', 'preview'])(
    'GMR-09 mixed-version gate：%s target 在 compatible-reader-first/Production Gate 前拒绝激活 Arena multiplayer',
    (target) => {
      stubValidBearerProductionEnv();
      vi.stubEnv('HOSTED_API_ENVIRONMENT', target);
      vi.stubEnv('REDIS_KEY_PREFIX', target === 'preview' ? 'preview' : '');
      vi.stubEnv('ARENA_MULTIPLAYER_ENABLED', 'true');

      expect(() => readHonoServerConfig()).toThrow(/ARENA_MULTIPLAYER_ENABLED.*Production Gate.*false/);
    },
  );

  it('读取共享 Redis 的环境隔离前缀', () => {
    stubValidBearerProductionEnv();
    vi.stubEnv('HOSTED_API_ENVIRONMENT', 'preview');
    vi.stubEnv('REDIS_KEY_PREFIX', 'preview');
    expect(readHonoServerConfig().redisKeyPrefix).toBe('preview');
  });

  it.each(['', 'preview-other'])(
    'preview target 拒绝非 canonical Redis prefix：%j',
    (prefix) => {
      stubValidBearerProductionEnv();
      vi.stubEnv('HOSTED_API_ENVIRONMENT', 'preview');
      vi.stubEnv('REDIS_KEY_PREFIX', prefix);

      expect(() => readHonoServerConfig()).toThrow(/preview.*REDIS_KEY_PREFIX.*preview/);
    },
  );

  it('production target 拒绝使用 preview Redis namespace', () => {
    stubValidBearerProductionEnv();
    vi.stubEnv('REDIS_KEY_PREFIX', 'preview');

    expect(() => readHonoServerConfig()).toThrow(/production.*REDIS_KEY_PREFIX.*为空/);
  });

  it('拒绝可能造成 Redis key 越界的环境前缀', () => {
    stubValidBearerProductionEnv();
    vi.stubEnv('REDIS_KEY_PREFIX', 'preview:api');
    expect(() => readHonoServerConfig()).toThrow(/REDIS_KEY_PREFIX/);
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

  it('hybrid 生产模式也拒绝 loopback 明文 Better Auth URL', () => {
    stubValidBearerProductionEnv();
    vi.stubEnv('HONO_AUTH_MODE', 'hybrid');
    vi.stubEnv('BETTER_AUTH_SECRET', 'c'.repeat(32));
    vi.stubEnv('BETTER_AUTH_URL', 'http://127.0.0.1:3000');
    expect(() => readHonoServerConfig()).toThrow(/BETTER_AUTH_URL.*HTTPS/);
  });

  it('生产配置不完整时聚合报告缺失项', () => {
    stubValidBearerProductionEnv();
    vi.stubEnv('REDIS_URL', '');
    vi.stubEnv('REDIS_HOST', '');
    vi.stubEnv('SIGNATURE_SECRET_KEY', 'short');
    expect(() => readHonoServerConfig()).toThrow(/Redis 未配置.*SIGNATURE_SECRET_KEY/);
  });

  it.each(['production', 'preview'])(
    '%s target 不受 NODE_ENV=development 绕过并默认要求 Redis/D1',
    (deploymentTarget) => {
      stubValidBearerProductionEnv();
      vi.stubEnv('NODE_ENV', 'development');
      vi.stubEnv('HOSTED_API_ENVIRONMENT', deploymentTarget);
      vi.stubEnv('REDIS_KEY_PREFIX', deploymentTarget === 'preview' ? 'preview' : '');
      vi.stubEnv('REDIS_URL', '');
      vi.stubEnv('REDIS_HOST', '');

      expect(() => readHonoServerConfig()).toThrow(/Redis 未配置/);
    },
  );

  it('拒绝未知 deployment target，不能静默降级为本机模式', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('HOSTED_API_ENVIRONMENT', 'prodution');

    expect(() => readHonoServerConfig()).toThrow(/HOSTED_API_ENVIRONMENT/);
  });

  it.each([
    ['REDIS_REQUIRED', 'REDIS_REQUIRED'],
    ['D1_REQUIRED', 'D1_REQUIRED'],
  ])('生产模式拒绝关闭必需依赖：%s', (_label, variable) => {
    stubValidBearerProductionEnv();
    vi.stubEnv(variable, 'false');
    expect(() => readHonoServerConfig()).toThrow(new RegExp(`${variable}.*true`));
  });

  it.each([
    ['明文 URL', 'http://d1.example.com'],
    ['带凭据 URL', 'https://user:pass@d1.example.com'],
    ['带路径 URL', 'https://d1.example.com/unsafe'],
    ['带 query URL', 'https://d1.example.com?database=production'],
    ['带 fragment URL', 'https://d1.example.com#unsafe'],
  ])('生产模式拒绝不受信任的 D1 Gateway URL：%s', (_label, value) => {
    stubValidBearerProductionEnv();
    vi.stubEnv('D1_GATEWAY_URL', value);
    expect(() => readHonoServerConfig()).toThrow(/D1_GATEWAY_URL/);
  });

  it('生产模式要求 D1 Gateway transport credential', () => {
    stubValidBearerProductionEnv();
    vi.stubEnv('D1_GATEWAY_HMAC_SECRET', '');
    vi.stubEnv('D1_GATEWAY_TOKEN', '');

    expect(() => readHonoServerConfig()).toThrow(/D1 Gateway.*HMAC_SECRET.*TOKEN/);
  });

  it('production target 即使设置 fault-injection 也拒绝 loopback 明文 Gateway', () => {
    stubValidBearerProductionEnv();
    vi.stubEnv('D1_GATEWAY_URL', 'http://127.0.0.1:8788');
    vi.stubEnv('HOSTED_DR_LOCAL_FAULT_INJECTION', 'true');

    expect(() => readHonoServerConfig()).toThrow(/D1_GATEWAY_URL/);
  });

  it('仅允许显式 local target 的 fault-injection 使用 loopback 明文 Gateway', () => {
    stubValidBearerProductionEnv();
    vi.stubEnv('HOSTED_API_ENVIRONMENT', 'local');
    vi.stubEnv('D1_GATEWAY_URL', 'http://127.0.0.1:8788');
    vi.stubEnv('HOSTED_DR_LOCAL_FAULT_INJECTION', 'true');

    expect(readHonoServerConfig().nodeEnv).toBe('production');
  });

  it('生产模式拒绝 wildcard CORS', () => {
    stubValidBearerProductionEnv();
    vi.stubEnv('HONO_CORS_ORIGINS', '*');
    expect(() => readHonoServerConfig()).toThrow(/HONO_CORS_ORIGINS/);
  });

  it('生产模式在创建 generation reservation 前拒绝不可信 provider URL', () => {
    stubValidBearerProductionEnv();
    vi.stubEnv('AI_API_KEY', '');
    vi.stubEnv('AI_PROVIDERS_CONFIG', JSON.stringify([{
      name: 'invalid-provider',
      apiKey: 'test-key',
      baseUrl: 'http://metadata.internal/v1',
      model: 'model-1',
      type: 'openai',
    }]));

    expect(() => readHonoServerConfig()).toThrow(/AI_PROVIDERS_CONFIG\/AI_API_KEY/);
  });

  it('生产模式要求独立的 Arena finalization authority 与 R2 terminal store', () => {
    stubValidBearerProductionEnv();
    vi.stubEnv('ARENA_FINALIZATION_URL', '');
    vi.stubEnv('ARENA_FINALIZATION_HMAC_SECRET', 'short');
    vi.stubEnv('R2_ACCESS_KEY_ID', '');
    vi.stubEnv('R2_SECRET_ACCESS_KEY', '');
    vi.stubEnv('R2_BUCKET_NAME', '');
    vi.stubEnv('R2_ACCOUNT_ID', '');
    vi.stubEnv('R2_ENDPOINT', '');

    expect(() => readHonoServerConfig()).toThrow(
      /ARENA_FINALIZATION_URL.*ARENA_FINALIZATION_HMAC_SECRET.*R2_ACCESS_KEY_ID.*R2_SECRET_ACCESS_KEY.*R2_BUCKET_NAME.*R2_ACCOUNT_ID\/R2_ENDPOINT/,
    );
  });

  it.each([
    ['明文远端 URL', 'http://app.example.com'],
    ['带凭据 URL', 'https://user:pass@app.example.com'],
    ['带路径 URL', 'https://app.example.com/hidden/base'],
  ])('生产模式拒绝不可信 Arena authority URL：%s', (_label, value) => {
    stubValidBearerProductionEnv();
    vi.stubEnv('ARENA_FINALIZATION_URL', value);
    expect(() => readHonoServerConfig()).toThrow(/ARENA_FINALIZATION_URL/);
  });

  it('G25E2-VERSION-SKEW：生产启动路径接受 rollout 阶段一个版本的兼容偏差', () => {
    stubValidBearerProductionEnv();
    vi.stubEnv('HOSTED_DR_GATE_STAGE', 'rollout');
    vi.stubEnv('HOSTED_DR_PRIMARY_CONTRACT_VERSION', 'g25e1-v2');
    vi.stubEnv('HOSTED_DR_DR_CONTRACT_VERSION', 'g25e1-v1');
    vi.stubEnv('HOSTED_DR_CLIENT_CONTRACT_VERSION', 'g25e1-v1');
    vi.stubEnv('HOSTED_DR_SCHEMA_STATE', 'expanded');

    expect(readHonoServerConfig().nodeEnv).toBe('production');
  });

  it('G25E2-VERSION-SKEW：生产启动路径拒绝跨 family 或过大 skew', () => {
    stubValidBearerProductionEnv();
    vi.stubEnv('HOSTED_DR_PRIMARY_CONTRACT_VERSION', 'g25e2-v2');
    vi.stubEnv('HOSTED_DR_DR_CONTRACT_VERSION', 'g25e1-v1');
    vi.stubEnv('HOSTED_DR_CLIENT_CONTRACT_VERSION', 'g25e1-v1');

    expect(() => readHonoServerConfig()).toThrow(/HOSTED_DR_VERSION_GATE/);
  });

  it('拒绝未知鉴权模式', () => {
    vi.stubEnv('HONO_AUTH_MODE', 'cookie-only');
    expect(() => readHonoServerConfig()).toThrow(/HONO_AUTH_MODE 必须是 hybrid 或 bearer/);
  });
});
