import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createServer, type Socket } from 'node:net';
import { fileURLToPath } from 'node:url';

import {
  HARDENING_LOAD_WORKLOAD,
  isolatedRoomKeyPatterns,
  parseRoomHardeningLoadEnvironment,
} from '../scripts/verify-room-hardening-load';

const verifierPath = fileURLToPath(new URL(
  '../scripts/verify-room-hardening-load.ts',
  import.meta.url,
));
const CHILD_TIMEOUT_MS = 10_000;

const runAgainstTcpSentinel = async (input: Readonly<{
  redisHostname: string;
  keyPrefix: string;
  hostedApiEnvironment?: string;
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
      REDIS_URL: `redis://${input.redisHostname}:${address.port}`,
      ROOM_HARDENING_LOAD_VERIFY: 'true',
      ROOM_HARDENING_LOAD_KEY_PREFIX: input.keyPrefix,
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

describe('Room hardening load verifier contract', () => {
  test('固定 32 Room、每 Room 4 个真实 WSS client 与 20 次权威 workload transition', () => {
    expect(HARDENING_LOAD_WORKLOAD).toEqual({
      rooms: 32,
      socketsPerRoom: 4,
      membershipTransitionsPerRoom: 4,
      configTransitionsPerRoom: 16,
      authorityTransitionsPerRoom: 20,
      totalSockets: 128,
      totalAuthorityTransitions: 640,
    });
    expect(Object.isFrozen(HARDENING_LOAD_WORKLOAD)).toBe(true);
  });

  test('只建立显式 opt-in、loopback、非 production、安全 prefix 的配置', () => {
    expect(parseRoomHardeningLoadEnvironment({
      HOSTED_API_ENVIRONMENT: 'local',
      REDIS_URL: 'redis://127.0.0.1:6379',
      ROOM_HARDENING_LOAD_VERIFY: 'true',
      ROOM_HARDENING_LOAD_KEY_PREFIX: 'gmr10-load-test',
    })).toEqual({
      redisUrl: 'redis://127.0.0.1:6379',
      keyPrefix: 'gmr10-load-test',
    });

    expect(() => parseRoomHardeningLoadEnvironment({
      HOSTED_API_ENVIRONMENT: 'local',
      REDIS_URL: 'redis://127.0.0.1:6379',
      ROOM_HARDENING_LOAD_KEY_PREFIX: 'gmr10-load-test',
    })).toThrow(/ROOM_HARDENING_LOAD_VERIFY=true/u);
    expect(() => parseRoomHardeningLoadEnvironment({
      HOSTED_API_ENVIRONMENT: 'production',
      REDIS_URL: 'redis://127.0.0.1:6379',
      ROOM_HARDENING_LOAD_VERIFY: 'true',
      ROOM_HARDENING_LOAD_KEY_PREFIX: 'gmr10-load-test',
    })).toThrow(/HOSTED_API_ENVIRONMENT 必须显式设为 local 或 test/u);
    expect(() => parseRoomHardeningLoadEnvironment({
      REDIS_URL: 'redis://127.0.0.1:6379',
      ROOM_HARDENING_LOAD_VERIFY: 'true',
      ROOM_HARDENING_LOAD_KEY_PREFIX: 'gmr10-load-test',
    })).toThrow(/HOSTED_API_ENVIRONMENT 必须显式设为 local 或 test/u);
    expect(() => parseRoomHardeningLoadEnvironment({
      HOSTED_API_ENVIRONMENT: 'preview',
      REDIS_URL: 'redis://127.0.0.1:6379',
      ROOM_HARDENING_LOAD_VERIFY: 'true',
      ROOM_HARDENING_LOAD_KEY_PREFIX: 'gmr10-load-test',
    })).toThrow(/HOSTED_API_ENVIRONMENT 必须显式设为 local 或 test/u);
    expect(() => parseRoomHardeningLoadEnvironment({
      HOSTED_API_ENVIRONMENT: 'local',
      REDIS_URL: 'redis://10.0.0.8:6379',
      ROOM_HARDENING_LOAD_VERIFY: 'true',
      ROOM_HARDENING_LOAD_KEY_PREFIX: 'gmr10-load-test',
    })).toThrow(/loopback Redis/u);
    expect(() => parseRoomHardeningLoadEnvironment({
      HOSTED_API_ENVIRONMENT: 'local',
      REDIS_URL: 'redis://127.0.0.1:6379',
      ROOM_HARDENING_LOAD_VERIFY: 'true',
      ROOM_HARDENING_LOAD_KEY_PREFIX: '*',
    })).toThrow(/安全非默认环境标识/u);
    expect(() => parseRoomHardeningLoadEnvironment({
      HOSTED_API_ENVIRONMENT: 'local',
      REDIS_URL: 'redis://127.0.0.1:6379',
      ROOM_HARDENING_LOAD_VERIFY: 'true',
      ROOM_HARDENING_LOAD_KEY_PREFIX: 'production',
    })).toThrow(/安全非默认环境标识/u);
  });

  test('隔离清理 pattern 只覆盖显式 Room namespace', () => {
    expect(isolatedRoomKeyPatterns('gmr10-load-test')).toEqual([
      'mahoshojo:room:v1:gmr10-load-test:*',
      'mahoshojo:room-directory:v1:gmr10-load-test:*',
      'mahoshojo:room-ticket:v1:gmr10-load-test:*',
    ]);
    expect(() => isolatedRoomKeyPatterns('*')).toThrow(/安全非默认环境标识/u);
  });

  test('verifier 源码不包含 Redis 宽泛清理命令', async () => {
    const source = await readFile(verifierPath, 'utf8');
    const forbidden = ['FLUSH' + 'ALL', 'FLUSH' + 'DB'];
    for (const command of forbidden) expect(source.toUpperCase()).not.toContain(command);
  });
});

describe('Room hardening load verifier safety boundary', () => {
  test('非 loopback Redis URL 在任何 TCP/Redis 副作用前 fail closed', async () => {
    const result = await runAgainstTcpSentinel({
      redisHostname: '0.0.0.0',
      keyPrefix: 'gmr10-safety',
    });

    expect(result).toMatchObject({
      connections: 0,
      exitCode: 1,
      signal: null,
      timedOut: false,
    });
    expect(result.stderr).toContain('只允许连接 loopback Redis');
  });

  test.each(['*', 'production'])(
    '危险 prefix %j 在任何 TCP/Redis 副作用前 fail closed',
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
        'ROOM_HARDENING_LOAD_KEY_PREFIX 必须是安全非默认环境标识',
      );
    },
  );

  test('production target 在任何 TCP/Redis 副作用前 fail closed', async () => {
    const result = await runAgainstTcpSentinel({
      redisHostname: '127.0.0.1',
      keyPrefix: 'gmr10-safety',
      hostedApiEnvironment: 'production',
    });

    expect(result).toMatchObject({
      connections: 0,
      exitCode: 1,
      signal: null,
      timedOut: false,
    });
    expect(result.stderr).toContain('HOSTED_API_ENVIRONMENT 必须显式设为 local 或 test');
  });
});
