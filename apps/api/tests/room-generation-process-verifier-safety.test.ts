import { spawn } from 'node:child_process';
import { createServer, type Socket } from 'node:net';
import { fileURLToPath } from 'node:url';

const verifierPath = fileURLToPath(new URL(
  '../scripts/verify-room-generation-process-recovery.ts',
  import.meta.url,
));
// 每个用例都派生一次 `node --import tsx <verifier>`，而 tsx 冷启动要编译整个 api 脚本图。
// 空载实测约 **7 秒**（`node --import tsx` 到子进程退出，连续两次 7073ms / 6857ms）。
// 7 个用例因此合计约 50 秒。
//
// 旧的 20s 看门狗在空载下够用，但它把**高负载下的冷启动抖动**与**真正挂起的子进程**混为一谈：
// 一旦抖动越过看门狗，子进程被 SIGKILL，`timedOut` 变成 true，于是断言
// `timedOut: false` 失败——一次「本机太慢」被读成「产品没能 fail closed」。这正是本文件注释原本
// 想避免的情况，只是当时的数值不足以覆盖实际成本。
//
// 60s = 7s 空载的约 8 倍余量，足以吸收全仓并发下的 CPU 超订。它仍然远小于无限等待：真挂起时
// 60s 后必然被终止，watchdog 的职责没有被削弱。
const CHILD_TIMEOUT_MS = 60_000;
// 断言阶段本身要做的只是读一个已经退出的子进程，5s 足够；但也要覆盖高负载下 stdout/stderr 收尾。
const TEST_TIMEOUT_MS = CHILD_TIMEOUT_MS + 10_000;

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
  /** 子进程从派生到退出的实测耗时。看门狗触发时用于区分「冷启动慢」与「真的挂起」。 */
  elapsedMs: number;
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
  const startedAt = Date.now();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill('SIGKILL');
  }, CHILD_TIMEOUT_MS);
  const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  clearTimeout(timeout);
  const elapsedMs = Date.now() - startedAt;

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
    elapsedMs,
  };
};

/**
 * 断言「看门狗没有触发」，并在触发时给出一条**指名道姓**的失败理由。
 *
 * ## 为什么需要它
 *
 * 这个套件的每个用例都断言 `timedOut: false`。但 `timedOut` 为真的含义是「子进程在
 * {@link CHILD_TIMEOUT_MS} 内没有退出」——它**不能**区分两种情况：
 *
 * 1. verifier 真的挂起（产品缺陷，必须红）；
 * 2. tsx 冷启动在高负载下慢到越过阈值（环境问题，与产品无关）。
 *
 * 两者都落进同一个 `expect(...).toMatchObject({ timedOut: false })`，于是第 2 种会以
 * 「产品没能 fail closed」的样子出现在 CI 上。这不只是噪音：它会让人下一次真的挂起时也不再相信
 * 这条红线。断言本身保持原样（看门狗触发仍然判红，绝不静默放过），但失败消息必须说明到底是哪一种。
 */
const expectVerdictObserved = (result: Readonly<{
  timedOut: boolean;
  elapsedMs: number;
  stderr: string;
}>): void => {
  if (!result.timedOut) return;
  throw new Error(
    `子进程在 ${CHILD_TIMEOUT_MS}ms 看门狗内没有退出，因此本次无法判定 fail-closed 行为。`
    + ` 实测耗时 ${result.elapsedMs}ms。这更可能是 tsx 冷启动在高负载下变慢（空载约 7s），`
    + `而不是产品缺陷；但在拿到确证之前本断言不会放行。子进程 stderr：\n${result.stderr}`,
  );
};

describe('Room generation process verifier safety boundary', () => {
  test('非 loopback Redis URL 在任何 TCP/Redis 副作用前 fail closed', async () => {
    const result = await runAgainstTcpSentinel({
      redisHostname: '0.0.0.0',
      keyPrefix: 'gmr09-safety',
    });

    expectVerdictObserved(result);
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

      expectVerdictObserved(result);
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
      expectVerdictObserved(result);
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
    expectVerdictObserved(result);
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
