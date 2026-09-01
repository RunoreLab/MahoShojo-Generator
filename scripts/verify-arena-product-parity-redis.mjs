import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

const repositoryRoot = path.resolve(import.meta.dirname, '..');
const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const loopbackHosts = new Set(['127.0.0.1', 'localhost', '[::1]']);

const assertLoopbackRedisUrl = (value) => {
  const parsed = new URL(value);
  if (parsed.protocol !== 'redis:' || !loopbackHosts.has(parsed.hostname)) {
    throw new Error('Arena product parity Redis verifier 只允许 redis:// loopback 地址');
  }
  return parsed;
};

const reserveLoopbackPort = async () => await new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    if (!address || typeof address === 'string') {
      server.close();
      reject(new Error('无法分配 loopback Redis 端口'));
      return;
    }
    server.close((error) => error ? reject(error) : resolve(address.port));
  });
});

const pingRedis = async (url) => {
  const parsed = assertLoopbackRedisUrl(url);
  const port = Number(parsed.port || 6379);
  await new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: parsed.hostname, port });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('Redis PING 超时'));
    }, 1_000);
    socket.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    socket.on('data', (chunk) => {
      if (!chunk.toString('utf8').includes('+PONG')) return;
      clearTimeout(timer);
      socket.end();
      resolve();
    });
    socket.once('connect', () => socket.write('*1\r\n$4\r\nPING\r\n'));
  });
};

const waitForRedis = async (url, child) => {
  let lastError = null;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`临时 Redis 提前退出：${child.exitCode}`);
    }
    try {
      await pingRedis(url);
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error(`临时 Redis 未就绪：${lastError instanceof Error ? lastError.message : String(lastError)}`);
};

const externalRedisUrl = process.env.ARENA_PRODUCT_PARITY_REDIS_URL?.trim();
let redisUrl = externalRedisUrl || '';
let redisProcess = null;
let redisDirectory = null;

try {
  if (redisUrl) {
    assertLoopbackRedisUrl(redisUrl);
    await pingRedis(redisUrl);
  } else {
    const port = await reserveLoopbackPort();
    redisDirectory = mkdtempSync(path.join(tmpdir(), 'mahoshojo-gmr10q-redis.'));
    redisUrl = `redis://127.0.0.1:${port}`;
    redisProcess = spawn('redis-server', [
      '--bind', '127.0.0.1',
      '--protected-mode', 'yes',
      '--port', String(port),
      '--save', '',
      '--appendonly', 'no',
      '--dir', redisDirectory,
    ], { stdio: ['ignore', 'ignore', 'inherit'] });
    await waitForRedis(redisUrl, redisProcess);
  }

  const prefixBase = `g10q${process.pid}${Date.now().toString(36)}`.slice(0, 24);
  const verifiers = [
    {
      command: 'verify:room-redis',
      evidence: 'ROOM_REDIS_VERIFY=true',
      environment: {
        ROOM_REDIS_VERIFY: 'true',
        ROOM_REDIS_VERIFY_KEY_PREFIX: `${prefixBase}r`,
      },
    },
    {
      command: 'verify:room-generation-redis',
      evidence: 'ROOM_GENERATION_REDIS_VERIFY=true',
      environment: {
        ROOM_GENERATION_REDIS_VERIFY: 'true',
        ROOM_GENERATION_REDIS_VERIFY_KEY_PREFIX: `${prefixBase}g`,
      },
    },
    {
      command: 'verify:room-generation-process-recovery',
      evidence: 'ROOM_GENERATION_PROCESS_VERIFY=true',
      environment: {
        ROOM_GENERATION_PROCESS_VERIFY: 'true',
        ROOM_REDIS_VERIFY_KEY_PREFIX: `${prefixBase}p`,
        ROOM_GENERATION_PROCESS_VERIFY_TOKEN: `${prefixBase}process`,
      },
    },
  ];

  for (const verifier of verifiers) {
    console.log(`[arena-product-parity-redis] ${verifier.command} (${verifier.evidence})`);
    const result = spawnSync(
      pnpmCommand,
      ['--filter', '@mahoshojo/api', 'run', verifier.command],
      {
        cwd: repositoryRoot,
        stdio: 'inherit',
        env: {
          ...process.env,
          NODE_ENV: 'test',
          HOSTED_API_ENVIRONMENT: 'local',
          REDIS_URL: redisUrl,
          ...verifier.environment,
        },
      },
    );
    if (result.error) throw result.error;
    if (result.status !== 0) process.exitCode = result.status ?? 1;
    if (process.exitCode) break;
  }
} finally {
  if (redisProcess && redisProcess.exitCode === null) {
    const stopped = new Promise((resolve) => {
      redisProcess.once('exit', resolve);
      setTimeout(resolve, 3_000);
    });
    redisProcess.kill('SIGTERM');
    await stopped;
  }
  if (redisDirectory) rmSync(redisDirectory, { recursive: true, force: true });
}

if (process.exitCode) process.exit(process.exitCode);
console.log('[arena-product-parity-redis] PASS');
