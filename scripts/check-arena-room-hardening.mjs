import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const EXPECTED_TOP_LEVEL_KEYS = [
  'cleanupPolicy',
  'drills',
  'environment',
  'namespacePolicy',
  'productionExecution',
  'schemaVersion',
  'secretPolicy',
  'suite',
];

const EXPECTED_DRILL_KEYS = [
  'assertions',
  'command',
  'id',
  'owner',
  'recovery',
];

const EXPECTED_OWNER_KEYS = ['kind', 'path', 'selector'];
const EXPECTED_RECOVERY_KEYS = ['classification', 'expectation'];

const EXPECTED_DRILLS = Object.freeze([
  {
    id: 'real_socket_disconnect',
    owner: {
      kind: 'vitest',
      path: 'apps/api/tests/room-websocket-authority-upgrade.test.ts',
      selector: 'host-client-disconnected',
    },
    command: 'pnpm --filter @mahoshojo/api exec vitest run tests/room-websocket-authority-upgrade.test.ts --config vitest.config.ts',
    recovery: {
      classification: 'recoverable',
      expectation: '连接 presence 被清理；服务器权威 generation/publisher 继续，客户端可用新 ticket 重连',
    },
    assertions: [
      '真实 Node WebSocket 断开只移除对应 connection presence',
      'host 断开后服务器权威 publisher 继续向仍在线 member 发布 terminal',
      '断开与恢复证据不记录 ticket、正文、用户标识或 secret',
    ],
  },
  {
    id: 'host_refresh',
    owner: {
      kind: 'vitest',
      path: 'apps/api/tests/room-websocket-authority.test.ts',
      selector: '单 tab close/refresh 不 revoke membership',
    },
    command: 'pnpm --filter @mahoshojo/api exec vitest run tests/room-websocket-authority.test.ts --config vitest.config.ts',
    recovery: {
      classification: 'recoverable',
      expectation: 'refresh 只替换对应连接；membership 不撤销，last close 后才设置离线 deadline',
    },
    assertions: [
      'multi-tab host refresh 不提升客户端信任或撤销有效 membership',
      '旧连接关闭与新连接 attach 的 presence 计数保持服务器权威',
      'last close 以前 Room 不伪造 host offline terminal',
    ],
  },
  {
    id: 'redis_unavailable',
    owner: {
      kind: 'verifier',
      path: 'apps/api/scripts/verify-room-redis.ts',
      selector: 'directoryDisconnectedRuntimeFailClosed',
    },
    command: 'HOSTED_API_ENVIRONMENT=local REDIS_URL=redis://127.0.0.1:6379 ROOM_REDIS_VERIFY=true ROOM_REDIS_VERIFY_KEY_PREFIX=gmr10_unavailable pnpm --filter @mahoshojo/api run verify:room-redis',
    recovery: {
      classification: 'recoverable',
      expectation: 'Redis seam 恢复后只能从已提交 checkpoint 继续或由调用方显式重试',
    },
    assertions: [
      'directory create、close 与 checkpoint mutation 在 Redis unavailable 时 fail closed',
      '失败路径不安装未提交 actor state、不删除既有 checkpoint 或 directory',
      '恢复不盲目重放非幂等 generation Provider',
    ],
  },
  {
    id: 'hono_restart_redis_survivor',
    owner: {
      kind: 'verifier',
      path: 'apps/api/scripts/verify-room-hardening-faults.ts',
      selector: 'honoRestartRedisSurvivor',
    },
    command: 'HOSTED_API_ENVIRONMENT=local REDIS_URL=redis://127.0.0.1:6379 ROOM_HARDENING_VERIFY=true ROOM_HARDENING_VERIFY_KEY_PREFIX=gmr10_faults pnpm --filter @mahoshojo/api run verify:room-hardening-faults',
    recovery: {
      classification: 'recoverable',
      expectation: '新 Hono runtime 从同一存活 Redis 的已提交 checkpoint 恢复 Room authority',
    },
    assertions: [
      'Hono runtime 重启期间 Redis process 保持存活且 checkpoint 不被重建或改写',
      '新 actor 使用新 epoch warm recovery 并 fence 旧 writer',
      '恢复前后的 Room identity 与 durable facts 保持一致',
    ],
  },
  {
    id: 'exact_checkpoint_loss',
    owner: {
      kind: 'verifier',
      path: 'apps/api/scripts/verify-room-hardening-faults.ts',
      selector: 'exactCheckpointLoss',
    },
    command: 'HOSTED_API_ENVIRONMENT=local REDIS_URL=redis://127.0.0.1:6379 ROOM_HARDENING_VERIFY=true ROOM_HARDENING_VERIFY_KEY_PREFIX=gmr10_faults pnpm --filter @mahoshojo/api run verify:room-hardening-faults',
    recovery: {
      classification: 'unrecoverable',
      expectation: '旧 Room 必须返回 replacement-required 且不得复活；只能创建不同 ID 的新 Room',
    },
    assertions: [
      '只精确删除隔离 active checkpoint，不使用 SCAN 宽删或 FLUSH',
      '旧 directory candidate 被清理且 lookup、join、recover 均不能复活旧 Room',
      'observer 给出 replacement-required，随后可创建不同 ID 的新 Room',
    ],
  },
  {
    id: 'stale_orphan_directory',
    owner: {
      kind: 'verifier',
      path: 'apps/api/scripts/verify-room-redis.ts',
      selector: 'directoryStaleCleanup',
    },
    command: 'HOSTED_API_ENVIRONMENT=local REDIS_URL=redis://127.0.0.1:6379 ROOM_REDIS_VERIFY=true ROOM_REDIS_VERIFY_KEY_PREFIX=gmr10_directory pnpm --filter @mahoshojo/api run verify:room-redis',
    recovery: {
      classification: 'recoverable',
      expectation: 'stale/orphan candidate 只做 exact lazy cleanup，并保留并发 replacement',
    },
    assertions: [
      '缺 checkpoint、malformed record 与 orphan index 不会出现在 discovery 结果',
      'cleanup 同时校验 exact raw/index member，不删除 concurrent replacement',
      '分页 cursor 在清理无效 candidate 后仍单调推进',
    ],
  },
  {
    id: 'generation_midflight_sigkill',
    owner: {
      kind: 'verifier',
      path: 'apps/api/scripts/verify-room-generation-process-recovery.ts',
      selector: 'producerLostAfterKill',
    },
    command: 'HOSTED_API_ENVIRONMENT=local REDIS_URL=redis://127.0.0.1:6379 ROOM_GENERATION_PROCESS_VERIFY=true ROOM_REDIS_VERIFY_KEY_PREFIX=gmr10_process pnpm --filter @mahoshojo/api run verify:room-generation-process-recovery',
    recovery: {
      classification: 'recoverable',
      expectation: 'SIGKILL 后由新 runtime 收敛为 producer_lost durable terminal，不启动第二 Provider',
    },
    assertions: [
      '真实子进程在 generation mid-flight 收到 SIGKILL',
      '恢复后 Provider start 总数仍为一且 duplicate start 不执行第二次非幂等调用',
      'producer_lost terminal、checkpoint 与 durable terminal event/snapshot 一致且无 secret 持久化',
    ],
  },
  {
    id: 'slow_consumer',
    owner: {
      kind: 'vitest',
      path: 'apps/api/tests/room-websocket-gateway.test.ts',
      selector: 'bounded send queue 饱和时以 resync-required 关闭 slow consumer',
    },
    command: 'pnpm --filter @mahoshojo/api exec vitest run tests/room-websocket-gateway.test.ts --config vitest.config.ts',
    recovery: {
      classification: 'recoverable',
      expectation: '只关闭超出有界 backlog 的 slow socket，重连后必须走 replay 或 snapshot resync',
    },
    assertions: [
      'outbound queued frames/bytes 始终受固定上限约束',
      'slow consumer 收到 resync-required close 且 subscriber、backlog 只清理一次',
      'slow socket 不阻塞 actor checkpoint 或其他健康连接',
    ],
  },
  {
    id: 'oversize_flood',
    owner: {
      kind: 'vitest',
      path: 'apps/api/tests/room-websocket-gateway.test.ts',
      selector: '拒绝 binary、超大和 malformed client frame',
    },
    command: 'pnpm --filter @mahoshojo/api exec vitest run tests/room-websocket-gateway.test.ts --config vitest.config.ts',
    recovery: {
      classification: 'recoverable',
      expectation: '只拒绝或关闭违规连接；健康连接仍受 connection/user/occupancy 有界限制',
    },
    assertions: [
      'binary、oversized 与 malformed client frame 在进入 Room command 前被拒绝',
      'connection flood 与同用户 flood 触发固定 rate/cap fail-closed',
      '违规输入不创建 reservation、subscriber 或 authority mutation',
    ],
  },
  {
    id: 'vps_unreachable',
    owner: {
      kind: 'verifier',
      path: 'apps/api/scripts/verify-room-hardening-faults.ts',
      selector: 'vpsUnreachable',
    },
    command: 'HOSTED_API_ENVIRONMENT=local REDIS_URL=redis://127.0.0.1:6379 ROOM_HARDENING_VERIFY=true ROOM_HARDENING_VERIFY_KEY_PREFIX=gmr10_faults pnpm --filter @mahoshojo/api run verify:room-hardening-faults',
    recovery: {
      classification: 'unrecoverable',
      expectation: '组合关闭 gateway、actor registry 与 Redis seam 后旧 Room 明确 unavailable；不得声称透明 failover',
    },
    assertions: [
      'gateway shutdown 停止新 upgrade 并有界关闭已连接 socket',
      'actor registry force-close 不伪造未提交 checkpoint ack 或 fan-out',
      'Redis seam 关闭后旧 Room 不可继续，只能显式重启或 rebuild',
    ],
  },
]);

const isRecord = (value) => (
  value !== null
  && typeof value === 'object'
  && !Array.isArray(value)
);

const hasExactKeys = (value, expectedKeys) => (
  isRecord(value)
  && JSON.stringify(Object.keys(value).sort()) === JSON.stringify(expectedKeys)
);

const sameJson = (left, right) => JSON.stringify(left) === JSON.stringify(right);

const containsCredential = (candidate) => {
  const serialized = JSON.stringify(candidate);
  return (
    /OPENSSH PRIVATE KEY|-----BEGIN [A-Z ]+ PRIVATE KEY-----/iu.test(serialized)
    || /Authorization:\s*Bearer\s+[A-Za-z0-9._~+/=-]{8,}/iu.test(serialized)
    || /(?:api[_-]?key|password)\s*[=:]\s*["']?[A-Za-z0-9._~+/=-]{8,}/iu.test(serialized)
  );
};

const forbiddenDefaultNamespace = (command) => (
  /(?:ROOM_(?:GENERATION_)?REDIS_VERIFY_KEY_PREFIX|ROOM_HARDENING_VERIFY_KEY_PREFIX)=(?:gmr02|gmr09dur|verify|default|prod|production)(?:\s|$)/iu
    .test(command)
);

const resolveOwnerPath = (repositoryRoot, relativePath) => {
  const root = path.resolve(repositoryRoot);
  const resolved = path.resolve(root, relativePath);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) return null;
  return resolved;
};

export const validateArenaRoomHardeningEvidence = (
  candidate,
  { repositoryRoot = path.resolve(import.meta.dirname, '..') } = {},
) => {
  const failures = [];
  const fail = (message) => failures.push(message);

  if (!hasExactKeys(candidate, EXPECTED_TOP_LEVEL_KEYS)) {
    fail('顶层字段必须与 GMR-10 hardening evidence schema 精确一致');
    return failures;
  }
  if (candidate.schemaVersion !== 1) fail('schemaVersion 必须为 1');
  if (candidate.suite !== 'GMR-10_ARENA_ROOM_HARDENING_V1') {
    fail('suite 必须为 GMR-10_ARENA_ROOM_HARDENING_V1');
  }
  if (candidate.environment !== 'local-loopback-fault-injection') {
    fail('environment 必须保持 local-loopback-fault-injection');
  }
  if (candidate.productionExecution !== 'DEFERRED') {
    fail('productionExecution 必须保持 DEFERRED');
  }
  if (candidate.cleanupPolicy !== 'exact-isolated-prefix-only') {
    fail('cleanupPolicy 必须是 exact-isolated-prefix-only');
  }
  if (candidate.namespacePolicy !== 'explicit-nondefault-prefix-required') {
    fail('namespacePolicy 必须要求显式非默认 prefix');
  }
  if (candidate.secretPolicy !== 'no-secret-or-content-evidence') {
    fail('secretPolicy 必须禁止 secret/content evidence');
  }
  if (containsCredential(candidate)) {
    fail('manifest 不得包含 credential/private key material');
  }

  const actualIds = Array.isArray(candidate.drills)
    ? candidate.drills.map((drill) => (isRecord(drill) ? drill.id : null))
    : [];
  const expectedIds = EXPECTED_DRILLS.map((drill) => drill.id);
  if (!sameJson(actualIds, expectedIds)) {
    fail('drills 必须按固定顺序恰好覆盖 10 个 GMR-10 场景');
  }
  if (!Array.isArray(candidate.drills)) return failures;

  for (let index = 0; index < candidate.drills.length; index += 1) {
    const drill = candidate.drills[index];
    const expected = EXPECTED_DRILLS[index];
    const label = isRecord(drill) && typeof drill.id === 'string'
      ? drill.id
      : `drill[${index}]`;
    if (!expected || !hasExactKeys(drill, EXPECTED_DRILL_KEYS)) {
      fail(`${label}: drill 字段必须与 schema 精确一致`);
      continue;
    }
    if (!hasExactKeys(drill.owner, EXPECTED_OWNER_KEYS)) {
      fail(`${label}: owner 字段必须与 schema 精确一致`);
      continue;
    }
    if (!hasExactKeys(drill.recovery, EXPECTED_RECOVERY_KEYS)) {
      fail(`${label}: recovery 字段必须与 schema 精确一致`);
      continue;
    }
    if (!sameJson(drill.owner, expected.owner)) {
      fail(`${label}: owner contract 与固定 evidence owner 不一致`);
    }
    if (drill.command !== expected.command) {
      fail(`${label}: command allowlist 不匹配`);
    }
    if (!sameJson(drill.recovery, expected.recovery)) {
      fail(`${label}: recovery contract 与固定故障语义不一致`);
    }
    if (!sameJson(drill.assertions, expected.assertions)) {
      fail(`${label}: assertions contract 与固定验收断言不一致`);
    }
    if (typeof drill.command === 'string') {
      if (/\bFLUSH(?:ALL|DB)?\b/iu.test(drill.command)) {
        fail(`${label}: command 不得包含 FLUSH`);
      }
      if (forbiddenDefaultNamespace(drill.command)) {
        fail(`${label}: command 不得使用默认或生产 namespace`);
      }
    }

    const ownerPath = typeof drill.owner.path === 'string'
      ? resolveOwnerPath(repositoryRoot, drill.owner.path)
      : null;
    if (!ownerPath) {
      fail(`${label}: owner path 必须位于 repository 内`);
      continue;
    }
    let ownerSource;
    try {
      ownerSource = readFileSync(ownerPath, 'utf8');
    } catch {
      fail(`${label}: owner path 不存在或不可读：${drill.owner.path}`);
      continue;
    }
    if (
      typeof drill.owner.selector !== 'string'
      || drill.owner.selector.length === 0
      || !ownerSource.includes(drill.owner.selector)
    ) {
      fail(`${label}: owner selector 无法在 ${drill.owner.path} 定位`);
    }
  }

  return failures;
};

const readArgument = (arguments_, name, fallback) => {
  const index = arguments_.indexOf(name);
  if (index < 0) return fallback;
  const value = arguments_[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} 缺少值`);
  return value;
};

export const runArenaRoomHardeningEvidenceCli = (
  arguments_ = process.argv.slice(2),
) => {
  for (let index = 0; index < arguments_.length; index += 2) {
    if (arguments_[index] !== '--manifest' || index + 1 >= arguments_.length) {
      throw new Error(`未知或不完整参数：${arguments_[index] ?? ''}`);
    }
  }
  const repositoryRoot = path.resolve(import.meta.dirname, '..');
  const manifestPath = path.resolve(
    repositoryRoot,
    readArgument(
      arguments_,
      '--manifest',
      'config/arena-room-hardening-evidence.json',
    ),
  );
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`hardening evidence JSON 无法解析：${detail}`);
  }
  const failures = validateArenaRoomHardeningEvidence(manifest, { repositoryRoot });
  if (failures.length > 0) {
    for (const failure of failures) {
      console.error(`[arena-room-hardening] ${failure}`);
    }
    return 1;
  }
  console.log(JSON.stringify({
    gate: 'ARENA_ROOM_HARDENING_EVIDENCE',
    drills: manifest.drills.length,
    productionExecution: manifest.productionExecution,
    status: 'PASS',
  }));
  return 0;
};

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (invokedPath === import.meta.url) {
  try {
    process.exitCode = runArenaRoomHardeningEvidenceCli();
  } catch (error) {
    console.error(`[arena-room-hardening] ${
      error instanceof Error ? error.message : String(error)
    }`);
    process.exitCode = 1;
  }
}
