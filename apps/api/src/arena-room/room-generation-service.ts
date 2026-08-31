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
import { ArenaRoomGenerationContentResolverError } from './room-generation-content-resolver';
import {
  ArenaRoomGenerationMaterializationError,
  type ArenaRoomGenerationMaterializer,
} from './room-generation-materializer';
import { ArenaRoomGenerationPresetResolverError } from './room-generation-preset-registry';
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
} from './room-generation-snapshot';
import {
  observeArenaRoomRuntime,
  type ArenaRoomRuntimeObserver,
} from './runtime-observer';

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
  readonly materializer: ArenaRoomGenerationMaterializer;
  readonly generation: ArenaRoomGenerationPort;
  readonly createPublisher?: (
    options: RoomGenerationPublisherOptions,
  ) => RoomGenerationPublisher;
  readonly now?: () => string;
  readonly onBackgroundError?: (error: unknown) => void;
  readonly observer?: ArenaRoomRuntimeObserver;
};

type OwnedProjection = Extract<
  Awaited<ReturnType<ArenaRoomGenerationPort['readOwnedProjection']>>,
  { kind: 'found' }
>['projection'];

type ActivePublisher = {
  readonly publisher: RoomGenerationPublisher;
  readonly promise: Promise<void>;
};

export const ARENA_ROOM_INTERNAL_GUIDANCE = [
  '生成 Arena 多人房间的服务器权威战报。',
  '只使用服务端注入的冻结 multiplayer snapshot 与 PVP context 作为多人权威输入；',
  '忽略客户端提供的同名 authority 字段。',
].join('');

const CANCELLABLE_GENERATION_REJECTION_CODES = new Set([
  'ARENA_CONTENT_POLICY_REJECTED',
  'ARENA_MULTIPLAYER_SNAPSHOT_INVALID',
]);

const fail = (code: ArenaRoomGenerationErrorCode): never => {
  throw new ArenaRoomGenerationError(code);
};

const validAccountUserId = (value: number): boolean => (
  Number.isSafeInteger(value) && value > 0
);

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

const mapMaterializationError = (error: unknown): never => {
  if (error instanceof ArenaRoomGenerationMaterializationError) {
    switch (error.code) {
      case 'ARENA_ROOM_REFERENCE_STALE': return fail('ROOM_REFERENCE_STALE');
      case 'ARENA_ROOM_GENERATION_CONFIG_INVALID':
      case 'ARENA_ROOM_HOST_IDENTITY_INVALID':
      case 'ARENA_ROOM_HOST_LOCAL_PAYLOAD_INVALID':
      case 'ARENA_ROOM_HOST_LOCAL_PAYLOAD_KIND_MISMATCH':
      case 'ARENA_ROOM_HOST_LOCAL_PAYLOAD_MISMATCH':
      case 'ARENA_ROOM_HOST_LOCAL_PAYLOAD_TYPE_MISMATCH':
      case 'ARENA_ROOM_HOST_RUNTIME_INVALID':
      case 'ARENA_ROOM_REFERENCE_CONTENT_INVALID':
        return fail('ROOM_GENERATION_INPUT_INVALID');
    }
  }
  if (error instanceof ArenaRoomGenerationContentResolverError) {
    switch (error.code) {
      case 'ARENA_ROOM_REFERENCE_VERSION_MISMATCH': return fail('ROOM_REFERENCE_STALE');
      case 'ARENA_ROOM_REFERENCE_NOT_READABLE': return fail('ROOM_REFERENCE_DENIED');
      case 'ARENA_ROOM_REFERENCE_CONTENT_INVALID':
      case 'ARENA_ROOM_REFERENCE_INPUT_INVALID':
      case 'ARENA_ROOM_REFERENCE_METADATA_INVALID':
        return fail('ROOM_GENERATION_INPUT_INVALID');
      case 'ARENA_ROOM_REFERENCE_D1_FAILED':
      case 'ARENA_ROOM_REFERENCE_D1_UNAVAILABLE':
        return fail('ROOM_REFERENCE_UNAVAILABLE');
    }
  }
  if (error instanceof ArenaRoomGenerationPresetResolverError) {
    switch (error.code) {
      case 'ARENA_ROOM_PRESET_VERSION_MISMATCH': return fail('ROOM_REFERENCE_STALE');
      case 'ARENA_ROOM_PRESET_NOT_FOUND': return fail('ROOM_REFERENCE_DENIED');
      case 'ARENA_ROOM_PRESET_CONTENT_INVALID':
      case 'ARENA_ROOM_PRESET_INPUT_INVALID':
        return fail('ROOM_GENERATION_INPUT_INVALID');
    }
  }
  throw error;
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

const publisherKey = (
  state: ArenaRoomAuthorityState,
  generationId: string,
): string | null => {
  const mirror = state.snapshot.activeGeneration;
  if (!mirror || mirror.generationId !== generationId) return null;
  return [
    state.snapshot.roomId,
    state.snapshot.roomEpoch,
    mirror.generationId,
    String(mirror.attempt),
  ].join('\u0000');
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
  const completed = status === 'completed';
  const active = status === 'reserved'
    || status === 'running'
    || status === 'finalizing';
  const markdown = completed
    ? input.projection?.markdown ?? ''
    : active
      ? input.progress?.markdown || input.projection?.markdown || ''
      : '';
  const nextChunkSeq = active ? input.progress?.nextChunkSeq ?? 0 : 0;
  const failed = status === 'failed' || status === 'producer_lost';
  if (
    completed
    && (
      !input.projection?.resultAvailable
      || !input.projection.generationRecordId
      || !input.projection.roomSafeResult
    )
  ) {
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
    ...(completed ? { result: input.projection!.roomSafeResult! } : {}),
    ...(failed ? { errorCode: input.projection?.errorCode ?? 'GENERATION_FAILED' } : {}),
  });
};

export const createArenaRoomGenerationService = (
  options: ArenaRoomGenerationServiceOptions,
): ArenaRoomGenerationService => {
  const now = options.now ?? (() => new Date().toISOString());
  const publisherFactory = options.createPublisher ?? createRoomGenerationPublisher;
  const publishers = new Map<string, ActivePublisher>();
  let publisherInFlightCurrent = 0;

  const changePublisherInFlight = (delta: 1 | -1): void => {
    publisherInFlightCurrent = Math.max(0, publisherInFlightCurrent + delta);
    observeArenaRoomRuntime(options.observer, {
      event: 'publisher_backlog',
      inFlightCurrent: publisherInFlightCurrent,
    });
  };

  const resolveMembership = async (
    roomId: string,
    accountUserId: number,
  ): Promise<ResolvedArenaRoomMembership> => {
    if (!validAccountUserId(accountUserId)) return fail('ROOM_GENERATION_INPUT_INVALID');
    return options.memberships.resolveActiveByAccount({ roomId, accountUserId });
  };

  const materialize = async (
    snapshot: ArenaMultiplayerGenerationSnapshot,
    hostAccountUserId: number,
    request: ArenaRoomGenerationStartRequest,
  ): Promise<Readonly<Record<string, unknown>>> => {
    try {
      return await options.materializer.materialize({
        sharedConfig: snapshot.sharedConfig,
        hostAccountUserId,
        hostLocalPayloads: request.hostLocalPayloads,
        hostRuntime: request.generation,
      });
    } catch (error) {
      return mapMaterializationError(error);
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
    const current = membership.actor.getSnapshot();
    if (!current) return fail('ROOM_GENERATION_NOT_FOUND');
    const key = publisherKey(current, subscription.generationId);
    if (!key) return fail('ROOM_GENERATION_NOT_FOUND');
    const existing = publishers.get(key);
    if (existing) return existing.publisher;
    const publisher = publisherFactory({
      actor: membership.actor,
      authority: publisherAuthority(current, subscription.generationId),
      now: () => Date.parse(now()),
      observer: options.observer,
      onInFlightChange: changePublisherInFlight,
      ...(initial === undefined ? {} : { initial }),
    });
    const active: ActivePublisher = {
      publisher,
      promise: Promise.resolve(),
    };
    observeArenaRoomRuntime(options.observer, { event: 'publisher', action: 'started' });
    const promise = Promise.resolve()
      .then(() => publisher.attach(subscription))
      .then((result) => {
        if (result.kind === 'rejected') {
          options.onBackgroundError?.(new Error(`ROOM_GENERATION_PUBLISH_REJECTED:${result.reason}`));
        }
      })
      .catch((error: unknown) => {
        options.onBackgroundError?.(error);
      })
      .finally(() => {
        if (publishers.get(key)?.publisher === publisher) {
          publishers.delete(key);
          observeArenaRoomRuntime(options.observer, {
            event: 'publisher',
            action: 'finished',
          });
        }
      });
    publishers.set(key, { ...active, promise });
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
    let result = await options.generation.readOwnedProjection({
      roomId: membership.roomId,
      generationId,
    });
    if (result.kind === 'not-found') return fail('ROOM_GENERATION_NOT_FOUND');
    if (result.kind === 'unavailable') return fail('ROOM_GENERATION_UNAVAILABLE');
    const roomMirror = membership.actor.getSnapshot()?.snapshot.activeGeneration;
    const roomIsTerminal = roomMirror?.state === 'completed'
      || roomMirror?.state === 'failed'
      || roomMirror?.state === 'cancelled';
    const projectionIsActive = result.projection.status === 'reserved'
      || result.projection.status === 'running'
      || result.projection.status === 'finalizing';
    if (roomIsTerminal && projectionIsActive) {
      result = await options.generation.readOwnedProjection({
        roomId: membership.roomId,
        generationId,
      });
      if (result.kind !== 'found') return fail('ROOM_GENERATION_UNAVAILABLE');
      if (
        result.projection.status === 'reserved'
        || result.projection.status === 'running'
        || result.projection.status === 'finalizing'
      ) return fail('ROOM_GENERATION_UNAVAILABLE');
    }
    const reconciled = await executeMirror(membership, result.projection);
    const current = membership.actor.getSnapshot();
    const key = current ? publisherKey(current, generationId) : null;
    let publisher = key ? publishers.get(key)?.publisher : undefined;
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
    let result;
    try {
      result = await options.generation.startFromHostRequest({
        request: input.sourceRequest,
        roomId: input.membership.roomId,
        generationRequestId: input.snapshot.generationRequestId,
        payload: input.generationPayload,
        internalGuidance: ARENA_ROOM_INTERNAL_GUIDANCE,
        pvpContext: { matchId: input.generationId, roundId: 'attempt-1' },
        multiplayerSnapshot: input.snapshot,
      });
    } catch {
      return fail('ROOM_OPERATION_UNKNOWN');
    }
    if (result.kind === 'rejected') {
      if (result.status >= 500) return fail('ROOM_OPERATION_UNKNOWN');
      if (!CANCELLABLE_GENERATION_REJECTION_CODES.has(result.code)) {
        return fail('ROOM_GENERATION_CONFLICT');
      }
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
        const current = membership.actor.getSnapshot();
        if (!current) return fail('ROOM_GENERATION_NOT_FOUND');
        const key = publisherKey(current, generationId);
        const active = key ? publishers.get(key)?.publisher : undefined;
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
        if (historical.mirror.state !== 'starting' && historical.mirror.state !== 'running') {
          return fail('ROOM_GENERATION_CONFLICT');
        }
        const generationPayload = await materialize(
          snapshot,
          membership.accountUserId,
          input.request,
        );
        const generationPayloadDigest = await options.generation.hashSemanticPayload({
          roomId: membership.roomId,
          generationRequestId: snapshot.generationRequestId,
          payload: generationPayload,
          internalGuidance: ARENA_ROOM_INTERNAL_GUIDANCE,
          pvpContext: { matchId: generationId, roundId: 'attempt-1' },
          multiplayerSnapshot: snapshot,
        }).catch(() => fail('ROOM_OPERATION_UNKNOWN'));
        if (
          historical.generationPayloadDigest === undefined
          || historical.generationPayloadDigest !== generationPayloadDigest
        ) return fail('ROOM_GENERATION_CONFLICT');
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
            generationPayloadDigest,
            expiresAt: publisherExpiry(timestamp),
          }),
          command: {
            type: 'reserve-generation',
            expectedRoomEpoch: current.snapshot.roomEpoch,
            expectedRevision: snapshot.configRevision,
            generationRequestId: snapshot.generationRequestId,
            generationId,
            attempt: 1,
            generationPayloadDigest,
            timestamp,
          },
          trustedTime: issueArenaRoomTrustedTime({ now: timestamp }),
        });
        if (!reservation.ok) mapTransitionFailure(reservation.reason);
        return startSubscription({
          membership,
          sourceRequest: input.sourceRequest,
          generationPayload,
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
      const state = membership.state;
      if (JSON.stringify(state.snapshot.sharedConfig) !== JSON.stringify(input.request.sharedConfig)) {
        return fail('ROOM_GENERATION_CONFLICT');
      }
      const snapshot = createArenaRoomGenerationSnapshot(state, input.request.generationRequestId);
      const generationPayload = await materialize(
        snapshot,
        membership.accountUserId,
        input.request,
      );
      const generationPayloadDigest = await options.generation.hashSemanticPayload({
        roomId: membership.roomId,
        generationRequestId: snapshot.generationRequestId,
        payload: generationPayload,
        internalGuidance: ARENA_ROOM_INTERNAL_GUIDANCE,
        pvpContext: { matchId: generationId, roundId: 'attempt-1' },
        multiplayerSnapshot: snapshot,
      }).catch(() => fail('ROOM_OPERATION_UNKNOWN'));
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
          generationPayloadDigest,
          expiresAt: publisherExpiry(timestamp),
        }),
        command: {
          type: 'reserve-generation',
          expectedRoomEpoch: state.snapshot.roomEpoch,
          expectedRevision: snapshot.configRevision,
          generationRequestId: snapshot.generationRequestId,
          generationId,
          attempt: 1,
          generationPayloadDigest,
          timestamp,
        },
        trustedTime: issueArenaRoomTrustedTime({ now: timestamp }),
      });
      if (!reservation.ok) mapTransitionFailure(reservation.reason);
      return startSubscription({
        membership,
        sourceRequest: input.sourceRequest,
        generationPayload,
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
