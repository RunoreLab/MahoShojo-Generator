import { createHash, randomUUID } from 'node:crypto';

import { ARENA_ROOM_WEBSOCKET_PROTOCOL } from '@mahoshojo/contracts/arena-room';

import {
  checkpointPredecessorOf,
  createArenaRoomCheckpointCommit,
  issueArenaRoomPresenceAuthority,
  issueArenaRoomRecoveryAuthority,
  issueArenaRoomGenerationPublisherAuthority,
  issueArenaRoomTrustedTime,
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
import {
  createRoomActorRegistry,
  type RoomActorCheckpointStore,
} from '../src/arena-room/room-actor-registry';
import { createArenaRoomDirectoryService } from '../src/arena-room/room-directory-service';
import {
  createStoredRoomDirectoryRecord,
  roomDirectoryPublicIndexMember,
  serializeStoredRoomDirectoryRecord,
} from '../src/arena-room/room-directory-record';
import { createArenaRoomMembershipService } from '../src/arena-room/room-membership-service';
import { createArenaRoomProposalService } from '../src/arena-room/room-proposal-service';
import { createArenaRoomGenerationService } from '../src/arena-room/room-generation-service';
import type { ArenaDataCardRefVerifier } from '../src/arena-room/arena-data-card-ref-verifier';
import type {
  ArenaRoomGenerationEvent,
  ArenaRoomGenerationPort,
} from '../src/arena-generation/room-generation-port';
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
const generationRoomId = `room-generation-${token}`;
const authorityRoomId = `room-authority-${token}`;
const directoryRoomId = `room-directory-public-${token}`;
const unlistedDirectoryRoomId = `room-directory-unlisted-${token}`;
const staleDirectoryRoomId = `room-directory-stale-${token}`;
const malformedDirectoryRoomId = `room-directory-malformed-${token}`;
const invalidDirectoryStorageRoomId = `room-directory-invalid-storage-${token}`;
const invalidDirectoryRecordStorageRoomId = `room-directory-invalid-record-${token}`;
const invalidDirectoryCreateRecordRoomId = `room-directory-create-invalid-record-${token}`;
const invalidDirectoryCreateIndexRoomId = `room-directory-create-invalid-index-${token}`;
const disconnectedDirectoryRoomId = `room-directory-disconnected-${token}`;
const disconnectedCreateRoomId = `room-directory-disconnected-create-${token}`;
const wrongEpochDirectoryRoomId = `room-directory-wrong-epoch-${token}`;
const wrongHostDirectoryRoomId = `room-directory-wrong-host-${token}`;
const closedCandidateDirectoryRoomId = `room-directory-closed-candidate-${token}`;
const expiredCandidateDirectoryRoomId = `room-directory-expired-candidate-${token}`;
const unknownDirectoryRoomId = `room-directory-unknown-${token}`;
const paginationDirectoryRoomIds = Array.from(
  { length: 52 },
  (_, index) => `room-directory-page-${String(index).padStart(2, '0')}-${token}`,
);
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
const directoryPrefix = `mahoshojo:room-directory:v1:${keyPrefix}`;
const directoryPublicIndexKey = `${directoryPrefix}:public`;
const directoryRecordKey = (id: string): string => `${directoryPrefix}:entry:${roomHash(id)}`;

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
    const persistedDirectory = createArenaRoomDirectoryService({
      authority: readerStore,
      store: reader.getRoomDirectoryStore(),
      now: nowAt(THIRD_TIMESTAMP),
    });
    if ((await persistedDirectory.lookup(roomId))?.title !== 'Restart Redis directory') {
      throw new Error('ROOM_REDIS_RESTART_DIRECTORY_PERSISTENCE_FAILED');
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
    if (
      (await persistedDirectory.lookup(roomId))?.roomId !== roomId
      || await cleanup.zScore(
        directoryPublicIndexKey,
        roomDirectoryPublicIndexMember(roomId, THIRD_TIMESTAMP),
      ) !== 0
    ) {
      throw new Error('ROOM_REDIS_RESTART_DIRECTORY_RECOVERY_FAILED');
    }
    const delayedOldMutation = publish(createRoom(roomId).nextState);
    if ((await writerStore.save({ commit: commit(delayedOldMutation) })).kind !== 'conflict') {
      throw new Error('ROOM_REDIS_RESTART_OLD_ACTOR_FENCE_FAILED');
    }
    await recoveredRegistry.shutdown();
    const deleted = await readerStore.delete({ checkpoint: recovered });
    if (deleted.kind !== 'deleted') throw new Error('ROOM_REDIS_RESTART_CLEANUP_FAILED');
    if (
      await cleanup.get(directoryRecordKey(roomId)) !== null
      || await cleanup.zScore(
        directoryPublicIndexKey,
        roomDirectoryPublicIndexMember(roomId, THIRD_TIMESTAMP),
      ) !== null
    ) throw new Error('ROOM_REDIS_RESTART_DIRECTORY_CLEANUP_FAILED');
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
      directoryAfterRestart: true,
      directoryRecoveryRebindAfterRestart: true,
      directoryCleanupAfterRestart: true,
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
      directory: { title: 'Restart Redis directory', visibility: 'public' },
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
      directoryPersisted: true,
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

      await proposalService.submit({
        roomId: proposalRoomId,
        accountUserId: 202,
        request: {
          proposalId: 'redis-proposal-withdraw',
          expectedRoomEpoch: proposalHost.roomEpoch,
          baseRevision: 1,
          changes: [{
            changeId: 'withdraw-mode',
            type: 'setBattleMode',
            value: 'kizuna',
            expectedBase: { kind: 'value', value: 'classic' },
          }],
        },
      });
      const proposalWithdrawn = await proposalService.withdraw({
        roomId: proposalRoomId,
        proposalId: 'redis-proposal-withdraw',
        accountUserId: 202,
        request: { expectedRoomEpoch: proposalHost.roomEpoch },
      });
      if (
        proposalWithdrawn.status !== 'withdrawn'
        || proposalWithdrawn.revision !== 1
        || (await readerStore.load(proposalRoomId))?.snapshot.proposals.length !== 0
      ) throw new Error('ROOM_REDIS_PROPOSAL_WITHDRAW_FAILED');

      await proposalService.submit({
        roomId: proposalRoomId,
        accountUserId: 202,
        request: {
          proposalId: 'redis-proposal-reject',
          expectedRoomEpoch: proposalHost.roomEpoch,
          baseRevision: 1,
          changes: [{
            changeId: 'reject-mode',
            type: 'setBattleMode',
            value: 'daily',
            expectedBase: { kind: 'value', value: 'classic' },
          }],
        },
      });
      const proposalRejected = await proposalService.resolve({
        roomId: proposalRoomId,
        proposalId: 'redis-proposal-reject',
        accountUserId: 101,
        request: {
          expectedRoomEpoch: proposalHost.roomEpoch,
          expectedRevision: 1,
          resolution: 'reject',
        },
      });
      if (
        proposalRejected.status !== 'rejected'
        || proposalRejected.revision !== 1
        || (await readerStore.load(proposalRoomId))?.snapshot.sharedConfig.battleMode !== 'classic'
      ) throw new Error('ROOM_REDIS_PROPOSAL_REJECT_FAILED');

      await proposalService.submit({
        roomId: proposalRoomId,
        accountUserId: 202,
        request: {
          proposalId: 'redis-proposal-atomic',
          expectedRoomEpoch: proposalHost.roomEpoch,
          baseRevision: 1,
          changes: [
            {
              changeId: 'atomic-guidance',
              type: 'setUserGuidance',
              value: 'redis-atomic-applied',
              expectedBase: { kind: 'value', value: 'redis-proposal-applied' },
              atomicGroupId: 'atomic-group-1',
            },
            {
              changeId: 'atomic-mode',
              type: 'setBattleMode',
              value: 'kizuna',
              expectedBase: { kind: 'value', value: 'classic' },
              dependsOn: ['atomic-guidance'],
              atomicGroupId: 'atomic-group-1',
            },
          ],
        },
      });
      await fixedError(proposalService.resolve({
        roomId: proposalRoomId,
        proposalId: 'redis-proposal-atomic',
        accountUserId: 101,
        request: {
          expectedRoomEpoch: proposalHost.roomEpoch,
          expectedRevision: 1,
          resolution: 'accept-selected',
          selectedChangeIds: ['atomic-mode'],
        },
      }), 'ROOM_PROPOSAL_CONFLICT');
      const pendingAfterAtomicFailure = await readerStore.load(proposalRoomId);
      if (
        pendingAfterAtomicFailure?.snapshot.revision !== 1
        || pendingAfterAtomicFailure.snapshot.proposals[0]?.proposalId !== 'redis-proposal-atomic'
      ) throw new Error('ROOM_REDIS_PROPOSAL_ATOMIC_PARTIAL_MUTATED');
      const atomicAccepted = await proposalService.resolve({
        roomId: proposalRoomId,
        proposalId: 'redis-proposal-atomic',
        accountUserId: 101,
        request: {
          expectedRoomEpoch: proposalHost.roomEpoch,
          expectedRevision: 1,
          resolution: 'accept-selected',
          selectedChangeIds: ['atomic-guidance', 'atomic-mode'],
        },
      });
      if (
        atomicAccepted.status !== 'accepted'
        || atomicAccepted.revision !== 2
        || (await readerStore.load(proposalRoomId))?.snapshot.sharedConfig.battleMode !== 'kizuna'
      ) throw new Error('ROOM_REDIS_PROPOSAL_ATOMIC_ACCEPT_FAILED');

      for (const [proposalId, value] of [
        ['redis-proposal-competing-a', 'redis-competing-a'],
        ['redis-proposal-competing-b', 'redis-competing-b'],
      ] as const) {
        await proposalService.submit({
          roomId: proposalRoomId,
          accountUserId: 202,
          request: {
            proposalId,
            expectedRoomEpoch: proposalHost.roomEpoch,
            baseRevision: 2,
            changes: [{
              changeId: `guidance-${proposalId}`,
              type: 'setUserGuidance',
              value,
              expectedBase: { kind: 'value', value: 'redis-atomic-applied' },
            }],
          },
        });
      }
      await proposalService.resolve({
        roomId: proposalRoomId,
        proposalId: 'redis-proposal-competing-a',
        accountUserId: 101,
        request: {
          expectedRoomEpoch: proposalHost.roomEpoch,
          expectedRevision: 2,
          resolution: 'accept-selected',
          selectedChangeIds: ['guidance-redis-proposal-competing-a'],
        },
      });
      await fixedError(proposalService.resolve({
        roomId: proposalRoomId,
        proposalId: 'redis-proposal-competing-b',
        accountUserId: 101,
        request: {
          expectedRoomEpoch: proposalHost.roomEpoch,
          expectedRevision: 3,
          resolution: 'accept-selected',
          selectedChangeIds: ['guidance-redis-proposal-competing-b'],
        },
      }), 'ROOM_PROPOSAL_CONFLICT');
      const competingState = await readerStore.load(proposalRoomId);
      if (
        competingState?.snapshot.revision !== 3
        || competingState.snapshot.sharedConfig.userGuidance !== 'redis-competing-a'
        || competingState.snapshot.proposals[0]?.proposalId !== 'redis-proposal-competing-b'
      ) throw new Error('ROOM_REDIS_PROPOSAL_COMPETING_FAILED');
      await proposalService.resolve({
        roomId: proposalRoomId,
        proposalId: 'redis-proposal-competing-b',
        accountUserId: 101,
        request: {
          expectedRoomEpoch: proposalHost.roomEpoch,
          expectedRevision: 3,
          resolution: 'reject',
        },
      });
      await proposalActors.shutdown();

      let generationNow = Date.parse(THIRD_TIMESTAMP);
      const generationActors = createRoomActorRegistry({
        store: writerStore,
        createRoomIdentity: () => ({
          roomId: generationRoomId,
          roomEpoch: 'generation-epoch-1',
        }),
        createTimestamp: () => TIMESTAMP,
        now: () => generationNow,
      });
      let generationUserIndex = 0;
      const generationMemberships = createArenaRoomMembershipService({
        actors: generationActors,
        createUserId: () => `generation-user-${++generationUserIndex}`,
        now: () => NEXT_TIMESTAMP,
      });
      const generationHost = await generationMemberships.create({
        accountUserId: 101,
        displayName: 'Generation Host',
        sharedConfig: sharedConfig(),
      });
      await generationMemberships.join({
        roomId: generationRoomId,
        accountUserId: 202,
        displayName: 'Generation Member',
      });
      const generationId = `redis-generation-${token}`;
      const generationRequestId = `redis-request-${token}`;
      const generationSecretCanary = `provider-secret-${token}`;
      let generationStartCount = 0;
      let generationResumeCount = 0;
      let referenceVerifyCount = 0;
      let durableProjectionStatus: 'completed' | 'running' = 'running';
      let primaryStreamController: ReadableStreamDefaultController<
        ArenaRoomGenerationEvent
      > | null = null;
      const primarySubscription = {
        generationId,
        generationRequestId,
        events: new ReadableStream<ArenaRoomGenerationEvent>({
          start(controller) {
            primaryStreamController = controller;
          },
        }),
      };
      const generationPort = {
        async deriveGenerationId() {
          return generationId;
        },
        async hashSemanticPayload() {
          return `sha256:${'a'.repeat(64)}`;
        },
        async startFromHostRequest(input) {
          generationStartCount += 1;
          const persistedReservation = await readerStore.load(generationRoomId);
          if (
            persistedReservation?.snapshot.activeGeneration?.state !== 'starting'
            || persistedReservation.snapshot.activeGeneration.generationId !== generationId
            || JSON.stringify(persistedReservation).includes(generationSecretCanary)
            || input.multiplayerSnapshot.participantUserIds.join(',') !== '101,202'
          ) {
            throw new Error('ROOM_REDIS_GENERATION_RESERVATION_ORDER_FAILED');
          }
          return { kind: 'subscribed' as const, subscription: primarySubscription };
        },
        async readOwnedProjection() {
          return {
            kind: 'found' as const,
            projection: {
              generationId,
              generationRequestId,
              status: durableProjectionStatus,
              markdown: durableProjectionStatus === 'completed'
                ? '# Redis 恢复后的权威终态\n'
                : '# Redis 进程恢复基线\n',
              resumeCursor: durableProjectionStatus === 'completed' ? '12-0' : '10-0',
              updatedAt: new Date(generationNow).toISOString(),
              finalAuthoritative: durableProjectionStatus === 'completed',
              resultAvailable: durableProjectionStatus === 'completed',
              generationRecordId: durableProjectionStatus === 'completed'
                ? `generation-record-${token}`
                : null,
              errorCode: null,
            },
          };
        },
        async resumeOwnedSubscription() {
          generationResumeCount += 1;
          const events = new ReadableStream<ArenaRoomGenerationEvent>({
            start(controller) {
              controller.enqueue({
                id: '11-0',
                type: 'markdown',
                chunk: '恢复后的增量\n',
              });
              controller.enqueue({
                id: '12-0',
                type: 'done',
                status: 'completed',
                generationRecordId: `generation-record-${token}`,
                resultAvailable: true,
              });
              durableProjectionStatus = 'completed';
              controller.close();
            },
          });
          return {
            kind: 'subscribed' as const,
            subscription: { generationId, generationRequestId, events },
          };
        },
      } satisfies ArenaRoomGenerationPort;
      const generationReferences: ArenaDataCardRefVerifier = {
        async verify(input) {
          referenceVerifyCount += 1;
          return input.refs;
        },
      };
      const generationService = createArenaRoomGenerationService({
        memberships: generationMemberships,
        references: generationReferences,
        generation: generationPort,
        now: () => new Date(generationNow).toISOString(),
      });
      const generationConfig = sharedConfig();
      generationConfig.userGuidance = 'Redis generation pending config';
      const generationRequest = {
        expectedRoomEpoch: generationHost.roomEpoch,
        expectedRevision: 0,
        generationRequestId,
        sharedConfig: generationConfig,
        generation: {
          generationRequestId,
          internalGuidance: '验证 Redis Room generation publisher',
          customProvider: { apiKey: generationSecretCanary },
        },
      };
      const sourceRequest = new Request('https://api.example.test/arena-room-generation', {
        method: 'POST',
        headers: { authorization: 'Bearer verifier-account' },
      });
      const generationActor = generationActors.get(generationRoomId);
      if (!generationActor) throw new Error('ROOM_REDIS_GENERATION_ACTOR_MISSING');
      const hostFanout: string[] = [];
      const memberFanout: string[] = [];
      const stopHostFanout = generationActor.subscribe((fanout) => {
        hostFanout.push(...(fanout.storyEvents ?? []).map((event) => event.payload.delta));
      });
      generationActor.subscribe((fanout) => {
        memberFanout.push(...(fanout.storyEvents ?? []).map((event) => event.payload.delta));
      });
      await generationService.start({
        roomId: generationRoomId,
        accountUserId: 101,
        request: generationRequest,
        sourceRequest,
      });
      const waitForGeneration = async (
        predicate: (state: ArenaRoomAuthorityState | null) => boolean,
        failure: string,
      ): Promise<ArenaRoomAuthorityState> => {
        for (let attempt = 0; attempt < 200; attempt += 1) {
          const state = await readerStore.load(generationRoomId);
          if (predicate(state)) return state!;
          await new Promise<void>((resolve) => setTimeout(resolve, 5));
        }
        throw new Error(failure);
      };
      await waitForGeneration(
        (state) => state?.snapshot.activeGeneration?.state === 'running',
        'ROOM_REDIS_GENERATION_RUNNING_TIMEOUT',
      );
      await generationService.start({
        roomId: generationRoomId,
        accountUserId: 101,
        request: generationRequest,
        sourceRequest,
      });
      if (
        generationStartCount !== 1
        || referenceVerifyCount !== 1
        || JSON.stringify(await readerStore.load(generationRoomId)).includes(generationSecretCanary)
      ) {
        throw new Error('ROOM_REDIS_GENERATION_DUPLICATE_OR_SECRET_FAILED');
      }

      // Closing the host-side subscriber must not own or stop the server publisher.
      stopHostFanout();
      const currentPrimaryStreamController = () => primaryStreamController;
      currentPrimaryStreamController()?.enqueue({
        id: '1-0',
        type: 'markdown',
        chunk: '# 房主连接断开后继续发布\n',
      });
      for (let attempt = 0; attempt < 100 && memberFanout.length === 0; attempt += 1) {
        await new Promise<void>((resolve) => setTimeout(resolve, 5));
      }
      if (hostFanout.length !== 0 || memberFanout.join('') !== '# 房主连接断开后继续发布\n') {
        throw new Error('ROOM_REDIS_GENERATION_HOST_DISCONNECT_PUBLISH_FAILED');
      }

      // Simulate process loss: discard in-memory actor/publisher, preserve Redis,
      // then reconcile the durable generation projection before attaching resume.
      generationActors.forceClose();
      currentPrimaryStreamController()?.close();
      generationNow = Date.parse('2026-08-28T00:03:00.000Z');
      const recoveredGenerationActors = createRoomActorRegistry({
        store: readerStore,
        createRoomEpoch: () => 'generation-epoch-2',
        recoveryTimestamp: () => new Date(generationNow).toISOString(),
        now: () => generationNow,
      });
      const recoveredMemberships = createArenaRoomMembershipService({
        actors: recoveredGenerationActors,
        now: () => new Date(generationNow).toISOString(),
      });
      const recoveredGenerationService = createArenaRoomGenerationService({
        memberships: recoveredMemberships,
        references: generationReferences,
        generation: generationPort,
        now: () => new Date(generationNow).toISOString(),
      });
      const recoveredView = await recoveredGenerationService.read({
        roomId: generationRoomId,
        generationId,
        accountUserId: 202,
      });
      if (
        recoveredView.roomEpoch !== 'generation-epoch-2'
        || !recoveredView.markdown.includes('Redis 进程恢复基线')
        || generationResumeCount !== 1
        || generationStartCount !== 1
      ) {
        throw new Error('ROOM_REDIS_GENERATION_PROCESS_RECONCILE_FAILED');
      }
      const completedGenerationState = await waitForGeneration(
        (state) => state?.snapshot.activeGeneration?.state === 'completed',
        'ROOM_REDIS_GENERATION_TERMINAL_TIMEOUT',
      );
      const recoveredGenerationActor = recoveredGenerationActors.get(generationRoomId);
      if (!recoveredGenerationActor) {
        throw new Error('ROOM_REDIS_GENERATION_RECOVERED_ACTOR_MISSING');
      }
      const staleTimestamp = new Date(generationNow).toISOString();
      const rejectedScopes = await Promise.all([
        recoveredGenerationActor.execute({
          authority: issueArenaRoomGenerationPublisherAuthority({
            roomId: generationRoomId,
            roomEpoch: 'generation-epoch-1',
            generationRequestId,
            generationId,
            attempt: 1,
            expiresAt: '2026-08-29T00:00:00.000Z',
          }),
          command: {
            type: 'mirror-generation',
            expectedRoomEpoch: 'generation-epoch-1',
            generationRequestId,
            generationId,
            attempt: 1,
            state: 'completed',
            generationRecordId: `generation-record-${token}`,
            timestamp: staleTimestamp,
          },
          trustedTime: issueArenaRoomTrustedTime({ now: staleTimestamp }),
        }),
        recoveredGenerationActor.execute({
          authority: issueArenaRoomGenerationPublisherAuthority({
            roomId: generationRoomId,
            roomEpoch: 'generation-epoch-2',
            generationRequestId,
            generationId,
            attempt: 2,
            expiresAt: '2026-08-29T00:00:00.000Z',
          }),
          command: {
            type: 'mirror-generation',
            expectedRoomEpoch: 'generation-epoch-2',
            generationRequestId,
            generationId,
            attempt: 2,
            state: 'completed',
            generationRecordId: `generation-record-${token}`,
            timestamp: staleTimestamp,
          },
          trustedTime: issueArenaRoomTrustedTime({ now: staleTimestamp }),
        }),
      ]);
      if (rejectedScopes.some((result) => result.ok)) {
        throw new Error('ROOM_REDIS_GENERATION_OLD_EPOCH_ATTEMPT_ACCEPTED');
      }
      const authoritativeFinal = await recoveredGenerationService.read({
        roomId: generationRoomId,
        generationId,
        accountUserId: 202,
      });
      if (
        completedGenerationState.snapshot.activeGeneration?.state !== 'completed'
        || !authoritativeFinal.finalAuthoritative
        || authoritativeFinal.generationRecordId !== `generation-record-${token}`
        || authoritativeFinal.markdown !== '# Redis 恢复后的权威终态\n'
        || JSON.stringify(completedGenerationState).includes(generationSecretCanary)
      ) {
        throw new Error('ROOM_REDIS_GENERATION_AUTHORITATIVE_FINAL_FAILED');
      }
      await recoveredGenerationActors.shutdown();

      const directoryIdentities = [
        { roomId: directoryRoomId, roomEpoch: 'directory-epoch-1' },
        { roomId: unlistedDirectoryRoomId, roomEpoch: 'directory-unlisted-epoch-1' },
      ];
      let directoryIdentityIndex = 0;
      let directoryUserIndex = 0;
      let directoryNow = Date.parse(NEXT_TIMESTAMP);
      const directoryActors = createRoomActorRegistry({
        store: writerStore,
        createRoomIdentity: () => directoryIdentities[directoryIdentityIndex++]!,
        createTimestamp: () => TIMESTAMP,
        now: () => directoryNow,
        checkpointRefreshIntervalMs: 1_000,
      });
      const directoryMemberships = createArenaRoomMembershipService({
        actors: directoryActors,
        createUserId: () => `directory-user-${++directoryUserIndex}`,
        now: () => NEXT_TIMESTAMP,
      });
      const publicRoom = await directoryMemberships.create({
        accountUserId: 101,
        displayName: 'Directory Host',
        sharedConfig: sharedConfig(),
        directory: { title: 'Redis public directory', visibility: 'public' },
      });
      const unlistedRoom = await directoryMemberships.create({
        accountUserId: 202,
        displayName: 'Unlisted Host',
        sharedConfig: sharedConfig(),
        directory: { title: 'Redis unlisted directory', visibility: 'unlisted' },
      });
      const directory = createArenaRoomDirectoryService({
        authority: readerStore,
        store: writer.getRoomDirectoryStore(),
        now: nowAt(NEXT_TIMESTAMP),
      });
      const initialDirectoryPage = await directory.discoverPublic({ limit: 50 });
      if (
        initialDirectoryPage.items.length !== 1
        || initialDirectoryPage.items[0]?.roomId !== directoryRoomId
        || initialDirectoryPage.items[0]?.title !== 'Redis public directory'
        || initialDirectoryPage.items.some((item) => item.roomId === unlistedDirectoryRoomId)
      ) {
        throw new Error('ROOM_DIRECTORY_REDIS_ONLY_CREATE_DISCOVERY_FAILED');
      }
      const publicIndexMember = roomDirectoryPublicIndexMember(directoryRoomId, TIMESTAMP);
      if (
        await cleanup.get(directoryRecordKey(directoryRoomId)) === null
        || await cleanup.zScore(directoryPublicIndexKey, publicIndexMember) !== 0
        || await cleanup.zScore(
          directoryPublicIndexKey,
          roomDirectoryPublicIndexMember(unlistedDirectoryRoomId, TIMESTAMP),
        ) !== null
      ) {
        throw new Error('ROOM_DIRECTORY_REDIS_ONLY_ATOMIC_INDEX_FAILED');
      }
      const publicActor = directoryActors.get(directoryRoomId);
      const publicBeforePresence = await cleanup.get(directoryRecordKey(directoryRoomId));
      const publicStateBeforePresence = publicActor?.getSnapshot();
      if (!publicActor || !publicStateBeforePresence || publicBeforePresence === null) {
        throw new Error('ROOM_DIRECTORY_REDIS_ONLY_PRESENCE_SETUP_FAILED');
      }
      const unsubscribeDirectoryRefresh = publicActor.subscribe(() => undefined);
      await cleanup.pExpire(directoryRecordKey(directoryRoomId), 1_000);
      directoryNow += 1_000;
      const directoryTtlRefreshCount = await directoryActors.refreshActiveCheckpoints();
      unsubscribeDirectoryRefresh();
      const refreshedDirectoryTtl = await cleanup.pTTL(directoryRecordKey(directoryRoomId));
      if (
        directoryTtlRefreshCount !== 2
        || refreshedDirectoryTtl < 86_000_000
        || refreshedDirectoryTtl > 86_400_000
        || await cleanup.zScore(directoryPublicIndexKey, publicIndexMember) !== 0
      ) {
        throw new Error('ROOM_DIRECTORY_REDIS_ONLY_LIFECYCLE_TTL_REFRESH_FAILED');
      }
      const presence = await publicActor.execute({
        authority: issueArenaRoomPresenceAuthority({
          roomId: directoryRoomId,
          roomEpoch: publicStateBeforePresence.snapshot.roomEpoch,
          deadlines: { hostOfflineDeadline: null, roomIdleDeadline: null },
          timestamp: NEXT_TIMESTAMP,
        }),
        command: {
          type: 'sync-presence',
          expectedRoomEpoch: publicStateBeforePresence.snapshot.roomEpoch,
          deadlines: { hostOfflineDeadline: null, roomIdleDeadline: null },
          timestamp: NEXT_TIMESTAMP,
        },
      });
      if (
        !presence.ok
        || presence.kind !== 'applied'
        || await cleanup.get(directoryRecordKey(directoryRoomId)) !== publicBeforePresence
        || await cleanup.zScore(directoryPublicIndexKey, publicIndexMember) !== 0
        || await cleanup.zCard(directoryPublicIndexKey) !== 1
      ) {
        throw new Error('ROOM_DIRECTORY_REDIS_ONLY_PRESENCE_WRITE_ISOLATION_FAILED');
      }
      await directoryMemberships.join({
        roomId: unlistedRoom.roomId,
        accountUserId: 303,
        displayName: 'Known ID Member',
      });

      await directoryActors.shutdown();
      const recoveredDirectoryActors = createRoomActorRegistry({
        store: writerStore,
        createRoomEpoch: (id) => (
          id === directoryRoomId ? 'directory-epoch-2' : 'directory-unlisted-epoch-2'
        ),
        recoveryTimestamp: () => NEXT_TIMESTAMP,
        now: nowAt(NEXT_TIMESTAMP),
      });
      const recoveredPublicActor = await recoveredDirectoryActors.recover(directoryRoomId);
      if (
        recoveredPublicActor?.getSnapshot()?.snapshot.roomEpoch !== 'directory-epoch-2'
        || (await directory.lookup(directoryRoomId))?.roomId !== directoryRoomId
      ) {
        throw new Error('ROOM_DIRECTORY_REDIS_ONLY_RECOVERY_REBIND_FAILED');
      }
      const recoveredIndexMember = roomDirectoryPublicIndexMember(directoryRoomId, NEXT_TIMESTAMP);
      if (
        await cleanup.zScore(directoryPublicIndexKey, publicIndexMember) !== null
        || await cleanup.zScore(directoryPublicIndexKey, recoveredIndexMember) !== 0
      ) {
        throw new Error('ROOM_DIRECTORY_REDIS_ONLY_RECOVERY_INDEX_FAILED');
      }
      await cleanup.zAdd(directoryPublicIndexKey, { score: 0, value: publicIndexMember });
      const staleIndexPage = await directory.discoverPublic({ limit: 50 });
      if (
        staleIndexPage.items.filter((item) => item.roomId === directoryRoomId).length !== 1
        || await cleanup.get(directoryRecordKey(directoryRoomId)) === null
        || await cleanup.zScore(directoryPublicIndexKey, publicIndexMember) !== null
        || await cleanup.zScore(directoryPublicIndexKey, recoveredIndexMember) !== 0
      ) {
        throw new Error('ROOM_DIRECTORY_REDIS_ONLY_STALE_INDEX_RECORD_PRESERVATION_FAILED');
      }
      const directoryStore = writer.getRoomDirectoryStore();
      const preReplacementRaw = await cleanup.get(directoryRecordKey(directoryRoomId));
      if (preReplacementRaw === null) {
        throw new Error('ROOM_DIRECTORY_REDIS_ONLY_REPLACEMENT_SETUP_FAILED');
      }
      const preReplacementCandidate = await directoryStore.candidateFromRaw({
        roomId: directoryRoomId,
        raw: preReplacementRaw,
        indexMember: recoveredIndexMember,
      });
      const concurrentReplacement = createStoredRoomDirectoryRecord({
        roomId: directoryRoomId,
        roomEpoch: 'directory-epoch-2',
        hostUserId: 101,
        title: 'Redis public directory replacement',
        visibility: 'public',
        status: 'open',
        createdAt: TIMESTAMP,
        lastActivityAt: THIRD_TIMESTAMP,
      });
      const concurrentReplacementRaw = serializeStoredRoomDirectoryRecord(concurrentReplacement);
      await cleanup.set(directoryRecordKey(directoryRoomId), concurrentReplacementRaw);
      await cleanup.zAdd(directoryPublicIndexKey, {
        score: 0,
        value: concurrentReplacement.publicIndexMember!,
      });
      const replacementCleanup = await directoryStore.removeIfExact(preReplacementCandidate);
      if (
        replacementCleanup.kind !== 'index-removed'
        || await cleanup.get(directoryRecordKey(directoryRoomId)) !== concurrentReplacementRaw
        || await cleanup.zScore(directoryPublicIndexKey, recoveredIndexMember) !== null
        || await cleanup.zScore(
          directoryPublicIndexKey,
          concurrentReplacement.publicIndexMember!,
        ) !== 0
      ) {
        throw new Error('ROOM_DIRECTORY_REDIS_ONLY_CONCURRENT_REPLACEMENT_PRESERVATION_FAILED');
      }
      const closedDirectory = await recoveredDirectoryActors.execute({
        roomId: directoryRoomId,
        command: {
          type: 'close',
          expectedRoomEpoch: 'directory-epoch-2',
          reason: 'redis-only-directory-verifier',
          timestamp: THIRD_TIMESTAMP,
        },
        authority: {
          kind: 'authenticated-user',
          actorUserId: publicRoom.member.userId,
          accountUserId: 101,
        },
      });
      if (
        !closedDirectory.ok
        || closedDirectory.kind !== 'applied'
        || await cleanup.get(directoryRecordKey(directoryRoomId)) !== null
        || await cleanup.zScore(directoryPublicIndexKey, recoveredIndexMember) !== null
        || await cleanup.zScore(
          directoryPublicIndexKey,
          concurrentReplacement.publicIndexMember!,
        ) !== null
        || await cleanup.zCard(directoryPublicIndexKey) !== 0
        || (await directory.discoverPublic({ limit: 50 })).items
          .some((item) => item.roomId === directoryRoomId)
      ) {
        throw new Error('ROOM_DIRECTORY_REDIS_ONLY_ATOMIC_CLOSE_FAILED');
      }

      let throwAfterCommittedCreate = true;
      let unknownSaveEvalAttempts = 0;
      const unknownCountedStore = createRedisRoomStore({
        keyPrefix,
        getClient: () => ({
          get: (key) => cleanup.get(key),
          eval: (script, options) => {
            if (script.includes('ROOM_CHECKPOINT_SAVE_V1')) unknownSaveEvalAttempts += 1;
            return cleanup.eval(script, options);
          },
        } satisfies RedisRoomClient),
      });
      const unknownReplyStore: RoomActorCheckpointStore = {
        load: (id) => unknownCountedStore.load(id),
        refresh: (input) => unknownCountedStore.refresh(input),
        save: async (input) => {
          const result = await unknownCountedStore.save(input);
          if (throwAfterCommittedCreate && result.kind === 'saved') {
            throwAfterCommittedCreate = false;
            throw new Error('SIMULATED_REDIS_REPLY_LOSS_AFTER_COMMIT');
          }
          return result;
        },
      };
      const unknownActors = createRoomActorRegistry({
        store: unknownReplyStore,
        createRoomIdentity: () => ({
          roomId: unknownDirectoryRoomId,
          roomEpoch: 'directory-unknown-epoch-1',
        }),
        createTimestamp: () => TIMESTAMP,
        now: nowAt(TIMESTAMP),
      });
      const unknownMemberships = createArenaRoomMembershipService({
        actors: unknownActors,
        createUserId: () => 'directory-unknown-host',
        now: () => TIMESTAMP,
      });
      let unknownCreateRejected = false;
      try {
        await unknownMemberships.create({
          accountUserId: 505,
          displayName: 'Unknown Reply Host',
          sharedConfig: sharedConfig(),
          directory: { title: 'Unknown reply room', visibility: 'public' },
        });
      } catch (error) {
        unknownCreateRejected = error instanceof Error
          && error.message === 'SIMULATED_REDIS_REPLY_LOSS_AFTER_COMMIT';
      }
      const unknownOldIndex = roomDirectoryPublicIndexMember(unknownDirectoryRoomId, TIMESTAMP);
      if (
        !unknownCreateRejected
        || unknownSaveEvalAttempts !== 1
        || unknownActors.get(unknownDirectoryRoomId) !== null
        || await cleanup.get(roomKey(unknownDirectoryRoomId)) === null
        || await cleanup.get(directoryRecordKey(unknownDirectoryRoomId)) === null
        || await cleanup.zScore(directoryPublicIndexKey, unknownOldIndex) !== 0
      ) {
        throw new Error('ROOM_DIRECTORY_REDIS_ONLY_CREATE_REPLY_LOSS_QUARANTINE_FAILED');
      }
      await unknownActors.shutdown();
      const unknownRecoveryActors = createRoomActorRegistry({
        store: writerStore,
        createRoomEpoch: () => 'directory-unknown-epoch-2',
        recoveryTimestamp: () => NEXT_TIMESTAMP,
        now: nowAt(NEXT_TIMESTAMP),
      });
      const unknownRecovered = await unknownRecoveryActors.recover(unknownDirectoryRoomId);
      const unknownNewIndex = roomDirectoryPublicIndexMember(
        unknownDirectoryRoomId,
        NEXT_TIMESTAMP,
      );
      if (
        unknownRecovered?.getSnapshot()?.snapshot.roomEpoch !== 'directory-unknown-epoch-2'
        || await cleanup.zScore(directoryPublicIndexKey, unknownOldIndex) !== null
        || await cleanup.zScore(directoryPublicIndexKey, unknownNewIndex) !== 0
        || (await directory.lookup(unknownDirectoryRoomId))?.roomId !== unknownDirectoryRoomId
      ) {
        throw new Error('ROOM_DIRECTORY_REDIS_ONLY_CREATE_REPLY_LOSS_RECOVERY_FAILED');
      }
      const closedUnknown = await unknownRecoveryActors.execute({
        roomId: unknownDirectoryRoomId,
        authority: {
          kind: 'authenticated-user',
          actorUserId: 'directory-unknown-host',
          accountUserId: 505,
        },
        command: {
          type: 'close',
          expectedRoomEpoch: 'directory-unknown-epoch-2',
          reason: 'reply-loss-verifier-complete',
          timestamp: THIRD_TIMESTAMP,
        },
      });
      if (!closedUnknown.ok || closedUnknown.kind !== 'applied') {
        throw new Error('ROOM_DIRECTORY_REDIS_ONLY_CREATE_REPLY_LOSS_CLOSE_FAILED');
      }
      await unknownRecoveryActors.shutdown();

      let paginationIdentity = 0;
      let paginationUser = 0;
      const paginationActors = createRoomActorRegistry({
        store: writerStore,
        createRoomIdentity: () => ({
          roomId: paginationDirectoryRoomIds[paginationIdentity]!,
          roomEpoch: `directory-page-epoch-${paginationIdentity++}`,
        }),
        createTimestamp: () => TIMESTAMP,
        now: nowAt(TIMESTAMP),
      });
      const paginationMemberships = createArenaRoomMembershipService({
        actors: paginationActors,
        createUserId: () => `directory-page-host-${++paginationUser}`,
        now: () => TIMESTAMP,
      });
      for (let index = 0; index < paginationDirectoryRoomIds.length; index += 1) {
        await paginationMemberships.create({
          accountUserId: 10_000 + index,
          displayName: `Page Host ${index}`,
          sharedConfig: sharedConfig(),
          directory: { title: `Page room ${index}`, visibility: 'public' },
        });
      }
      const firstDirectoryPage = await directory.discoverPublic({ limit: 50 });
      if (firstDirectoryPage.nextCursor === null) {
        throw new Error('ROOM_DIRECTORY_REDIS_ONLY_PAGINATION_CURSOR_MISSING');
      }
      const secondDirectoryPage = await directory.discoverPublic({
        cursor: firstDirectoryPage.nextCursor,
        limit: 50,
      });
      const pagedRoomIds = [
        ...firstDirectoryPage.items.map((item) => item.roomId),
        ...secondDirectoryPage.items.map((item) => item.roomId),
      ];
      if (
        firstDirectoryPage.items.length !== 50
        || secondDirectoryPage.items.length !== 2
        || secondDirectoryPage.nextCursor !== null
        || new Set(pagedRoomIds).size !== paginationDirectoryRoomIds.length
        || paginationDirectoryRoomIds.some((id) => !pagedRoomIds.includes(id))
      ) {
        throw new Error('ROOM_DIRECTORY_REDIS_ONLY_PAGINATION_FAILED');
      }
      await paginationActors.shutdown();
      await cleanup.zRem(
        directoryPublicIndexKey,
        paginationDirectoryRoomIds.map((id) => roomDirectoryPublicIndexMember(id, TIMESTAMP)),
      );
      await cleanup.unlink([
        ...paginationDirectoryRoomIds.flatMap(roomKeys),
        ...paginationDirectoryRoomIds.map(directoryRecordKey),
      ]);

      const malformedSortedSetMember = '!malformed-directory-member';
      await cleanup.zAdd(directoryPublicIndexKey, {
        score: 0,
        value: malformedSortedSetMember,
      });
      await fixedError(
        directory.discoverPublic({ limit: 1 }),
        'REDIS_ROOM_DIRECTORY_RESPONSE_INVALID',
      );
      if (await cleanup.zScore(directoryPublicIndexKey, malformedSortedSetMember) !== null) {
        throw new Error('ROOM_DIRECTORY_REDIS_ONLY_MALFORMED_MEMBER_CLEANUP_FAILED');
      }

      const authorityCandidateCases = [
        {
          id: wrongEpochDirectoryRoomId,
          checkpoint: createRoom(wrongEpochDirectoryRoomId),
          recordEpoch: 'wrong-epoch',
          hostUserId: 101,
          now: NEXT_TIMESTAMP,
        },
        {
          id: wrongHostDirectoryRoomId,
          checkpoint: createRoom(wrongHostDirectoryRoomId),
          recordEpoch: 'epoch-1',
          hostUserId: 999,
          now: NEXT_TIMESTAMP,
        },
        {
          id: closedCandidateDirectoryRoomId,
          checkpoint: close(createRoom(closedCandidateDirectoryRoomId).nextState),
          recordEpoch: 'epoch-1',
          hostUserId: 101,
          now: NEXT_TIMESTAMP,
        },
        {
          id: expiredCandidateDirectoryRoomId,
          checkpoint: createRoom(expiredCandidateDirectoryRoomId),
          recordEpoch: 'epoch-1',
          hostUserId: 101,
          now: '2026-08-29T00:00:00.000Z',
        },
      ] as const;
      for (const candidateCase of authorityCandidateCases) {
        if (candidateCase.checkpoint.predecessor === null) {
          await writerStore.save({ commit: commit(candidateCase.checkpoint) });
        } else {
          const createdCase = createRoom(candidateCase.id);
          await writerStore.save({ commit: commit(createdCase) });
          await writerStore.save({ commit: commit(candidateCase.checkpoint) });
        }
        const stored = createStoredRoomDirectoryRecord({
          roomId: candidateCase.id,
          roomEpoch: candidateCase.recordEpoch,
          hostUserId: candidateCase.hostUserId,
          title: 'Authority candidate',
          visibility: 'public',
          status: 'open',
          createdAt: TIMESTAMP,
          lastActivityAt: TIMESTAMP,
        });
        await cleanup.set(
          directoryRecordKey(candidateCase.id),
          serializeStoredRoomDirectoryRecord(stored),
        );
        await cleanup.zAdd(directoryPublicIndexKey, {
          score: 0,
          value: stored.publicIndexMember!,
        });
        const scopedDirectory = createArenaRoomDirectoryService({
          authority: readerStore,
          store: directoryStore,
          now: nowAt(candidateCase.now),
        });
        if (
          await scopedDirectory.lookup(candidateCase.id) !== null
          || await cleanup.get(directoryRecordKey(candidateCase.id)) !== null
          || await cleanup.zScore(directoryPublicIndexKey, stored.publicIndexMember!) !== null
        ) {
          throw new Error('ROOM_DIRECTORY_REDIS_ONLY_AUTHORITY_CANDIDATE_CLEANUP_FAILED');
        }
      }

      const staleStored = createStoredRoomDirectoryRecord({
        roomId: staleDirectoryRoomId,
        roomEpoch: 'stale-directory-epoch',
        hostUserId: 404,
        title: 'Stale Redis directory',
        visibility: 'public',
        status: 'open',
        createdAt: TIMESTAMP,
        lastActivityAt: TIMESTAMP,
      });
      await cleanup.set(
        directoryRecordKey(staleDirectoryRoomId),
        serializeStoredRoomDirectoryRecord(staleStored),
      );
      await cleanup.zAdd(directoryPublicIndexKey, {
        score: 0,
        value: staleStored.publicIndexMember!,
      });
      const malformedIndexMember = roomDirectoryPublicIndexMember(
        malformedDirectoryRoomId,
        TIMESTAMP,
      );
      await cleanup.set(directoryRecordKey(malformedDirectoryRoomId), '{not-json');
      await cleanup.zAdd(directoryPublicIndexKey, {
        score: 0,
        value: malformedIndexMember,
      });
      const stalePage = await directory.discoverPublic({ limit: 50 });
      if (
        stalePage.items.some((item) => (
          item.roomId === staleDirectoryRoomId || item.roomId === malformedDirectoryRoomId
        ))
        || await cleanup.get(directoryRecordKey(staleDirectoryRoomId)) !== null
        || await cleanup.get(directoryRecordKey(malformedDirectoryRoomId)) !== null
        || await cleanup.zScore(directoryPublicIndexKey, staleStored.publicIndexMember!) !== null
        || await cleanup.zScore(directoryPublicIndexKey, malformedIndexMember) !== null
      ) {
        throw new Error('ROOM_DIRECTORY_REDIS_ONLY_STALE_CLEANUP_FAILED');
      }
      await recoveredDirectoryActors.shutdown();

      const invalidDirectoryCreateRecord = createRoom(invalidDirectoryCreateRecordRoomId);
      const invalidDirectoryCreateRecordIndex = roomDirectoryPublicIndexMember(
        invalidDirectoryCreateRecordRoomId,
        TIMESTAMP,
      );
      await cleanup.sAdd(directoryRecordKey(invalidDirectoryCreateRecordRoomId), 'wrong-type');
      await fixedError(writerStore.save({
        commit: commit(invalidDirectoryCreateRecord),
        directory: {
          roomId: invalidDirectoryCreateRecordRoomId,
          roomEpoch: 'epoch-1',
          hostUserId: 101,
          title: 'Atomic create record WRONGTYPE verifier',
          visibility: 'public',
          status: 'open',
          createdAt: TIMESTAMP,
          lastActivityAt: TIMESTAMP,
        },
      }), 'REDIS_ROOM_DIRECTORY_INVALID');
      if (
        await cleanup.get(roomKey(invalidDirectoryCreateRecordRoomId)) !== null
        || await cleanup.type(roomFenceKey(invalidDirectoryCreateRecordRoomId)) !== 'none'
        || await cleanup.type(directoryRecordKey(invalidDirectoryCreateRecordRoomId)) !== 'set'
        || await cleanup.zScore(directoryPublicIndexKey, invalidDirectoryCreateRecordIndex) !== null
      ) {
        throw new Error('ROOM_DIRECTORY_REDIS_ONLY_ATOMIC_CREATE_RECORD_WRONGTYPE_FAILED');
      }
      await cleanup.del(directoryRecordKey(invalidDirectoryCreateRecordRoomId));

      const invalidDirectoryCreateIndex = createRoom(invalidDirectoryCreateIndexRoomId);
      await cleanup.set(directoryPublicIndexKey, 'wrong-type');
      await fixedError(writerStore.save({
        commit: commit(invalidDirectoryCreateIndex),
        directory: {
          roomId: invalidDirectoryCreateIndexRoomId,
          roomEpoch: 'epoch-1',
          hostUserId: 101,
          title: 'Atomic create index WRONGTYPE verifier',
          visibility: 'public',
          status: 'open',
          createdAt: TIMESTAMP,
          lastActivityAt: TIMESTAMP,
        },
      }), 'REDIS_ROOM_DIRECTORY_INVALID');
      if (
        await cleanup.get(roomKey(invalidDirectoryCreateIndexRoomId)) !== null
        || await cleanup.type(roomFenceKey(invalidDirectoryCreateIndexRoomId)) !== 'none'
        || await cleanup.get(directoryRecordKey(invalidDirectoryCreateIndexRoomId)) !== null
        || await cleanup.get(directoryPublicIndexKey) !== 'wrong-type'
      ) {
        throw new Error('ROOM_DIRECTORY_REDIS_ONLY_ATOMIC_CREATE_INDEX_WRONGTYPE_FAILED');
      }
      await cleanup.del(directoryPublicIndexKey);

      const disconnectedRuntime = new RedisRuntime(
        redisUrl,
        true,
        undefined,
        undefined,
        keyPrefix,
      );
      await disconnectedRuntime.connect();
      let disconnectedIdentityIndex = 0;
      let disconnectedUserIndex = 0;
      const disconnectedIdentities = [
        {
          roomId: disconnectedDirectoryRoomId,
          roomEpoch: 'directory-disconnected-epoch-1',
        },
        {
          roomId: disconnectedCreateRoomId,
          roomEpoch: 'directory-disconnected-create-epoch-1',
        },
      ];
      const disconnectedActors = createRoomActorRegistry({
        store: disconnectedRuntime.getRoomStore(),
        createRoomIdentity: () => disconnectedIdentities[disconnectedIdentityIndex++]!,
        createTimestamp: () => TIMESTAMP,
        now: nowAt(NEXT_TIMESTAMP),
      });
      const disconnectedMemberships = createArenaRoomMembershipService({
        actors: disconnectedActors,
        createUserId: () => `directory-disconnected-host-${++disconnectedUserIndex}`,
        now: () => NEXT_TIMESTAMP,
      });
      try {
        await disconnectedMemberships.create({
          accountUserId: 606,
          displayName: 'Disconnected Host',
          sharedConfig: sharedConfig(),
          directory: { title: 'Disconnected public room', visibility: 'public' },
        });
        const disconnectedCheckpointRaw = await cleanup.get(
          roomKey(disconnectedDirectoryRoomId),
        );
        const disconnectedDirectoryRaw = await cleanup.get(
          directoryRecordKey(disconnectedDirectoryRoomId),
        );
        const disconnectedIndexMember = roomDirectoryPublicIndexMember(
          disconnectedDirectoryRoomId,
          TIMESTAMP,
        );
        if (disconnectedCheckpointRaw === null || disconnectedDirectoryRaw === null) {
          throw new Error('ROOM_DIRECTORY_REDIS_ONLY_DISCONNECT_SETUP_FAILED');
        }
        await disconnectedRuntime.close();
        await fixedError(disconnectedMemberships.close({
          roomId: disconnectedDirectoryRoomId,
          accountUserId: 606,
          expectedRoomEpoch: 'directory-disconnected-epoch-1',
        }), 'REDIS_ROOM_CHECKPOINT_UNAVAILABLE');
        if (
          disconnectedActors.size !== 0
          || await cleanup.get(roomKey(disconnectedDirectoryRoomId)) !== disconnectedCheckpointRaw
          || await cleanup.get(directoryRecordKey(disconnectedDirectoryRoomId))
            !== disconnectedDirectoryRaw
          || await cleanup.zScore(directoryPublicIndexKey, disconnectedIndexMember) !== 0
        ) {
          throw new Error('ROOM_DIRECTORY_REDIS_ONLY_DISCONNECTED_CLOSE_FAIL_CLOSED_FAILED');
        }
        await fixedError(disconnectedMemberships.create({
          accountUserId: 607,
          displayName: 'Disconnected Create Host',
          sharedConfig: sharedConfig(),
          directory: { title: 'Disconnected create room', visibility: 'public' },
        }), 'REDIS_ROOM_CHECKPOINT_UNAVAILABLE');
        if (
          disconnectedActors.size !== 0
          || await cleanup.get(roomKey(disconnectedCreateRoomId)) !== null
          || await cleanup.type(roomFenceKey(disconnectedCreateRoomId)) !== 'none'
          || await cleanup.get(directoryRecordKey(disconnectedCreateRoomId)) !== null
          || await cleanup.zScore(
            directoryPublicIndexKey,
            roomDirectoryPublicIndexMember(disconnectedCreateRoomId, TIMESTAMP),
          ) !== null
        ) {
          throw new Error('ROOM_DIRECTORY_REDIS_ONLY_DISCONNECTED_CREATE_FAIL_CLOSED_FAILED');
        }
        const disconnectedPersisted = await readerStore.load(disconnectedDirectoryRoomId);
        if (
          disconnectedPersisted === null
          || (await writerStore.delete({ checkpoint: disconnectedPersisted })).kind !== 'deleted'
          || await cleanup.get(directoryRecordKey(disconnectedDirectoryRoomId)) !== null
          || await cleanup.zScore(directoryPublicIndexKey, disconnectedIndexMember) !== null
        ) {
          throw new Error('ROOM_DIRECTORY_REDIS_ONLY_DISCONNECT_CLEANUP_FAILED');
        }
      } finally {
        await disconnectedActors.shutdown();
        await disconnectedRuntime.close();
      }

      const invalidRecordCreated = createRoom(invalidDirectoryRecordStorageRoomId);
      await writerStore.save({ commit: commit(invalidRecordCreated) });
      const invalidRecordCheckpointRaw = await cleanup.get(
        roomKey(invalidDirectoryRecordStorageRoomId),
      );
      await cleanup.sAdd(directoryRecordKey(invalidDirectoryRecordStorageRoomId), 'wrong-type');
      await fixedError(writerStore.save({
        commit: commit(publish(invalidRecordCreated.nextState)),
      }), 'REDIS_ROOM_DIRECTORY_INVALID');
      if (
        await cleanup.get(roomKey(invalidDirectoryRecordStorageRoomId))
          !== invalidRecordCheckpointRaw
      ) {
        throw new Error('ROOM_DIRECTORY_REDIS_ONLY_RECORD_WRONGTYPE_PARTIAL_COMMIT');
      }
      await cleanup.del(directoryRecordKey(invalidDirectoryRecordStorageRoomId));

      const invalidDirectoryCreated = createRoom(invalidDirectoryStorageRoomId);
      await writerStore.save({
        commit: commit(invalidDirectoryCreated),
        directory: {
          roomId: invalidDirectoryStorageRoomId,
          roomEpoch: 'epoch-1',
          hostUserId: 101,
          title: 'Directory WRONGTYPE verifier',
          visibility: 'public',
          status: 'open',
          createdAt: TIMESTAMP,
          lastActivityAt: TIMESTAMP,
        },
      });
      const invalidDirectoryCheckpointRaw = await cleanup.get(
        roomKey(invalidDirectoryStorageRoomId),
      );
      const invalidDirectoryRaw = await cleanup.get(
        directoryRecordKey(invalidDirectoryStorageRoomId),
      );
      if (invalidDirectoryRaw === null) {
        throw new Error('ROOM_DIRECTORY_REDIS_ONLY_STORAGE_TYPE_SETUP_FAILED');
      }
      await cleanup.del(directoryPublicIndexKey);
      await cleanup.set(directoryPublicIndexKey, 'wrong-type');
      await fixedError(writerStore.save({
        commit: commit(close(invalidDirectoryCreated.nextState)),
      }), 'REDIS_ROOM_DIRECTORY_INVALID');
      await fixedError(writerStore.expire({
        checkpoint: invalidDirectoryCreated.nextState,
      }), 'REDIS_ROOM_DIRECTORY_INVALID');
      await fixedError(writerStore.delete({
        checkpoint: invalidDirectoryCreated.nextState,
      }), 'REDIS_ROOM_DIRECTORY_INVALID');
      const invalidDirectoryCandidate = await directoryStore.candidateFromRaw({
        roomId: invalidDirectoryStorageRoomId,
        raw: invalidDirectoryRaw,
        indexMember: roomDirectoryPublicIndexMember(invalidDirectoryStorageRoomId, TIMESTAMP),
      });
      await fixedError(
        directoryStore.removeIfExact(invalidDirectoryCandidate),
        'REDIS_ROOM_DIRECTORY_INVALID',
      );
      await fixedError(directory.discoverPublic({ limit: 1 }), 'REDIS_ROOM_COMMAND_FAILED');
      if (
        await cleanup.get(roomKey(invalidDirectoryStorageRoomId))
          !== invalidDirectoryCheckpointRaw
        || await cleanup.get(directoryRecordKey(invalidDirectoryStorageRoomId))
          !== invalidDirectoryRaw
      ) {
        throw new Error('ROOM_DIRECTORY_REDIS_ONLY_STORAGE_TYPE_PARTIAL_COMMIT');
      }
      await cleanup.del(directoryPublicIndexKey);

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
        generationReservationBeforeProducer: true,
        generationSingleProducer: true,
        generationHostDisconnectPublisher: true,
        generationProcessRecovery: true,
        generationOldEpochAttemptFence: true,
        generationTerminalAuthority: true,
        generationSecretIsolation: true,
        redisOnlyDirectory: true,
        directoryAtomicCreateIndex: true,
        directoryUnlistedKnownJoin: true,
        directoryRecoveryRebind: true,
        directoryLifecycleTtlRefresh: true,
        directoryActiveSubscriberTtlRefresh: true,
        directoryPresenceWriteIsolation: true,
        directoryStaleIndexRecordPreservation: true,
        directoryConcurrentReplacementPreservation: true,
        directoryCreateReplyLossRecovery: true,
        directoryBoundedPagination: true,
        directoryAtomicClose: true,
        directoryStaleCleanup: true,
        directoryMalformedCleanup: true,
        directoryMalformedMemberCleanup: true,
        directoryAuthorityCandidateCleanup: true,
        directoryFaultMatrixFailClosed: true,
        directoryStorageTypeFailClosed: true,
        directoryAtomicCreateStorageTypeFailClosed: true,
        directoryDisconnectedRuntimeFailClosed: true,
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
    const directoryIndexCleanupType = await cleanup.type(directoryPublicIndexKey);
    if (directoryIndexCleanupType === 'zset') await cleanup.zRem(directoryPublicIndexKey, [
      roomDirectoryPublicIndexMember(roomId, TIMESTAMP),
      roomDirectoryPublicIndexMember(roomId, NEXT_TIMESTAMP),
      roomDirectoryPublicIndexMember(roomId, THIRD_TIMESTAMP),
      roomDirectoryPublicIndexMember(directoryRoomId, TIMESTAMP),
      roomDirectoryPublicIndexMember(directoryRoomId, NEXT_TIMESTAMP),
      roomDirectoryPublicIndexMember(directoryRoomId, THIRD_TIMESTAMP),
      roomDirectoryPublicIndexMember(unlistedDirectoryRoomId, TIMESTAMP),
      roomDirectoryPublicIndexMember(staleDirectoryRoomId, TIMESTAMP),
      roomDirectoryPublicIndexMember(malformedDirectoryRoomId, TIMESTAMP),
      roomDirectoryPublicIndexMember(unknownDirectoryRoomId, TIMESTAMP),
      roomDirectoryPublicIndexMember(unknownDirectoryRoomId, NEXT_TIMESTAMP),
      roomDirectoryPublicIndexMember(wrongEpochDirectoryRoomId, TIMESTAMP),
      roomDirectoryPublicIndexMember(wrongHostDirectoryRoomId, TIMESTAMP),
      roomDirectoryPublicIndexMember(closedCandidateDirectoryRoomId, TIMESTAMP),
      roomDirectoryPublicIndexMember(expiredCandidateDirectoryRoomId, TIMESTAMP),
      roomDirectoryPublicIndexMember(invalidDirectoryStorageRoomId, TIMESTAMP),
      roomDirectoryPublicIndexMember(invalidDirectoryCreateRecordRoomId, TIMESTAMP),
      roomDirectoryPublicIndexMember(invalidDirectoryCreateIndexRoomId, TIMESTAMP),
      roomDirectoryPublicIndexMember(disconnectedDirectoryRoomId, TIMESTAMP),
      roomDirectoryPublicIndexMember(disconnectedCreateRoomId, TIMESTAMP),
      ...paginationDirectoryRoomIds.map((id) => roomDirectoryPublicIndexMember(id, TIMESTAMP)),
    ]);
    else if (directoryIndexCleanupType !== 'none') await cleanup.del(directoryPublicIndexKey);
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
      ...roomKeys(generationRoomId),
      ...roomKeys(authorityRoomId),
      ...roomKeys(directoryRoomId),
      ...roomKeys(unlistedDirectoryRoomId),
      ...roomKeys(staleDirectoryRoomId),
      ...roomKeys(malformedDirectoryRoomId),
      ...roomKeys(invalidDirectoryStorageRoomId),
      ...roomKeys(invalidDirectoryRecordStorageRoomId),
      ...roomKeys(invalidDirectoryCreateRecordRoomId),
      ...roomKeys(invalidDirectoryCreateIndexRoomId),
      ...roomKeys(disconnectedDirectoryRoomId),
      ...roomKeys(disconnectedCreateRoomId),
      ...roomKeys(wrongEpochDirectoryRoomId),
      ...roomKeys(wrongHostDirectoryRoomId),
      ...roomKeys(closedCandidateDirectoryRoomId),
      ...roomKeys(expiredCandidateDirectoryRoomId),
      ...roomKeys(unknownDirectoryRoomId),
      ...paginationDirectoryRoomIds.flatMap(roomKeys),
      ticketReplayKey,
      authorityTicketReplayKey,
      directoryRecordKey(roomId),
      directoryRecordKey(directoryRoomId),
      directoryRecordKey(unlistedDirectoryRoomId),
      directoryRecordKey(staleDirectoryRoomId),
      directoryRecordKey(malformedDirectoryRoomId),
      directoryRecordKey(unknownDirectoryRoomId),
      directoryRecordKey(invalidDirectoryStorageRoomId),
      directoryRecordKey(invalidDirectoryRecordStorageRoomId),
      directoryRecordKey(invalidDirectoryCreateRecordRoomId),
      directoryRecordKey(invalidDirectoryCreateIndexRoomId),
      directoryRecordKey(disconnectedDirectoryRoomId),
      directoryRecordKey(disconnectedCreateRoomId),
      directoryRecordKey(wrongEpochDirectoryRoomId),
      directoryRecordKey(wrongHostDirectoryRoomId),
      directoryRecordKey(closedCandidateDirectoryRoomId),
      directoryRecordKey(expiredCandidateDirectoryRoomId),
      ...paginationDirectoryRoomIds.map(directoryRecordKey),
    ]);
  }
  await cleanup.quit();
}
