import { spawn } from 'node:child_process';
import { createServer, type Socket } from 'node:net';
import { fileURLToPath } from 'node:url';

const verifierPaths = {
  room: fileURLToPath(new URL('../scripts/verify-room-redis.ts', import.meta.url)),
  generation: fileURLToPath(new URL('../scripts/verify-room-generation-redis.ts', import.meta.url)),
} as const;
const CHILD_TIMEOUT_MS = 10_000;

const runAgainstTcpSentinel = async (input: Readonly<{
  verifier: keyof typeof verifierPaths;
  hostedApiEnvironment: string;
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

  const child = spawn(process.execPath, ['--import', 'tsx', verifierPaths[input.verifier]], {
    env: {
      ...process.env,
      HOSTED_API_ENVIRONMENT: input.hostedApiEnvironment,
      NODE_ENV: 'test',
      REDIS_URL: `redis://127.0.0.1:${address.port}`,
      ROOM_REDIS_VERIFY_KEY_PREFIX: 'gmr10-room-safety',
      ROOM_GENERATION_REDIS_VERIFY: 'true',
      ROOM_GENERATION_REDIS_VERIFY_KEY_PREFIX: 'gmr10-generation-safety',
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

describe.each(['room', 'generation'] as const)('%s Redis verifier environment safety', (verifier) => {
  test.each(['production', 'preview', ''])(
    'HOSTED_API_ENVIRONMENT=%j 在任何 Redis 副作用前 fail closed',
    async (hostedApiEnvironment) => {
      const result = await runAgainstTcpSentinel({ verifier, hostedApiEnvironment });
      expect(result).toMatchObject({
        connections: 0,
        exitCode: 1,
        signal: null,
        timedOut: false,
      });
      expect(result.stderr).toContain('只允许 HOSTED_API_ENVIRONMENT=local/test');
    },
  );
});
