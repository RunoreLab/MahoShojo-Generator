import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createServer, type Socket } from 'node:net';
import { fileURLToPath } from 'node:url';

const verifierPath = fileURLToPath(new URL(
  '../scripts/verify-room-hardening-faults.ts',
  import.meta.url,
));
const CHILD_TIMEOUT_MS = 10_000;

const runAgainstTcpSentinel = async (input: Readonly<{
  redisHostname: string;
  keyPrefix: string;
  hostedApiEnvironment?: string;
  nodeEnvironment?: string;
}>) => {
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
      NODE_ENV: input.nodeEnvironment ?? 'test',
      REDIS_URL: `redis://${input.redisHostname}:${address.port}`,
      ROOM_HARDENING_VERIFY: 'true',
      ROOM_HARDENING_VERIFY_KEY_PREFIX: input.keyPrefix,
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
  return { connections, exit: exit.code, signal: exit.signal, stderr, timedOut };
};

describe('Room hardening faults verifier safety boundary', () => {
  test('非 loopback Redis URL 在任何 TCP/Redis 副作用前 fail closed', async () => {
    const result = await runAgainstTcpSentinel({
      redisHostname: '0.0.0.0',
      keyPrefix: 'gmr10_faults',
    });
    expect(result).toMatchObject({ connections: 0, exit: 1 });
    expect(result.stderr).toContain('只允许连接 loopback Redis');
  });

  test.each(['*', 'production'])(
    '危险 key prefix %j 在任何 TCP/Redis 副作用前 fail closed',
    async (keyPrefix) => {
      const result = await runAgainstTcpSentinel({
        redisHostname: '127.0.0.1',
        keyPrefix,
      });
      expect(result).toMatchObject({ connections: 0, exit: 1 });
      expect(result.stderr).toContain(
        'ROOM_HARDENING_VERIFY_KEY_PREFIX 必须是安全非默认环境标识',
      );
    },
  );

  test('production target 在任何 TCP/Redis 副作用前 fail closed', async () => {
    const result = await runAgainstTcpSentinel({
      redisHostname: '127.0.0.1',
      keyPrefix: 'gmr10_faults',
      hostedApiEnvironment: 'production',
    });
    expect(result).toMatchObject({ connections: 0, exit: 1 });
    expect(result.stderr).toContain('HOSTED_API_ENVIRONMENT 必须显式设为 local 或 test');
  });

  test.each([
    ['', 'unknown deployment target'],
    ['preview', 'preview deployment target'],
  ])('%s 在任何 TCP/Redis 副作用前 fail closed（%s）', async (hostedApiEnvironment) => {
    const result = await runAgainstTcpSentinel({
      redisHostname: '127.0.0.1',
      keyPrefix: 'gmr10_faults',
      hostedApiEnvironment,
    });
    expect(result).toMatchObject({ connections: 0, exit: 1 });
    expect(result.stderr).toContain('HOSTED_API_ENVIRONMENT 必须显式设为 local 或 test');
  });

  test('固定输出三个 fault selector，且不含 FLUSH 或远程执行路径', async () => {
    const source = await readFile(verifierPath, 'utf8');
    expect(source).toContain('honoRestartRedisSurvivor');
    expect(source).toContain('honoServersStarted: 2');
    expect(source).toContain('redisRunIdStable');
    expect(source).toContain('checkpointUnchangedDuringRestart');
    expect(source).toContain('exactCheckpointLoss');
    expect(source).toContain('vpsUnreachable');
    expect(source).not.toMatch(/flush(?:all|db)/iu);
    expect(source).not.toContain('38.76.205.9');
  });
});
