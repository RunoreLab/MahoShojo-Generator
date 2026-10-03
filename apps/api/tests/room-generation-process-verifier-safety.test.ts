import { spawn } from 'node:child_process';
import { createServer, type Socket } from 'node:net';
import { fileURLToPath } from 'node:url';

const verifierPath = fileURLToPath(new URL(
  '../scripts/verify-room-generation-process-recovery.ts',
  import.meta.url,
));
// 每个用例都派生一次 `node --import tsx <verifier>`。改脚本之前实测
// 7364ms / 7450ms / 7478ms / 8083ms（连续四次，且有无 tsx 缓存都一样），本文件 52 秒。
//
// 关键在于那 7~8 秒**全在加载模块图**，不在跑被测逻辑：ESM 的静态 import 是提升的，所以
// `verify-room-generation-process-recovery.ts` 顶部那些 guard（`REDIS_URL`、
// `HOSTED_API_ENVIRONMENT`、`NODE_ENV`、loopback 判定）要等 `@mahoshojo/hosted-api` 的
// service、`redis` 客户端与本地 arena-room 模块**全部加载完之后**才有机会抛错。也就是
// 这个 fail-closed 门禁要等 7 秒才 fail closed，而它守的 7 个用例**全部只断言
// 「在产生任何 TCP/Redis 副作用前就退出」**。
//
// 现在脚本把重模块改成 guard 之后的动态 import，于是子进程只加载 `room-verifier-safety`
// （零依赖的 20 行纯函数）就退出：实测 603 / 407 / 368ms，本文件 2.84 秒（**18 倍**）。
// 安全性是提高的——guard 失败时那些重模块根本不会被加载。
//
// 10s ≈ 实测最差 0.6s 的 16 倍。之所以敢给得比「3 倍」宽裕，是因为成本结构变了：现在每次
// 派生只付 node + tsx 自身启动，不再加载任何业务模块图，因此对慢机器的敏感性大幅下降。
// 看门狗职责没有被削弱，仍然是有限等待，只是有限得更合理。
const CHILD_TIMEOUT_MS = 10_000;
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
  /** 子进程从派生到退出的实测耗时。看门狗触发时用于区分「模块加载慢」与「真的挂起」。 */
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
 * 2. tsx 自身启动在高负载下慢到越过阈值（环境问题，与产品无关）。
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
    + ` 实测耗时 ${result.elapsedMs}ms。这更可能是 tsx 自身启动在高负载下变慢（实测 0.37–0.6s），`
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
