import {
  ArenaRoomSnapshotSchema,
  MAX_PENDING_PROPOSALS_PER_MEMBER,
  MAX_ROOM_MEMBERS,
  PROTOCOL_VERSION,
  ROOM_SNAPSHOT_SCHEMA_VERSION,
  RoomEventSchema,
  type ArenaProposal,
  type ControlRoomEvent,
  type GenerationMirror,
  type RoomMember,
} from '@mahoshojo/contracts/arena-room';

import { applyArenaProposal } from './apply';
import {
  ArenaRoomAuthorityStateSchema,
  ArenaRoomCommandSchema,
  checkpointPredecessorOf,
  transitionFailure,
  transitionSuccess,
  type ArenaRoomAuthorityState,
  type ArenaRoomCommand,
  type ArenaRoomTransitionResult,
} from './state-machine-model';
import { deepClone, deepEqual } from './utils';

type MutableState = {
  -readonly [K in keyof ArenaRoomAuthorityState]: ArenaRoomAuthorityState[K];
};

const parseState = (input: unknown): ArenaRoomAuthorityState | null => {
  const parsed = ArenaRoomAuthorityStateSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
};

const activeMember = (state: ArenaRoomAuthorityState, userId: string): RoomMember | undefined => (
  state.snapshot.members.find((member) => member.userId === userId && member.membershipState === 'active')
);

const activeHost = (state: ArenaRoomAuthorityState): RoomMember | undefined => (
  state.snapshot.members.find((member) => member.role === 'host' && member.membershipState === 'active')
);

const requireHost = (state: ArenaRoomAuthorityState, actorUserId: string): ArenaRoomTransitionResult | null => {
  const host = activeHost(state);
  return host?.userId === actorUserId
    ? null
    : transitionFailure('forbidden', 'host-required');
};

const requireMember = (state: ArenaRoomAuthorityState, actorUserId: string): ArenaRoomTransitionResult | null => {
  const member = activeMember(state, actorUserId);
  return member?.role === 'member'
    ? null
    : transitionFailure('forbidden', 'member-required');
};

const cloneState = (state: ArenaRoomAuthorityState): MutableState => deepClone(state) as MutableState;

const parseNextState = (state: ArenaRoomAuthorityState): ArenaRoomAuthorityState => (
  ArenaRoomAuthorityStateSchema.parse(state)
);

const eventBase = (state: ArenaRoomAuthorityState, timestamp: string) => ({
  protocolVersion: PROTOCOL_VERSION,
  roomId: state.snapshot.roomId,
  roomEpoch: state.snapshot.roomEpoch,
  timestamp,
});

const pushControlEvent = (
  state: MutableState,
  events: ControlRoomEvent[],
  timestamp: string,
  event: Omit<ControlRoomEvent, 'protocolVersion' | 'roomId' | 'roomEpoch' | 'controlSeq' | 'timestamp'>,
): void => {
  state.snapshot.controlSeq += 1;
  const parsed = RoomEventSchema.parse({
    ...eventBase(state, timestamp),
    controlSeq: state.snapshot.controlSeq,
    ...event,
  });
  if (parsed.type === 'story.delta') throw new Error('control transition cannot emit story.delta');
  events.push(parsed);
};

const pushSnapshotEvent = (
  state: MutableState,
  events: ControlRoomEvent[],
  timestamp: string,
  increment = true,
): void => {
  if (increment) state.snapshot.controlSeq += 1;
  const parsed = RoomEventSchema.parse({
    ...eventBase(state, timestamp),
    type: 'room.snapshot',
    controlSeq: state.snapshot.controlSeq,
    payload: deepClone(state.snapshot),
  });
  if (parsed.type === 'story.delta') throw new Error('snapshot cannot be story.delta');
  events.push(parsed);
};

const finishApplied = (
  previous: ArenaRoomAuthorityState | null,
  next: MutableState,
  events: readonly ControlRoomEvent[],
): ArenaRoomTransitionResult => transitionSuccess({
  kind: 'applied',
  predecessor: previous ? checkpointPredecessorOf(previous) : null,
  nextState: parseNextState(next),
  events,
});

const finishIdempotent = (state: ArenaRoomAuthorityState): ArenaRoomTransitionResult => transitionSuccess({
  kind: 'idempotent',
  predecessor: checkpointPredecessorOf(state),
  nextState: parseNextState(deepClone(state)),
});

const closeRoom = (
  state: ArenaRoomAuthorityState,
  timestamp: string,
  reason?: string,
): ArenaRoomTransitionResult => {
  if (state.lifecycle.status === 'closed') return finishIdempotent(state);
  const next = cloneState(state);
  next.lifecycle = {
    status: 'closed',
    createdAt: state.lifecycle.createdAt,
    updatedAt: timestamp,
    closedAt: timestamp,
    ...(reason === undefined ? {} : { closeReason: reason }),
  };
  const events: ControlRoomEvent[] = [];
  pushControlEvent(next, events, timestamp, {
    type: 'room.closing',
    payload: reason === undefined ? {} : { reason },
  });
  return finishApplied(state, next, events);
};

const createRoom = (
  command: Extract<ArenaRoomCommand, { type: 'create' }>,
): ArenaRoomTransitionResult => {
  if (command.host.role !== 'host' || command.host.membershipState !== 'active') {
    return transitionFailure('validation-failed', 'invalid-command');
  }
  const snapshot = ArenaRoomSnapshotSchema.parse({
    protocolVersion: PROTOCOL_VERSION,
    schemaVersion: ROOM_SNAPSHOT_SCHEMA_VERSION,
    roomId: command.roomId,
    roomEpoch: command.roomEpoch,
    controlSeq: 0,
    revision: 0,
    sharedConfig: command.sharedConfig,
    members: [command.host],
    proposals: [],
    activeGeneration: null,
  });
  const next = ArenaRoomAuthorityStateSchema.parse({
    lifecycle: {
      status: 'open',
      createdAt: command.timestamp,
      updatedAt: command.timestamp,
    },
    snapshot,
  });
  const events: ControlRoomEvent[] = [];
  pushSnapshotEvent(next, events, command.timestamp, false);
  return finishApplied(null, next, events);
};

const joinMember = (
  state: ArenaRoomAuthorityState,
  command: Extract<ArenaRoomCommand, { type: 'join-member' }>,
): ArenaRoomTransitionResult => {
  if (command.actorUserId !== command.member.userId
    || command.member.role !== 'member'
    || command.member.membershipState !== 'active') {
    return transitionFailure('forbidden', 'member-required');
  }
  const existingIndex = state.snapshot.members.findIndex((member) => member.userId === command.member.userId);
  if (existingIndex >= 0 && state.snapshot.members[existingIndex]?.membershipState === 'active') {
    return deepEqual(state.snapshot.members[existingIndex], command.member)
      ? finishIdempotent(state)
      : transitionFailure('duplicate', 'member-id-conflict');
  }
  if (existingIndex < 0 && state.snapshot.members.length >= MAX_ROOM_MEMBERS) {
    return transitionFailure('capability-denied', 'member-limit-reached');
  }
  const next = cloneState(state);
  if (existingIndex >= 0) next.snapshot.members[existingIndex] = deepClone(command.member);
  else next.snapshot.members.push(deepClone(command.member));
  next.lifecycle = { ...next.lifecycle, updatedAt: command.timestamp };
  const events: ControlRoomEvent[] = [];
  pushControlEvent(next, events, command.timestamp, {
    type: 'room.member.joined',
    payload: { member: deepClone(command.member) },
  });
  return finishApplied(state, next, events);
};

const revokeMember = (
  state: ArenaRoomAuthorityState,
  targetUserId: string,
  timestamp: string,
): ArenaRoomTransitionResult => {
  const memberIndex = state.snapshot.members.findIndex((member) => member.userId === targetUserId);
  if (memberIndex < 0) return transitionFailure('not-found', 'member-not-active');
  const member = state.snapshot.members[memberIndex];
  if (!member || member.membershipState !== 'active') return finishIdempotent(state);
  const next = cloneState(state);
  const revoked = { ...member, membershipState: 'revoked' as const };
  next.snapshot.members[memberIndex] = revoked;
  next.lifecycle = { ...next.lifecycle, updatedAt: timestamp };
  const events: ControlRoomEvent[] = [];
  pushControlEvent(next, events, timestamp, {
    type: 'room.member.left',
    payload: { member: revoked },
  });
  return finishApplied(state, next, events);
};

const publishConfig = (
  state: ArenaRoomAuthorityState,
  command: Extract<ArenaRoomCommand, { type: 'publish-config' }>,
): ArenaRoomTransitionResult => {
  const authorization = requireHost(state, command.actorUserId);
  if (authorization) return authorization;
  if (command.expectedRevision !== state.snapshot.revision) {
    return transitionFailure('stale', 'room-revision-mismatch');
  }
  if (deepEqual(state.snapshot.sharedConfig, command.sharedConfig)) return finishIdempotent(state);
  const next = cloneState(state);
  next.snapshot.sharedConfig = deepClone(command.sharedConfig);
  next.snapshot.revision += 1;
  next.lifecycle = { ...next.lifecycle, updatedAt: command.timestamp };
  const events: ControlRoomEvent[] = [];
  pushControlEvent(next, events, command.timestamp, {
    type: 'room.config.updated',
    payload: {
      revision: next.snapshot.revision,
      sharedConfig: deepClone(next.snapshot.sharedConfig),
    },
  });
  return finishApplied(state, next, events);
};

const submitProposal = (
  state: ArenaRoomAuthorityState,
  command: Extract<ArenaRoomCommand, { type: 'submit-proposal' }>,
): ArenaRoomTransitionResult => {
  const authorization = requireMember(state, command.actorUserId);
  if (authorization) return authorization;
  if (command.proposal.authorUserId !== command.actorUserId || command.proposal.roomId !== state.snapshot.roomId) {
    return transitionFailure('forbidden', 'member-required');
  }
  if (command.proposal.status !== 'submitted') {
    return transitionFailure('validation-failed', 'proposal-not-submitted');
  }
  if (command.proposal.baseRevision > state.snapshot.revision) {
    return transitionFailure('stale', 'room-revision-mismatch');
  }
  const existing = state.snapshot.proposals.find((item) => item.proposalId === command.proposal.proposalId);
  if (existing) {
    return deepEqual(existing, command.proposal)
      ? finishIdempotent(state)
      : transitionFailure('duplicate', 'proposal-id-conflict');
  }
  const pendingCount = state.snapshot.proposals.filter((item) => (
    item.authorUserId === command.actorUserId && item.status === 'submitted'
  )).length;
  if (pendingCount >= MAX_PENDING_PROPOSALS_PER_MEMBER) {
    return transitionFailure('capability-denied', 'member-limit-reached');
  }
  const next = cloneState(state);
  next.snapshot.proposals.push(deepClone(command.proposal));
  next.lifecycle = { ...next.lifecycle, updatedAt: command.timestamp };
  const events: ControlRoomEvent[] = [];
  pushControlEvent(next, events, command.timestamp, {
    type: 'proposal.submitted',
    payload: { proposal: deepClone(command.proposal) },
  });
  return finishApplied(state, next, events);
};

const updateProposalStatus = (
  state: ArenaRoomAuthorityState,
  proposalIndex: number,
  status: ArenaProposal['status'],
  timestamp: string,
): { next: MutableState; proposal: ArenaProposal } => {
  const next = cloneState(state);
  const current = next.snapshot.proposals[proposalIndex];
  if (!current) throw new Error('proposal index disappeared');
  const proposal = { ...current, status, updatedAt: timestamp } as ArenaProposal;
  next.snapshot.proposals[proposalIndex] = proposal;
  next.lifecycle = { ...next.lifecycle, updatedAt: timestamp };
  return { next, proposal };
};

const resolveProposal = (
  state: ArenaRoomAuthorityState,
  command: Extract<ArenaRoomCommand, { type: 'resolve-proposal' }>,
): ArenaRoomTransitionResult => {
  const authorization = requireHost(state, command.actorUserId);
  if (authorization) return authorization;
  const proposalIndex = state.snapshot.proposals.findIndex((item) => item.proposalId === command.proposalId);
  if (proposalIndex < 0) return transitionFailure('not-found', 'proposal-not-found');
  const proposal = state.snapshot.proposals[proposalIndex];
  if (!proposal || proposal.status !== 'submitted') {
    return transitionFailure('conflict', 'proposal-not-submitted');
  }
  if (command.resolution === 'reject') {
    const { next } = updateProposalStatus(state, proposalIndex, 'rejected', command.timestamp);
    const events: ControlRoomEvent[] = [];
    pushControlEvent(next, events, command.timestamp, {
      type: 'proposal.resolved',
      payload: { proposalId: command.proposalId, status: 'rejected' },
    });
    return finishApplied(state, next, events);
  }

  const applied = applyArenaProposal({
    roomId: state.snapshot.roomId,
    config: state.snapshot.sharedConfig,
    revision: state.snapshot.revision,
  }, proposal, command.selectedChangeIds);
  if (applied.status === 'rejected') {
    return applied.conflicts.length > 0
      ? transitionFailure('conflict', 'proposal-conflict')
      : transitionFailure('validation-failed', 'proposal-selection-invalid');
  }
  const { next } = updateProposalStatus(state, proposalIndex, applied.status, command.timestamp);
  next.snapshot.sharedConfig = deepClone(applied.config);
  next.snapshot.revision = applied.revision;
  const events: ControlRoomEvent[] = [];
  pushControlEvent(next, events, command.timestamp, {
    type: 'room.config.updated',
    payload: {
      revision: next.snapshot.revision,
      sharedConfig: deepClone(next.snapshot.sharedConfig),
    },
  });
  pushControlEvent(next, events, command.timestamp, {
    type: 'proposal.resolved',
    payload: { proposalId: command.proposalId, status: applied.status },
  });
  return finishApplied(state, next, events);
};

const withdrawProposal = (
  state: ArenaRoomAuthorityState,
  command: Extract<ArenaRoomCommand, { type: 'withdraw-proposal' }>,
): ArenaRoomTransitionResult => {
  const authorization = requireMember(state, command.actorUserId);
  if (authorization) return authorization;
  const proposalIndex = state.snapshot.proposals.findIndex((item) => item.proposalId === command.proposalId);
  if (proposalIndex < 0) return transitionFailure('not-found', 'proposal-not-found');
  const proposal = state.snapshot.proposals[proposalIndex];
  if (!proposal || proposal.authorUserId !== command.actorUserId) {
    return transitionFailure('forbidden', 'proposal-author-required');
  }
  if (proposal.status !== 'submitted') return transitionFailure('conflict', 'proposal-not-submitted');
  const { next } = updateProposalStatus(state, proposalIndex, 'withdrawn', command.timestamp);
  const events: ControlRoomEvent[] = [];
  pushControlEvent(next, events, command.timestamp, {
    type: 'proposal.resolved',
    payload: { proposalId: command.proposalId, status: 'withdrawn' },
  });
  return finishApplied(state, next, events);
};

const sameReservation = (
  mirror: GenerationMirror,
  command: Extract<ArenaRoomCommand, { type: 'reserve-generation' }>,
): boolean => (
  mirror.generationRequestId === command.generationRequestId
  && mirror.generationId === command.generationId
  && mirror.attempt === command.attempt
  && mirror.configRevision === command.expectedRevision
  && mirror.snapshotDigest === command.snapshotDigest
  && mirror.collaborativeInfluence === command.collaborativeInfluence
  && deepEqual(mirror.participantUserIds, command.participantUserIds)
);

const reserveGeneration = (
  state: ArenaRoomAuthorityState,
  command: Extract<ArenaRoomCommand, { type: 'reserve-generation' }>,
): ArenaRoomTransitionResult => {
  const authorization = requireHost(state, command.actorUserId);
  if (authorization) return authorization;
  if (command.expectedRevision !== state.snapshot.revision) {
    return transitionFailure('stale', 'room-revision-mismatch');
  }
  const active = state.snapshot.activeGeneration;
  if (active?.generationRequestId === command.generationRequestId) {
    return sameReservation(active, command)
      ? finishIdempotent(state)
      : transitionFailure('conflict', 'generation-request-conflict');
  }
  if (active && (active.state === 'starting' || active.state === 'running')) {
    return transitionFailure('conflict', 'generation-active');
  }
  const next = cloneState(state);
  next.snapshot.activeGeneration = {
    generationRequestId: command.generationRequestId,
    generationId: command.generationId,
    attempt: command.attempt,
    state: 'starting',
    configRevision: state.snapshot.revision,
    snapshotDigest: command.snapshotDigest,
    collaborativeInfluence: command.collaborativeInfluence,
    participantUserIds: [...command.participantUserIds],
    startedAt: command.timestamp,
  };
  next.lifecycle = { ...next.lifecycle, updatedAt: command.timestamp };
  const events: ControlRoomEvent[] = [];
  pushSnapshotEvent(next, events, command.timestamp);
  return finishApplied(state, next, events);
};

const generationEventPayload = (mirror: GenerationMirror) => ({
  generationRequestId: mirror.generationRequestId,
  generationId: mirror.generationId,
  attempt: mirror.attempt,
  configRevision: mirror.configRevision,
  snapshotDigest: mirror.snapshotDigest,
  collaborativeInfluence: mirror.collaborativeInfluence,
  participantUserIds: [...mirror.participantUserIds],
});

const mirrorGeneration = (
  state: ArenaRoomAuthorityState,
  command: Extract<ArenaRoomCommand, { type: 'mirror-generation' }>,
): ArenaRoomTransitionResult => {
  const active = state.snapshot.activeGeneration;
  if (!active) return transitionFailure('not-found', 'generation-identity-mismatch');
  if (active.generationRequestId !== command.generationRequestId || active.generationId !== command.generationId) {
    return transitionFailure('stale', 'generation-identity-mismatch');
  }
  if (active.attempt !== command.attempt) {
    return transitionFailure('stale', 'generation-attempt-mismatch');
  }
  const terminal = active.state === 'completed' || active.state === 'failed' || active.state === 'cancelled';
  if (terminal) {
    return active.state === command.state
      ? finishIdempotent(state)
      : transitionFailure('conflict', 'generation-transition-invalid');
  }
  if (active.state === 'running' && command.state === 'running') return finishIdempotent(state);

  const next = cloneState(state);
  const nextMirror: GenerationMirror = {
    ...active,
    state: command.state,
    ...(command.state === 'completed' || command.state === 'failed' || command.state === 'cancelled'
      ? { finishedAt: command.timestamp }
      : {}),
  };
  next.snapshot.activeGeneration = nextMirror;
  next.lifecycle = { ...next.lifecycle, updatedAt: command.timestamp };
  const events: ControlRoomEvent[] = [];
  if (command.state === 'running') {
    pushControlEvent(next, events, command.timestamp, {
      type: 'generation.started',
      payload: generationEventPayload(nextMirror),
    });
  } else if (command.state === 'completed') {
    pushControlEvent(next, events, command.timestamp, {
      type: 'generation.completed',
      payload: {
        ...generationEventPayload(nextMirror),
        generationRecordId: command.generationRecordId as string,
      },
    });
  } else if (command.state === 'failed') {
    pushControlEvent(next, events, command.timestamp, {
      type: 'generation.failed',
      payload: {
        ...generationEventPayload(nextMirror),
        errorCode: command.errorCode as NonNullable<typeof command.errorCode>,
      },
    });
  } else {
    pushSnapshotEvent(next, events, command.timestamp);
  }
  return finishApplied(state, next, events);
};

export const transitionArenaRoom = (
  stateInput: unknown | null,
  commandInput: unknown,
): ArenaRoomTransitionResult => {
  const parsedCommand = ArenaRoomCommandSchema.safeParse(commandInput);
  if (!parsedCommand.success) return transitionFailure('validation-failed', 'invalid-command');
  const command = parsedCommand.data;

  if (command.type === 'create') {
    if (stateInput !== null) {
      const current = parseState(stateInput);
      return current
        ? transitionFailure('duplicate', 'state-already-exists')
        : transitionFailure('validation-failed', 'invalid-state');
    }
    return createRoom(command);
  }
  if (stateInput === null) return transitionFailure('not-found', 'state-required');
  const state = parseState(stateInput);
  if (!state) return transitionFailure('validation-failed', 'invalid-state');
  if (command.expectedRoomEpoch !== state.snapshot.roomEpoch) {
    return transitionFailure('stale', 'room-epoch-mismatch');
  }

  if (command.type === 'close') {
    const authorization = requireHost(state, command.actorUserId);
    if (authorization) return authorization;
    return closeRoom(state, command.timestamp, command.reason);
  }
  if (state.lifecycle.status === 'closed') return transitionFailure('room-closed', 'room-closed');

  switch (command.type) {
    case 'join-member':
      return joinMember(state, command);
    case 'leave-member': {
      const member = activeMember(state, command.actorUserId);
      if (!member) return transitionFailure('not-found', 'member-not-active');
      return member.role === 'host'
        ? closeRoom(state, command.timestamp)
        : revokeMember(state, command.actorUserId, command.timestamp);
    }
    case 'kick-member': {
      const authorization = requireHost(state, command.actorUserId);
      if (authorization) return authorization;
      const target = state.snapshot.members.find((member) => member.userId === command.targetUserId);
      if (target?.role === 'host') return transitionFailure('forbidden', 'host-required');
      return revokeMember(state, command.targetUserId, command.timestamp);
    }
    case 'publish-config':
      return publishConfig(state, command);
    case 'submit-proposal':
      return submitProposal(state, command);
    case 'resolve-proposal':
      return resolveProposal(state, command);
    case 'withdraw-proposal':
      return withdrawProposal(state, command);
    case 'reserve-generation':
      return reserveGeneration(state, command);
    case 'mirror-generation':
      return mirrorGeneration(state, command);
  }
};
