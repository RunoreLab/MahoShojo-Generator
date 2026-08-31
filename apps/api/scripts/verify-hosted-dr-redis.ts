import { DatabaseSync } from 'node:sqlite';
import { createClient } from 'redis';
import { createNodeArenaGenerationTerminalStore } from '@mahoshojo/hosted-runtime/arena-generation';
import type {
  NodeDataD1Client,
  NodeDataD1Statement,
} from '@mahoshojo/hosted-runtime/node-runtime/data-ports';

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
const authorityDatabase = new DatabaseSync(':memory:');

const createSqliteD1Adapter = (database: DatabaseSync): NodeDataD1Client => ({
  prepare(sql) {
    const statement = database.prepare(sql);
    let parameters: unknown[] = [];
    const d1Statement: NodeDataD1Statement = {
      bind(...nextParameters) {
        parameters = nextParameters;
        return d1Statement;
      },
      async all() {
        return {
          success: true,
          results: statement.all(...parameters as never[]) as Record<string, unknown>[],
          meta: {},
        };
      },
      async run() {
        const result = statement.run(...parameters as never[]);
        return {
          success: true,
          results: [],
          meta: { changes: Number(result.changes) },
        };
      },
    };
    return d1Statement;
  },
});

const sha256 = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('');
};

try {
  const authorityGenerationId = 'g25e2-authority-generation';
  const authorityRequestId = 'g25e2-authority-request';
  const authorityActorKey = 'user:2502';
  const authorityPayloadHash = 'g25e2-authority-payload';
  const authorityR2Key = `v1/battle-report-generations/${authorityGenerationId}/output.md`;
  const authorityMarkdown = '# G25E2 authority\n\nRedis empty drill must not change this terminal.';
  authorityDatabase.exec(`
CREATE TABLE battle_report_generations (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  output_preview TEXT,
  extra_json TEXT NOT NULL
);
CREATE TABLE large_objects (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  owner_ref_id TEXT NOT NULL,
  r2_key TEXT NOT NULL
);
  `.trim());
  authorityDatabase.prepare(`
INSERT INTO battle_report_generations (id, status, updated_at, output_preview, extra_json)
VALUES (?, ?, ?, ?, ?)
  `.trim()).run(
    authorityGenerationId,
    'completed',
    '2026-08-25T04:00:00.000Z',
    'bounded preview',
    JSON.stringify({
      generationRequestId: authorityRequestId,
      generationOwnerHash: await sha256(authorityActorKey),
      generationPayloadHash: authorityPayloadHash,
      generationTerminalStatus: 'completed',
      finalizationCompleted: true,
      resultRef: `r2:${authorityR2Key}`,
    }),
  );
  authorityDatabase.prepare(`
INSERT INTO large_objects (id, kind, owner_ref_id, r2_key)
VALUES (?, ?, ?, ?)
  `.trim()).run(
    `arena-output:${authorityGenerationId}`,
    'battle_report_generation_output',
    authorityGenerationId,
    authorityR2Key,
  );
  const authorityStore = createNodeArenaGenerationTerminalStore({
    getD1Client: () => createSqliteD1Adapter(authorityDatabase),
    objectStore: {
      async put() {
        throw new Error('G25E2 authority fixture is read-only');
      },
      async getText(key) {
        if (key !== authorityR2Key) throw new Error('G25E2 authority R2 key mismatch');
        return { kind: 'found' as const, text: authorityMarkdown };
      },
    },
  });
  const readAuthority = () => authorityStore.readOwnedTerminal({
    generationId: authorityGenerationId,
    actorKey: authorityActorKey,
  });
  const authorityBefore = await readAuthority();
  if (
    authorityBefore?.generationRequestId !== authorityRequestId
    || authorityBefore.payloadHash !== authorityPayloadHash
    || authorityBefore.markdown !== authorityMarkdown
    || authorityBefore.contentAvailable !== true
  ) {
    throw new Error(`${DRILL_CASE_ID} 无法经应用 D1/R2 terminal store 读取 authority`);
  }
  if (await authorityStore.readOwnedTerminal({
    generationId: authorityGenerationId,
    actorKey: 'user:2503',
  }) !== null) {
    throw new Error(`${DRILL_CASE_ID} authority owner gate 未 fail closed`);
  }

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
  const authorityAfter = await readAuthority();
  if (JSON.stringify(authorityAfter) !== JSON.stringify(authorityBefore)) {
    throw new Error(`${DRILL_CASE_ID} Redis 清空改变了应用 D1/R2 terminal authority`);
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
    authority: 'arena-terminal-d1-r2-path-unchanged',
    authorityGenerationId,
    authorityContentAvailable: authorityAfter?.contentAvailable === true,
    destructiveCommands: 'local-loopback-flushdb-only',
  }));
} finally {
  await runtime.close();
  if (client.isOpen) await client.quit();
  authorityDatabase.close();
}
