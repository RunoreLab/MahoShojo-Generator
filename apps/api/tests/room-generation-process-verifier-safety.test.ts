import { spawn } from 'node:child_process';
import { createServer, type Socket } from 'node:net';
import { fileURLToPath } from 'node:url';

const verifierPath = fileURLToPath(new URL(
  '../scripts/verify-room-generation-process-recovery.ts',
  import.meta.url,
));
// 每个用例都派生一次 `node --import tsx <verifier>`。本机实测（连续四次，绝对路径避免
// 「脚本没找到」的假测量）：7364ms / 7450ms / 7478ms / 8083ms。
//
// **这 7~8 秒不是在跑被测逻辑，全在加载模块图。** ESM 的 import 是提升的，所以
// `verify-room-generation-process-recovery.ts` 顶部那些 guard（`REDIS_URL`、
// `HOSTED_API_ENVIRONMENT`、`NODE_ENV`、loopback 判定）在 `@mahoshojo/hosted-api` 的
// service、`redis` 客户端与本地 arena-room 模块**全部加载完之后**才有机会抛错。
// 也就是说：这个 fail-closed 门禁要等 7 秒才 fail closed，而它守的每一个用例都只断言
// 「在产生任何 TCP/Redis 副作用前就退出」。7 个用例因此合计约 52 秒，本文件实测 64 秒，
// 占 apps/api 全部测试时间的绝大部分。
//
// 30s ≈ 实测最差 8.1s 的 3.7 倍，够吸收全仓并发下的 CPU 争抢；比上一轮的 60s 紧一半，
// 真挂起时半程就能判红，而不是让本文件最坏耗时翻到 7×60s。看门狗职责没有被削弱：
// 它仍然是有限等待，只是有限得更合理。
//
// 想把这 52 秒真正去掉，得让那几个 guard 在重模块之前跑（把 service/redis 的 import
// 改成 guard 之后的动态 import）。那是生产脚本的结构改动，会改变「什么时候 fail closed」，
// 属于安全边界的决定，不在测试优化范围内——已记给 owner，未在本轮实施。
const CHILD_TIMEOUT_MS = 30_000;
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
 * 2. tsx 加载模块图在高负载下慢到越过阈值（环境问题，与产品无关）。
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
    + ` 实测耗时 ${result.elapsedMs}ms。这更可能是 tsx 在高负载下加载模块图变慢（实测 7.4–8.1s），`
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
