import { createHash, randomUUID } from 'node:crypto';

import { ARENA_ROOM_WEBSOCKET_PROTOCOL } from '@mahoshojo/contracts/arena-room';

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
import type {
  D1RoomDirectoryStore,
  RoomDirectoryRecord,
} from '../src/arena-room/d1-room-directory-store';
import { createRoomActorRegistry } from '../src/arena-room/room-actor-registry';
import { createArenaRoomDirectoryService } from '../src/arena-room/room-directory-service';
import {
  createRedisRoomDirectoryRegistrationStore,
} from '../src/arena-room/redis-room-directory-registration-store';
import { createArenaRoomMembershipService } from '../src/arena-room/room-membership-service';
import { createArenaRoomProposalService } from '../src/arena-room/room-proposal-service';
import {
  createArenaRoomTicketCodec,
  createArenaRoomTicketSignatureService,
} from '../src/arena-room/room-ticket';
import {
  createArenaRoomWebSocketAuthority,
} from '../src/arena-room/room-websocket-authority';
import {
  ARENA_ROOM_WEBSOCKET_PATH,
  RoomWebSocketGateway,
} from '../src/arena-room/room-websocket-gateway';
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
const nowAt = (timestamp: string) => () => Date.parse(timestamp);
const roomId = `room-restart-${token}`;
const ttlRoomId = `room-ttl-${token}`;
const epochRoomId = `room-epoch-${token}`;
const expiryFenceRoomId = `room-expiry-fence-${token}`;
const legacyRoomId = `room-legacy-v1-${token}`;
const legacyAuthorityRoomId = `room-authority-v1-${token}`;
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
const proposalRoomId = `room-proposal-${token}`;
const authorityRoomId = `room-authority-${token}`;
const directoryRegistrationRoomId = `room-directory-registration-${token}`;
const directoryPendingRoomId = `room-directory-pending-${token}`;
const directoryPendingRaceRoomId = `room-directory-pending-race-${token}`;
const directoryMalformedRaceRoomId = `room-directory-malformed-race-${token}`;
const directoryLegacyRoomId = `room-directory-legacy-${token}`;
const ticketJti = `verifier:${token}`;
const authorityTicketJti = `authority:${token}`;
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
const authorityTicketReplayKey = `mahoshojo:room-ticket:v1:${keyPrefix}:${createHash('sha256')
  .update(authorityTicketJti).digest('hex')}`;
const directoryRegistrationMember = roomHash(directoryRegistrationRoomId);
const directoryRegistrationPrefix = `mahoshojo:room-directory-registration:v2:${keyPrefix}`;
const directoryRegistrationKey = `${directoryRegistrationPrefix}:entry:${directoryRegistrationMember}`;
const directoryRegistrationIndexKey = `${directoryRegistrationPrefix}:index`;
const directoryPendingMember = roomHash(directoryPendingRoomId);
const directoryPendingKey = `${directoryRegistrationPrefix}:entry:${directoryPendingMember}`;
const directoryPendingRaceMember = roomHash(directoryPendingRaceRoomId);
const directoryPendingRaceKey = `${directoryRegistrationPrefix}:entry:${directoryPendingRaceMember}`;
const directoryMalformedRaceMember = roomHash(directoryMalformedRaceRoomId);
const directoryMalformedRaceKey = `${directoryRegistrationPrefix}:entry:${directoryMalformedRaceMember}`;
const directoryLegacyMember = roomHash(directoryLegacyRoomId);
const directoryLegacyV1Prefix = `mahoshojo:room-directory-registration:v1:${keyPrefix}`;
const directoryLegacyV1Key = `${directoryLegacyV1Prefix}:entry:${directoryLegacyMember}`;
const directoryLegacyV1IndexKey = `${directoryLegacyV1Prefix}:index`;
const directoryLegacyV2Key = `${directoryRegistrationPrefix}:entry:${directoryLegacyMember}`;

const eventually = async (check: () => boolean | Promise<boolean>): Promise<void> => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await check()) return;
    await new Promise<void>((resolve) => { setTimeout(resolve, 10); });
  }
  throw new Error('ROOM_REDIS_EVENTUALLY_TIMEOUT');
};

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
    const replayNow = Date.now();
    const persistedTicket = await reader.getRoomTicketReplayStore().consume({
      jti: ticketJti,
      nowMs: replayNow,
      expiresAtMs: replayNow + 60_000,
    });
    if (persistedTicket.kind !== 'replayed') {
      throw new Error('ROOM_REDIS_RESTART_TICKET_REPLAY_FAILED');
    }
    const recoveredRegistry = createRoomActorRegistry({
      store: readerStore,
      createRoomEpoch: () => `restart-recovered-${token}`,
      recoveryTimestamp: () => THIRD_TIMESTAMP,
      now: nowAt(THIRD_TIMESTAMP),
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
      ticketReplayAfterRestart: true,
    }));
  } else if (phase === 'write') {
    const registry = createRoomActorRegistry({
      store: writerStore,
      createRoomIdentity: () => ({ roomId, roomEpoch: 'epoch-1' }),
      createTimestamp: () => TIMESTAMP,
      now: nowAt(NEXT_TIMESTAMP),
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
    const replayNow = Date.now();
    const consumedTicket = await writer.getRoomTicketReplayStore().consume({
      jti: ticketJti,
      nowMs: replayNow,
      expiresAtMs: replayNow + 60_000,
    });
    if (consumedTicket.kind !== 'consumed') {
      throw new Error('ROOM_REDIS_RESTART_TICKET_WRITE_FAILED');
    }
    console.info(JSON.stringify({
      roomRedis: true,
      phase: 'write',
      acknowledged: true,
      roomActorCheckpoint: true,
      ticketReplayPersisted: true,
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

      const legacyAuthorityV2 = createRoom(legacyAuthorityRoomId).nextState;
      const legacyAuthorityV1 = structuredClone(legacyAuthorityV2) as unknown as Record<string, unknown>;
      legacyAuthorityV1.authorityStateVersion = 1;
      delete legacyAuthorityV1.deadlines;
      await cleanup.set(roomKey(legacyAuthorityRoomId), JSON.stringify({
        checkpointVersion: 1,
        ...checkpointPredecessorOf(legacyAuthorityV2),
        state: legacyAuthorityV1,
      }), { PX: 3_600_000 });
      const migratedAuthority = await readerStore.load(legacyAuthorityRoomId);
      const migratedAuthorityRaw = JSON.parse(
        await cleanup.get(roomKey(legacyAuthorityRoomId)) || 'null',
      ) as { state?: { authorityStateVersion?: number } } | null;
      if (
        migratedAuthority?.authorityStateVersion !== 2
        || migratedAuthority.deadlines.hostOfflineDeadline !== migratedAuthority.lifecycle.updatedAt
        || migratedAuthorityRaw?.state?.authorityStateVersion !== 2
      ) {
        throw new Error('ROOM_REDIS_AUTHORITY_V1_MIGRATION_FAILED');
      }
      const legacyAuthorityRegistry = createRoomActorRegistry({
        store: writerStore,
        now: () => Date.parse(NEXT_TIMESTAMP),
      });
      const legacyAuthorityActor = await legacyAuthorityRegistry.recover(legacyAuthorityRoomId);
      const legacyAuthoritySnapshot = legacyAuthorityActor?.getSnapshot();
      if (
        legacyAuthoritySnapshot?.lifecycle.status !== 'closed'
        || legacyAuthoritySnapshot.lifecycle.closeReason !== 'host-offline-timeout'
      ) {
        throw new Error('ROOM_REDIS_AUTHORITY_V1_FAIL_CLOSED_FAILED');
      }
      await legacyAuthorityRegistry.shutdown();

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
        now: nowAt(THIRD_TIMESTAMP),
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
        now: nowAt(NEXT_TIMESTAMP),
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
        now: nowAt(NEXT_TIMESTAMP),
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

      const proposalActors = createRoomActorRegistry({
        store: writerStore,
        createRoomIdentity: () => ({
          roomId: proposalRoomId,
          roomEpoch: 'proposal-epoch-1',
        }),
        createTimestamp: () => TIMESTAMP,
        now: nowAt(THIRD_TIMESTAMP),
      });
      let proposalUserIndex = 0;
      const proposalMemberships = createArenaRoomMembershipService({
        actors: proposalActors,
        createUserId: () => `proposal-user-${++proposalUserIndex}`,
        now: () => NEXT_TIMESTAMP,
      });
      const proposalHost = await proposalMemberships.create({
        accountUserId: 101,
        displayName: 'Proposal host',
        sharedConfig: sharedConfig(),
      });
      await proposalMemberships.join({
        roomId: proposalHost.roomId,
        accountUserId: 202,
        displayName: 'Proposal member',
      });
      const proposalService = createArenaRoomProposalService({
        memberships: proposalMemberships,
        references: { verify: async ({ refs }) => refs },
        now: () => THIRD_TIMESTAMP,
      });
      const proposalSubmitted = await proposalService.submit({
        roomId: proposalRoomId,
        accountUserId: 202,
        request: {
          proposalId: 'redis-proposal-1',
          expectedRoomEpoch: proposalHost.roomEpoch,
          baseRevision: 0,
          changes: [{
            changeId: 'guidance-1',
            type: 'setUserGuidance',
            value: 'redis-proposal-applied',
            expectedBase: { kind: 'value', value: '' },
          }],
        },
      });
      if (
        proposalSubmitted.status !== 'submitted'
        || (await readerStore.load(proposalRoomId))?.snapshot.proposals[0]?.proposalId
          !== 'redis-proposal-1'
      ) {
        throw new Error('ROOM_REDIS_PROPOSAL_SUBMIT_FAILED');
      }
      const proposalResolved = await proposalService.resolve({
        roomId: proposalRoomId,
        proposalId: 'redis-proposal-1',
        accountUserId: 101,
        request: {
          expectedRoomEpoch: proposalHost.roomEpoch,
          expectedRevision: 0,
          resolution: 'accept-selected',
          selectedChangeIds: ['guidance-1'],
        },
      });
      const persistedProposalResolution = await readerStore.load(proposalRoomId);
      if (
        proposalResolved.status !== 'accepted'
        || proposalResolved.revision !== 1
        || persistedProposalResolution?.snapshot.sharedConfig.userGuidance
          !== 'redis-proposal-applied'
        || persistedProposalResolution.snapshot.proposals.length !== 0
      ) {
        throw new Error('ROOM_REDIS_PROPOSAL_RESOLVE_FAILED');
      }
      await proposalActors.shutdown();

      const directoryRegistrations = writer.getRoomDirectoryRegistrationStore();
      const directoryRegistration = {
        roomId: directoryRegistrationRoomId,
        roomEpoch: 'directory-epoch-1',
        hostUserId: 101,
        title: 'Redis verifier directory',
        visibility: 'public' as const,
        status: 'open' as const,
        createdAt: TIMESTAMP,
        lastActivityAt: NEXT_TIMESTAMP,
      };
      await directoryRegistrations.prepare({
        record: directoryRegistration,
        preparedAtMs: Date.parse(TIMESTAMP),
      });
      await directoryRegistrations.prepare({
        record: directoryRegistration,
        preparedAtMs: Date.parse(TIMESTAMP),
      });
      const storedDirectoryRegistration = await directoryRegistrations.get(
        directoryRegistrationRoomId,
      );
      if (
        storedDirectoryRegistration === null
        || storedDirectoryRegistration.targetRoomEpoch !== 'directory-epoch-1'
        || storedDirectoryRegistration.projectedRoomEpoch !== null
        || storedDirectoryRegistration.phase !== 'pending-create'
      ) {
        throw new Error('ROOM_DIRECTORY_REGISTRATION_PREPARE_FAILED');
      }
      if ((await directoryRegistrations.advanceTarget({
        roomId: directoryRegistrationRoomId,
        previousTargetRoomEpoch: 'directory-epoch-1',
        targetRoomEpoch: 'directory-epoch-2',
        lastActivityAt: THIRD_TIMESTAMP,
        updatedAtMs: Date.parse(THIRD_TIMESTAMP),
      })).kind !== 'advanced') {
        throw new Error('ROOM_DIRECTORY_REGISTRATION_ADVANCE_FAILED');
      }
      if ((await directoryRegistrations.advanceTarget({
        roomId: directoryRegistrationRoomId,
        previousTargetRoomEpoch: 'directory-epoch-1',
        targetRoomEpoch: 'directory-stale-epoch',
        lastActivityAt: THIRD_TIMESTAMP,
        updatedAtMs: Date.parse(THIRD_TIMESTAMP),
      })).kind !== 'stale') {
        throw new Error('ROOM_DIRECTORY_REGISTRATION_STALE_ADVANCE_FAILED');
      }
      const listedDirectoryRegistration = (await directoryRegistrations.list({ limit: 50 }))
        .find((entry) => entry.roomId === directoryRegistrationRoomId);
      if (
        listedDirectoryRegistration?.targetRoomEpoch !== 'directory-epoch-2'
        || listedDirectoryRegistration.projectedRoomEpoch !== 'directory-epoch-1'
        || listedDirectoryRegistration.phase !== 'projecting'
      ) {
        throw new Error('ROOM_DIRECTORY_REGISTRATION_LIST_FAILED');
      }
      if ((await directoryRegistrations.confirmProjected({
        roomId: directoryRegistrationRoomId,
        targetRoomEpoch: 'directory-epoch-2',
        updatedAtMs: Date.parse(THIRD_TIMESTAMP),
        score: Date.parse(THIRD_TIMESTAMP),
      })).kind !== 'confirmed') {
        throw new Error('ROOM_DIRECTORY_REGISTRATION_CONFIRM_FAILED');
      }
      if ((await directoryRegistrations.delete({
        roomId: directoryRegistrationRoomId,
        targetRoomEpoch: 'directory-epoch-1',
        phase: 'closing',
      })).kind !== 'stale') {
        throw new Error('ROOM_DIRECTORY_REGISTRATION_STALE_DELETE_FAILED');
      }
      if ((await directoryRegistrations.markClosing({
        roomId: directoryRegistrationRoomId,
        targetRoomEpoch: 'directory-epoch-2',
        updatedAtMs: Date.parse(THIRD_TIMESTAMP),
        score: Date.parse(THIRD_TIMESTAMP),
        authorityState: null,
      })).kind !== 'marked') {
        throw new Error('ROOM_DIRECTORY_REGISTRATION_MARK_CLOSING_FAILED');
      }
      if ((await directoryRegistrations.delete({
        roomId: directoryRegistrationRoomId,
        targetRoomEpoch: 'directory-epoch-2',
        phase: 'closing',
      })).kind !== 'deleted') {
        throw new Error('ROOM_DIRECTORY_REGISTRATION_DELETE_FAILED');
      }

      const legacyDirectoryRegistration = {
        ...directoryRegistration,
        roomId: directoryLegacyRoomId,
        roomEpoch: 'directory-legacy-epoch-1',
      };
      await cleanup.set(directoryLegacyV1Key, JSON.stringify(legacyDirectoryRegistration));
      await cleanup.zAdd(directoryLegacyV1IndexKey, {
        score: Date.parse(legacyDirectoryRegistration.createdAt),
        value: directoryLegacyMember,
      });
      const migratedLegacyDirectory = (await directoryRegistrations.list({ limit: 50 }))
        .find((entry) => entry.roomId === directoryLegacyRoomId);
      if (
        migratedLegacyDirectory?.phase !== 'pending-create'
        || migratedLegacyDirectory.targetRoomEpoch !== 'directory-legacy-epoch-1'
        || migratedLegacyDirectory.projectedRoomEpoch !== null
        || await cleanup.get(directoryLegacyV1Key) !== null
        || await cleanup.zScore(directoryLegacyV1IndexKey, directoryLegacyMember) !== null
        || await cleanup.get(directoryLegacyV2Key) === null
      ) {
        throw new Error('ROOM_DIRECTORY_REGISTRATION_V1_MIGRATION_FAILED');
      }
      const repeatedLegacyDirectory = (await directoryRegistrations.list({ limit: 50 }))
        .find((entry) => entry.roomId === directoryLegacyRoomId);
      if (
        repeatedLegacyDirectory?.targetRoomEpoch !== 'directory-legacy-epoch-1'
        || await cleanup.get(directoryLegacyV1Key) !== null
        || await cleanup.zScore(directoryLegacyV1IndexKey, directoryLegacyMember) !== null
      ) {
        throw new Error('ROOM_DIRECTORY_REGISTRATION_V1_LIST_NOT_IDEMPOTENT');
      }
      await directoryRegistrations.markClosing({
        roomId: directoryLegacyRoomId,
        targetRoomEpoch: 'directory-legacy-epoch-1',
        updatedAtMs: Date.parse(THIRD_TIMESTAMP),
        score: Date.parse(THIRD_TIMESTAMP),
        authorityState: null,
      });
      await directoryRegistrations.delete({
        roomId: directoryLegacyRoomId,
        targetRoomEpoch: 'directory-legacy-epoch-1',
        phase: 'closing',
      });

      const directoryRows = new Map<string, RoomDirectoryRecord>();
      let failDirectoryRead = false;
      let failDirectoryDelete = false;
      const directoryD1: D1RoomDirectoryStore = {
        async upsertOpen(input) {
          const current = directoryRows.get(input.roomId);
          if (
            current === undefined
            || (current.roomEpoch === input.roomEpoch
              && current.lastActivityAt <= input.lastActivityAt)
          ) directoryRows.set(input.roomId, structuredClone(input));
        },
        async rebindEpoch(input) {
          const current = directoryRows.get(input.roomId);
          if (
            current?.roomEpoch === input.previousRoomEpoch
            && current.hostUserId === input.hostUserId
          ) {
            directoryRows.set(input.roomId, {
              ...current,
              roomEpoch: input.nextRoomEpoch,
              lastActivityAt: current.lastActivityAt > input.lastActivityAt
                ? current.lastActivityAt
                : input.lastActivityAt,
            });
          }
        },
        async delete(input) {
          if (failDirectoryDelete) throw new Error('ROOM_DIRECTORY_D1_DELETE_FAULT_INJECTED');
          if (directoryRows.get(input.roomId)?.roomEpoch === input.roomEpoch) {
            directoryRows.delete(input.roomId);
          }
        },
        async get(inputRoomId) {
          if (failDirectoryRead) throw new Error('ROOM_DIRECTORY_D1_FAULT_INJECTED');
          const current = directoryRows.get(inputRoomId);
          return current === undefined ? null : structuredClone(current);
        },
        async listPublic() { return []; },
        async listByHost() { return []; },
        async listReconciliationCandidates() { return []; },
      };
      let failDirectoryConfirm = true;
      const faultingDirectoryRegistrations = createRedisRoomDirectoryRegistrationStore({
        keyPrefix,
        getClient: () => ({
          async eval(script, options) {
            if (
              failDirectoryConfirm
              && script.includes('ROOM_DIRECTORY_REGISTRATION_CONFIRM_PROJECTED_V2')
            ) {
              throw new Error('ROOM_DIRECTORY_CONFIRM_EVAL_FAULT_INJECTED');
            }
            return cleanup.eval(script, options);
          },
        }),
      });
      const directory = createArenaRoomDirectoryService({
        authority: writerStore,
        registrations: faultingDirectoryRegistrations,
        store: directoryD1,
        now: nowAt(NEXT_TIMESTAMP),
      });
      const firstDirectoryActors = createRoomActorRegistry({
        store: writerStore,
        createRoomIdentity: () => ({
          roomId: directoryRegistrationRoomId,
          roomEpoch: 'directory-epoch-1',
        }),
        createTimestamp: () => TIMESTAMP,
        now: nowAt(NEXT_TIMESTAMP),
        prepareCreatedOpen: directory.prepareCreatedOpen,
        onCommittedRecovered: directory.rebindCommittedOpen,
        onCommittedClosed: directory.removeCommittedClosed,
      });
      const directoryMemberships = createArenaRoomMembershipService({
        actors: firstDirectoryActors,
        createUserId: () => 'directory-host-1',
        directory,
      });
      await directoryMemberships.create({
        accountUserId: 101,
        displayName: 'Directory host',
        sharedConfig: sharedConfig(),
        directory: { title: 'Redis recovery directory', visibility: 'public' },
      });
      if (directoryRows.get(directoryRegistrationRoomId)?.roomEpoch !== 'directory-epoch-1') {
        throw new Error('ROOM_DIRECTORY_INITIAL_PROJECTION_FAILED');
      }
      const unconfirmedInitialProjection = await directoryRegistrations.get(
        directoryRegistrationRoomId,
      );
      if (
        unconfirmedInitialProjection?.phase !== 'projecting'
        || unconfirmedInitialProjection.targetRoomEpoch !== 'directory-epoch-1'
        || unconfirmedInitialProjection.projectedRoomEpoch !== null
      ) {
        throw new Error('ROOM_DIRECTORY_UNCONFIRMED_PROJECTION_FIXTURE_FAILED');
      }
      failDirectoryConfirm = false;
      await firstDirectoryActors.shutdown();
      failDirectoryRead = true;
      let directoryProjectionErrors = 0;
      const recoveredDirectoryActors = createRoomActorRegistry({
        store: readerStore,
        createRoomEpoch: () => 'directory-epoch-2',
        recoveryTimestamp: () => NEXT_TIMESTAMP,
        now: nowAt(NEXT_TIMESTAMP),
        prepareCreatedOpen: directory.prepareCreatedOpen,
        onCommittedRecovered: directory.rebindCommittedOpen,
        onCommittedClosed: directory.removeCommittedClosed,
        onBackgroundError: () => { directoryProjectionErrors += 1; },
      });
      await recoveredDirectoryActors.recover(directoryRegistrationRoomId);
      await eventually(async () => {
        const current = await directoryRegistrations.get(directoryRegistrationRoomId);
        return directoryProjectionErrors === 1
          && current?.phase === 'projecting'
          && current.projectedRoomEpoch === 'directory-epoch-1'
          && current.targetRoomEpoch === 'directory-epoch-2';
      });
      failDirectoryRead = false;
      const compensated = await directory.reconcileRegistrations({
        limit: 50,
        score: Date.parse(THIRD_TIMESTAMP),
      });
      const compensatedRegistration = await directoryRegistrations.get(
        directoryRegistrationRoomId,
      );
      if (
        compensated.projected !== 1
        || directoryRows.get(directoryRegistrationRoomId)?.roomEpoch !== 'directory-epoch-2'
        || compensatedRegistration?.phase !== 'active'
        || compensatedRegistration.projectedRoomEpoch !== 'directory-epoch-2'
      ) {
        throw new Error('ROOM_DIRECTORY_RECOVERY_COMPENSATION_FAILED');
      }
      failDirectoryDelete = true;
      const closeResult = await recoveredDirectoryActors.execute({
        roomId: directoryRegistrationRoomId,
        command: {
          type: 'close',
          expectedRoomEpoch: 'directory-epoch-2',
          reason: 'directory-tombstone-verifier',
          timestamp: THIRD_TIMESTAMP,
        },
        authority: {
          kind: 'authenticated-user',
          actorUserId: 'directory-host-1',
          accountUserId: 101,
        },
      });
      if (!closeResult.ok) throw new Error('ROOM_DIRECTORY_CLOSE_CHECKPOINT_FAILED');
      await eventually(async () => (
        directoryProjectionErrors === 2
        && (await directoryRegistrations.get(directoryRegistrationRoomId))?.phase === 'closing'
      ));
      if (directoryRows.get(directoryRegistrationRoomId)?.roomEpoch !== 'directory-epoch-2') {
        throw new Error('ROOM_DIRECTORY_CLOSE_TOMBSTONE_LOST_D1_ROW');
      }
      failDirectoryDelete = false;
      const closedCompensation = await directory.reconcileRegistrations({
        limit: 50,
        score: Date.parse(THIRD_TIMESTAMP),
      });
      if (
        closedCompensation.removed !== 1
        || directoryRows.has(directoryRegistrationRoomId)
        || await directoryRegistrations.get(directoryRegistrationRoomId) !== null
      ) {
        throw new Error('ROOM_DIRECTORY_CLOSE_COMPENSATION_FAILED');
      }
      const repeatedCloseCompensation = await directory.reconcileRegistrations({
        limit: 50,
        score: Date.parse(THIRD_TIMESTAMP),
      });
      if (repeatedCloseCompensation.scanned !== 0) {
        throw new Error('ROOM_DIRECTORY_CLOSE_COMPENSATION_NOT_IDEMPOTENT');
      }
      await recoveredDirectoryActors.shutdown();

      const pendingPreparedAtMs = Date.parse(THIRD_TIMESTAMP);
      await directoryRegistrations.prepare({
        record: {
          roomId: directoryPendingRoomId,
          roomEpoch: 'directory-pending-epoch-1',
          hostUserId: 101,
          title: 'Pending Redis directory',
          visibility: 'unlisted',
          status: 'open',
          createdAt: TIMESTAMP,
          lastActivityAt: NEXT_TIMESTAMP,
        },
        preparedAtMs: pendingPreparedAtMs,
      });
      const pendingDeferred = await directory.reconcileRegistrations({
        limit: 50,
        score: pendingPreparedAtMs + 1,
      });
      const pendingDueAtMs = pendingPreparedAtMs + 5 * 60_000;
      if (
        pendingDeferred.removed !== 0
        || (await directoryRegistrations.get(directoryPendingRoomId))?.phase !== 'pending-create'
        || await cleanup.zScore(directoryRegistrationIndexKey, directoryPendingMember)
          !== pendingDueAtMs
      ) {
        throw new Error('ROOM_DIRECTORY_PENDING_GRACE_FAILED');
      }
      const pendingExpired = await directory.reconcileRegistrations({
        limit: 50,
        score: pendingDueAtMs,
      });
      if (
        pendingExpired.removed !== 1
        || await directoryRegistrations.get(directoryPendingRoomId) !== null
      ) {
        throw new Error('ROOM_DIRECTORY_PENDING_EXPIRY_FAILED');
      }
      await fixedError(writerStore.save({
        commit: commit(createRoom(directoryPendingRoomId, 'directory-pending-epoch-1')),
        directoryRegistrationRequired: true,
      }), 'REDIS_ROOM_DIRECTORY_REGISTRATION_REQUIRED');
      if (await writerStore.load(directoryPendingRoomId) !== null) {
        throw new Error('ROOM_DIRECTORY_PENDING_CREATE_FENCE_FAILED');
      }

      const pendingRaceRecord = {
        roomId: directoryPendingRaceRoomId,
        roomEpoch: 'directory-pending-race-epoch-1',
        hostUserId: 101,
        title: 'Pending Redis directory save-first race',
        visibility: 'unlisted' as const,
        status: 'open' as const,
        createdAt: TIMESTAMP,
        lastActivityAt: NEXT_TIMESTAMP,
      };
      let injectedPendingRaceSave = false;
      const pendingRaceRegistrations = createRedisRoomDirectoryRegistrationStore({
        keyPrefix,
        getClient: () => ({
          async eval(script, options) {
            if (
              !injectedPendingRaceSave
              && script.includes('ROOM_DIRECTORY_REGISTRATION_MARK_CLOSING_V2')
            ) {
              injectedPendingRaceSave = true;
              const saved = await writerStore.save({
                commit: commit(createRoom(
                  directoryPendingRaceRoomId,
                  pendingRaceRecord.roomEpoch,
                )),
                directoryRegistrationRequired: true,
              });
              if (saved.kind !== 'saved') {
                throw new Error('ROOM_DIRECTORY_PENDING_RACE_SAVE_FAILED');
              }
            }
            return cleanup.eval(script, options);
          },
        }),
      });
      await pendingRaceRegistrations.prepare({
        record: pendingRaceRecord,
        preparedAtMs: pendingPreparedAtMs,
      });
      directoryRows.set(directoryPendingRaceRoomId, structuredClone(pendingRaceRecord));
      const pendingRaceDirectory = createArenaRoomDirectoryService({
        authority: readerStore,
        registrations: pendingRaceRegistrations,
        store: directoryD1,
        now: () => pendingDueAtMs,
        pendingCreateGraceMs: 5 * 60_000,
      });
      const pendingRaceCleanup = await pendingRaceDirectory.reconcileRegistrations({
        limit: 50,
        score: pendingDueAtMs,
      });
      if (
        !injectedPendingRaceSave
        || pendingRaceCleanup.removed !== 0
        || directoryRows.get(directoryPendingRaceRoomId)?.roomEpoch
          !== pendingRaceRecord.roomEpoch
        || (await pendingRaceRegistrations.get(directoryPendingRaceRoomId))?.phase
          !== 'projecting'
        || (await writerStore.load(directoryPendingRaceRoomId))?.snapshot.roomEpoch
          !== pendingRaceRecord.roomEpoch
      ) {
        throw new Error('ROOM_DIRECTORY_PENDING_SAVE_FIRST_FENCE_FAILED');
      }
      const pendingRaceProjection = await pendingRaceDirectory.reconcileRegistrations({
        limit: 50,
        score: pendingDueAtMs + 1,
      });
      if (
        pendingRaceProjection.projected !== 1
        || (await pendingRaceRegistrations.get(directoryPendingRaceRoomId))?.phase !== 'active'
      ) {
        throw new Error('ROOM_DIRECTORY_PENDING_SAVE_FIRST_RECOVERY_FAILED');
      }

      const malformedRaceRecord = {
        ...pendingRaceRecord,
        roomId: directoryMalformedRaceRoomId,
        roomEpoch: 'directory-malformed-race-epoch-1',
        title: 'Malformed terminal-looking checkpoint race',
      };
      const malformedCheckpointRaw = JSON.stringify({
        checkpointVersion: 1,
        roomId: malformedRaceRecord.roomId,
        roomEpoch: malformedRaceRecord.roomEpoch,
        state: { lifecycle: { status: 'closed' } },
      });
      let injectedMalformedCheckpoint = false;
      const malformedRaceRegistrations = createRedisRoomDirectoryRegistrationStore({
        keyPrefix,
        getClient: () => ({
          async eval(script, options) {
            if (
              !injectedMalformedCheckpoint
              && script.includes('ROOM_DIRECTORY_REGISTRATION_MARK_CLOSING_V2')
            ) {
              injectedMalformedCheckpoint = true;
              await cleanup.set(roomKey(directoryMalformedRaceRoomId), malformedCheckpointRaw);
            }
            return cleanup.eval(script, options);
          },
        }),
      });
      await malformedRaceRegistrations.prepare({
        record: malformedRaceRecord,
        preparedAtMs: pendingPreparedAtMs,
      });
      directoryRows.set(directoryMalformedRaceRoomId, structuredClone(malformedRaceRecord));
      const malformedRaceDirectory = createArenaRoomDirectoryService({
        authority: readerStore,
        registrations: malformedRaceRegistrations,
        store: directoryD1,
        now: () => pendingDueAtMs,
        pendingCreateGraceMs: 5 * 60_000,
      });
      const malformedRaceCleanup = await malformedRaceDirectory.reconcileRegistrations({
        limit: 50,
        score: pendingDueAtMs,
      });
      if (
        !injectedMalformedCheckpoint
        || malformedRaceCleanup.removed !== 0
        || directoryRows.get(directoryMalformedRaceRoomId)?.roomEpoch
          !== malformedRaceRecord.roomEpoch
        || (await malformedRaceRegistrations.get(directoryMalformedRaceRoomId))?.phase
          !== 'pending-create'
        || await cleanup.get(roomKey(directoryMalformedRaceRoomId)) !== malformedCheckpointRaw
      ) {
        throw new Error('ROOM_DIRECTORY_MALFORMED_AUTHORITY_FENCE_FAILED');
      }

      const authorityActors = createRoomActorRegistry({
        store: writerStore,
        createRoomIdentity: () => ({ roomId: authorityRoomId, roomEpoch: 'authority-epoch-1' }),
        createTimestamp: () => TIMESTAMP,
        now: nowAt(NEXT_TIMESTAMP),
      });
      const authorityMemberships = createArenaRoomMembershipService({
        actors: authorityActors,
        createUserId: () => 'authority-host-1',
        now: () => NEXT_TIMESTAMP,
      });
      await authorityMemberships.create({
        accountUserId: 101,
        displayName: 'Host',
        sharedConfig: sharedConfig(),
      });
      const authority = createArenaRoomWebSocketAuthority({
        actors: authorityActors,
        memberships: authorityMemberships,
        replay: writer.getRoomTicketReplayStore(),
        tickets: createArenaRoomTicketCodec({
          signatures: createArenaRoomTicketSignatureService({
            env: { SIGNATURE_SECRET_KEY: 'room-redis-verifier-secret-at-least-32-characters' },
            logger: { warn: () => undefined, error: () => undefined },
          }),
          createJti: () => authorityTicketJti,
        }),
      });
      const gateway = new RoomWebSocketGateway({
        allowedBrowserOrigins: ['https://app.example.test'],
        authorize: authority.authorize,
        heartbeatIntervalMs: 60_000,
        heartbeatTimeoutMs: 60_000,
      });
      const authorityTicket = await authority.issue({
        roomId: authorityRoomId,
        accountUserId: 101,
      });
      const upgradeRequest = () => new Request(
        `http://localhost${ARENA_ROOM_WEBSOCKET_PATH}?ticket=${encodeURIComponent(authorityTicket)}`,
        {
          headers: {
            connection: 'Upgrade',
            origin: 'https://app.example.test',
            'sec-websocket-key': Buffer.alloc(16, 7).toString('base64'),
            'sec-websocket-protocol': ARENA_ROOM_WEBSOCKET_PROTOCOL,
            'sec-websocket-version': '13',
            upgrade: 'websocket',
          },
        },
      );
      const authorizedUpgrade = await gateway.prepareUpgrade(upgradeRequest());
      const replayedUpgrade = await gateway.prepareUpgrade(upgradeRequest());
      if (
        !authorizedUpgrade.accepted
        || replayedUpgrade.accepted
        || replayedUpgrade.response.status !== 401
      ) {
        throw new Error('ROOM_REDIS_AUTHORITY_GATEWAY_WIRING_FAILED');
      }
      gateway.forceClose();
      await authorityActors.shutdown();
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
        proposalLifecycle: true,
        directoryRegistration: true,
        directoryRecoveryCompensation: true,
        directoryCloseCompensation: true,
        directoryPendingCreateGrace: true,
        directoryAtomicCreateFence: true,
        directoryAtomicCleanupFence: true,
        directoryMalformedAuthorityFence: true,
        directoryRegistrationV1Migration: true,
        activeTtlRefresh: true,
        ticketReplay: true,
        authorityGatewayRedisWiring: true,
        terminalTtl: true,
        monotonicExpiryFence: true,
        expireDelete: true,
        malformedExisting: true,
        baselineV1Compatibility: true,
        authorityStateV1Migration: true,
        ttlExpiry: true,
      }));
  }
} finally {
  await reader.close();
  await writer.close();
  if (!cleanup.isOpen) await cleanup.connect();
  if (phase !== 'write') {
    await cleanup.zRem(directoryRegistrationIndexKey, directoryRegistrationMember);
    await cleanup.zRem(directoryRegistrationIndexKey, directoryPendingMember);
    await cleanup.zRem(directoryRegistrationIndexKey, directoryPendingRaceMember);
    await cleanup.zRem(directoryRegistrationIndexKey, directoryMalformedRaceMember);
    await cleanup.zRem(directoryLegacyV1IndexKey, directoryLegacyMember);
    await cleanup.zRem(directoryRegistrationIndexKey, directoryLegacyMember);
    await cleanup.unlink([
      ...roomKeys(roomId),
      ...roomKeys(ttlRoomId),
      ...roomKeys(epochRoomId),
      ...roomKeys(expiryFenceRoomId),
      ...roomKeys(legacyRoomId),
      ...roomKeys(legacyAuthorityRoomId),
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
      ...roomKeys(proposalRoomId),
      ...roomKeys(authorityRoomId),
      ...roomKeys(directoryPendingRoomId),
      ...roomKeys(directoryPendingRaceRoomId),
      ...roomKeys(directoryMalformedRaceRoomId),
      ticketReplayKey,
      authorityTicketReplayKey,
      directoryRegistrationKey,
      directoryPendingKey,
      directoryPendingRaceKey,
      directoryMalformedRaceKey,
      directoryLegacyV1Key,
      directoryLegacyV2Key,
    ]);
  }
  await cleanup.quit();
}
