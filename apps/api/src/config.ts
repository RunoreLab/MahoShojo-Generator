import {
  parseTrustedBetterAuthBaseUrl,
  readHonoAuthMode,
  type HonoAuthMode,
} from '#/auth/config';
import { parseAIProvidersFromEnv } from '@mahoshojo/hosted-runtime/node-runtime/providers';
import { hasValidHostedApiProductionCorsOrigins } from '@mahoshojo/hosted-api/hosted-dr';

export type HonoServerConfig = {
  host: string;
  port: number;
  nodeEnv: string;
  redisUrl: string | null;
  redisKeyPrefix: string;
  redisRequired: boolean;
  d1Required: boolean;
  corsOrigins: string[];
  authMode: HonoAuthMode;
};

const hasText = (value: string | undefined): boolean => Boolean(value?.trim());

const isTrustedHttpsOrigin = (value: string | undefined): boolean => {
  if (!hasText(value)) return false;
  try {
    const url = new URL(value as string);
    return url.protocol === 'https:'
      && !url.username
      && !url.password
      && url.pathname === '/'
      && !url.search
      && !url.hash;
  } catch {
    return false;
  }
};

const hasValidAiProviderConfig = (env: NodeJS.ProcessEnv): boolean =>
  parseAIProvidersFromEnv(env).length > 0;

const validateProductionEnvironment = (
  env: NodeJS.ProcessEnv,
  config: HonoServerConfig,
): void => {
  if (config.nodeEnv !== 'production') return;

  const problems: string[] = [];
  if (!config.redisUrl) problems.push('Redis 未配置（REDIS_URL 或 REDIS_HOST）');
  if (!hasValidAiProviderConfig(env)) problems.push('AI_PROVIDERS_CONFIG/AI_API_KEY 缺失或无有效 provider');
  if ((env.SIGNATURE_SECRET_KEY?.trim().length ?? 0) < 32) {
    problems.push('SIGNATURE_SECRET_KEY 必须至少 32 个字符');
  }
  if (!hasValidHostedApiProductionCorsOrigins(config.corsOrigins)) {
    problems.push('HONO_CORS_ORIGINS 必须显式配置生产来源');
  }

  const gatewayUrl = env.D1_GATEWAY_URL?.trim();
  if (gatewayUrl) {
    const gatewaySecret = env.D1_GATEWAY_HMAC_SECRET?.trim();
    const gatewayToken = env.D1_GATEWAY_TOKEN?.trim();
    if (!gatewaySecret && !gatewayToken) {
      problems.push('D1 Gateway 需要 D1_GATEWAY_HMAC_SECRET 或 D1_GATEWAY_TOKEN');
    }
    if (gatewaySecret && gatewaySecret.length < 32) {
      problems.push('D1_GATEWAY_HMAC_SECRET 必须至少 32 个字符');
    }
  } else if (!hasText(env.CLOUDFLARE_ACCOUNT_ID)
    || !hasText(env.D1_DATABASE_ID)
    || !hasText(env.CLOUDFLARE_API_TOKEN)) {
    problems.push('D1 未配置（推荐 Gateway，或提供 Cloudflare 管理 API 三项配置）');
  }

  if (!isTrustedHttpsOrigin(env.ARENA_FINALIZATION_URL)) {
    problems.push('ARENA_FINALIZATION_URL 必须是无凭据、路径、查询与片段的 HTTPS origin');
  }
  const arenaFinalizationSecret = env.ARENA_FINALIZATION_HMAC_SECRET?.trim() ?? '';
  if (arenaFinalizationSecret.length < 32) {
    problems.push('ARENA_FINALIZATION_HMAC_SECRET 必须至少 32 个字符');
  } else if ([
    env.SIGNATURE_SECRET_KEY,
    env.D1_GATEWAY_HMAC_SECRET,
    env.BETTER_AUTH_SECRET,
  ].some((secret) => secret?.trim() === arenaFinalizationSecret)) {
    problems.push('ARENA_FINALIZATION_HMAC_SECRET 必须使用独立 secret');
  }

  for (const name of ['R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME'] as const) {
    if (!hasText(env[name])) problems.push(`${name} 缺失`);
  }
  if (!hasText(env.R2_ACCOUNT_ID)
    && !hasText(env.R2_ENDPOINT)
    && !hasText(env.CF_ACCOUNT_ID)
    && !hasText(env.CLOUDFLARE_ACCOUNT_ID)) {
    problems.push('R2_ACCOUNT_ID/R2_ENDPOINT 缺失');
  }
  if (hasText(env.R2_ENDPOINT) && !isTrustedHttpsOrigin(env.R2_ENDPOINT)) {
    problems.push('R2_ENDPOINT 必须是无凭据、路径、查询与片段的 HTTPS origin');
  }

  if (config.authMode === 'hybrid') {
    if ((env.BETTER_AUTH_SECRET?.trim().length ?? 0) < 32) {
      problems.push('hybrid 鉴权需要至少 32 字符的 BETTER_AUTH_SECRET');
    }
    if (!hasText(env.BETTER_AUTH_URL)) {
      problems.push('hybrid 鉴权需要 BETTER_AUTH_URL');
    } else {
      try {
        parseTrustedBetterAuthBaseUrl(env.BETTER_AUTH_URL, { allowLocalHttp: false });
      } catch (error) {
        problems.push(error instanceof Error ? error.message : 'BETTER_AUTH_URL 配置无效');
      }
    }
  }

  if (problems.length > 0) {
    throw new Error(`[hono] 生产环境配置不完整：${problems.join('；')}`);
  }
};

const readBoolean = (name: string, fallback: boolean): boolean => {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  throw new Error(`${name} 必须是 true/false、1/0、yes/no 或 on/off`);
};

const readPort = (): number => {
  const raw = process.env.HONO_PORT?.trim() || '8787';
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`HONO_PORT 不是有效端口：${raw}`);
  }
  return port;
};

const readCorsOrigins = (): string[] => {
  const raw = process.env.HONO_CORS_ORIGINS?.trim();
  if (!raw) return ['http://localhost:3000', 'http://127.0.0.1:3000'];
  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
};

const readRedisUrl = (): string | null => {
  const explicitUrl = process.env.REDIS_URL?.trim();
  if (explicitUrl) return explicitUrl;

  const host = process.env.REDIS_HOST?.trim();
  if (!host) return null;
  const port = process.env.REDIS_PORT?.trim() || '6379';
  const username = process.env.REDIS_USERNAME?.trim() || 'default';
  const password = process.env.REDIS_PASSWORD || '';
  const protocol = readBoolean('REDIS_TLS', false) ? 'rediss' : 'redis';
  const credentials = password
    ? `${encodeURIComponent(username)}:${encodeURIComponent(password)}@`
    : '';
  return `${protocol}://${credentials}${host}:${port}`;
};

const readRedisKeyPrefix = (): string => {
  const prefix = process.env.REDIS_KEY_PREFIX?.trim() || '';
  if (prefix && !/^[a-z0-9_-]{1,32}$/u.test(prefix)) {
    throw new Error('REDIS_KEY_PREFIX 只能包含 1-32 个小写字母、数字、下划线或连字符');
  }
  return prefix;
};

export const readHonoServerConfig = (): HonoServerConfig => {
  const nodeEnv = process.env.NODE_ENV?.trim() || 'development';
  const redisUrl = readRedisUrl();

  const config: HonoServerConfig = {
    host: process.env.HONO_HOST?.trim() || '0.0.0.0',
    port: readPort(),
    nodeEnv,
    redisUrl,
    redisKeyPrefix: readRedisKeyPrefix(),
    redisRequired: readBoolean('REDIS_REQUIRED', nodeEnv === 'production'),
    d1Required: readBoolean('D1_REQUIRED', nodeEnv === 'production'),
    corsOrigins: readCorsOrigins(),
    authMode: readHonoAuthMode(),
  };
  validateProductionEnvironment(process.env, config);
  return config;
};
