import { createHash, randomUUID } from 'node:crypto';

import {
  checkpointPredecessorOf,
  createArenaRoomCheckpointCommit,
  issueArenaRoomRecoveryAuthority,
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
import { createRoomActorRegistry } from '../src/arena-room/room-actor-registry';
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
const THIRD_TIMESTAMP = '2026-08-28T00:02:00.000Z';
const roomId = `room-restart-${token}`;
const ttlRoomId = `room-ttl-${token}`;
const epochRoomId = `room-epoch-${token}`;
const expiryFenceRoomId = `room-expiry-fence-${token}`;
const legacyRoomId = `room-legacy-v1-${token}`;
const legacyRecoveryRoomId = `room-legacy-recovery-${token}`;
const legacyLoadTtlRoomId = `room-legacy-load-ttl-${token}`;
const legacyLoadRaceRoomId = `room-legacy-load-race-${token}`;
const unobservedLegacyRoomId = `room-legacy-unobserved-${token}`;
const malformedRoomId = `room-malformed-${token}`;
const invalidFenceRoomId = `room-invalid-fence-${token}`;
const fullFenceRoomId = `room-full-fence-${token}`;
const invalidDeleteFenceRoomId = `room-invalid-delete-fence-${token}`;
const invalidExpireFenceRoomId = `room-invalid-expire-fence-${token}`;
const fullMutationFenceRoomId = `room-full-mutation-fence-${token}`;
const recoveryRoomId = `room-recovery-${token}`;
const actorRoomId = `room-actor-${token}`;
const ticketJti = `verifier:${token}`;
const roomHash = (id: string): string => createHash('sha256').update(id).digest('hex');
const roomKey = (id: string): string => (
  `mahoshojo:room:v1:${keyPrefix}:${roomHash(id)}:checkpoint`
);
const roomFenceKey = (id: string): string => (
  `mahoshojo:room:v1:${keyPrefix}:${roomHash(id)}:incarnations`
);
const roomKeys = (id: string): string[] => [roomKey(id), roomFenceKey(id)];
const ticketReplayKey = `mahoshojo:room-ticket:v1:${keyPrefix}:${createHash('sha256')
  .update(ticketJti).digest('hex')}`;

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
    deadlines: {
      hostOfflineDeadline: '2026-08-28T00:45:00.000Z',
      roomIdleDeadline: '2026-08-28T12:00:00.000Z',
    },
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

const recover = (
  state: ArenaRoomAuthorityState,
  nextRoomEpoch: string,
): ArenaRoomTransitionSuccess => {
  const absentPresenceDeadlines = {
    hostOfflineDeadline: '2026-08-28T00:46:00.000Z',
    roomIdleDeadline: '2026-08-28T12:01:00.000Z',
  } as const;
  const result = transitionArenaRoom(state, {
    type: 'recover',
    expectedRoomEpoch: state.snapshot.roomEpoch,
    nextRoomEpoch,
    absentPresenceDeadlines,
    timestamp: NEXT_TIMESTAMP,
  }, issueArenaRoomRecoveryAuthority({
    roomId: state.snapshot.roomId,
    previousRoomEpoch: state.snapshot.roomEpoch,
    nextRoomEpoch,
    absentPresenceDeadlines,
    timestamp: NEXT_TIMESTAMP,
  }));
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
    const recoveredRegistry = createRoomActorRegistry({
      store: readerStore,
      createRoomEpoch: () => `restart-recovered-${token}`,
      recoveryTimestamp: () => THIRD_TIMESTAMP,
    });
    const recoveredActor = await recoveredRegistry.recover(roomId);
    const recovered = recoveredActor?.getSnapshot() ?? null;
    if (
      recovered?.snapshot.sharedConfig.userGuidance !== 'restart-recovery-acknowledged'
      || recovered.snapshot.revision !== 1
      || recovered.snapshot.roomEpoch !== `restart-recovered-${token}`
    ) {
      throw new Error('ROOM_REDIS_RESTART_RECOVERY_FAILED');
    }
    const delayedOldMutation = publish(createRoom(roomId).nextState);
    if ((await writerStore.save({ commit: commit(delayedOldMutation) })).kind !== 'conflict') {
      throw new Error('ROOM_REDIS_RESTART_OLD_ACTOR_FENCE_FAILED');
    }
    await recoveredRegistry.shutdown();
    const deleted = await readerStore.delete({ checkpoint: recovered });
    if (deleted.kind !== 'deleted') throw new Error('ROOM_REDIS_RESTART_CLEANUP_FAILED');
    const sameEpochAfterRestartDelete = await readerStore.save({
      commit: commit(createRoom(roomId)),
    });
    if (
      sameEpochAfterRestartDelete.kind !== 'conflict'
      || await cleanup.pTTL(roomFenceKey(roomId)) !== -1
    ) {
      throw new Error('ROOM_REDIS_RESTART_INCARNATION_FENCE_FAILED');
    }
    console.info(JSON.stringify({
      roomRedis: true,
      phase: 'read',
      restartRecovery: true,
      roomActorRestartRecovery: true,
      oldActorFence: true,
      incarnationFence: true,
    }));
  } else if (phase === 'write') {
    const registry = createRoomActorRegistry({
      store: writerStore,
      createRoomIdentity: () => ({ roomId, roomEpoch: 'epoch-1' }),
      createTimestamp: () => TIMESTAMP,
    });
    const created = (await registry.create({
      host: { userId: 'host-1', displayName: 'Host' },
      sharedConfig: sharedConfig(),
      authority: hostAuthority,
    })).result;
    if (!created.ok || created.kind !== 'applied') {
      throw new Error('ROOM_ACTOR_RESTART_WRITE_CREATE_FAILED');
    }
    const mutated = await registry.execute({
      roomId,
      command: {
        type: 'publish-config',
        expectedRoomEpoch: 'epoch-1',
        expectedRevision: 0,
        sharedConfig: { ...sharedConfig(), userGuidance: 'restart-recovery-acknowledged' },
        timestamp: NEXT_TIMESTAMP,
      },
      authority: hostAuthority,
    });
    if (!mutated.ok || mutated.kind !== 'applied') {
      throw new Error('ROOM_ACTOR_RESTART_WRITE_MUTATE_FAILED');
    }
    await registry.shutdown();
    if (JSON.stringify(await readerStore.load(roomId)) !== JSON.stringify(mutated.nextState)) {
      throw new Error('ROOM_ACTOR_RESTART_WRITE_CHECKPOINT_FAILED');
    }
    console.info(JSON.stringify({
      roomRedis: true,
      phase: 'write',
      acknowledged: true,
      roomActorCheckpoint: true,
    }));
  } else {
    const createdTransition = createRoom(roomId);
    const initial = createdTransition.nextState;
    const publishedTransition = publish(initial);
    const acknowledged = structuredClone(publishedTransition.nextState);
    publishedTransition.nextState.snapshot.sharedConfig.userGuidance = 'tampered-old-payload';
    const createdReceipt = commit(createdTransition);
    const created = await writerStore.save({ commit: createdReceipt });
    const duplicateCreate = await readerStore.save({ commit: commit(createRoom(roomId)) });
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

      await cleanup.pExpire(roomKey(roomId), 1_000);
      const refreshed = await writerStore.refresh({ checkpoint: acknowledged });
      const staleRefresh = await readerStore.refresh({ checkpoint: initial });
      const refreshedTtl = await cleanup.pTTL(roomKey(roomId));
      if (
        refreshed.kind !== 'refreshed'
        || staleRefresh.kind !== 'conflict'
        || refreshedTtl < 86_000_000
        || refreshedTtl > 86_400_000
      ) {
        throw new Error('ROOM_REDIS_ACTIVE_TTL_REFRESH_FAILED');
      }

      const firstTicketUse = await writer.getRoomTicketReplayStore().consume({
        jti: ticketJti,
        nowMs: 1_000,
        expiresAtMs: 46_000,
      });
      const replayedTicketUse = await reader.getRoomTicketReplayStore().consume({
        jti: ticketJti,
        nowMs: 2_000,
        expiresAtMs: 46_000,
      });
      const ticketReplayTtl = await cleanup.pTTL(ticketReplayKey);
      if (
        firstTicketUse.kind !== 'consumed'
        || replayedTicketUse.kind !== 'replayed'
        || ticketReplayTtl <= 0
        || ticketReplayTtl > 45_000
      ) {
        throw new Error('ROOM_REDIS_TICKET_REPLAY_FAILED');
      }

      const staleClose = close(initial);
      const staleWriter = await readerStore.save({ commit: commit(staleClose) });
      const counterCollision = structuredClone(acknowledged);
      counterCollision.snapshot.sharedConfig.userGuidance = '';
      const collisionWriter = await readerStore.save({ commit: commit(close(counterCollision)) });
      const collisionExpire = await readerStore.expire({ checkpoint: counterCollision });
      const collisionDelete = await readerStore.delete({ checkpoint: counterCollision });
      const collisionSurvivor = await readerStore.load(roomId);
      await fixedError(writerStore.save({
        commit: {} as ArenaRoomCheckpointCommit,
      }), 'REDIS_ROOM_TRANSITION_COMMIT_INVALID');

      const currentEpoch = createRoom(epochRoomId, 'epoch-2');
      const epochCreated = await writerStore.save({ commit: commit(currentEpoch) });
      const oldEpoch = createRoom(epochRoomId, 'epoch-1');
      const oldEpochOverwrite = await readerStore.save({ commit: commit(close(oldEpoch.nextState)) });
      if (
        staleWriter.kind !== 'conflict'
        || collisionWriter.kind !== 'conflict'
        || collisionExpire.kind !== 'conflict'
        || collisionDelete.kind !== 'conflict'
        || JSON.stringify(collisionSurvivor) !== JSON.stringify(acknowledged)
        || epochCreated.kind !== 'saved'
        || oldEpochOverwrite.kind !== 'conflict'
      ) {
        throw new Error('ROOM_REDIS_CAS_FENCING_FAILED');
      }

      const recoveryCreated = createRoom(recoveryRoomId, 'epoch-recovery-1');
      if ((await writerStore.save({ commit: commit(recoveryCreated) })).kind !== 'saved') {
        throw new Error('ROOM_REDIS_RECOVERY_CREATE_FAILED');
      }
      const delayedOldEpoch = publish(recoveryCreated.nextState);
      const recoveredTransition = recover(recoveryCreated.nextState, 'epoch-recovery-2');
      if ((await writerStore.save({ commit: commit(recoveredTransition) })).kind !== 'saved') {
        throw new Error('ROOM_REDIS_RECOVERY_ROLLOVER_FAILED');
      }
      const delayedRecoveryResult = await writerStore.save({ commit: commit(delayedOldEpoch) });
      const recoveredState = await readerStore.load(recoveryRoomId);
      const reusedEpoch = recover(recoveredTransition.nextState, 'epoch-recovery-1');
      const reusedEpochResult = await writerStore.save({ commit: commit(reusedEpoch) });
      if (
        delayedRecoveryResult.kind !== 'conflict'
        || recoveredState?.snapshot.roomEpoch !== 'epoch-recovery-2'
        || reusedEpochResult.kind !== 'conflict'
      ) {
        throw new Error('ROOM_REDIS_RECOVERY_FENCING_FAILED');
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

      const expired = await writerStore.expire({ checkpoint: closed });
      const firstExpiryTtl = await cleanup.pTTL(roomKey(roomId));
      const repeatedExpire = await writerStore.expire({ checkpoint: closed });
      const repeatedExpiryTtl = await cleanup.pTTL(roomKey(roomId));
      const deleted = await writerStore.delete({ checkpoint: closed });
      const repeatedDelete = await writerStore.delete({ checkpoint: closed });
      await fixedError(
        writerStore.save({ commit: createdReceipt }),
        'REDIS_ROOM_TRANSITION_COMMIT_INVALID',
      );
      const sameEpochAfterDelete = await writerStore.save({
        commit: commit(createRoom(roomId)),
      });
      const incarnationLedgerTtl = await cleanup.pTTL(roomFenceKey(roomId));
      if (
        expired.kind !== 'expired'
        || repeatedExpire.kind !== 'expired'
        || firstExpiryTtl <= 0
        || firstExpiryTtl > 300_000
        || repeatedExpiryTtl <= 0
        || repeatedExpiryTtl > firstExpiryTtl
        || deleted.kind !== 'deleted'
        || repeatedDelete.kind !== 'missing'
        || sameEpochAfterDelete.kind !== 'conflict'
        || incarnationLedgerTtl !== -1
      ) {
        throw new Error('ROOM_REDIS_EXPIRY_DELETE_FAILED');
      }

      const expiryFenceCreated = createRoom(expiryFenceRoomId);
      if ((await writerStore.save({ commit: commit(expiryFenceCreated) })).kind !== 'saved') {
        throw new Error('ROOM_REDIS_EXPIRY_FENCE_CREATE_FAILED');
      }
      if ((await writerStore.expire({ checkpoint: expiryFenceCreated.nextState })).kind !== 'expired') {
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
      const malformedExpected = createRoom(malformedRoomId).nextState;
      await cleanup.set(malformedKey, malformedRaw);
      await fixedError(writerStore.expire({ checkpoint: malformedExpected }), 'REDIS_ROOM_CHECKPOINT_INVALID');
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
      if (!await cleanup.sIsMember(roomFenceKey(legacyRoomId), legacyState.snapshot.roomEpoch)) {
        throw new Error('ROOM_REDIS_LEGACY_V1_LOAD_FENCE_BOOTSTRAP_FAILED');
      }
      const legacyPublished = publish(legacyState);
      if ((await writerStore.save({ commit: commit(legacyPublished) })).kind !== 'saved') {
        throw new Error('ROOM_REDIS_LEGACY_V1_SAVE_FAILED');
      }
      if (!await cleanup.sIsMember(roomFenceKey(legacyRoomId), legacyState.snapshot.roomEpoch)) {
        throw new Error('ROOM_REDIS_LEGACY_V1_FENCE_BOOTSTRAP_FAILED');
      }
      if ((await writerStore.expire({ checkpoint: legacyPublished.nextState })).kind !== 'expired') {
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

      const legacyRecoveryState = createRoom(legacyRecoveryRoomId, 'legacy-epoch-1').nextState;
      await cleanup.set(roomKey(legacyRecoveryRoomId), JSON.stringify({
        checkpointVersion: 1,
        ...checkpointPredecessorOf(legacyRecoveryState),
        state: legacyRecoveryState,
      }), { PX: 3_600_000 });
      const legacyRecoveryRegistry = createRoomActorRegistry({
        store: writerStore,
        createRoomEpoch: () => 'legacy-epoch-2',
        recoveryTimestamp: () => THIRD_TIMESTAMP,
      });
      const legacyRecoveredActor = await legacyRecoveryRegistry.recover(legacyRecoveryRoomId);
      const legacyRecovered = legacyRecoveredActor?.getSnapshot() ?? null;
      if (
        legacyRecovered?.snapshot.roomEpoch !== 'legacy-epoch-2'
        || !await cleanup.sIsMember(roomFenceKey(legacyRecoveryRoomId), 'legacy-epoch-1')
        || !await cleanup.sIsMember(roomFenceKey(legacyRecoveryRoomId), 'legacy-epoch-2')
      ) {
        throw new Error('ROOM_REDIS_LEGACY_RECOVERY_FENCE_BOOTSTRAP_FAILED');
      }
      await legacyRecoveryRegistry.shutdown();
      if ((await writerStore.delete({ checkpoint: legacyRecovered })).kind !== 'deleted') {
        throw new Error('ROOM_REDIS_LEGACY_RECOVERY_DELETE_FAILED');
      }
      if ((await writerStore.save({
        commit: commit(createRoom(legacyRecoveryRoomId, 'legacy-epoch-1')),
      })).kind !== 'conflict') {
        throw new Error('ROOM_REDIS_LEGACY_RECOVERY_RESURRECTION_FAILED');
      }
      await fixedError(writerStore.delete({ checkpoint: malformedExpected }), 'REDIS_ROOM_CHECKPOINT_INVALID');
      if (await cleanup.get(malformedKey) !== malformedRaw) {
        throw new Error('ROOM_REDIS_MALFORMED_CHECKPOINT_MUTATED');
      }

      await cleanup.set(roomFenceKey(invalidFenceRoomId), 'provider-secret-canary');
      await fixedError(
        writerStore.save({ commit: commit(createRoom(invalidFenceRoomId)) }),
        'REDIS_ROOM_INCARNATION_FENCE_INVALID',
      );
      if (
        await cleanup.get(roomKey(invalidFenceRoomId)) !== null
        || await cleanup.get(roomFenceKey(invalidFenceRoomId)) !== 'provider-secret-canary'
      ) {
        throw new Error('ROOM_REDIS_INVALID_INCARNATION_FENCE_MUTATED');
      }

      await cleanup.sAdd(
        roomFenceKey(fullFenceRoomId),
        Array.from({ length: 16 }, (_, index) => `used-epoch-${index}`),
      );
      const fullFenceMembers = (await cleanup.sMembers(roomFenceKey(fullFenceRoomId))).sort();
      await fixedError(
        writerStore.save({ commit: commit(createRoom(fullFenceRoomId, 'epoch-17')) }),
        'REDIS_ROOM_INCARNATION_LIMIT',
      );
      if (
        await cleanup.get(roomKey(fullFenceRoomId)) !== null
        || JSON.stringify((await cleanup.sMembers(roomFenceKey(fullFenceRoomId))).sort())
          !== JSON.stringify(fullFenceMembers)
      ) {
        throw new Error('ROOM_REDIS_FULL_INCARNATION_FENCE_MUTATED');
      }

      const invalidDeleteCreated = createRoom(invalidDeleteFenceRoomId);
      await writerStore.save({ commit: commit(invalidDeleteCreated) });
      const invalidDeleteCheckpointRaw = await cleanup.get(roomKey(invalidDeleteFenceRoomId));
      await cleanup.unlink(roomFenceKey(invalidDeleteFenceRoomId));
      await cleanup.set(roomFenceKey(invalidDeleteFenceRoomId), 'delete-fence-canary');
      await fixedError(
        writerStore.delete({ checkpoint: invalidDeleteCreated.nextState }),
        'REDIS_ROOM_INCARNATION_FENCE_INVALID',
      );
      if (
        await cleanup.get(roomKey(invalidDeleteFenceRoomId)) !== invalidDeleteCheckpointRaw
        || await cleanup.get(roomFenceKey(invalidDeleteFenceRoomId)) !== 'delete-fence-canary'
      ) {
        throw new Error('ROOM_REDIS_INVALID_DELETE_FENCE_MUTATED');
      }

      const invalidExpireCreated = createRoom(invalidExpireFenceRoomId);
      await writerStore.save({ commit: commit(invalidExpireCreated) });
      await writerStore.expire({ checkpoint: invalidExpireCreated.nextState });
      const invalidExpireCheckpointRaw = await cleanup.get(roomKey(invalidExpireFenceRoomId));
      await cleanup.unlink(roomFenceKey(invalidExpireFenceRoomId));
      await cleanup.set(roomFenceKey(invalidExpireFenceRoomId), 'expire-fence-canary');
      await fixedError(
        writerStore.expire({ checkpoint: invalidExpireCreated.nextState }),
        'REDIS_ROOM_INCARNATION_FENCE_INVALID',
      );
      if (
        await cleanup.get(roomKey(invalidExpireFenceRoomId)) !== invalidExpireCheckpointRaw
        || await cleanup.get(roomFenceKey(invalidExpireFenceRoomId)) !== 'expire-fence-canary'
      ) {
        throw new Error('ROOM_REDIS_INVALID_EXPIRE_FENCE_MUTATED');
      }

      const fullMutationCreated = createRoom(fullMutationFenceRoomId, 'current-epoch');
      await writerStore.save({ commit: commit(fullMutationCreated) });
      const fullMutationCheckpointRaw = await cleanup.get(roomKey(fullMutationFenceRoomId));
      await cleanup.unlink(roomFenceKey(fullMutationFenceRoomId));
      const fullMutationMembers = Array.from(
        { length: 16 },
        (_, index) => `other-epoch-${index}`,
      ).sort();
      await cleanup.sAdd(roomFenceKey(fullMutationFenceRoomId), fullMutationMembers);
      await fixedError(
        writerStore.delete({ checkpoint: fullMutationCreated.nextState }),
        'REDIS_ROOM_INCARNATION_LIMIT',
      );
      await fixedError(
        writerStore.expire({ checkpoint: fullMutationCreated.nextState }),
        'REDIS_ROOM_INCARNATION_LIMIT',
      );
      if (
        await cleanup.get(roomKey(fullMutationFenceRoomId)) !== fullMutationCheckpointRaw
        || JSON.stringify((await cleanup.sMembers(roomFenceKey(fullMutationFenceRoomId))).sort())
          !== JSON.stringify(fullMutationMembers)
      ) {
        throw new Error('ROOM_REDIS_FULL_MUTATION_FENCE_MUTATED');
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
      const delayedCreateReceipt = commit(createRoom(ttlRoomId));
      const legacyLoadRaceState = createRoom(
        legacyLoadRaceRoomId,
        'legacy-load-race-epoch',
      ).nextState;
      await cleanup.set(roomKey(legacyLoadRaceRoomId), JSON.stringify({
        checkpointVersion: 1,
        ...checkpointPredecessorOf(legacyLoadRaceState),
        state: legacyLoadRaceState,
      }), { PX: 1_000 });
      let deleteLegacyRaceAfterGet = true;
      const legacyLoadRaceStore = createRedisRoomStore({
        keyPrefix,
        getClient: () => ({
          eval: (script, options) => cleanup.eval(script, options),
          get: async (key) => {
            const value = await cleanup.get(key);
            if (key === roomKey(legacyLoadRaceRoomId) && deleteLegacyRaceAfterGet) {
              deleteLegacyRaceAfterGet = false;
              await cleanup.del(key);
            }
            return typeof value === 'string' ? value : null;
          },
        } satisfies RedisRoomClient),
      });
      if (await legacyLoadRaceStore.load(legacyLoadRaceRoomId) !== null) {
        throw new Error('ROOM_REDIS_LEGACY_LOAD_EXPIRY_RACE_FAILED');
      }
      if (!await cleanup.sIsMember(
        roomFenceKey(legacyLoadRaceRoomId),
        legacyLoadRaceState.snapshot.roomEpoch,
      )) {
        throw new Error('ROOM_REDIS_LEGACY_LOAD_EXPIRY_RACE_FENCE_MISSING');
      }
      if ((await legacyLoadRaceStore.save({
        commit: commit(createRoom(legacyLoadRaceRoomId, 'legacy-load-race-epoch')),
      })).kind !== 'conflict') {
        throw new Error('ROOM_REDIS_LEGACY_LOAD_EXPIRY_RACE_RESURRECTION_FAILED');
      }
      const legacyLoadTtlState = createRoom(legacyLoadTtlRoomId, 'legacy-load-epoch').nextState;
      const unobservedLegacyState = createRoom(
        unobservedLegacyRoomId,
        'legacy-unobserved-epoch',
      ).nextState;
      await cleanup.set(roomKey(unobservedLegacyRoomId), JSON.stringify({
        checkpointVersion: 1,
        ...checkpointPredecessorOf(unobservedLegacyState),
        state: unobservedLegacyState,
      }), { PX: 1_000 });
      await cleanup.set(roomKey(legacyLoadTtlRoomId), JSON.stringify({
        checkpointVersion: 1,
        ...checkpointPredecessorOf(legacyLoadTtlState),
        state: legacyLoadTtlState,
      }), { PX: 1_000 });
      if (JSON.stringify(await shortTtlStore.load(legacyLoadTtlRoomId))
        !== JSON.stringify(legacyLoadTtlState)) {
        throw new Error('ROOM_REDIS_LEGACY_LOAD_TTL_BOOTSTRAP_FAILED');
      }
      if (!await cleanup.sIsMember(
        roomFenceKey(legacyLoadTtlRoomId),
        legacyLoadTtlState.snapshot.roomEpoch,
      )) {
        throw new Error('ROOM_REDIS_LEGACY_LOAD_TTL_FENCE_MISSING');
      }
      const shortLived = createRoom(ttlRoomId);
      if ((await shortTtlStore.save({ commit: commit(shortLived) })).kind !== 'saved') {
        throw new Error('ROOM_REDIS_SHORT_TTL_CREATE_FAILED');
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 2_100));
      if (await shortTtlStore.load(ttlRoomId) !== null) {
        throw new Error('ROOM_REDIS_TTL_EXPIRY_FAILED');
      }
      if (await shortTtlStore.load(legacyLoadTtlRoomId) !== null) {
        throw new Error('ROOM_REDIS_LEGACY_LOAD_TTL_EXPIRY_FAILED');
      }
      if (await cleanup.get(roomKey(unobservedLegacyRoomId)) !== null) {
        throw new Error('ROOM_REDIS_UNOBSERVED_LEGACY_TTL_EXPIRY_FAILED');
      }
      const untrustedCreateRegistry = createRoomActorRegistry({ store: shortTtlStore });
      await fixedError(untrustedCreateRegistry.execute({
        roomId: unobservedLegacyRoomId,
        command: {
          type: 'create',
          roomId: unobservedLegacyRoomId,
          roomEpoch: 'legacy-unobserved-epoch',
          host: {
            userId: 'host-1',
            role: 'host',
            displayName: 'Host',
            membershipState: 'active',
            joinedAt: TIMESTAMP,
          },
          sharedConfig: sharedConfig(),
          deadlines: {
            hostOfflineDeadline: '2026-08-28T00:45:00.000Z',
            roomIdleDeadline: '2026-08-28T12:00:00.000Z',
          },
          timestamp: TIMESTAMP,
        },
        authority: hostAuthority,
      }), 'ROOM_ACTOR_CREATE_REQUIRES_SERVER_IDENTITY');
      await untrustedCreateRegistry.shutdown();
      if (
        await cleanup.get(roomKey(unobservedLegacyRoomId)) !== null
        || await cleanup.exists(roomFenceKey(unobservedLegacyRoomId)) !== 0
      ) {
        throw new Error('ROOM_REDIS_UNTRUSTED_CREATE_MUTATED_EXPIRED_LEGACY');
      }
      if ((await shortTtlStore.save({
        commit: commit(createRoom(legacyLoadTtlRoomId, 'legacy-load-epoch')),
      })).kind !== 'conflict') {
        throw new Error('ROOM_REDIS_LEGACY_LOAD_TTL_RESURRECTION_FAILED');
      }
      const ttlResurrection = await shortTtlStore.save({
        commit: delayedCreateReceipt,
      });
      if (
        ttlResurrection.kind !== 'conflict'
        || await cleanup.pTTL(roomFenceKey(ttlRoomId)) !== -1
      ) {
        throw new Error('ROOM_REDIS_TTL_INCARNATION_FENCE_FAILED');
      }
      const nextIncarnation = await shortTtlStore.save({
        commit: commit(createRoom(ttlRoomId, 'epoch-2')),
      });
      if (nextIncarnation.kind !== 'saved') {
        throw new Error('ROOM_REDIS_NEW_INCARNATION_FAILED');
      }

      const oldActorRegistry = createRoomActorRegistry({
        store: writerStore,
        createRoomIdentity: () => ({
          roomId: actorRoomId,
          roomEpoch: 'actor-epoch-1',
        }),
        createTimestamp: () => TIMESTAMP,
      });
      const actorCreated = (await oldActorRegistry.create({
        host: { userId: 'host-1', displayName: 'Host' },
        sharedConfig: sharedConfig(),
        authority: hostAuthority,
      })).result;
      if (!actorCreated.ok) throw new Error('ROOM_ACTOR_CREATE_FAILED');
      const recoveredActorRegistry = createRoomActorRegistry({
        store: readerStore,
        createRoomEpoch: () => 'actor-epoch-2',
        recoveryTimestamp: () => NEXT_TIMESTAMP,
      });
      const recoveredActor = await recoveredActorRegistry.recover(actorRoomId);
      if (recoveredActor?.getSnapshot()?.snapshot.roomEpoch !== 'actor-epoch-2') {
        throw new Error('ROOM_ACTOR_WARM_RECOVERY_FAILED');
      }
      await fixedError(oldActorRegistry.execute({
        roomId: actorRoomId,
        command: {
          type: 'publish-config',
          expectedRoomEpoch: 'actor-epoch-1',
          expectedRevision: 0,
          sharedConfig: { ...sharedConfig(), userGuidance: 'late-old-actor' },
          timestamp: NEXT_TIMESTAMP,
        },
        authority: hostAuthority,
      }), 'ROOM_ACTOR_CHECKPOINT_CONFLICT');
      if ((await readerStore.load(actorRoomId))?.snapshot.roomEpoch !== 'actor-epoch-2') {
        throw new Error('ROOM_ACTOR_OLD_WRITER_MUTATED_RECOVERY');
      }
      await Promise.all([oldActorRegistry.shutdown(), recoveredActorRegistry.shutdown()]);
      console.info(JSON.stringify({
        roomRedis: true,
        phase: 'full',
        createLoadMutate: true,
        stalePredecessor: true,
        transitionReceipt: true,
        oneShotReceipt: true,
        incarnationFence: true,
        persistentIncarnationLedger: true,
        newEpochAfterExpiry: true,
        incarnationFenceFailClosed: true,
        destructiveFenceFailClosed: true,
        fullPredecessorFence: true,
        oldEpochFence: true,
        recoveryEpochRollover: true,
        legacyRecoveryPredecessorFence: true,
        legacyLoadFenceBootstrap: true,
        legacyLoadExpiryRaceFence: true,
        serverIssuedRoomIdentity: true,
        roomActorWarmRecovery: true,
        roomActorOldWriterFence: true,
        activeTtlRefresh: true,
        ticketReplay: true,
        terminalTtl: true,
        monotonicExpiryFence: true,
        expireDelete: true,
        malformedExisting: true,
        baselineV1Compatibility: true,
        ttlExpiry: true,
      }));
  }
} finally {
  await reader.close();
  await writer.close();
  if (!cleanup.isOpen) await cleanup.connect();
  if (phase !== 'write') {
    await cleanup.unlink([
      ...roomKeys(roomId),
      ...roomKeys(ttlRoomId),
      ...roomKeys(epochRoomId),
      ...roomKeys(expiryFenceRoomId),
      ...roomKeys(legacyRoomId),
      ...roomKeys(legacyRecoveryRoomId),
      ...roomKeys(legacyLoadTtlRoomId),
      ...roomKeys(legacyLoadRaceRoomId),
      ...roomKeys(unobservedLegacyRoomId),
      ...roomKeys(malformedRoomId),
      ...roomKeys(invalidFenceRoomId),
      ...roomKeys(fullFenceRoomId),
      ...roomKeys(invalidDeleteFenceRoomId),
      ...roomKeys(invalidExpireFenceRoomId),
      ...roomKeys(fullMutationFenceRoomId),
      ...roomKeys(recoveryRoomId),
      ...roomKeys(actorRoomId),
      ticketReplayKey,
    ]);
  }
  await cleanup.quit();
}
