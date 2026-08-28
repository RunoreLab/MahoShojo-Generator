import type {
  ArenaMultiplayerGenerationSnapshot,
  ArenaRoomGenerationStartRequest,
  ArenaRoomGenerationViewResponse,
} from '@mahoshojo/contracts/arena-room';
import { ArenaRoomGenerationViewResponseSchema } from '@mahoshojo/contracts/arena-room';
import {
  issueArenaRoomGenerationPublisherAuthority,
  issueArenaRoomGenerationReservationAuthority,
  issueArenaRoomTrustedTime,
  type ArenaRoomAuthorityState,
} from '@mahoshojo/multiplayer-core';

import type {
  ArenaRoomGenerationPort,
  ArenaRoomGenerationSubscription,
} from '../arena-generation/room-generation-port';
import {
  ArenaDataCardRefVerifierError,
  type ArenaDataCardRefVerifier,
} from './arena-data-card-ref-verifier';
import type {
  ArenaRoomMembershipService,
  ResolvedArenaRoomMembership,
} from './room-membership-service';
import {
  createRoomGenerationPublisher,
  type RoomGenerationPublisher,
  type RoomGenerationPublisherOptions,
} from './room-generation-publisher';
import {
  createArenaRoomGenerationSnapshot,
  createArenaRoomGenerationSnapshotFromFrozen,
  listArenaRoomGenerationRefs,
} from './room-generation-snapshot';

export type ArenaRoomGenerationErrorCode =
  | 'ROOM_EPOCH_STALE'
  | 'ROOM_GENERATION_CONFLICT'
  | 'ROOM_GENERATION_NOT_FOUND'
  | 'ROOM_GENERATION_UNAVAILABLE'
  | 'ROOM_GENERATION_INPUT_INVALID'
  | 'ROOM_PERMISSION_DENIED'
  | 'ROOM_REFERENCE_DENIED'
  | 'ROOM_REFERENCE_STALE'
  | 'ROOM_REFERENCE_UNAVAILABLE'
  | 'ROOM_REVISION_STALE'
  | 'ROOM_OPERATION_UNKNOWN';

export class ArenaRoomGenerationError extends Error {
  constructor(readonly code: ArenaRoomGenerationErrorCode) {
    super(code);
    this.name = 'ArenaRoomGenerationError';
  }
}

export type ArenaRoomGenerationService = {
  start(input: {
    readonly roomId: string;
    readonly accountUserId: number;
    readonly request: ArenaRoomGenerationStartRequest;
    readonly sourceRequest: Request;
  }): Promise<ArenaRoomGenerationViewResponse>;
  read(input: {
    readonly roomId: string;
    readonly generationId: string;
    readonly accountUserId: number;
  }): Promise<ArenaRoomGenerationViewResponse>;
};

export type ArenaRoomGenerationServiceOptions = {
  readonly memberships: Pick<ArenaRoomMembershipService, 'resolveActiveByAccount'>;
  readonly references: ArenaDataCardRefVerifier;
  readonly generation: ArenaRoomGenerationPort;
  readonly createPublisher?: (
    options: RoomGenerationPublisherOptions,
  ) => RoomGenerationPublisher;
  readonly now?: () => string;
  readonly onBackgroundError?: (error: unknown) => void;
};

type OwnedProjection = Extract<
  Awaited<ReturnType<ArenaRoomGenerationPort['readOwnedProjection']>>,
  { kind: 'found' }
>['projection'];

type ActivePublisher = {
  readonly publisher: RoomGenerationPublisher;
  readonly promise: Promise<void>;
};

const fail = (code: ArenaRoomGenerationErrorCode): never => {
  throw new ArenaRoomGenerationError(code);
};

const validAccountUserId = (value: number): boolean => (
  Number.isSafeInteger(value) && value > 0
);

const userAuthority = (membership: ResolvedArenaRoomMembership) => ({
  kind: 'authenticated-user' as const,
  actorUserId: membership.member.userId,
  accountUserId: membership.accountUserId,
});

const monotonicTimestamp = (
  now: () => string,
  state: ArenaRoomAuthorityState,
): string => {
  const supplied = Date.parse(now());
  const current = Date.parse(state.lifecycle.updatedAt);
  if (!Number.isFinite(supplied)) return fail('ROOM_GENERATION_INPUT_INVALID');
  return new Date(Math.max(supplied, current)).toISOString();
};

const publisherExpiry = (timestamp: string): string => (
  new Date(Date.parse(timestamp) + 24 * 60 * 60 * 1_000).toISOString()
);

const mapReferenceError = (error: unknown): never => {
  if (!(error instanceof ArenaDataCardRefVerifierError)) throw error;
  switch (error.code) {
    case 'ARENA_DATA_CARD_REF_VERSION_MISMATCH': return fail('ROOM_REFERENCE_STALE');
    case 'ARENA_DATA_CARD_REF_NOT_READABLE': return fail('ROOM_REFERENCE_DENIED');
    case 'ARENA_DATA_CARD_REF_INPUT_INVALID': return fail('ROOM_GENERATION_INPUT_INVALID');
    default: return fail('ROOM_REFERENCE_UNAVAILABLE');
  }
};

const mapTransitionFailure = (reason: string): never => {
  switch (reason) {
    case 'room-epoch-mismatch': return fail('ROOM_EPOCH_STALE');
    case 'room-revision-mismatch': return fail('ROOM_REVISION_STALE');
    case 'host-required':
    case 'member-required': return fail('ROOM_PERMISSION_DENIED');
    case 'generation-active':
    case 'generation-id-conflict':
    case 'generation-request-conflict':
    case 'generation-transition-invalid': return fail('ROOM_GENERATION_CONFLICT');
    default: return fail('ROOM_OPERATION_UNKNOWN');
  }
};

const statusFromMirror = (
  state: ArenaRoomGenerationViewResponse['generation']['state'],
): ArenaRoomGenerationViewResponse['status'] => {
  switch (state) {
    case 'starting': return 'reserved';
    case 'running': return 'running';
    case 'completed': return 'completed';
    case 'failed': return 'failed';
    case 'cancelled': return 'cancelled';
  }
};

const view = (input: {
  readonly state: ArenaRoomAuthorityState;
  readonly generationId: string;
  readonly projection?: OwnedProjection;
  readonly progress?: { readonly markdown: string; readonly nextChunkSeq: number };
}): ArenaRoomGenerationViewResponse => {
  const mirror = input.state.snapshot.activeGeneration;
  if (!mirror || mirror.generationId !== input.generationId) {
    return fail('ROOM_GENERATION_NOT_FOUND');
  }
  const status = input.projection?.status ?? statusFromMirror(mirror.state);
  const markdown = input.progress?.markdown
    || input.projection?.markdown
    || '';
  const nextChunkSeq = input.progress?.nextChunkSeq ?? 0;
  const completed = status === 'completed';
  const failed = status === 'failed' || status === 'producer_lost';
  if (completed && (!input.projection?.resultAvailable || !input.projection.generationRecordId)) {
    return fail('ROOM_GENERATION_UNAVAILABLE');
  }
  return ArenaRoomGenerationViewResponseSchema.parse({
    protocolVersion: 1,
    roomId: input.state.snapshot.roomId,
    roomEpoch: input.state.snapshot.roomEpoch,
    generation: mirror,
    status,
    markdown,
    nextChunkSeq,
    finalAuthoritative: completed,
    ...(completed ? { generationRecordId: input.projection!.generationRecordId! } : {}),
    ...(failed ? { errorCode: input.projection?.errorCode ?? 'GENERATION_FAILED' } : {}),
  });
};

export const createArenaRoomGenerationService = (
  options: ArenaRoomGenerationServiceOptions,
): ArenaRoomGenerationService => {
  const now = options.now ?? (() => new Date().toISOString());
  const publisherFactory = options.createPublisher ?? createRoomGenerationPublisher;
  const publishers = new Map<string, ActivePublisher>();

  const resolveMembership = async (
    roomId: string,
    accountUserId: number,
  ): Promise<ResolvedArenaRoomMembership> => {
    if (!validAccountUserId(accountUserId)) return fail('ROOM_GENERATION_INPUT_INVALID');
    return options.memberships.resolveActiveByAccount({ roomId, accountUserId });
  };

  const verifyRefs = async (
    snapshot: ArenaMultiplayerGenerationSnapshot,
    hostAccountUserId: number,
  ): Promise<void> => {
    try {
      await options.references.verify({
        refs: listArenaRoomGenerationRefs(snapshot.sharedConfig),
        hostAccountUserId,
      });
    } catch (error) {
      mapReferenceError(error);
    }
  };

  const publisherAuthority = (
    state: ArenaRoomAuthorityState,
    generationId: string,
  ) => {
    const mirror = state.snapshot.activeGeneration;
    if (!mirror || mirror.generationId !== generationId) {
      return fail('ROOM_GENERATION_NOT_FOUND');
    }
    const issuedAt = monotonicTimestamp(now, state);
    return issueArenaRoomGenerationPublisherAuthority({
      roomId: state.snapshot.roomId,
      roomEpoch: state.snapshot.roomEpoch,
      generationRequestId: mirror.generationRequestId,
      generationId: mirror.generationId,
      attempt: mirror.attempt,
      expiresAt: publisherExpiry(issuedAt),
    });
  };

  const beginPublisher = (
    membership: ResolvedArenaRoomMembership,
    subscription: ArenaRoomGenerationSubscription,
    initial?: { readonly markdown: string; readonly nextChunkSeq: number },
  ): RoomGenerationPublisher => {
    const existing = publishers.get(subscription.generationId);
    if (existing) return existing.publisher;
    const current = membership.actor.getSnapshot();
    if (!current) return fail('ROOM_GENERATION_NOT_FOUND');
    const publisher = publisherFactory({
      actor: membership.actor,
      authority: publisherAuthority(current, subscription.generationId),
      now: () => Date.parse(now()),
      ...(initial === undefined ? {} : { initial }),
    });
    const active: ActivePublisher = {
      publisher,
      promise: Promise.resolve(),
    };
    const promise = publisher.attach(subscription)
      .then((result) => {
        if (result.kind === 'rejected') {
          options.onBackgroundError?.(new Error(`ROOM_GENERATION_PUBLISH_REJECTED:${result.reason}`));
        }
      })
      .catch((error: unknown) => {
        options.onBackgroundError?.(error);
      })
      .finally(() => {
        if (publishers.get(subscription.generationId)?.publisher === publisher) {
          publishers.delete(subscription.generationId);
        }
      });
    publishers.set(subscription.generationId, { ...active, promise });
    return publisher;
  };

  const executeMirror = async (
    membership: ResolvedArenaRoomMembership,
    projection: OwnedProjection,
  ): Promise<ArenaRoomAuthorityState> => {
    let state = membership.actor.getSnapshot();
    if (!state) return fail('ROOM_GENERATION_NOT_FOUND');
    const mirror = state.snapshot.activeGeneration;
    if (
      !mirror
      || mirror.generationId !== projection.generationId
      || mirror.generationRequestId !== projection.generationRequestId
    ) return fail('ROOM_GENERATION_NOT_FOUND');
    const terminalState = projection.status === 'completed'
      ? 'completed'
      : projection.status === 'failed' || projection.status === 'producer_lost'
        ? 'failed'
        : projection.status === 'cancelled'
          ? 'cancelled'
          : null;
    const execute = async (
      target: 'running' | 'completed' | 'failed' | 'cancelled',
    ): Promise<void> => {
      const current = membership.actor.getSnapshot();
      if (!current) return fail('ROOM_GENERATION_NOT_FOUND');
      const timestamp = monotonicTimestamp(now, current);
      const authority = publisherAuthority(current, projection.generationId);
      const result = await membership.actor.execute({
        authority,
        command: {
          type: 'mirror-generation',
          expectedRoomEpoch: current.snapshot.roomEpoch,
          generationRequestId: mirror.generationRequestId,
          generationId: mirror.generationId,
          attempt: mirror.attempt,
          state: target,
          ...(target === 'completed' && projection.generationRecordId
            ? { generationRecordId: projection.generationRecordId }
            : {}),
          ...(target === 'failed' ? { errorCode: 'generation-failed' as const } : {}),
          timestamp,
        },
        trustedTime: issueArenaRoomTrustedTime({ now: timestamp }),
      });
      if (!result.ok) mapTransitionFailure(result.reason);
    };
    if (mirror.state === 'starting' && projection.status !== 'reserved') await execute('running');
    state = membership.actor.getSnapshot();
    if (!state) return fail('ROOM_GENERATION_NOT_FOUND');
    const currentMirror = state.snapshot.activeGeneration;
    if (terminalState && currentMirror?.state === 'running') await execute(terminalState);
    state = membership.actor.getSnapshot();
    if (!state) return fail('ROOM_GENERATION_NOT_FOUND');
    return state;
  };

  const readProjection = async (
    membership: ResolvedArenaRoomMembership,
    generationId: string,
    attach: boolean,
  ): Promise<ArenaRoomGenerationViewResponse> => {
    const result = await options.generation.readOwnedProjection({
      roomId: membership.roomId,
      generationId,
    });
    if (result.kind === 'not-found') return fail('ROOM_GENERATION_NOT_FOUND');
    if (result.kind === 'unavailable') return fail('ROOM_GENERATION_UNAVAILABLE');
    const reconciled = await executeMirror(membership, result.projection);
    let publisher = publishers.get(generationId)?.publisher;
    if (
      attach
      && !publisher
      && (result.projection.status === 'reserved'
        || result.projection.status === 'running'
        || result.projection.status === 'finalizing')
    ) {
      const resumed = await options.generation.resumeOwnedSubscription({
        roomId: membership.roomId,
        generationId,
        after: result.projection.resumeCursor,
      });
      if (resumed.kind === 'unavailable') return fail('ROOM_GENERATION_UNAVAILABLE');
      if (resumed.kind === 'not-found') return fail('ROOM_GENERATION_NOT_FOUND');
      publisher = beginPublisher(membership, resumed.subscription, {
        markdown: result.projection.markdown,
        nextChunkSeq: 0,
      });
    }
    return view({
      state: reconciled,
      generationId,
      projection: result.projection,
      ...(publisher ? { progress: publisher.getProgress() } : {}),
    });
  };

  const startSubscription = async (input: {
    readonly membership: ResolvedArenaRoomMembership;
    readonly sourceRequest: Request;
    readonly generationPayload: Readonly<Record<string, unknown>>;
    readonly snapshot: ArenaMultiplayerGenerationSnapshot;
    readonly generationId: string;
  }): Promise<ArenaRoomGenerationViewResponse> => {
    const internalGuidance = typeof input.generationPayload.internalGuidance === 'string'
      ? input.generationPayload.internalGuidance.trim()
      : '';
    if (!internalGuidance) return fail('ROOM_GENERATION_INPUT_INVALID');
    let result;
    try {
      result = await options.generation.startFromHostRequest({
        request: input.sourceRequest,
        roomId: input.membership.roomId,
        generationRequestId: input.snapshot.generationRequestId,
        payload: input.generationPayload,
        internalGuidance,
        pvpContext: { matchId: input.generationId, roundId: 'attempt-1' },
        multiplayerSnapshot: input.snapshot,
      });
    } catch {
      return fail('ROOM_OPERATION_UNKNOWN');
    }
    if (result.kind === 'rejected') {
      if (result.status >= 500) return fail('ROOM_OPERATION_UNKNOWN');
      const current = input.membership.actor.getSnapshot();
      if (!current) return fail('ROOM_GENERATION_NOT_FOUND');
      const mirror = current.snapshot.activeGeneration;
      if (!mirror || mirror.generationId !== input.generationId) {
        return fail('ROOM_GENERATION_NOT_FOUND');
      }
      const timestamp = monotonicTimestamp(now, current);
      const cancelled = await input.membership.actor.execute({
        authority: publisherAuthority(current, input.generationId),
        command: {
          type: 'mirror-generation',
          expectedRoomEpoch: current.snapshot.roomEpoch,
          generationRequestId: mirror.generationRequestId,
          generationId: mirror.generationId,
          attempt: mirror.attempt,
          state: 'cancelled',
          timestamp,
        },
        trustedTime: issueArenaRoomTrustedTime({ now: timestamp }),
      });
      if (!cancelled.ok) return mapTransitionFailure(cancelled.reason);
      return fail('ROOM_GENERATION_CONFLICT');
    }
    const publisher = beginPublisher(input.membership, result.subscription);
    const state = input.membership.actor.getSnapshot();
    if (!state) return fail('ROOM_GENERATION_NOT_FOUND');
    return view({
      state,
      generationId: input.generationId,
      progress: publisher.getProgress(),
    });
  };

  return Object.freeze({
    async start(input) {
      const membership = await resolveMembership(input.roomId, input.accountUserId);
      if (membership.member.role !== 'host') return fail('ROOM_PERMISSION_DENIED');
      if (membership.state.snapshot.roomEpoch !== input.request.expectedRoomEpoch) {
        return fail('ROOM_EPOCH_STALE');
      }
      const generationId = await options.generation.deriveGenerationId({
        roomId: membership.roomId,
        generationRequestId: input.request.generationRequestId,
      });
      const historical = membership.state.generationLedger.find((record) => (
        record.mirror.generationRequestId === input.request.generationRequestId
      ));
      if (historical) {
        if (historical.mirror.generationId !== generationId || historical.mirror.attempt !== 1) {
          return fail('ROOM_GENERATION_CONFLICT');
        }
        const snapshot = createArenaRoomGenerationSnapshotFromFrozen({
          roomId: membership.roomId,
          generationRequestId: historical.mirror.generationRequestId,
          configRevision: historical.mirror.configRevision,
          collaborativeInfluence: historical.mirror.collaborativeInfluence,
          participantUserIds: historical.mirror.participantUserIds,
          sharedConfig: input.request.sharedConfig,
        });
        if (snapshot.snapshotDigest !== historical.mirror.snapshotDigest) {
          return fail('ROOM_GENERATION_CONFLICT');
        }
        const active = publishers.get(generationId)?.publisher;
        const current = membership.actor.getSnapshot();
        if (!current) return fail('ROOM_GENERATION_NOT_FOUND');
        if (active) {
          return view({ state: current, generationId, progress: active.getProgress() });
        }
        const durable = await options.generation.readOwnedProjection({
          roomId: membership.roomId,
          generationId,
        });
        if (durable.kind === 'found') {
          return readProjection(membership, generationId, true);
        }
        if (durable.kind === 'unavailable') return fail('ROOM_OPERATION_UNKNOWN');
        await verifyRefs(snapshot, membership.accountUserId);
        const timestamp = monotonicTimestamp(now, current);
        const reservation = await membership.actor.execute({
          authority: issueArenaRoomGenerationReservationAuthority({
            actorUserId: membership.member.userId,
            accountUserId: membership.accountUserId,
            roomId: membership.roomId,
            roomEpoch: current.snapshot.roomEpoch,
            configRevision: snapshot.configRevision,
            generationRequestId: snapshot.generationRequestId,
            generationId,
            attempt: 1,
            snapshotDigest: snapshot.snapshotDigest,
            expiresAt: publisherExpiry(timestamp),
          }),
          command: {
            type: 'reserve-generation',
            expectedRoomEpoch: current.snapshot.roomEpoch,
            expectedRevision: snapshot.configRevision,
            generationRequestId: snapshot.generationRequestId,
            generationId,
            attempt: 1,
            timestamp,
          },
          trustedTime: issueArenaRoomTrustedTime({ now: timestamp }),
        });
        if (!reservation.ok) mapTransitionFailure(reservation.reason);
        return startSubscription({
          membership,
          sourceRequest: input.sourceRequest,
          generationPayload: input.request.generation,
          snapshot,
          generationId,
        });
      }

      if (membership.state.snapshot.activeGeneration?.state === 'starting'
        || membership.state.snapshot.activeGeneration?.state === 'running') {
        return fail('ROOM_GENERATION_CONFLICT');
      }
      if (membership.state.snapshot.revision !== input.request.expectedRevision) {
        return fail('ROOM_REVISION_STALE');
      }
      let state = membership.state;
      if (JSON.stringify(state.snapshot.sharedConfig) !== JSON.stringify(input.request.sharedConfig)) {
        const timestamp = monotonicTimestamp(now, state);
        const published = await membership.actor.execute({
          authority: userAuthority(membership),
          command: {
            type: 'publish-config',
            expectedRoomEpoch: state.snapshot.roomEpoch,
            expectedRevision: state.snapshot.revision,
            sharedConfig: input.request.sharedConfig,
            timestamp,
          },
        });
        if (!published.ok) return mapTransitionFailure(published.reason);
        state = published.nextState;
      }
      const snapshot = createArenaRoomGenerationSnapshot(state, input.request.generationRequestId);
      await verifyRefs(snapshot, membership.accountUserId);
      const timestamp = monotonicTimestamp(now, state);
      const reservation = await membership.actor.execute({
        authority: issueArenaRoomGenerationReservationAuthority({
          actorUserId: membership.member.userId,
          accountUserId: membership.accountUserId,
          roomId: membership.roomId,
          roomEpoch: state.snapshot.roomEpoch,
          configRevision: snapshot.configRevision,
          generationRequestId: snapshot.generationRequestId,
          generationId,
          attempt: 1,
          snapshotDigest: snapshot.snapshotDigest,
          expiresAt: publisherExpiry(timestamp),
        }),
        command: {
          type: 'reserve-generation',
          expectedRoomEpoch: state.snapshot.roomEpoch,
          expectedRevision: snapshot.configRevision,
          generationRequestId: snapshot.generationRequestId,
          generationId,
          attempt: 1,
          timestamp,
        },
        trustedTime: issueArenaRoomTrustedTime({ now: timestamp }),
      });
      if (!reservation.ok) mapTransitionFailure(reservation.reason);
      return startSubscription({
        membership,
        sourceRequest: input.sourceRequest,
        generationPayload: input.request.generation,
        snapshot,
        generationId,
      });
    },

    async read(input) {
      const membership = await resolveMembership(input.roomId, input.accountUserId);
      const active = membership.state.snapshot.activeGeneration;
      if (!active || active.generationId !== input.generationId) {
        return fail('ROOM_GENERATION_NOT_FOUND');
      }
      return readProjection(membership, input.generationId, true);
    },
  });
};
