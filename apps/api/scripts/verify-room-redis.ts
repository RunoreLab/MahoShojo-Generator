import { createHash, randomUUID } from 'node:crypto';

import {
  checkpointPredecessorOf,
  transitionArenaRoom,
  type ArenaRoomAuthorityState,
} from '@mahoshojo/multiplayer-core';
import { createClient } from 'redis';

import {
  createRedisRoomStore,
  type RedisRoomClient,
} from '../src/arena-room/redis-room-store';
import { RedisRuntime } from '../src/redis/runtime';

const redisUrl = process.env.REDIS_URL?.trim();
if (!redisUrl) throw new Error('Room Redis verifier 需要 REDIS_URL');

const parsedUrl = new URL(redisUrl);
if (
  !['redis:', 'rediss:'].includes(parsedUrl.protocol)
  || !['localhost', '127.0.0.1', '[::1]'].includes(parsedUrl.hostname)
) {
  throw new Error('Room Redis verifier 只允许连接 loopback Redis');
}

const phase = process.env.ROOM_REDIS_VERIFY_PHASE?.trim() || 'full';
if (!['full', 'write', 'read'].includes(phase)) {
  throw new Error('ROOM_REDIS_VERIFY_PHASE 只允许 full/write/read');
}
const suppliedToken = process.env.ROOM_REDIS_VERIFY_TOKEN?.trim();
if (phase !== 'full' && !suppliedToken) {
  throw new Error('write/read phase 需要 ROOM_REDIS_VERIFY_TOKEN');
}
const token = suppliedToken || randomUUID();
if (!/^[a-zA-Z0-9_-]{1,64}$/u.test(token)) {
  throw new Error('ROOM_REDIS_VERIFY_TOKEN 必须是安全 opaque token');
}
const keyPrefix = process.env.ROOM_REDIS_VERIFY_KEY_PREFIX?.trim() || 'gmr02';
if (!/^[a-z0-9_-]{1,32}$/u.test(keyPrefix)) {
  throw new Error('ROOM_REDIS_VERIFY_KEY_PREFIX 必须是安全环境标识');
}

const TIMESTAMP = '2026-08-28T00:00:00.000Z';
const NEXT_TIMESTAMP = '2026-08-28T00:01:00.000Z';
const roomId = `room-restart-${token}`;
const ttlRoomId = `room-ttl-${token}`;
const roomKey = (id: string): string => (
  `mahoshojo:room:v1:${keyPrefix}:${createHash('sha256').update(id).digest('hex')}:checkpoint`
);

const sharedConfig = () => ({
  battleMode: 'classic' as const,
  combatants: [{
    key: 'data-card:character-1',
    ref: { id: 'character-1', kind: 'character' as const, versionToken: 'v1' },
  }],
  teams: [],
  scenario: null,
  auxScenarios: [],
  materials: [],
  userGuidance: '',
  storyLength: 'standard' as const,
  customStoryLength: null,
  selectedLanguage: 'zh-CN',
  historySettings: {
    readArenaHistory: true,
    readArenaHistoryLimit: 3,
    isArenaHistoryUnlimited: false,
    writeArenaHistory: true,
    readCurrentState: true,
    writeCurrentState: true,
    readNarrativeHistory: false,
    readNarrativeHistoryLimit: 10,
    isNarrativeHistoryUnlimited: false,
    writeNarrativeHistory: false,
  },
});

const hostAuthority = {
  kind: 'authenticated-user' as const,
  actorUserId: 'host-1',
  accountUserId: 101,
};

const createState = (id: string, roomEpoch = 'epoch-1'): ArenaRoomAuthorityState => {
  const result = transitionArenaRoom(null, {
    type: 'create',
    roomId: id,
    roomEpoch,
    host: {
      userId: 'host-1',
      role: 'host',
      displayName: 'Host',
      membershipState: 'active',
      joinedAt: TIMESTAMP,
    },
    sharedConfig: sharedConfig(),
    timestamp: TIMESTAMP,
  }, hostAuthority);
  if (!result.ok) throw new Error('ROOM_REDIS_FIXTURE_CREATE_FAILED');
  return result.nextState;
};

const publish = (state: ArenaRoomAuthorityState): ArenaRoomAuthorityState => {
  const result = transitionArenaRoom(state, {
    type: 'publish-config',
    expectedRoomEpoch: state.snapshot.roomEpoch,
    expectedRevision: state.snapshot.revision,
    sharedConfig: { ...state.snapshot.sharedConfig, userGuidance: 'restart-recovery-acknowledged' },
    timestamp: NEXT_TIMESTAMP,
  }, hostAuthority);
  if (!result.ok) throw new Error('ROOM_REDIS_FIXTURE_PUBLISH_FAILED');
  return result.nextState;
};

const close = (state: ArenaRoomAuthorityState): ArenaRoomAuthorityState => {
  const result = transitionArenaRoom(state, {
    type: 'close',
    expectedRoomEpoch: state.snapshot.roomEpoch,
    reason: 'verifier-close',
    timestamp: NEXT_TIMESTAMP,
  }, hostAuthority);
  if (!result.ok) throw new Error('ROOM_REDIS_FIXTURE_CLOSE_FAILED');
  return result.nextState;
};

const reader = new RedisRuntime(redisUrl, true, undefined, undefined, keyPrefix);
const writer = new RedisRuntime(redisUrl, true, undefined, undefined, keyPrefix);
const cleanup = createClient({ url: redisUrl });
cleanup.on('error', () => undefined);

try {
  await reader.connect();
  await writer.connect();
  await cleanup.connect();
  const readerStore = reader.getRoomStore();
  const writerStore = writer.getRoomStore();

  if (phase === 'read') {
    const recovered = await readerStore.load(roomId);
    if (
      recovered?.snapshot.sharedConfig.userGuidance !== 'restart-recovery-acknowledged'
      || recovered.snapshot.revision !== 1
    ) {
      throw new Error('ROOM_REDIS_RESTART_RECOVERY_FAILED');
    }
    const deleted = await readerStore.delete({
      roomId,
      expected: checkpointPredecessorOf(recovered),
    });
    if (deleted.kind !== 'deleted') throw new Error('ROOM_REDIS_RESTART_CLEANUP_FAILED');
    console.info(JSON.stringify({ roomRedis: true, phase: 'read', restartRecovery: true }));
  } else {
    const initial = createState(roomId);
    const acknowledged = publish(initial);
    const created = await writerStore.save({ checkpoint: initial, expected: null });
    const duplicateCreate = await readerStore.save({ checkpoint: initial, expected: null });
    const mutated = await writerStore.save({
      checkpoint: acknowledged,
      expected: checkpointPredecessorOf(initial),
    });
    const recovered = await readerStore.load(roomId);
    if (
      created.kind !== 'saved'
      || duplicateCreate.kind !== 'conflict'
      || mutated.kind !== 'saved'
      || JSON.stringify(recovered) !== JSON.stringify(acknowledged)
    ) {
      throw new Error('ROOM_REDIS_ACKNOWLEDGED_CHECKPOINT_FAILED');
    }

    if (phase === 'write') {
      console.info(JSON.stringify({ roomRedis: true, phase: 'write', acknowledged: true }));
    } else {
      const staleClose = close(initial);
      const staleWriter = await readerStore.save({
        checkpoint: staleClose,
        expected: checkpointPredecessorOf(initial),
      });
      const nextEpoch = createState(roomId, 'epoch-2');
      const epochAdvanced = await writerStore.save({
        checkpoint: nextEpoch,
        expected: checkpointPredecessorOf(acknowledged),
      });
      const oldEpochOverwrite = await readerStore.save({
        checkpoint: close(acknowledged),
        expected: checkpointPredecessorOf(acknowledged),
      });
      if (
        staleWriter.kind !== 'conflict'
        || epochAdvanced.kind !== 'saved'
        || oldEpochOverwrite.kind !== 'conflict'
      ) {
        throw new Error('ROOM_REDIS_CAS_FENCING_FAILED');
      }

      const expired = await writerStore.expire({
        roomId,
        expected: checkpointPredecessorOf(nextEpoch),
      });
      const expiryTtl = await cleanup.pTTL(roomKey(roomId));
      const deleted = await writerStore.delete({
        roomId,
        expected: checkpointPredecessorOf(nextEpoch),
      });
      const repeatedDelete = await writerStore.delete({
        roomId,
        expected: checkpointPredecessorOf(nextEpoch),
      });
      if (
        expired.kind !== 'expired'
        || expiryTtl <= 0
        || expiryTtl > 300_000
        || deleted.kind !== 'deleted'
        || repeatedDelete.kind !== 'missing'
      ) {
        throw new Error('ROOM_REDIS_EXPIRY_DELETE_FAILED');
      }

      const shortTtlStore = createRedisRoomStore({
        keyPrefix,
        getClient: () => ({
          eval: (script, options) => cleanup.eval(script, options),
          get: async (key) => {
            const value = await cleanup.get(key);
            return typeof value === 'string' ? value : null;
          },
        } satisfies RedisRoomClient),
        activeTtlSeconds: 1,
        terminalTtlSeconds: 1,
      });
      const shortLived = createState(ttlRoomId);
      if ((await shortTtlStore.save({ checkpoint: shortLived, expected: null })).kind !== 'saved') {
        throw new Error('ROOM_REDIS_SHORT_TTL_CREATE_FAILED');
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 1_100));
      if (await shortTtlStore.load(ttlRoomId) !== null) {
        throw new Error('ROOM_REDIS_TTL_EXPIRY_FAILED');
      }
      console.info(JSON.stringify({
        roomRedis: true,
        phase: 'full',
        createLoadMutate: true,
        stalePredecessor: true,
        oldEpochFence: true,
        expireDelete: true,
        ttlExpiry: true,
      }));
    }
  }
} finally {
  await reader.close();
  await writer.close();
  if (!cleanup.isOpen) await cleanup.connect();
  if (phase !== 'write') {
    await cleanup.unlink([roomKey(roomId), roomKey(ttlRoomId)]);
  }
  await cleanup.quit();
}
