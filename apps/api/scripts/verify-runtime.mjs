import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { parse as parseEnvironment } from 'dotenv';
import { createClient } from 'redis';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const serverPort = Number(process.env.HONO_VERIFY_PORT || '8790');
const gatewayUrl = process.env.D1_GATEWAY_URL?.trim();

const readRedisUrl = async () => {
  const explicitUrl = process.env.REDIS_URL?.trim();
  if (explicitUrl) return explicitUrl;

  const configFile = process.env.REDIS_CONFIG_FILE?.trim();
  const environmentFile = process.env.REDIS_ENV_FILE?.trim();
  if (!configFile && !environmentFile) {
    throw new Error('请配置 REDIS_URL、REDIS_CONFIG_FILE 或 REDIS_ENV_FILE');
  }

  let password = '';
  if (configFile) {
    const content = await readFile(configFile, 'utf8');
    const match = content.match(/^\s*requirepass\s+(.+?)\s*$/m);
    password = match?.[1]?.trim().replace(/^(?:"(.*)"|'(.*)')$/, '$1$2') || '';
  }
  if (!password) {
    const fallbackEnvironmentFile = environmentFile
      || (configFile ? path.resolve(path.dirname(configFile), '..', '.env') : '');
    const values = parseEnvironment(await readFile(fallbackEnvironmentFile, 'utf8'));
    password = values.REDIS_PASSWORD || values.PANEL_REDIS_ROOT_PASSWORD || '';
  }
  if (!password) throw new Error('Redis 配置中没有找到密码');
  const host = process.env.REDIS_HOST?.trim() || '127.0.0.1';
  const port = process.env.REDIS_PORT?.trim() || '6379';
  return `redis://default:${encodeURIComponent(password)}@${host}:${port}`;
};

const waitForJson = async (url, timeoutMs = 20_000) => {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      const payload = await response.json();
      if (response.ok) return { response, payload };
      lastError = new Error(`${response.status}: ${JSON.stringify(payload)}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw lastError || new Error(`等待 ${url} 超时`);
};

if (!gatewayUrl) throw new Error('请配置 D1_GATEWAY_URL 指向待验证 Gateway');
const redisUrl = await readRedisUrl();
const redis = createClient({ url: redisUrl });
redis.on('error', () => undefined);
await redis.connect();

const logBuffer = [];
const child = spawn(process.execPath, ['dist/index.mjs'], {
  cwd: appRoot,
  env: {
    ...process.env,
    NODE_ENV: 'production',
    HONO_HOST: '127.0.0.1',
    HONO_PORT: String(serverPort),
    REDIS_URL: redisUrl,
    REDIS_REQUIRED: 'true',
    D1_REQUIRED: 'true',
    D1_GATEWAY_URL: gatewayUrl,
    D1_GATEWAY_HMAC_SECRET: process.env.D1_GATEWAY_HMAC_SECRET || '',
    CLOUDFLARE_ACCOUNT_ID: '',
    CLOUDFLARE_API_TOKEN: '',
    D1_DATABASE_ID: '',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

for (const stream of [child.stdout, child.stderr]) {
  stream.on('data', (chunk) => {
    logBuffer.push(String(chunk));
    if (logBuffer.length > 100) logBuffer.shift();
  });
}

try {
  const baseUrl = `http://127.0.0.1:${serverPort}`;
  const live = await waitForJson(`${baseUrl}/health/live`);
  const ready = await waitForJson(`${baseUrl}/health/ready`);
  const migratedApiResponse = await fetch(`${baseUrl}/api/creator/generate-stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  const unmigratedApiResponse = await fetch(`${baseUrl}/api/verify-origin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  const rateLimitKeys = [];
  for await (const key of redis.scanIterator({ MATCH: 'mahoshojo:rate-limit:api:*', COUNT: 100 })) {
    rateLimitKeys.push(key);
  }
  if (unmigratedApiResponse.status !== 404) {
    throw new Error(`未迁移 API 状态异常：${unmigratedApiResponse.status}`);
  }
  if (migratedApiResponse.status !== 400) {
    throw new Error(`迁移 API 状态异常：${migratedApiResponse.status}`);
  }
  if (rateLimitKeys.length === 0) throw new Error('未检测到 Redis 限流 key');

  console.log(JSON.stringify({
    live: live.payload.ok === true,
    ready: ready.payload.ok === true,
    redis: ready.payload.dependencies?.redis?.ready === true,
    d1: ready.payload.dependencies?.d1?.ready === true,
    migratedApi: migratedApiResponse.status === 400,
    unmigratedApiRejected: unmigratedApiResponse.status === 404,
    redisRateLimitKeyObserved: true,
  }, null, 2));
} catch (error) {
  console.error(logBuffer.join('').slice(-8_000));
  throw error;
} finally {
  child.kill('SIGTERM');
  await new Promise((resolve) => child.once('exit', resolve));
  await redis.quit();
}
