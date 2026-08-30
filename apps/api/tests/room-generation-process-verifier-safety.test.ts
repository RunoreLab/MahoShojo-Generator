import { spawn } from 'node:child_process';
import { createServer, type Socket } from 'node:net';
import { fileURLToPath } from 'node:url';

const verifierPath = fileURLToPath(new URL(
  '../scripts/verify-room-generation-process-recovery.ts',
  import.meta.url,
));
// 全仓测试会与 Web/其他 workspace 并发；tsx 冷启动在高负载下可能超过
// 10 秒。watchdog 只负责终止真正挂起的子进程，不应把启动抖动误报为
// fail-closed 失败。
const CHILD_TIMEOUT_MS = 20_000;
const TEST_TIMEOUT_MS = CHILD_TIMEOUT_MS + 5_000;

const runAgainstTcpSentinel = async (input: Readonly<{
  redisHostname: string;
  keyPrefix: string;
  hostedApiEnvironment?: string;
  verifyToken?: string;
}>): Promise<Readonly<{
  connections: number;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stderr: string;
  timedOut: boolean;
}>> => {
  let connections = 0;
  const sockets = new Set<Socket>();
  const sentinel = createServer((socket) => {
    connections += 1;
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('data', () => socket.write('-ERR verifier sentinel\r\n'));
  });
  await new Promise<void>((resolve, reject) => {
    sentinel.once('error', reject);
    sentinel.listen(0, '127.0.0.1', resolve);
  });
  const address = sentinel.address();
  if (!address || typeof address === 'string') throw new Error('TCP_SENTINEL_ADDRESS_INVALID');

  const child = spawn(process.execPath, ['--import', 'tsx', verifierPath], {
    env: {
      ...process.env,
      HOSTED_API_ENVIRONMENT: input.hostedApiEnvironment ?? 'local',
      NODE_ENV: 'test',
      REDIS_URL: `redis://${input.redisHostname}:${address.port}`,
      ROOM_GENERATION_PROCESS_VERIFY: 'true',
      ROOM_GENERATION_PROCESS_VERIFY_TOKEN: input.verifyToken ?? 'safety-test-token',
      ROOM_REDIS_VERIFY_KEY_PREFIX: input.keyPrefix,
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += String(chunk); });
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill('SIGKILL');
  }, CHILD_TIMEOUT_MS);
  const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  clearTimeout(timeout);

  for (const socket of sockets) socket.destroy();
  await new Promise<void>((resolve, reject) => {
    sentinel.close((error) => error ? reject(error) : resolve());
  });
  return {
    connections,
    exitCode: exit.code,
    signal: exit.signal,
    stderr,
    timedOut,
  };
};

describe('Room generation process verifier safety boundary', () => {
  test('非 loopback Redis URL 在任何 TCP/Redis 副作用前 fail closed', async () => {
    const result = await runAgainstTcpSentinel({
      redisHostname: '0.0.0.0',
      keyPrefix: 'gmr09-safety',
    });

    expect(result).toMatchObject({
      connections: 0,
      exitCode: 1,
      signal: null,
      timedOut: false,
    });
    expect(result.stderr).toContain('只允许连接 loopback Redis');
  }, TEST_TIMEOUT_MS);

  test.each(['*', 'production'])(
    '危险 key prefix %j 在任何 TCP/Redis 副作用前 fail closed',
    async (keyPrefix) => {
      const result = await runAgainstTcpSentinel({
        redisHostname: '127.0.0.1',
        keyPrefix,
      });

      expect(result).toMatchObject({
        connections: 0,
        exitCode: 1,
        signal: null,
        timedOut: false,
      });
      expect(result.stderr).toContain(
        'ROOM_REDIS_VERIFY_KEY_PREFIX 必须是安全非默认环境标识',
      );
    },
    TEST_TIMEOUT_MS,
  );

  test.each(['production', 'preview', ''])(
    'HOSTED_API_ENVIRONMENT=%j 在任何 TCP/Redis 副作用前 fail closed',
    async (hostedApiEnvironment) => {
      const result = await runAgainstTcpSentinel({
        redisHostname: '127.0.0.1',
        keyPrefix: 'gmr10-process-safety',
        hostedApiEnvironment,
      });
      expect(result).toMatchObject({
        connections: 0,
        exitCode: 1,
        signal: null,
        timedOut: false,
      });
      expect(result.stderr).toContain('只允许 HOSTED_API_ENVIRONMENT=local/test');
    },
    TEST_TIMEOUT_MS,
  );

  test('不安全 token 在任何 TCP/Redis 副作用前 fail closed', async () => {
    const result = await runAgainstTcpSentinel({
      redisHostname: '127.0.0.1',
      keyPrefix: 'gmr10-process-safety',
      verifyToken: '***',
    });
    expect(result).toMatchObject({
      connections: 0,
      exitCode: 1,
      signal: null,
      timedOut: false,
    });
    expect(result.stderr).toContain(
      'ROOM_GENERATION_PROCESS_VERIFY_TOKEN 必须是安全 opaque token',
    );
  }, TEST_TIMEOUT_MS);
});
