import {
  ArenaRoomPublishConfigRequestSchema,
  parseRoomServerTransportFrame,
  type ArenaRoomCreateRequest,
  type ArenaRoomGenerationProjectionStatus,
  type ArenaRoomGenerationStartRequest,
  type ArenaRoomGenerationViewResponse,
  type ArenaRoomProposalResolveRequest,
  type ArenaRoomProposalSubmitRequest,
  type ArenaRoomPublishConfigRequest,
  type ArenaRoomSessionResponse,
  type GenerationMirror,
  type RoomControlCursor,
  type RoomDirectoryEntry,
  type RoomEvent,
  type RoomServerTransportMessage,
  type StoryDeltaEvent,
  type StoryStreamCursor,
} from '@mahoshojo/contracts/arena-room';

import {
  ArenaRoomClientError,
  type ArenaRoomClient,
} from './client';

export type ArenaRoomControllerPhase =
  | 'closed'
  | 'connected'
  | 'connecting'
  | 'degraded'
  | 'disabled'
  | 'listing'
  | 'ready'
  | 'reconnecting'
  | 'replacement'
  | 'unknown'
  | 'unauthenticated';

export type ArenaRoomControllerState = {
  readonly phase: ArenaRoomControllerPhase;
  readonly rooms: readonly RoomDirectoryEntry[];
  readonly session: ArenaRoomSessionResponse | null;
  readonly notice: string | null;
  readonly error: string | null;
  readonly unknownOperation: 'create' | 'join' | null;
  readonly proposalOperation: 'resolve' | 'submit' | 'withdraw' | null;
  readonly proposalResultUnknown: boolean;
  readonly configPublishPending: boolean;
  readonly configPublishResultUnknown: boolean;
  readonly generation: ArenaRoomGenerationControllerView;
};

export type ArenaRoomGenerationPhase =
  | 'cancelled'
  | 'completed'
  | 'failed'
  | 'idle'
  | 'resyncing'
  | 'running'
  | 'starting'
  | 'unavailable'
  | 'unknown';

export type ArenaRoomGenerationGap = {
  readonly generationId: string;
  readonly expectedChunkSeq: number;
  readonly receivedChunkSeq: number;
};

export type ArenaRoomGenerationControllerView = {
  readonly mirror: GenerationMirror | null;
  readonly phase: ArenaRoomGenerationPhase;
  readonly status: ArenaRoomGenerationProjectionStatus | null;
  readonly authoritativeMarkdown: string;
  readonly markdown: string;
  readonly storyCursor: StoryStreamCursor | null;
  readonly gap: ArenaRoomGenerationGap | null;
  readonly finalAuthoritative: boolean;
  readonly generationRecordId: string | null;
  readonly errorCode: string | null;
  readonly pendingRequestId: string | null;
  readonly startResultUnknown: boolean;
};

type ProposalMutationOperation = 'resolve' | 'submit' | 'withdraw';

type UnknownProposalMutation = {
  readonly operation: ProposalMutationOperation;
  readonly proposalId: string;
};

export type ArenaRoomSocket = {
  onopen: (() => void) | null;
  onmessage: ((event: { readonly data: unknown }) => void) | null;
  onclose: ((event: { readonly code: number; readonly reason: string }) => void) | null;
  onerror: (() => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
};

type ArenaRoomControllerOptions = {
  readonly client: ArenaRoomClient;
  readonly createSocket: (url: string, protocol: string) => ArenaRoomSocket;
  readonly initialAccess?: { readonly enabled: boolean; readonly authenticated: boolean };
  readonly maxReconnectAttempts?: number;
  readonly reconnectDelayMs?: (attempt: number) => number;
  readonly setTimer?: (callback: () => void, delayMs: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
  readonly createRequestId?: () => string;
};

export type ArenaRoomCreateIntent = Omit<ArenaRoomCreateRequest, 'creationRequestId'>;

export type ArenaRoomController = {
  getSnapshot(): ArenaRoomControllerState;
  subscribe(listener: () => void): () => void;
  setAccess(access: { readonly enabled: boolean; readonly authenticated: boolean }): void;
  discover(): Promise<void>;
  create(request: ArenaRoomCreateIntent): Promise<void>;
  join(roomId: string, displayName: string): Promise<void>;
  retryUnknownOperation(): Promise<void>;
  leave(): Promise<void>;
  close(): Promise<void>;
  submitProposal(request: ArenaRoomProposalSubmitRequest): Promise<void>;
  resolveProposal(proposalId: string, request: ArenaRoomProposalResolveRequest): Promise<void>;
  withdrawProposal(proposalId: string): Promise<void>;
  publishConfig(request: ArenaRoomPublishConfigRequest): Promise<void>;
  startGeneration(request: ArenaRoomGenerationStartRequest): Promise<void>;
  retryGenerationStart(): Promise<void>;
  reconnect(): void;
  reset(): void;
  dispose(): void;
};

const EMPTY_GENERATION_VIEW: ArenaRoomGenerationControllerView = Object.freeze({
  mirror: null,
  phase: 'idle',
  status: null,
  authoritativeMarkdown: '',
  markdown: '',
  storyCursor: null,
  gap: null,
  finalAuthoritative: false,
  generationRecordId: null,
  errorCode: null,
  pendingRequestId: null,
  startResultUnknown: false,
});

const READY_STATE: ArenaRoomControllerState = Object.freeze({
  phase: 'ready',
  rooms: [],
  session: null,
  notice: null,
  error: null,
  unknownOperation: null,
  proposalOperation: null,
  proposalResultUnknown: false,
  configPublishPending: false,
  configPublishResultUnknown: false,
  generation: EMPTY_GENERATION_VIEW,
});

const phaseForAccess = (access: { enabled: boolean; authenticated: boolean }) => (
  !access.enabled ? 'disabled' as const
    : !access.authenticated ? 'unauthenticated' as const
      : 'ready' as const
);

const safeErrorMessage = (error: unknown): string => (
  error instanceof ArenaRoomClientError ? error.message : '房间运行时暂不可用'
);

const sameSharedConfig = (left: unknown, right: unknown): boolean => (
  JSON.stringify(left) === JSON.stringify(right)
);

const defaultReconnectDelay = (attempt: number): number => (
  Math.min(4_000, 500 * (2 ** Math.max(0, attempt - 1)))
);

const replaceMember = (
  session: ArenaRoomSessionResponse,
  event: Extract<RoomEvent, {
    type: 'room.host.offline' | 'room.host.online' | 'room.member.joined' | 'room.member.left';
  }>,
): ArenaRoomSessionResponse => {
  const incoming = event.payload.member;
  const existing = session.snapshot.members.findIndex((member) => member.userId === incoming.userId);
  const members = [...session.snapshot.members];
  if (existing >= 0) members[existing] = incoming;
  else members.push(incoming);
  const self = incoming.userId === session.self.userId ? incoming : session.self;
  return {
    ...session,
    self,
    snapshot: {
      ...session.snapshot,
      controlSeq: event.controlSeq,
      members,
    },
  };
};

type GenerationControlEvent = Extract<RoomEvent, {
  type: 'generation.completed' | 'generation.failed' | 'generation.started';
}>;

const projectionStatusForMirror = (
  mirror: GenerationMirror,
): ArenaRoomGenerationProjectionStatus => {
  switch (mirror.state) {
    case 'starting': return 'reserved';
    case 'running': return 'running';
    case 'completed': return 'completed';
    case 'failed': return 'failed';
    case 'cancelled': return 'cancelled';
  }
};

const generationPhaseForStatus = (
  status: ArenaRoomGenerationProjectionStatus,
): ArenaRoomGenerationPhase => {
  switch (status) {
    case 'reserved': return 'starting';
    case 'running':
    case 'finalizing': return 'running';
    case 'completed': return 'completed';
    case 'failed':
    case 'producer_lost': return 'failed';
    case 'cancelled': return 'cancelled';
  }
};

const mirrorFromGenerationControl = (
  current: GenerationMirror | null,
  event: GenerationControlEvent,
): GenerationMirror => {
  const sameAttempt = current?.generationId === event.payload.generationId
    && current.attempt === event.payload.attempt;
  const state = event.type === 'generation.started'
    ? 'running' as const
    : event.type === 'generation.completed'
      ? 'completed' as const
      : 'failed' as const;
  return {
    generationRequestId: event.payload.generationRequestId,
    generationId: event.payload.generationId,
    attempt: event.payload.attempt,
    state,
    configRevision: event.payload.configRevision,
    snapshotDigest: event.payload.snapshotDigest,
    collaborativeInfluence: event.payload.collaborativeInfluence,
    participantUserIds: event.payload.participantUserIds,
    startedAt: sameAttempt ? current.startedAt : event.timestamp,
    ...(event.type === 'generation.started' ? {} : { finishedAt: event.timestamp }),
  };
};

/** Pure control-plane reducer; story text and HTTP authority are handled separately. */
const reduceGenerationControl = (
  current: ArenaRoomGenerationControllerView,
  event: GenerationControlEvent,
): ArenaRoomGenerationControllerView => {
  const mirror = mirrorFromGenerationControl(current.mirror, event);
  const sameAttempt = current.mirror?.generationId === mirror.generationId
    && current.mirror.attempt === mirror.attempt;
  const base = sameAttempt ? current : EMPTY_GENERATION_VIEW;
  if (event.type === 'generation.started') {
    return {
      ...base,
      mirror,
      phase: 'running',
      status: 'running',
      gap: null,
      finalAuthoritative: false,
      generationRecordId: null,
      errorCode: null,
      pendingRequestId: null,
      startResultUnknown: false,
    };
  }
  return {
    ...base,
    mirror,
    phase: 'resyncing',
    status: event.type === 'generation.completed' ? 'completed' : 'failed',
    gap: null,
    finalAuthoritative: false,
    generationRecordId: null,
    errorCode: event.type === 'generation.failed' ? event.payload.errorCode : null,
    pendingRequestId: null,
    startResultUnknown: false,
  };
};

export const createArenaRoomController = (
  options: ArenaRoomControllerOptions,
): ArenaRoomController => {
  const maxReconnectAttempts = options.maxReconnectAttempts ?? 3;
  if (!Number.isSafeInteger(maxReconnectAttempts) || maxReconnectAttempts < 1) {
    throw new Error('maxReconnectAttempts 必须是正安全整数');
  }
  const reconnectDelayMs = options.reconnectDelayMs ?? defaultReconnectDelay;
  const setTimer = options.setTimer ?? ((callback, delayMs) => setTimeout(callback, delayMs));
  const clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const createRequestId = options.createRequestId ?? (() => globalThis.crypto.randomUUID());
  let access = options.initialAccess ?? { enabled: false, authenticated: false };
  let state: ArenaRoomControllerState = {
    ...READY_STATE,
    phase: phaseForAccess(access),
  };
  let socket: ArenaRoomSocket | null = null;
  let reconnectTimer: unknown = null;
  let reconnectAttempts = 0;
  let operationGeneration = 0;
  let proposalMutationGeneration = 0;
  let proposalMutationPending = false;
  let generationStartOperation = 0;
  let generationStartPending = false;
  let pendingGenerationStartRequest: ArenaRoomGenerationStartRequest | null = null;
  let generationFence = 0;
  let unknownProposalMutation: UnknownProposalMutation | null = null;
  let configPublishOperation = 0;
  let configPublishPending = false;
  let configPublishIntent: Readonly<{
    roomId: string;
    selfUserId: string;
    request: ArenaRoomPublishConfigRequest;
  }> | null = null;
  let disposed = false;
  let unresolvedCreateResult = false;
  let unresolvedCreateNotice: string | null = null;
  let pendingCreateRequest: ArenaRoomCreateRequest | null = null;
  let pendingJoinRoomId: string | null = null;
  let controlCursor: RoomControlCursor | undefined;
  const generationRecoveries = new Map<string, {
    promise: Promise<void>;
    rerunAfterFlight: boolean;
  }>();
  const listeners = new Set<() => void>();

  const publish = (patch: Partial<ArenaRoomControllerState>): void => {
    if (disposed) return;
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };

  const operationIsCurrent = (generation: number): boolean => (
    !disposed
    && generation === operationGeneration
    && access.enabled
    && access.authenticated
  );

  const invalidateConfigPublish = (): void => {
    configPublishOperation += 1;
    configPublishPending = false;
    configPublishIntent = null;
  };

  const clearReconnectTimer = (): void => {
    if (reconnectTimer === null) return;
    clearTimer(reconnectTimer);
    reconnectTimer = null;
  };

  const detachSocket = (close = false): void => {
    const current = socket;
    socket = null;
    if (!current) return;
    current.onopen = null;
    current.onmessage = null;
    current.onclose = null;
    current.onerror = null;
    if (close) current.close(1000, 'client-disconnect');
  };

  const enterReplacement = (): void => {
    invalidateConfigPublish();
    clearReconnectTimer();
    detachSocket(true);
    publish({
      phase: 'replacement',
      notice: '原房间无法恢复，请房主创建新房间',
      error: null,
    });
  };

  const scheduleReconnect = (degraded: boolean): void => {
    if (disposed || !access.enabled || !access.authenticated || !state.session) return;
    clearReconnectTimer();
    detachSocket(true);
    if (reconnectAttempts >= maxReconnectAttempts) {
      enterReplacement();
      return;
    }
    reconnectAttempts += 1;
    publish({
      phase: degraded ? 'degraded' : 'reconnecting',
      notice: degraded ? '房间运行时暂不可用，正在重试' : '正在重新连接…',
      error: null,
    });
    const generation = operationGeneration;
    reconnectTimer = setTimer(() => {
      reconnectTimer = null;
      if (disposed || generation !== operationGeneration || !state.session) return;
      void connectSession(state.session, true, generation);
    }, reconnectDelayMs(reconnectAttempts));
  };

  const proposalEventReconcilesUnknown = (
    event: Extract<RoomEvent, {
      type: 'proposal.resolved' | 'proposal.submitted' | 'proposal.updated';
    }>,
  ): boolean => {
    const unknown = unknownProposalMutation;
    if (unknown === null) return false;
    if (event.type === 'proposal.resolved') {
      return event.payload.proposalId === unknown.proposalId;
    }
    return unknown.operation === 'submit'
      && event.payload.proposal.proposalId === unknown.proposalId;
  };

  const recoveryKeyFor = (
    roomId: string,
    roomEpoch: string,
    mirror: GenerationMirror,
  ): string => `${roomId}\u0000${roomEpoch}\u0000${mirror.generationId}\u0000${mirror.attempt}`;

  const recoveryFenceIsCurrent = (input: {
    readonly roomId: string;
    readonly roomEpoch: string;
    readonly generationId: string;
    readonly attempt: number;
    readonly fence: number;
  }): boolean => {
    const active = state.session?.snapshot.activeGeneration;
    return !disposed
      && generationFence === input.fence
      && state.session?.roomId === input.roomId
      && state.session.roomEpoch === input.roomEpoch
      && active?.generationId === input.generationId
      && active.attempt === input.attempt;
  };

  const installAuthoritativeGenerationView = (
    view: ArenaRoomGenerationViewResponse,
    expected: {
      readonly roomId: string;
      readonly roomEpoch: string;
      readonly generationId: string;
      readonly attempt: number;
    },
  ): boolean => {
    const current = state.session;
    if (
      !current
      || view.roomId !== expected.roomId
      || view.roomEpoch !== expected.roomEpoch
      || view.generation.generationId !== expected.generationId
      || view.generation.attempt !== expected.attempt
      || current.roomId !== expected.roomId
      || current.roomEpoch !== expected.roomEpoch
    ) return false;
    if (
      view.status === 'completed'
      || view.status === 'failed'
      || view.status === 'cancelled'
      || view.status === 'producer_lost'
    ) pendingGenerationStartRequest = null;
    const storyCursor = view.nextChunkSeq === 0
      ? null
      : { generationId: view.generation.generationId, chunkSeq: view.nextChunkSeq - 1 };
    publish({
      session: {
        ...current,
        snapshot: {
          ...current.snapshot,
          activeGeneration: view.generation,
        },
      },
      generation: {
        mirror: view.generation,
        phase: generationPhaseForStatus(view.status),
        status: view.status,
        authoritativeMarkdown: view.markdown,
        markdown: view.markdown,
        storyCursor,
        gap: null,
        finalAuthoritative: view.finalAuthoritative,
        generationRecordId: view.generationRecordId ?? null,
        errorCode: view.errorCode ?? null,
        pendingRequestId: null,
        startResultUnknown: false,
      },
    });
    return true;
  };

  const requestGenerationRecovery = (
    reason: 'baseline' | 'gap' | 'reconnect' | 'resync' | 'terminal',
  ): Promise<void> | null => {
    const current = state.session;
    const mirror = current?.snapshot.activeGeneration;
    if (!current || !mirror || disposed) return null;
    const key = recoveryKeyFor(current.roomId, current.roomEpoch, mirror);
    const existing = generationRecoveries.get(key);
    if (existing) {
      if (reason === 'baseline' || reason === 'terminal') existing.rerunAfterFlight = true;
      return existing.promise;
    }
    const captured = {
      roomId: current.roomId,
      roomEpoch: current.roomEpoch,
      generationId: mirror.generationId,
      attempt: mirror.attempt,
      fence: generationFence,
    };
    publish({
      generation: {
        ...state.generation,
        mirror,
        phase: 'resyncing',
        status: state.generation.status ?? projectionStatusForMirror(mirror),
      },
    });
    const entry = {
      promise: Promise.resolve(),
      rerunAfterFlight: false,
    };
    entry.promise = options.client.getGenerationView(current.roomId, mirror.generationId)
      .then((view) => {
        if (!recoveryFenceIsCurrent(captured)) return;
        installAuthoritativeGenerationView(view, captured);
      })
      .catch(() => {
        if (!recoveryFenceIsCurrent(captured)) return;
        publish({
          generation: {
            ...state.generation,
            phase: 'unavailable',
          },
        });
      })
      .finally(() => {
        if (generationRecoveries.get(key) !== entry) return;
        generationRecoveries.delete(key);
        if (entry.rerunAfterFlight && !disposed) void requestGenerationRecovery('terminal');
      });
    generationRecoveries.set(key, entry);
    return entry.promise;
  };

  const generationViewForSnapshot = (
    mirror: GenerationMirror | null,
    resetPreview: boolean,
  ): ArenaRoomGenerationControllerView => {
    if (!mirror) {
      return state.generation.startResultUnknown && !resetPreview
        ? state.generation
        : EMPTY_GENERATION_VIEW;
    }
    const sameAttempt = !resetPreview
      && state.generation.mirror?.generationId === mirror.generationId
      && state.generation.mirror.attempt === mirror.attempt;
    const base = sameAttempt ? state.generation : EMPTY_GENERATION_VIEW;
    const pendingRequestId = pendingGenerationStartRequest?.generationRequestId
      === mirror.generationRequestId
      ? mirror.generationRequestId
      : null;
    return {
      ...base,
      mirror,
      phase: 'resyncing',
      status: projectionStatusForMirror(mirror),
      gap: null,
      finalAuthoritative: false,
      generationRecordId: null,
      errorCode: null,
      pendingRequestId,
      startResultUnknown: false,
    };
  };

  const applyStoryEvent = (event: StoryDeltaEvent): void => {
    const current = state.session;
    const mirror = current?.snapshot.activeGeneration;
    if (!current || !mirror) return;
    if (event.roomId !== current.roomId) {
      enterReplacement();
      return;
    }
    if (
      event.roomEpoch !== current.roomEpoch
      || event.generationId !== mirror.generationId
      || mirror.state !== 'running'
    ) return;
    const cursor = state.generation.storyCursor;
    const lastChunkSeq = cursor?.generationId === event.generationId ? cursor.chunkSeq : -1;
    if (event.chunkSeq <= lastChunkSeq) return;
    const expectedChunkSeq = lastChunkSeq + 1;
    if (state.generation.gap || state.generation.phase === 'resyncing') return;
    if (event.chunkSeq !== expectedChunkSeq) {
      publish({
        generation: {
          ...state.generation,
          phase: 'resyncing',
          gap: {
            generationId: event.generationId,
            expectedChunkSeq,
            receivedChunkSeq: event.chunkSeq,
          },
        },
      });
      void requestGenerationRecovery('gap');
      return;
    }
    publish({
      generation: {
        ...state.generation,
        phase: 'running',
        status: state.generation.status ?? 'running',
        markdown: state.generation.markdown + event.payload.delta,
        storyCursor: { generationId: event.generationId, chunkSeq: event.chunkSeq },
      },
    });
  };

  const applyControlEvent = (event: Exclude<RoomEvent, { type: 'story.delta' }>): void => {
    const current = state.session;
    if (!current) return;
    if (event.roomId !== current.roomId) {
      enterReplacement();
      return;
    }
    if (event.type !== 'room.snapshot' && event.roomEpoch !== current.roomEpoch) {
      scheduleReconnect(false);
      return;
    }
    if (
      event.roomEpoch === current.roomEpoch
      && event.type === 'room.snapshot'
      && event.controlSeq < current.snapshot.controlSeq
    ) return;
    if (event.type !== 'room.snapshot' && event.controlSeq <= current.snapshot.controlSeq) return;
    if (
      event.type !== 'room.snapshot'
      && event.controlSeq !== current.snapshot.controlSeq + 1
    ) {
      scheduleReconnect(false);
      return;
    }
    controlCursor = { roomEpoch: event.roomEpoch, controlSeq: event.controlSeq };
    reconnectAttempts = 0;

    if (event.type === 'room.snapshot') {
      const self = event.payload.members.find((member) => member.userId === current.self.userId);
      if (!self || self.membershipState !== 'active') {
        enterReplacement();
        return;
      }
      const epochChanged = current.roomEpoch !== event.roomEpoch;
      const configReconciled = !epochChanged
        && state.configPublishResultUnknown
        && configPublishIntent?.roomId === event.roomId
        && configPublishIntent.request.expectedRoomEpoch === event.roomEpoch
        && (
          event.payload.revision === configPublishIntent.request.expectedRevision
          || event.payload.revision === configPublishIntent.request.expectedRevision + 1
        )
        && sameSharedConfig(
          event.payload.sharedConfig,
          configPublishIntent.request.sharedConfig,
        );
      if (epochChanged) invalidateConfigPublish();
      else if (configReconciled) configPublishIntent = null;
      unknownProposalMutation = null;
      generationFence += 1;
      publish({
        session: {
          protocolVersion: 1,
          roomId: event.roomId,
          roomEpoch: event.roomEpoch,
          self,
          snapshot: event.payload,
        },
        generation: generationViewForSnapshot(event.payload.activeGeneration, epochChanged),
        ...(epochChanged ? { notice: '房间已由服务器恢复，需要重新同步' } : {}),
        proposalOperation: null,
        proposalResultUnknown: false,
        ...(configReconciled ? {
          configPublishPending: false,
          configPublishResultUnknown: false,
          notice: '房间配置已更新',
          error: null,
        } : epochChanged ? {
          configPublishPending: false,
          configPublishResultUnknown: false,
        } : {}),
      });
      if (event.payload.activeGeneration) void requestGenerationRecovery('baseline');
      return;
    }

    if (
      event.type === 'room.member.joined'
      || event.type === 'room.member.left'
      || event.type === 'room.host.offline'
      || event.type === 'room.host.online'
    ) {
      const next = replaceMember(current, event);
      if (event.type === 'room.member.left' && event.payload.member.userId === current.self.userId) {
        invalidateConfigPublish();
        detachSocket(true);
        publish({
          phase: 'closed',
          session: next,
          notice: '房间成员资格已结束',
          error: null,
        });
        return;
      }
      publish({ session: next });
      return;
    }

    if (event.type === 'room.config.updated') {
      const configReconciled = state.configPublishResultUnknown
        && configPublishIntent?.roomId === event.roomId
        && configPublishIntent.request.expectedRoomEpoch === event.roomEpoch
        && event.payload.revision === configPublishIntent.request.expectedRevision + 1
        && sameSharedConfig(
          event.payload.sharedConfig,
          configPublishIntent.request.sharedConfig,
        );
      if (configReconciled) configPublishIntent = null;
      publish({
        session: {
          ...current,
          snapshot: {
            ...current.snapshot,
            controlSeq: event.controlSeq,
            revision: event.payload.revision,
            sharedConfig: event.payload.sharedConfig,
          },
        },
        ...(configReconciled ? {
          configPublishPending: false,
          configPublishResultUnknown: false,
          notice: '房间配置已更新',
          error: null,
        } : {}),
      });
      return;
    }

    if (event.type === 'proposal.submitted' || event.type === 'proposal.updated') {
      const proposal = event.payload.proposal;
      const proposals = current.snapshot.proposals.filter((item) => (
        item.proposalId !== proposal.proposalId
      ));
      proposals.push(proposal);
      const reconciledUnknown = proposalEventReconcilesUnknown(event);
      if (reconciledUnknown) unknownProposalMutation = null;
      publish({
        session: {
          ...current,
          snapshot: {
            ...current.snapshot,
            controlSeq: event.controlSeq,
            proposals,
          },
        },
        ...(state.proposalResultUnknown && !reconciledUnknown ? {} : {
          proposalOperation: null,
          proposalResultUnknown: false,
          notice: event.type === 'proposal.submitted' ? 'Proposal 已进入房间' : 'Proposal 已更新',
          error: null,
        }),
      });
      return;
    }

    if (event.type === 'proposal.resolved') {
      const reconciledUnknown = proposalEventReconcilesUnknown(event);
      if (reconciledUnknown) unknownProposalMutation = null;
      publish({
        session: {
          ...current,
          snapshot: {
            ...current.snapshot,
            controlSeq: event.controlSeq,
            proposals: current.snapshot.proposals.filter((proposal) => (
              proposal.proposalId !== event.payload.proposalId
            )),
          },
        },
        ...(state.proposalResultUnknown && !reconciledUnknown ? {} : {
          proposalOperation: null,
          proposalResultUnknown: false,
          notice: event.payload.status === 'withdrawn'
            ? 'Proposal 已撤回'
            : event.payload.status === 'rejected'
              ? 'Proposal 已拒绝'
              : 'Proposal 已应用',
          error: null,
        }),
      });
      return;
    }

    if (
      event.type === 'generation.started'
      || event.type === 'generation.completed'
      || event.type === 'generation.failed'
    ) {
      const generation = reduceGenerationControl(state.generation, event);
      generationFence += 1;
      publish({
        session: {
          ...current,
          snapshot: {
            ...current.snapshot,
            controlSeq: event.controlSeq,
            activeGeneration: generation.mirror,
          },
        },
        generation,
      });
      if (event.type !== 'generation.started') void requestGenerationRecovery('terminal');
      return;
    }

    if (event.type === 'room.closing') {
      invalidateConfigPublish();
      detachSocket(true);
      publish({ phase: 'closed', notice: '房间已关闭', error: null });
      return;
    }
  };

  const handleMessage = (raw: unknown): void => {
    let message: RoomServerTransportMessage;
    try {
      if (typeof raw !== 'string' && !(raw instanceof Uint8Array)) {
        throw new Error('unsupported websocket frame');
      }
      message = parseRoomServerTransportFrame(raw);
    } catch {
      scheduleReconnect(true);
      return;
    }
    if (message.type === 'room.resync.required') {
      void requestGenerationRecovery('resync');
      scheduleReconnect(false);
      return;
    }
    if (message.type === 'story.delta') {
      applyStoryEvent(message);
      return;
    }
    applyControlEvent(message);
  };

  async function connectSession(
    session: ArenaRoomSessionResponse,
    reconnecting: boolean,
    generation: number,
  ): Promise<void> {
    if (disposed || generation !== operationGeneration) return;
    publish({
      session,
      phase: reconnecting ? 'reconnecting' : 'connecting',
      notice: reconnecting ? '正在重新连接…' : '正在连接房间…',
      error: null,
    });
    if (reconnecting && session.snapshot.activeGeneration) {
      void requestGenerationRecovery('reconnect');
    }
    try {
      const reconnect = reconnecting
        ? {
          ...(controlCursor ? { control: controlCursor } : {}),
          ...(state.generation.storyCursor ? { story: state.generation.storyCursor } : {}),
        }
        : null;
      const issued = await options.client.issueTicket(session.roomId, {
        ...(reconnect && Object.keys(reconnect).length > 0 ? { reconnect } : {}),
      });
      if (disposed || generation !== operationGeneration) return;
      const current = options.createSocket(
        options.client.buildWebSocketUrl(issued),
        issued.websocket.protocol,
      );
      detachSocket(true);
      socket = current;
      current.onopen = () => {
        if (socket !== current || disposed) return;
        publish({ phase: 'connected', notice: null, error: null });
      };
      current.onmessage = (event) => {
        if (socket === current && !disposed) handleMessage(event.data);
      };
      current.onerror = () => {
        if (socket === current && !disposed) {
          publish({ notice: '房间运行时暂不可用，正在重试' });
        }
      };
      current.onclose = (event) => {
        if (socket !== current || disposed) return;
        socket = null;
        if (event.code === 1000) {
          publish({ phase: 'closed', notice: '房间已关闭', error: null });
          return;
        }
        if (event.code === 1008 && event.reason === 'membership-revoked') {
          enterReplacement();
          return;
        }
        scheduleReconnect(event.code === 1008 && event.reason !== 'room-epoch-stale');
      };
    } catch {
      if (disposed || generation !== operationGeneration) return;
      scheduleReconnect(true);
    }
  }

  const startSession = async (session: ArenaRoomSessionResponse): Promise<void> => {
    const generation = operationGeneration;
    if (!operationIsCurrent(generation)) return;
    unknownProposalMutation = null;
    unresolvedCreateResult = false;
    unresolvedCreateNotice = null;
    pendingCreateRequest = null;
    pendingJoinRoomId = null;
    generationFence += 1;
    publish({
      session,
      generation: generationViewForSnapshot(session.snapshot.activeGeneration, true),
      unknownOperation: null,
      proposalOperation: null,
      proposalResultUnknown: false,
    });
    reconnectAttempts = 0;
    controlCursor = {
      roomEpoch: session.roomEpoch,
      controlSeq: session.snapshot.controlSeq,
    };
    if (session.snapshot.activeGeneration) void requestGenerationRecovery('baseline');
    await connectSession(session, false, generation);
  };

  const reconcileUnknownProposal = async (
    current: ArenaRoomSessionResponse,
    generation: number,
  ): Promise<void> => {
    clearReconnectTimer();
    detachSocket(true);
    publish({
      phase: 'reconnecting',
      notice: '正在获取房间权威快照并对账…',
      error: null,
    });
    try {
      const authoritative = await options.client.getSession(current.roomId);
      if (
        disposed
        || generation !== operationGeneration
        || authoritative.roomId !== current.roomId
      ) return;
      controlCursor = {
        roomEpoch: authoritative.roomEpoch,
        controlSeq: authoritative.snapshot.controlSeq,
      };
      reconnectAttempts = 0;
      unknownProposalMutation = null;
      generationFence += 1;
      publish({
        session: authoritative,
        generation: generationViewForSnapshot(
          authoritative.snapshot.activeGeneration,
          authoritative.roomEpoch !== current.roomEpoch,
        ),
        proposalOperation: null,
        proposalResultUnknown: false,
        notice: '已取得房间权威快照，正在重新连接…',
        error: null,
      });
      if (authoritative.snapshot.activeGeneration) void requestGenerationRecovery('baseline');
      await connectSession(authoritative, true, generation);
    } catch {
      if (disposed || generation !== operationGeneration) return;
      scheduleReconnect(true);
    }
  };

  const failOperation = (
    error: unknown,
    generation: number,
    operation?: 'create' | 'join',
  ): void => {
    if (!operationIsCurrent(generation)) return;
    if (error instanceof ArenaRoomClientError && error.code === 'ROOM_RESULT_UNKNOWN') {
      if (operation === 'create') {
        unresolvedCreateResult = true;
        unresolvedCreateNotice = error.message;
      }
      publish({
        phase: 'unknown',
        notice: unresolvedCreateResult ? unresolvedCreateNotice : error.message,
        error: null,
        unknownOperation: unresolvedCreateResult ? 'create' : operation ?? null,
      });
      return;
    }
    if (unresolvedCreateResult) {
      publish({
        phase: 'unknown',
        notice: unresolvedCreateNotice,
        error: safeErrorMessage(error),
        unknownOperation: 'create',
      });
      return;
    }
    publish({
      phase: state.session ? 'degraded' : 'ready',
      notice: null,
      error: safeErrorMessage(error),
      unknownOperation: null,
    });
  };

  const runProposalMutation = async (
    operation: ProposalMutationOperation,
    proposalId: string,
    requiredRole: 'host' | 'member',
    execute: (session: ArenaRoomSessionResponse) => Promise<unknown>,
  ): Promise<void> => {
    const current = state.session;
    if (
      disposed
      || !access.enabled
      || !access.authenticated
      || !current
      || current.self.role !== requiredRole
      || proposalMutationPending
      || state.proposalResultUnknown
    ) return;
    proposalMutationPending = true;
    unknownProposalMutation = null;
    proposalMutationGeneration += 1;
    const generation = proposalMutationGeneration;
    publish({
      proposalOperation: operation,
      notice: operation === 'submit'
        ? '正在提交 Proposal…'
        : operation === 'resolve'
          ? '正在处理 Proposal…'
          : '正在撤回 Proposal…',
      error: null,
    });
    try {
      await execute(current);
      if (
        disposed
        || generation !== proposalMutationGeneration
        || state.session?.roomId !== current.roomId
        || state.session.roomEpoch !== current.roomEpoch
      ) return;
      publish({
        proposalOperation: null,
        proposalResultUnknown: false,
        notice: '请求已确认，等待房间权威状态同步',
        error: null,
      });
      unknownProposalMutation = null;
    } catch (error) {
      if (
        disposed
        || generation !== proposalMutationGeneration
        || state.session?.roomId !== current.roomId
        || state.session.roomEpoch !== current.roomEpoch
      ) return;
      if (error instanceof ArenaRoomClientError && error.code === 'ROOM_RESULT_UNKNOWN') {
        unknownProposalMutation = { operation, proposalId };
        publish({
          proposalOperation: null,
          proposalResultUnknown: true,
          notice: error.message,
          error: null,
        });
      } else {
        unknownProposalMutation = null;
        publish({
          proposalOperation: null,
          proposalResultUnknown: false,
          notice: null,
          error: safeErrorMessage(error),
        });
      }
    } finally {
      if (generation === proposalMutationGeneration) proposalMutationPending = false;
    }
  };

  const runConfigPublish = async (
    input: ArenaRoomPublishConfigRequest,
  ): Promise<void> => {
    if (disposed || !access.enabled || !access.authenticated) return;
    const parsed = ArenaRoomPublishConfigRequestSchema.safeParse(input);
    if (!parsed.success) {
      publish({
        configPublishPending: false,
        configPublishResultUnknown: false,
        notice: null,
        error: '房间配置请求无效',
      });
      return;
    }
    const request = parsed.data;
    const current = state.session;
    if (
      disposed
      || !access.enabled
      || !access.authenticated
      || !current
      || configPublishPending
      || state.configPublishResultUnknown
    ) return;
    if (
      current.self.role !== 'host'
      || current.self.membershipState !== 'active'
    ) {
      publish({
        configPublishPending: false,
        configPublishResultUnknown: false,
        notice: null,
        error: '只有当前房主可以更新房间配置',
      });
      return;
    }
    if (
      request.expectedRoomEpoch !== current.roomEpoch
      || request.expectedRevision !== current.snapshot.revision
    ) {
      publish({
        configPublishPending: false,
        configPublishResultUnknown: false,
        notice: null,
        error: '房间配置已发生变化，请重新确认后再发布',
      });
      return;
    }

    configPublishPending = true;
    configPublishOperation += 1;
    const operation = configPublishOperation;
    const captured = {
      roomId: current.roomId,
      roomEpoch: current.roomEpoch,
      revision: current.snapshot.revision,
      controlSeq: current.snapshot.controlSeq,
      selfUserId: current.self.userId,
    };
    configPublishIntent = {
      roomId: current.roomId,
      selfUserId: current.self.userId,
      request,
    };
    publish({
      configPublishPending: true,
      configPublishResultUnknown: false,
      notice: '正在更新房间配置…',
      error: null,
    });
    try {
      const authoritative = await options.client.publishConfig(current.roomId, request);
      const latest = state.session;
      if (
        disposed
        || operation !== configPublishOperation
        || !latest
        || latest.roomId !== captured.roomId
        || latest.roomEpoch !== captured.roomEpoch
        || latest.self.userId !== captured.selfUserId
        || latest.self.role !== 'host'
        || latest.self.membershipState !== 'active'
      ) return;
      const responseMatchesIntent = authoritative.roomId === captured.roomId
        && authoritative.roomEpoch === captured.roomEpoch
        && authoritative.self.userId === captured.selfUserId
        && authoritative.self.role === 'host'
        && authoritative.snapshot.controlSeq >= captured.controlSeq
        && (
          authoritative.snapshot.revision === captured.revision
          || authoritative.snapshot.revision === captured.revision + 1
        )
        && sameSharedConfig(authoritative.snapshot.sharedConfig, request.sharedConfig);
      if (!responseMatchesIntent) {
        publish({
          configPublishPending: false,
          configPublishResultUnknown: true,
          notice: '配置发布结果无法确认，请先同步房间权威状态',
          error: null,
        });
        return;
      }
      const canInstall = latest.snapshot.revision === captured.revision
        && latest.snapshot.controlSeq === captured.controlSeq;
      const alreadyInstalled = latest.snapshot.revision === authoritative.snapshot.revision
        && latest.snapshot.controlSeq >= authoritative.snapshot.controlSeq
        && sameSharedConfig(latest.snapshot.sharedConfig, request.sharedConfig);
      if (!canInstall && !alreadyInstalled) {
        configPublishIntent = null;
        publish({
          configPublishPending: false,
          configPublishResultUnknown: false,
          notice: '房间状态已变化，未安装过期的配置响应',
          error: null,
        });
        return;
      }
      configPublishIntent = null;
      publish({
        ...(canInstall ? { session: authoritative } : {}),
        configPublishPending: false,
        configPublishResultUnknown: false,
        notice: '房间配置已更新',
        error: null,
      });
    } catch (error) {
      if (
        disposed
        || operation !== configPublishOperation
        || state.session?.roomId !== captured.roomId
        || state.session.roomEpoch !== captured.roomEpoch
        || state.session.self.userId !== captured.selfUserId
      ) return;
      if (error instanceof ArenaRoomClientError && error.code === 'ROOM_RESULT_UNKNOWN') {
        publish({
          configPublishPending: false,
          configPublishResultUnknown: true,
          notice: error.message,
          error: null,
        });
      } else {
        configPublishIntent = null;
        publish({
          configPublishPending: false,
          configPublishResultUnknown: false,
          notice: null,
          error: safeErrorMessage(error),
        });
      }
    } finally {
      if (operation === configPublishOperation) configPublishPending = false;
    }
  };

  const runGenerationStart = async (
    request: ArenaRoomGenerationStartRequest,
    retry = false,
  ): Promise<void> => {
    const current = state.session;
    const effectiveRequest = retry && current && request.expectedRoomEpoch !== current.roomEpoch
      ? { ...request, expectedRoomEpoch: current.roomEpoch }
      : request;
    const active = current?.snapshot.activeGeneration;
    const activeState = active?.state;
    const retryAllowed = retry && (
      (
        state.generation.startResultUnknown
        && state.generation.pendingRequestId === request.generationRequestId
      )
      || (
        state.generation.phase === 'unavailable'
        && state.generation.mirror?.state === 'starting'
        && state.generation.mirror.generationRequestId === request.generationRequestId
      )
    );
    if (
      disposed
      || !access.enabled
      || !access.authenticated
      || !current
      || current.self.role !== 'host'
      || effectiveRequest.expectedRoomEpoch !== current.roomEpoch
      || (!retry && effectiveRequest.expectedRevision !== current.snapshot.revision)
      || generationStartPending
      || (retry ? !retryAllowed : state.generation.startResultUnknown)
      || (!retry && (activeState === 'starting' || activeState === 'running'))
    ) return;
    if (!retry) pendingGenerationStartRequest = request;
    generationStartPending = true;
    generationStartOperation += 1;
    const operation = generationStartOperation;
    const expectedRoomId = current.roomId;
    const expectedRoomEpoch = current.roomEpoch;
    publish({
      generation: {
        ...(retry ? state.generation : EMPTY_GENERATION_VIEW),
        phase: 'starting',
        pendingRequestId: request.generationRequestId,
        startResultUnknown: false,
      },
      notice: '正在启动多人生成…',
      error: null,
    });
    try {
      const view = await options.client.startGeneration(current.roomId, effectiveRequest);
      if (
        disposed
        || operation !== generationStartOperation
        || state.session?.roomId !== expectedRoomId
        || state.session.roomEpoch !== expectedRoomEpoch
      ) return;
      generationFence += 1;
      if (!installAuthoritativeGenerationView(view, {
        roomId: expectedRoomId,
        roomEpoch: expectedRoomEpoch,
        generationId: view.generation.generationId,
        attempt: view.generation.attempt,
      })) return;
      publish({ notice: '多人生成已进入房间权威流程', error: null });
    } catch (error) {
      if (
        disposed
        || operation !== generationStartOperation
        || state.session?.roomId !== expectedRoomId
        || state.session.roomEpoch !== expectedRoomEpoch
      ) return;
      if (error instanceof ArenaRoomClientError && error.code === 'ROOM_RESULT_UNKNOWN') {
        publish({
          generation: {
            ...EMPTY_GENERATION_VIEW,
            phase: 'unknown',
            pendingRequestId: request.generationRequestId,
            startResultUnknown: true,
          },
          notice: error.message,
          error: null,
        });
      } else {
        const currentActive = state.session?.snapshot.activeGeneration;
        if (currentActive?.state !== 'starting' && currentActive?.state !== 'running') {
          pendingGenerationStartRequest = null;
        }
        publish({
          generation: {
            ...EMPTY_GENERATION_VIEW,
            phase: 'unavailable',
          },
          notice: null,
          error: safeErrorMessage(error),
        });
      }
    } finally {
      if (operation === generationStartOperation) generationStartPending = false;
    }
  };

  return Object.freeze({
    getSnapshot: () => state,

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    setAccess(nextAccess) {
      if (
        access.enabled === nextAccess.enabled
        && access.authenticated === nextAccess.authenticated
      ) return;
      access = nextAccess;
      operationGeneration += 1;
      proposalMutationGeneration += 1;
      generationStartOperation += 1;
      generationFence += 1;
      invalidateConfigPublish();
      proposalMutationPending = false;
      generationStartPending = false;
      pendingGenerationStartRequest = null;
      clearReconnectTimer();
      detachSocket(true);
      reconnectAttempts = 0;
      controlCursor = undefined;
      unresolvedCreateResult = false;
      unresolvedCreateNotice = null;
      unknownProposalMutation = null;
      publish({
        ...READY_STATE,
        phase: phaseForAccess(access),
      });
    },

    async discover() {
      if (disposed || !access.enabled || !access.authenticated) return;
      operationGeneration += 1;
      const generation = operationGeneration;
      publish({ phase: 'listing', error: null });
      try {
        const page = await options.client.discover({ limit: 20 });
        if (!operationIsCurrent(generation)) return;
        publish({
          phase: unresolvedCreateResult ? 'unknown' : 'ready',
          rooms: page.items,
          error: null,
        });
      } catch (error) {
        if (unresolvedCreateResult && operationIsCurrent(generation)) {
          publish({ phase: 'unknown', error: safeErrorMessage(error) });
        } else {
          failOperation(error, generation);
        }
      }
    },

    async create(request) {
      if (disposed || !access.enabled || !access.authenticated) return;
      if (unresolvedCreateResult) return;
      const requestWithId: ArenaRoomCreateRequest = {
        ...request,
        creationRequestId: createRequestId(),
      };
      pendingCreateRequest = requestWithId;
      pendingJoinRoomId = null;
      operationGeneration += 1;
      proposalMutationGeneration += 1;
      generationStartOperation += 1;
      generationFence += 1;
      invalidateConfigPublish();
      proposalMutationPending = false;
      generationStartPending = false;
      pendingGenerationStartRequest = null;
      const generation = operationGeneration;
      clearReconnectTimer();
      detachSocket(true);
      publish({
        phase: 'connecting',
        session: null,
        generation: EMPTY_GENERATION_VIEW,
        notice: '正在创建房间…',
        error: null,
      });
      try {
        const nextSession = await options.client.create(requestWithId);
        if (!operationIsCurrent(generation)) return;
        await startSession(nextSession);
      } catch (error) {
        failOperation(error, generation, 'create');
        if (!(error instanceof ArenaRoomClientError) || error.code !== 'ROOM_RESULT_UNKNOWN') {
          pendingCreateRequest = null;
        }
      }
    },

    async join(roomId, displayName) {
      if (disposed || !access.enabled || !access.authenticated) return;
      if (unresolvedCreateResult) return;
      operationGeneration += 1;
      proposalMutationGeneration += 1;
      generationStartOperation += 1;
      generationFence += 1;
      invalidateConfigPublish();
      proposalMutationPending = false;
      generationStartPending = false;
      pendingGenerationStartRequest = null;
      pendingCreateRequest = null;
      pendingJoinRoomId = null;
      const generation = operationGeneration;
      clearReconnectTimer();
      detachSocket(true);
      publish({
        phase: 'connecting',
        session: null,
        generation: EMPTY_GENERATION_VIEW,
        notice: '正在加入房间…',
        error: null,
      });
      try {
        const nextSession = await options.client.join(roomId, { displayName });
        if (!operationIsCurrent(generation)) return;
        await startSession(nextSession);
      } catch (error) {
        if (error instanceof ArenaRoomClientError && error.code === 'ROOM_RESULT_UNKNOWN') {
          try {
            const reconciled = await options.client.getSession(roomId);
            if (!operationIsCurrent(generation)) return;
            await startSession(reconciled);
            return;
          } catch {
            if (!operationIsCurrent(generation)) return;
            pendingJoinRoomId = roomId;
          }
        }
        failOperation(error, generation, 'join');
      }
    },

    async retryUnknownOperation() {
      if (disposed || !access.enabled || !access.authenticated || state.phase !== 'unknown') return;
      const createRequest = pendingCreateRequest;
      const joinRoomId = pendingJoinRoomId;
      if (state.unknownOperation === 'create' && createRequest !== null) {
        operationGeneration += 1;
        const generation = operationGeneration;
        publish({ phase: 'connecting', notice: '正在确认创建结果…', error: null });
        try {
          const nextSession = await options.client.create(createRequest);
          if (!operationIsCurrent(generation)) return;
          await startSession(nextSession);
        } catch (error) {
          failOperation(error, generation, 'create');
        }
        return;
      }
      if (state.unknownOperation === 'join' && joinRoomId !== null) {
        operationGeneration += 1;
        const generation = operationGeneration;
        publish({ phase: 'connecting', notice: '正在确认加入结果…', error: null });
        try {
          const nextSession = await options.client.getSession(joinRoomId);
          if (!operationIsCurrent(generation)) return;
          await startSession(nextSession);
        } catch (error) {
          if (!operationIsCurrent(generation)) return;
          publish({
            phase: 'unknown',
            notice: '加入结果仍无法确认；未重复提交加入请求',
            error: safeErrorMessage(error),
            unknownOperation: 'join',
          });
        }
      }
    },

    async leave() {
      if (!state.session || disposed) return;
      operationGeneration += 1;
      proposalMutationGeneration += 1;
      generationStartOperation += 1;
      generationFence += 1;
      invalidateConfigPublish();
      proposalMutationPending = false;
      generationStartPending = false;
      pendingGenerationStartRequest = null;
      const generation = operationGeneration;
      const { roomId, roomEpoch } = state.session;
      clearReconnectTimer();
      detachSocket(true);
      try {
        await options.client.leave(roomId, roomEpoch);
        if (!operationIsCurrent(generation)) return;
        publish({ phase: 'closed', notice: '已离开房间', error: null });
      } catch (error) {
        failOperation(error, generation);
      }
    },

    async close() {
      if (!state.session || state.session.self.role !== 'host' || disposed) return;
      operationGeneration += 1;
      proposalMutationGeneration += 1;
      generationStartOperation += 1;
      generationFence += 1;
      invalidateConfigPublish();
      proposalMutationPending = false;
      generationStartPending = false;
      pendingGenerationStartRequest = null;
      const generation = operationGeneration;
      const { roomId, roomEpoch } = state.session;
      clearReconnectTimer();
      detachSocket(true);
      try {
        await options.client.close(roomId, roomEpoch);
        if (!operationIsCurrent(generation)) return;
        publish({ phase: 'closed', notice: '房间已关闭', error: null });
      } catch (error) {
        failOperation(error, generation);
      }
    },

    async submitProposal(request) {
      await runProposalMutation('submit', request.proposalId, 'member', (current) => (
        options.client.submitProposal(current.roomId, request)
      ));
    },

    async resolveProposal(proposalId, request) {
      await runProposalMutation('resolve', proposalId, 'host', (current) => (
        options.client.resolveProposal(current.roomId, proposalId, request)
      ));
    },

    async withdrawProposal(proposalId) {
      await runProposalMutation('withdraw', proposalId, 'member', (current) => (
        options.client.withdrawProposal(current.roomId, proposalId, current.roomEpoch)
      ));
    },

    async publishConfig(request) {
      await runConfigPublish(request);
    },

    async startGeneration(request) {
      await runGenerationStart(request);
    },

    async retryGenerationStart() {
      const request = pendingGenerationStartRequest;
      if (!request) return;
      await runGenerationStart(request, true);
    },

    reconnect() {
      if (!state.session || disposed || !access.enabled || !access.authenticated) return;
      operationGeneration += 1;
      proposalMutationGeneration += 1;
      proposalMutationPending = false;
      reconnectAttempts = 0;
      if (state.proposalResultUnknown) {
        void reconcileUnknownProposal(state.session, operationGeneration);
        return;
      }
      scheduleReconnect(false);
    },

    reset() {
      operationGeneration += 1;
      proposalMutationGeneration += 1;
      generationStartOperation += 1;
      generationFence += 1;
      invalidateConfigPublish();
      proposalMutationPending = false;
      generationStartPending = false;
      pendingGenerationStartRequest = null;
      clearReconnectTimer();
      detachSocket(true);
      reconnectAttempts = 0;
      controlCursor = undefined;
      unresolvedCreateResult = false;
      unresolvedCreateNotice = null;
      pendingCreateRequest = null;
      pendingJoinRoomId = null;
      unknownProposalMutation = null;
      publish({ ...READY_STATE, phase: phaseForAccess(access) });
    },

    dispose() {
      if (disposed) return;
      operationGeneration += 1;
      proposalMutationGeneration += 1;
      generationStartOperation += 1;
      generationFence += 1;
      invalidateConfigPublish();
      proposalMutationPending = false;
      generationStartPending = false;
      pendingGenerationStartRequest = null;
      pendingCreateRequest = null;
      pendingJoinRoomId = null;
      unknownProposalMutation = null;
      clearReconnectTimer();
      detachSocket(true);
      listeners.clear();
      disposed = true;
    },
  });
};
