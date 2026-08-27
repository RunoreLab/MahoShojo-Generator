import { createHash, randomUUID } from 'node:crypto';

import {
  checkpointPredecessorOf,
  createArenaRoomCheckpointCommit,
  transitionArenaRoom,
  type ArenaRoomAuthorityState,
  type ArenaRoomCheckpointCommit,
  type ArenaRoomTransitionSuccess,
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
const epochRoomId = `room-epoch-${token}`;
const expiryFenceRoomId = `room-expiry-fence-${token}`;
const legacyRoomId = `room-legacy-v1-${token}`;
const malformedRoomId = `room-malformed-${token}`;
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

const success = (result: ReturnType<typeof transitionArenaRoom>): ArenaRoomTransitionSuccess => {
  if (!result.ok) throw new Error(`${result.code}:${result.reason}`);
  return result;
};

const createRoom = (id: string, roomEpoch = 'epoch-1'): ArenaRoomTransitionSuccess => {
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
  return success(result);
};

const publish = (state: ArenaRoomAuthorityState): ArenaRoomTransitionSuccess => {
  const result = transitionArenaRoom(state, {
    type: 'publish-config',
    expectedRoomEpoch: state.snapshot.roomEpoch,
    expectedRevision: state.snapshot.revision,
    sharedConfig: { ...state.snapshot.sharedConfig, userGuidance: 'restart-recovery-acknowledged' },
    timestamp: NEXT_TIMESTAMP,
  }, hostAuthority);
  return success(result);
};

const close = (state: ArenaRoomAuthorityState): ArenaRoomTransitionSuccess => {
  const result = transitionArenaRoom(state, {
    type: 'close',
    expectedRoomEpoch: state.snapshot.roomEpoch,
    reason: 'verifier-close',
    timestamp: NEXT_TIMESTAMP,
  }, hostAuthority);
  return success(result);
};

const commit = (transition: ArenaRoomTransitionSuccess): ArenaRoomCheckpointCommit => (
  createArenaRoomCheckpointCommit(transition)
);

const fixedError = async (operation: Promise<unknown>, expectedCode: string): Promise<void> => {
  try {
    await operation;
  } catch (error) {
    const message = String(error);
    if (message.includes(expectedCode) && !message.includes('provider-secret-canary')) return;
    throw new Error('ROOM_REDIS_FIXED_ERROR_FAILED');
  }
  throw new Error('ROOM_REDIS_FIXED_ERROR_FAILED');
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
    const createdTransition = createRoom(roomId);
    const initial = createdTransition.nextState;
    const publishedTransition = publish(initial);
    const acknowledged = structuredClone(publishedTransition.nextState);
    publishedTransition.nextState.snapshot.sharedConfig.userGuidance = 'tampered-old-payload';
    const created = await writerStore.save({ commit: commit(createdTransition) });
    const duplicateCreate = await readerStore.save({ commit: commit(createdTransition) });
    const mutated = await writerStore.save({ commit: commit(publishedTransition) });
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
      const staleWriter = await readerStore.save({ commit: commit(staleClose) });
      await fixedError(writerStore.save({
        commit: {} as ArenaRoomCheckpointCommit,
      }), 'REDIS_ROOM_TRANSITION_COMMIT_INVALID');

      const currentEpoch = createRoom(epochRoomId, 'epoch-2');
      const epochCreated = await writerStore.save({ commit: commit(currentEpoch) });
      const oldEpoch = createRoom(epochRoomId, 'epoch-1');
      const oldEpochOverwrite = await readerStore.save({ commit: commit(close(oldEpoch.nextState)) });
      if (
        staleWriter.kind !== 'conflict'
        || epochCreated.kind !== 'saved'
        || oldEpochOverwrite.kind !== 'conflict'
      ) {
        throw new Error('ROOM_REDIS_CAS_FENCING_FAILED');
      }

      const closedTransition = close(acknowledged);
      const closed = closedTransition.nextState;
      const closedSaved = await writerStore.save({ commit: commit(closedTransition) });
      const terminalTtl = await cleanup.pTTL(roomKey(roomId));
      if (
        closedSaved.kind !== 'saved'
        || terminalTtl <= 0
        || terminalTtl > 300_000
      ) {
        throw new Error('ROOM_REDIS_TERMINAL_TTL_FAILED');
      }

      const expired = await writerStore.expire({
        roomId,
        expected: checkpointPredecessorOf(closed),
      });
      const firstExpiryTtl = await cleanup.pTTL(roomKey(roomId));
      const repeatedExpire = await writerStore.expire({
        roomId,
        expected: checkpointPredecessorOf(closed),
      });
      const repeatedExpiryTtl = await cleanup.pTTL(roomKey(roomId));
      const deleted = await writerStore.delete({
        roomId,
        expected: checkpointPredecessorOf(closed),
      });
      const repeatedDelete = await writerStore.delete({
        roomId,
        expected: checkpointPredecessorOf(closed),
      });
      if (
        expired.kind !== 'expired'
        || repeatedExpire.kind !== 'expired'
        || firstExpiryTtl <= 0
        || firstExpiryTtl > 300_000
        || repeatedExpiryTtl <= 0
        || repeatedExpiryTtl > firstExpiryTtl
        || deleted.kind !== 'deleted'
        || repeatedDelete.kind !== 'missing'
      ) {
        throw new Error('ROOM_REDIS_EXPIRY_DELETE_FAILED');
      }

      const expiryFenceCreated = createRoom(expiryFenceRoomId);
      if ((await writerStore.save({ commit: commit(expiryFenceCreated) })).kind !== 'saved') {
        throw new Error('ROOM_REDIS_EXPIRY_FENCE_CREATE_FAILED');
      }
      if ((await writerStore.expire({
        roomId: expiryFenceRoomId,
        expected: checkpointPredecessorOf(expiryFenceCreated.nextState),
      })).kind !== 'expired') {
        throw new Error('ROOM_REDIS_EXPIRY_FENCE_INSTALL_FAILED');
      }
      const resurrection = await writerStore.save({
        commit: commit(publish(expiryFenceCreated.nextState)),
      });
      if (resurrection.kind !== 'conflict') {
        throw new Error('ROOM_REDIS_EXPIRY_FENCE_RESURRECTION_FAILED');
      }

      const malformedRaw = '{provider-secret-canary';
      const malformedKey = roomKey(malformedRoomId);
      const malformedExpected = {
        ...checkpointPredecessorOf(initial),
        roomId: malformedRoomId,
      };
      await cleanup.set(malformedKey, malformedRaw);
      await fixedError(writerStore.expire({
        roomId: malformedRoomId,
        expected: malformedExpected,
      }), 'REDIS_ROOM_CHECKPOINT_INVALID');
      if (await cleanup.get(malformedKey) !== malformedRaw) {
        throw new Error('ROOM_REDIS_MALFORMED_CHECKPOINT_MUTATED');
      }

      const legacyCreated = createRoom(legacyRoomId);
      const legacyState = legacyCreated.nextState;
      const legacyKey = roomKey(legacyRoomId);
      await cleanup.set(legacyKey, JSON.stringify({
        checkpointVersion: 1,
        ...checkpointPredecessorOf(legacyState),
        state: legacyState,
      }), { PX: 3_600_000 });
      if (JSON.stringify(await readerStore.load(legacyRoomId)) !== JSON.stringify(legacyState)) {
        throw new Error('ROOM_REDIS_LEGACY_V1_LOAD_FAILED');
      }
      const legacyPublished = publish(legacyState);
      if ((await writerStore.save({ commit: commit(legacyPublished) })).kind !== 'saved') {
        throw new Error('ROOM_REDIS_LEGACY_V1_SAVE_FAILED');
      }
      if ((await writerStore.expire({
        roomId: legacyRoomId,
        expected: checkpointPredecessorOf(legacyPublished.nextState),
      })).kind !== 'expired') {
        throw new Error('ROOM_REDIS_LEGACY_V1_EXPIRE_FAILED');
      }
      const expiringLegacy = JSON.parse(await cleanup.get(legacyKey) || 'null') as unknown;
      if (
        typeof expiringLegacy !== 'object'
        || expiringLegacy === null
        || !('checkpointVersion' in expiringLegacy)
        || expiringLegacy.checkpointVersion !== 2
        || !('expiryFence' in expiringLegacy)
        || expiringLegacy.expiryFence !== 'expiring'
      ) {
        throw new Error('ROOM_REDIS_LEGACY_V1_TOMBSTONE_FAILED');
      }
      await fixedError(writerStore.delete({
        roomId: malformedRoomId,
        expected: malformedExpected,
      }), 'REDIS_ROOM_CHECKPOINT_INVALID');
      if (await cleanup.get(malformedKey) !== malformedRaw) {
        throw new Error('ROOM_REDIS_MALFORMED_CHECKPOINT_MUTATED');
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
      const shortLived = createRoom(ttlRoomId);
      if ((await shortTtlStore.save({ commit: commit(shortLived) })).kind !== 'saved') {
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
        transitionReceipt: true,
        oldEpochFence: true,
        terminalTtl: true,
        monotonicExpiryFence: true,
        expireDelete: true,
        malformedExisting: true,
        baselineV1Compatibility: true,
        ttlExpiry: true,
      }));
    }
  }
} finally {
  await reader.close();
  await writer.close();
  if (!cleanup.isOpen) await cleanup.connect();
  if (phase !== 'write') {
    await cleanup.unlink([
      roomKey(roomId),
      roomKey(ttlRoomId),
      roomKey(epochRoomId),
      roomKey(expiryFenceRoomId),
      roomKey(legacyRoomId),
      roomKey(malformedRoomId),
    ]);
  }
  await cleanup.quit();
}
