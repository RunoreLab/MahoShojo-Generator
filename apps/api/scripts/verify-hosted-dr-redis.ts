import { createClient } from 'redis';

import { RedisRuntime } from '../src/redis/runtime';

const redisUrl = process.env.REDIS_URL?.trim();
if (!redisUrl) throw new Error('G25E2 Redis verifier 需要 REDIS_URL');
if (process.env.HOSTED_DR_LOCAL_FAULT_INJECTION !== 'true') {
  throw new Error('G25E2 Redis verifier 只允许 HOSTED_DR_LOCAL_FAULT_INJECTION=true');
}

const parsedUrl = new URL(redisUrl);
if (
  !['redis:', 'rediss:'].includes(parsedUrl.protocol)
  || !['localhost', '127.0.0.1', '[::1]'].includes(parsedUrl.hostname)
) {
  throw new Error('G25E2 Redis verifier 只允许连接 loopback Redis');
}

const client = createClient({ url: redisUrl });
client.on('error', () => undefined);
const runtime = new RedisRuntime(redisUrl, true);

try {
  await client.connect();
  const before = await client.dbSize();
  if (before !== 0) {
    throw new Error(`G25E2 Redis empty 前置条件失败：隔离 DB 有 ${before} 个 key`);
  }

  await runtime.connect();
  if (!await runtime.ping()) throw new Error('G25E2 Redis ping 失败');
  const state = await runtime.getGenerationReplayStore().readState({
    generationId: 'g25e2-empty-probe-never-written',
    actorKey: 'anonymous:g25e2-empty-probe',
  });
  if (state !== null) throw new Error('G25E2 Redis empty replay state 不应存在');

  const after = await client.dbSize();
  if (after !== 0) {
    throw new Error(`G25E2 Redis empty 读取后出现 ${after} 个 key`);
  }

  console.log(JSON.stringify({
    redisEmpty: true,
    databaseSizeBefore: before,
    databaseSizeAfter: after,
    runtimeReady: runtime.getStatus().ready,
    replayState: 'absent',
    destructiveCommands: false,
  }));
} finally {
  await runtime.close();
  if (client.isOpen) await client.quit();
}
