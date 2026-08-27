import { createClient } from 'redis';

import { RedisRuntime } from '../src/redis/runtime';

const DRILL_CASE_ID = 'G25E2-REDIS-EMPTY';
const redisUrl = process.env.REDIS_URL?.trim();
if (!redisUrl) throw new Error('G25E2 Redis verifier 需要 REDIS_URL');
if (process.env.HOSTED_DR_LOCAL_FAULT_INJECTION?.trim().toLowerCase() !== 'true') {
  throw new Error('G25E2 Redis verifier 只允许 HOSTED_DR_LOCAL_FAULT_INJECTION=true');
}

const parsedUrl = new URL(redisUrl);
if (
  !['redis:', 'rediss:'].includes(parsedUrl.protocol)
  || !['localhost', '127.0.0.1', '[::1]'].includes(parsedUrl.hostname)
) {
  throw new Error('G25E2 Redis verifier 只允许连接 loopback Redis');
}

const keyPrefix = process.env.HOSTED_DR_REDIS_KEY_PREFIX?.trim() || 'preview';
if (!/^[a-z0-9_-]{1,32}$/u.test(keyPrefix)) {
  throw new Error('G25E2 Redis verifier 需要安全的环境 key prefix');
}

const client = createClient({ url: redisUrl });
client.on('error', () => undefined);
const runtime = new RedisRuntime(redisUrl, true, undefined, undefined, keyPrefix);

try {
  await client.connect();
  const before = await client.dbSize();
  if (before !== 0) {
    throw new Error(`${DRILL_CASE_ID} 前置条件失败：隔离 DB 有 ${before} 个 key`);
  }

  await runtime.connect();
  const store = runtime.getGenerationReplayStore();
  const seed = await store.reserve({
    actorKey: 'anonymous:g25e2-empty-probe',
    generationRequestId: 'g25e2-empty-probe-request',
    generationId: 'g25e2-empty-probe-seeded',
    payloadHash: 'g25e2-empty-probe-payload',
    producerToken: 'g25e2-empty-probe-producer',
    now: '2026-08-25T04:00:00.000Z',
    leaseExpiresAt: '2026-08-25T04:01:00.000Z',
  });
  if (seed.kind !== 'created') throw new Error(`${DRILL_CASE_ID} seed 失败`);
  const seededKeys: string[] = [];
  for await (const keys of client.scanIterator({ MATCH: `mahoshojo:gen:v1:${keyPrefix}:*` })) {
    seededKeys.push(...keys);
  }
  if (seededKeys.length < 2 || seededKeys.some((key) => !key.startsWith(`mahoshojo:gen:v1:${keyPrefix}:`))) {
    throw new Error(`${DRILL_CASE_ID} seed key 未被环境前缀隔离`);
  }
  const seeded = await client.dbSize();
  if (seeded < 2) throw new Error(`${DRILL_CASE_ID} seed 未写入 state/reservation`);

  // 仅清理 loopback fault-injection DB；此脚本拒绝远端/生产 Redis。
  await client.flushDb();
  const afterFlush = await client.dbSize();
  if (afterFlush !== 0) throw new Error(`${DRILL_CASE_ID} 清理后仍有 ${afterFlush} 个 key`);

  if (!await runtime.ping()) throw new Error(`${DRILL_CASE_ID} ping 失败`);
  const state = await store.readState({
    generationId: 'g25e2-empty-probe-never-written',
    actorKey: 'anonymous:g25e2-empty-probe',
  });
  if (state !== null) throw new Error(`${DRILL_CASE_ID} replay state 不应存在`);

  const afterRead = await client.dbSize();
  if (afterRead !== 0) {
    throw new Error(`${DRILL_CASE_ID} 读取后出现 ${afterRead} 个 key`);
  }

  console.log(JSON.stringify({
    drillCase: DRILL_CASE_ID,
    redisEmpty: true,
    databaseSizeBefore: before,
    seededKeys: seededKeys.length,
    databaseSizeBeforeFlush: seeded,
    databaseSizeAfter: afterRead,
    runtimeReady: runtime.getStatus().ready,
    replayState: 'absent',
    authority: 'external-d1-or-binding-not-replaced-by-redis',
    destructiveCommands: 'local-loopback-flushdb-only',
  }));
} finally {
  await runtime.close();
  if (client.isOpen) await client.quit();
}
