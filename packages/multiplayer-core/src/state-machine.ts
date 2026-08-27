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
import { transitionSuccessInternal } from './checkpoint-commit';
import { mergeCollaborativeChanges, retainCollaborativeChanges } from './provenance';
import {
  ArenaRoomAuthorityStateSchema,
  ArenaRoomCommandSchema,
  ARENA_ROOM_AUTHORITY_STATE_VERSION,
  MAX_ROOM_COLLABORATIVE_CHANGES,
  MAX_ROOM_GENERATION_RECORDS,
  MAX_ROOM_MEMBER_AUTHORITY_RECORDS,
  MAX_ROOM_PROPOSAL_TOMBSTONES,
  checkpointPredecessorOf,
  parseArenaRoomAuthorityContext,
  parseArenaRoomTrustedTime,
  transitionFailure,
  type ArenaRoomAuthorityContext,
  type ArenaRoomAuthorityState,
  type ArenaRoomCommand,
  type ArenaRoomGenerationRecord,
  type ArenaRoomMemberAuthorityRecord,
  type ArenaRoomTransitionResult,
  type ArenaRoomTrustedTime,
} from './state-machine-model';
import { deepClone, deepEqual } from './utils';

type MutableState = {
  -readonly [K in keyof ArenaRoomAuthorityState]: ArenaRoomAuthorityState[K];
};

type UserAuthority = Extract<ArenaRoomAuthorityContext, { kind: 'authenticated-user' }>;

const parseState = (input: unknown): ArenaRoomAuthorityState | null => {
  const parsed = ArenaRoomAuthorityStateSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
};

const cloneState = (state: ArenaRoomAuthorityState): MutableState => deepClone(state) as MutableState;

const activeMember = (state: ArenaRoomAuthorityState, userId: string): RoomMember | undefined => (
  state.snapshot.members.find((member) => member.userId === userId && member.membershipState === 'active')
);

const memberAuthorityRecord = (
  state: ArenaRoomAuthorityState,
  userId: string,
): ArenaRoomMemberAuthorityRecord | undefined => (
  state.memberAuthority.find((record) => record.member.userId === userId)
);

const requireUserAuthority = (
  state: ArenaRoomAuthorityState,
  context: ArenaRoomAuthorityContext,
): UserAuthority | ArenaRoomTransitionResult => {
  if (context.kind !== 'authenticated-user') {
    return transitionFailure('forbidden', 'invalid-authority-context');
  }
  const record = memberAuthorityRecord(state, context.actorUserId);
  if (!record
    || record.accountUserId !== context.accountUserId
    || record.member.membershipState !== 'active') {
    return transitionFailure('forbidden', 'member-not-active');
  }
  return context;
};

const requireRole = (
  state: ArenaRoomAuthorityState,
  context: ArenaRoomAuthorityContext,
  role: 'host' | 'member',
): ArenaRoomTransitionResult | null => {
  const authority = requireUserAuthority(state, context);
  if ('ok' in authority) return authority;
  const member = activeMember(state, authority.actorUserId);
  if (member?.role === role) return null;
  return transitionFailure('forbidden', role === 'host' ? 'host-required' : 'member-required');
};

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
): boolean => {
  const controlSeq = state.snapshot.controlSeq + 1;
  const parsed = RoomEventSchema.safeParse({
    ...eventBase(state, timestamp),
    controlSeq,
    ...event,
  });
  if (!parsed.success || parsed.data.type === 'story.delta') return false;
  state.snapshot.controlSeq = controlSeq;
  events.push(parsed.data);
  return true;
};

const pushSnapshotEvent = (
  state: MutableState,
  events: ControlRoomEvent[],
  timestamp: string,
  increment = true,
): boolean => {
  const controlSeq = increment ? state.snapshot.controlSeq + 1 : state.snapshot.controlSeq;
  const snapshot = deepClone(state.snapshot);
  snapshot.controlSeq = controlSeq;
  const parsed = RoomEventSchema.safeParse({
    ...eventBase(state, timestamp),
    type: 'room.snapshot',
    controlSeq,
    payload: snapshot,
  });
  if (!parsed.success || parsed.data.type === 'story.delta') return false;
  state.snapshot.controlSeq = controlSeq;
  events.push(parsed.data);
  return true;
};

const snapshotFitsControlFrame = (state: ArenaRoomAuthorityState): boolean => RoomEventSchema.safeParse({
  ...eventBase(state, state.lifecycle.updatedAt),
  type: 'room.snapshot',
  controlSeq: state.snapshot.controlSeq,
  payload: state.snapshot,
}).success;

const finishApplied = (
  previous: ArenaRoomAuthorityState | null,
  next: MutableState,
  events: readonly ControlRoomEvent[],
): ArenaRoomTransitionResult => {
  if (!snapshotFitsControlFrame(next)) {
    return transitionFailure('payload-too-large', 'room-snapshot-too-large');
  }
  const parsed = ArenaRoomAuthorityStateSchema.safeParse(next);
  if (!parsed.success) return transitionFailure('validation-failed', 'invalid-state');
  return transitionSuccessInternal({
    kind: 'applied',
    predecessor: previous ? checkpointPredecessorOf(previous) : null,
    nextState: parsed.data,
    events,
  });
};

const finishIdempotent = (state: ArenaRoomAuthorityState): ArenaRoomTransitionResult => transitionSuccessInternal({
  kind: 'idempotent',
  predecessor: checkpointPredecessorOf(state),
  nextState: deepClone(state),
});

const eventOverflow = (): ArenaRoomTransitionResult => (
  transitionFailure('payload-too-large', 'room-snapshot-too-large')
);

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
  if (!pushControlEvent(next, events, timestamp, {
    type: 'room.closing',
    payload: reason === undefined ? {} : { reason },
  })) return eventOverflow();
  return finishApplied(state, next, events);
};

const createRoom = (
  command: Extract<ArenaRoomCommand, { type: 'create' }>,
  context: ArenaRoomAuthorityContext,
): ArenaRoomTransitionResult => {
  if (context.kind !== 'authenticated-user'
    || context.actorUserId !== command.host.userId
    || command.host.role !== 'host'
    || command.host.membershipState !== 'active') {
    return transitionFailure('forbidden', 'host-required');
  }
  const snapshot = ArenaRoomSnapshotSchema.safeParse({
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
  if (!snapshot.success) return transitionFailure('validation-failed', 'invalid-command');
  const parsed = ArenaRoomAuthorityStateSchema.safeParse({
    lifecycle: {
      status: 'open',
      createdAt: command.timestamp,
      updatedAt: command.timestamp,
    },
    snapshot: snapshot.data,
    authorityStateVersion: ARENA_ROOM_AUTHORITY_STATE_VERSION,
    memberAuthority: [{ accountUserId: context.accountUserId, member: command.host }],
    generationLedger: [],
    terminalProposalIds: [],
    collaborativeChanges: [],
  });
  if (!parsed.success) return transitionFailure('validation-failed', 'invalid-state');
  const next = cloneState(parsed.data);
  const events: ControlRoomEvent[] = [];
  if (!pushSnapshotEvent(next, events, command.timestamp, false)) return eventOverflow();
  return finishApplied(null, next, events);
};

const joinMember = (
  state: ArenaRoomAuthorityState,
  command: Extract<ArenaRoomCommand, { type: 'join-member' }>,
  context: ArenaRoomAuthorityContext,
): ArenaRoomTransitionResult => {
  if (context.kind !== 'authenticated-user'
    || context.actorUserId !== command.member.userId
    || command.member.role !== 'member'
    || command.member.membershipState !== 'active') {
    return transitionFailure('forbidden', 'member-required');
  }
  const existing = memberAuthorityRecord(state, command.member.userId);
  if (existing) {
    if (existing.member.membershipState === 'revoked') {
      return transitionFailure('forbidden', 'member-not-active');
    }
    return existing.accountUserId === context.accountUserId && deepEqual(existing.member, command.member)
      ? finishIdempotent(state)
      : transitionFailure('duplicate', 'member-id-conflict');
  }
  if (state.memberAuthority.some((record) => record.accountUserId === context.accountUserId)) {
    return transitionFailure('duplicate', 'member-id-conflict');
  }
  if (state.snapshot.members.filter((member) => member.membershipState === 'active').length >= MAX_ROOM_MEMBERS) {
    return transitionFailure('capability-denied', 'member-limit-reached');
  }
  if (state.memberAuthority.length >= MAX_ROOM_MEMBER_AUTHORITY_RECORDS) {
    return transitionFailure('capability-denied', 'member-history-limit-reached');
  }
  const next = cloneState(state);
  next.snapshot.members.push(deepClone(command.member));
  next.memberAuthority.push({ accountUserId: context.accountUserId, member: deepClone(command.member) });
  next.lifecycle = { ...next.lifecycle, updatedAt: command.timestamp };
  const events: ControlRoomEvent[] = [];
  if (!pushControlEvent(next, events, command.timestamp, {
    type: 'room.member.joined',
    payload: { member: deepClone(command.member) },
  })) return eventOverflow();
  return finishApplied(state, next, events);
};

const revokeMember = (
  state: ArenaRoomAuthorityState,
  targetUserId: string,
  timestamp: string,
): ArenaRoomTransitionResult => {
  const authorityIndex = state.memberAuthority.findIndex((record) => record.member.userId === targetUserId);
  if (authorityIndex < 0) return transitionFailure('not-found', 'member-not-active');
  const authority = state.memberAuthority[authorityIndex];
  if (!authority) return transitionFailure('not-found', 'member-not-active');
  if (authority.member.membershipState === 'revoked') return finishIdempotent(state);
  const member = activeMember(state, targetUserId);
  if (!member) return transitionFailure('validation-failed', 'invalid-state');

  const authoredProposals = state.snapshot.proposals.filter((item) => item.authorUserId === targetUserId);
  const pendingProposalIds = authoredProposals
    .filter((item) => item.status === 'submitted')
    .map((item) => item.proposalId);
  const proposalIdsToTombstone = authoredProposals
    .map((item) => item.proposalId)
    .filter((proposalId) => !state.terminalProposalIds.includes(proposalId));
  if (state.terminalProposalIds.length + proposalIdsToTombstone.length > MAX_ROOM_PROPOSAL_TOMBSTONES) {
    return transitionFailure('capability-denied', 'proposal-history-limit-reached');
  }

  const next = cloneState(state);
  const revoked = { ...member, membershipState: 'revoked' as const };
  next.snapshot.members = next.snapshot.members.filter((item) => item.userId !== targetUserId);
  next.snapshot.proposals = next.snapshot.proposals.filter((item) => item.authorUserId !== targetUserId);
  next.memberAuthority[authorityIndex] = {
    accountUserId: authority.accountUserId,
    member: revoked,
  };
  next.terminalProposalIds.push(...proposalIdsToTombstone);
  next.lifecycle = { ...next.lifecycle, updatedAt: timestamp };
  const events: ControlRoomEvent[] = [];
  for (const proposalId of pendingProposalIds) {
    if (!pushControlEvent(next, events, timestamp, {
      type: 'proposal.resolved',
      payload: { proposalId, status: 'withdrawn' },
    })) return eventOverflow();
  }
  if (!pushControlEvent(next, events, timestamp, {
    type: 'room.member.left',
    payload: { member: revoked },
  })) return eventOverflow();
  return finishApplied(state, next, events);
};

const publishConfig = (
  state: ArenaRoomAuthorityState,
  command: Extract<ArenaRoomCommand, { type: 'publish-config' }>,
  context: ArenaRoomAuthorityContext,
): ArenaRoomTransitionResult => {
  const authorization = requireRole(state, context, 'host');
  if (authorization) return authorization;
  if (command.expectedRevision !== state.snapshot.revision) {
    return transitionFailure('stale', 'room-revision-mismatch');
  }
  if (deepEqual(state.snapshot.sharedConfig, command.sharedConfig)) return finishIdempotent(state);
  const next = cloneState(state);
  next.snapshot.sharedConfig = deepClone(command.sharedConfig);
  next.snapshot.revision += 1;
  next.collaborativeChanges = retainCollaborativeChanges(
    state.collaborativeChanges,
    next.snapshot.sharedConfig,
  );
  next.lifecycle = { ...next.lifecycle, updatedAt: command.timestamp };
  const events: ControlRoomEvent[] = [];
  if (!pushControlEvent(next, events, command.timestamp, {
    type: 'room.config.updated',
    payload: {
      revision: next.snapshot.revision,
      sharedConfig: deepClone(next.snapshot.sharedConfig),
    },
  })) return eventOverflow();
  return finishApplied(state, next, events);
};

const submitProposal = (
  state: ArenaRoomAuthorityState,
  command: Extract<ArenaRoomCommand, { type: 'submit-proposal' }>,
  context: ArenaRoomAuthorityContext,
): ArenaRoomTransitionResult => {
  const authorization = requireRole(state, context, 'member');
  if (authorization) return authorization;
  const actor = context as UserAuthority;
  if (command.proposal.authorUserId !== actor.actorUserId || command.proposal.roomId !== state.snapshot.roomId) {
    return transitionFailure('forbidden', 'member-required');
  }
  if (command.proposal.status !== 'submitted') {
    return transitionFailure('validation-failed', 'proposal-not-submitted');
  }
  if (command.proposal.baseRevision > state.snapshot.revision) {
    return transitionFailure('stale', 'room-revision-mismatch');
  }
  if (state.terminalProposalIds.includes(command.proposal.proposalId)) {
    return transitionFailure('duplicate', 'proposal-id-conflict');
  }
  const existing = state.snapshot.proposals.find((item) => item.proposalId === command.proposal.proposalId);
  if (existing) {
    return deepEqual(existing, command.proposal)
      ? finishIdempotent(state)
      : transitionFailure('duplicate', 'proposal-id-conflict');
  }
  const knownProposalIds = new Set([
    ...state.terminalProposalIds,
    ...state.snapshot.proposals.map((item) => item.proposalId),
  ]);
  if (knownProposalIds.size >= MAX_ROOM_PROPOSAL_TOMBSTONES) {
    return transitionFailure('capability-denied', 'proposal-history-limit-reached');
  }
  const pendingCount = state.snapshot.proposals.filter((item) => (
    item.authorUserId === actor.actorUserId && item.status === 'submitted'
  )).length;
  if (pendingCount >= MAX_PENDING_PROPOSALS_PER_MEMBER) {
    return transitionFailure('capability-denied', 'member-limit-reached');
  }
  const next = cloneState(state);
  next.snapshot.proposals.push(deepClone(command.proposal));
  next.lifecycle = { ...next.lifecycle, updatedAt: command.timestamp };
  const events: ControlRoomEvent[] = [];
  if (!pushControlEvent(next, events, command.timestamp, {
    type: 'proposal.submitted',
    payload: { proposal: deepClone(command.proposal) },
  })) return eventOverflow();
  return finishApplied(state, next, events);
};

const takeProposal = (
  state: ArenaRoomAuthorityState,
  proposalIndex: number,
  timestamp: string,
): { next: MutableState; proposal: ArenaProposal } | null => {
  const proposal = state.snapshot.proposals[proposalIndex];
  if (!proposal || state.terminalProposalIds.length >= MAX_ROOM_PROPOSAL_TOMBSTONES) return null;
  const next = cloneState(state);
  next.snapshot.proposals.splice(proposalIndex, 1);
  next.terminalProposalIds.push(proposal.proposalId);
  next.lifecycle = { ...next.lifecycle, updatedAt: timestamp };
  return { next, proposal };
};

const resolveProposal = (
  state: ArenaRoomAuthorityState,
  command: Extract<ArenaRoomCommand, { type: 'resolve-proposal' }>,
  context: ArenaRoomAuthorityContext,
): ArenaRoomTransitionResult => {
  const authorization = requireRole(state, context, 'host');
  if (authorization) return authorization;
  const proposalIndex = state.snapshot.proposals.findIndex((item) => item.proposalId === command.proposalId);
  if (proposalIndex < 0) {
    return state.terminalProposalIds.includes(command.proposalId)
      ? transitionFailure('conflict', 'proposal-not-submitted')
      : transitionFailure('not-found', 'proposal-not-found');
  }
  const proposal = state.snapshot.proposals[proposalIndex];
  if (!proposal || proposal.status !== 'submitted') {
    return transitionFailure('conflict', 'proposal-not-submitted');
  }
  const taken = takeProposal(state, proposalIndex, command.timestamp);
  if (!taken) return transitionFailure('capability-denied', 'proposal-history-limit-reached');
  const { next } = taken;
  const events: ControlRoomEvent[] = [];

  if (command.resolution === 'reject') {
    if (!pushControlEvent(next, events, command.timestamp, {
      type: 'proposal.resolved',
      payload: { proposalId: command.proposalId, status: 'rejected' },
    })) return eventOverflow();
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

  const configChanged = !deepEqual(state.snapshot.sharedConfig, applied.config);
  if (configChanged) {
    next.snapshot.sharedConfig = deepClone(applied.config);
    next.snapshot.revision = state.snapshot.revision + 1;
    const acceptedIds = new Set(applied.acceptedChangeIds);
    const collaborativeChanges = mergeCollaborativeChanges({
      previousChanges: state.collaborativeChanges,
      acceptedChanges: proposal.changes.filter((change) => acceptedIds.has(change.changeId)),
      previousConfig: state.snapshot.sharedConfig,
      nextConfig: next.snapshot.sharedConfig,
    });
    if (collaborativeChanges.length > MAX_ROOM_COLLABORATIVE_CHANGES) {
      return transitionFailure('capability-denied', 'collaborative-history-limit-reached');
    }
    next.collaborativeChanges = collaborativeChanges;
    if (!pushControlEvent(next, events, command.timestamp, {
      type: 'room.config.updated',
      payload: {
        revision: next.snapshot.revision,
        sharedConfig: deepClone(next.snapshot.sharedConfig),
      },
    })) return eventOverflow();
  }
  if (!pushControlEvent(next, events, command.timestamp, {
    type: 'proposal.resolved',
    payload: { proposalId: command.proposalId, status: applied.status },
  })) return eventOverflow();
  return finishApplied(state, next, events);
};

const withdrawProposal = (
  state: ArenaRoomAuthorityState,
  command: Extract<ArenaRoomCommand, { type: 'withdraw-proposal' }>,
  context: ArenaRoomAuthorityContext,
): ArenaRoomTransitionResult => {
  const authorization = requireRole(state, context, 'member');
  if (authorization) return authorization;
  const actor = context as UserAuthority;
  const proposalIndex = state.snapshot.proposals.findIndex((item) => item.proposalId === command.proposalId);
  if (proposalIndex < 0) {
    return state.terminalProposalIds.includes(command.proposalId)
      ? transitionFailure('conflict', 'proposal-not-submitted')
      : transitionFailure('not-found', 'proposal-not-found');
  }
  const proposal = state.snapshot.proposals[proposalIndex];
  if (!proposal || proposal.authorUserId !== actor.actorUserId) {
    return transitionFailure('forbidden', 'proposal-author-required');
  }
  if (proposal.status !== 'submitted') return transitionFailure('conflict', 'proposal-not-submitted');
  const taken = takeProposal(state, proposalIndex, command.timestamp);
  if (!taken) return transitionFailure('capability-denied', 'proposal-history-limit-reached');
  const events: ControlRoomEvent[] = [];
  if (!pushControlEvent(taken.next, events, command.timestamp, {
    type: 'proposal.resolved',
    payload: { proposalId: command.proposalId, status: 'withdrawn' },
  })) return eventOverflow();
  return finishApplied(state, taken.next, events);
};

const sameReservation = (
  record: ArenaRoomGenerationRecord,
  command: Extract<ArenaRoomCommand, { type: 'reserve-generation' }>,
  snapshotDigest: string,
): boolean => (
  record.mirror.generationRequestId === command.generationRequestId
  && record.mirror.generationId === command.generationId
  && record.mirror.attempt === command.attempt
  && record.mirror.configRevision === command.expectedRevision
  && record.mirror.snapshotDigest === snapshotDigest
);

const reserveGeneration = (
  state: ArenaRoomAuthorityState,
  command: Extract<ArenaRoomCommand, { type: 'reserve-generation' }>,
  context: ArenaRoomAuthorityContext,
  trustedTime: ArenaRoomTrustedTime,
): ArenaRoomTransitionResult => {
  if (context.kind !== 'generation-reserver') {
    return transitionFailure('forbidden', 'invalid-authority-context');
  }
  const authority = memberAuthorityRecord(state, context.actorUserId);
  if (!authority
    || authority.accountUserId !== context.accountUserId
    || authority.member.membershipState !== 'active'
    || authority.member.role !== 'host') {
    return transitionFailure('forbidden', 'host-required');
  }
  const scope = context.scope;
  if (scope.roomId !== state.snapshot.roomId
    || scope.roomEpoch !== state.snapshot.roomEpoch
    || scope.configRevision !== command.expectedRevision
    || scope.generationRequestId !== command.generationRequestId
    || scope.generationId !== command.generationId
    || scope.attempt !== command.attempt) {
    return transitionFailure('forbidden', 'authority-scope-mismatch');
  }
  const now = Date.parse(trustedTime.now);
  if (Date.parse(command.timestamp) !== now) {
    return transitionFailure('forbidden', 'command-timestamp-mismatch');
  }
  if (now < Date.parse(state.lifecycle.updatedAt)) {
    return transitionFailure('stale', 'command-timestamp-regression');
  }
  if (now >= Date.parse(scope.expiresAt)) {
    return transitionFailure('forbidden', 'authority-scope-expired');
  }
  const historical = state.generationLedger.find((record) => (
    record.mirror.generationRequestId === command.generationRequestId
  ));
  if (historical) {
    return sameReservation(historical, command, scope.snapshotDigest)
      ? finishIdempotent(state)
      : transitionFailure('conflict', 'generation-request-conflict');
  }
  if (state.generationLedger.some((record) => record.mirror.generationId === command.generationId)) {
    return transitionFailure('conflict', 'generation-id-conflict');
  }
  if (command.expectedRevision !== state.snapshot.revision) {
    return transitionFailure('stale', 'room-revision-mismatch');
  }
  const active = state.snapshot.activeGeneration;
  if (active && (active.state === 'starting' || active.state === 'running')) {
    return transitionFailure('conflict', 'generation-active');
  }
  if (state.generationLedger.length >= MAX_ROOM_GENERATION_RECORDS) {
    return transitionFailure('capability-denied', 'generation-history-limit-reached');
  }
  const participantUserIds = state.memberAuthority
    .filter((record) => record.member.membershipState === 'active')
    .map((record) => record.accountUserId)
    .sort((left, right) => left - right);
  const collaborativeInfluence = state.collaborativeChanges.length > 0;
  const mirror: GenerationMirror = {
    generationRequestId: command.generationRequestId,
    generationId: command.generationId,
    attempt: command.attempt,
    state: 'starting',
    configRevision: state.snapshot.revision,
    snapshotDigest: scope.snapshotDigest,
    collaborativeInfluence,
    participantUserIds,
    startedAt: command.timestamp,
  };
  const next = cloneState(state);
  next.snapshot.activeGeneration = mirror;
  next.generationLedger.push({ mirror: deepClone(mirror) });
  next.lifecycle = { ...next.lifecycle, updatedAt: command.timestamp };
  const events: ControlRoomEvent[] = [];
  if (!pushSnapshotEvent(next, events, command.timestamp)) return eventOverflow();
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

const terminalMetadataMatches = (
  record: ArenaRoomGenerationRecord,
  command: Extract<ArenaRoomCommand, { type: 'mirror-generation' }>,
): boolean => {
  if (command.state === 'completed') return record.generationRecordId === command.generationRecordId;
  if (command.state === 'failed') return record.errorCode === command.errorCode;
  return command.state === 'cancelled';
};

const mirrorGeneration = (
  state: ArenaRoomAuthorityState,
  command: Extract<ArenaRoomCommand, { type: 'mirror-generation' }>,
  context: ArenaRoomAuthorityContext,
  trustedTime: ArenaRoomTrustedTime,
): ArenaRoomTransitionResult => {
  if (context.kind !== 'generation-publisher') {
    return transitionFailure('forbidden', 'invalid-authority-context');
  }
  const scope = context.scope;
  if (scope.roomId !== state.snapshot.roomId
    || scope.roomEpoch !== state.snapshot.roomEpoch
    || scope.generationRequestId !== command.generationRequestId
    || scope.generationId !== command.generationId
    || scope.attempt !== command.attempt) {
    return transitionFailure('forbidden', 'authority-scope-mismatch');
  }
  const now = Date.parse(trustedTime.now);
  if (Date.parse(command.timestamp) !== now) {
    return transitionFailure('forbidden', 'command-timestamp-mismatch');
  }
  if (now < Date.parse(state.lifecycle.updatedAt)) {
    return transitionFailure('stale', 'command-timestamp-regression');
  }
  if (now >= Date.parse(scope.expiresAt)) {
    return transitionFailure('forbidden', 'authority-scope-expired');
  }
  const active = state.snapshot.activeGeneration;
  if (!active) return transitionFailure('not-found', 'generation-identity-mismatch');
  if (active.generationRequestId !== command.generationRequestId || active.generationId !== command.generationId) {
    return transitionFailure('stale', 'generation-identity-mismatch');
  }
  if (active.attempt !== command.attempt) {
    return transitionFailure('stale', 'generation-attempt-mismatch');
  }
  const recordIndex = state.generationLedger.findIndex((record) => (
    record.mirror.generationRequestId === command.generationRequestId
  ));
  const record = state.generationLedger[recordIndex];
  if (!record || !deepEqual(record.mirror, active)) {
    return transitionFailure('validation-failed', 'invalid-state');
  }
  const terminal = active.state === 'completed' || active.state === 'failed' || active.state === 'cancelled';
  if (terminal) {
    if (active.state !== command.state) {
      return transitionFailure('conflict', 'generation-transition-invalid');
    }
    return terminalMetadataMatches(record, command)
      ? finishIdempotent(state)
      : transitionFailure('conflict', 'generation-terminal-conflict');
  }
  if (active.state === 'running' && command.state === 'running') return finishIdempotent(state);
  if (active.state === 'starting' && command.state !== 'running' && command.state !== 'cancelled') {
    return transitionFailure('conflict', 'generation-transition-invalid');
  }

  const next = cloneState(state);
  const nextMirror: GenerationMirror = {
    ...active,
    state: command.state,
    ...(command.state === 'completed' || command.state === 'failed' || command.state === 'cancelled'
      ? { finishedAt: command.timestamp }
      : {}),
  };
  next.snapshot.activeGeneration = nextMirror;
  next.generationLedger[recordIndex] = {
    mirror: deepClone(nextMirror),
    ...(command.state === 'completed' ? { generationRecordId: command.generationRecordId } : {}),
    ...(command.state === 'failed' ? { errorCode: command.errorCode } : {}),
  };
  next.lifecycle = { ...next.lifecycle, updatedAt: command.timestamp };
  const events: ControlRoomEvent[] = [];
  if (command.state === 'running') {
    if (!pushControlEvent(next, events, command.timestamp, {
      type: 'generation.started',
      payload: generationEventPayload(nextMirror),
    })) return eventOverflow();
  } else if (command.state === 'completed') {
    if (!pushControlEvent(next, events, command.timestamp, {
      type: 'generation.completed',
      payload: {
        ...generationEventPayload(nextMirror),
        generationRecordId: command.generationRecordId as string,
      },
    })) return eventOverflow();
  } else if (command.state === 'failed') {
    if (!pushControlEvent(next, events, command.timestamp, {
      type: 'generation.failed',
      payload: {
        ...generationEventPayload(nextMirror),
        errorCode: command.errorCode as NonNullable<typeof command.errorCode>,
      },
    })) return eventOverflow();
  } else if (!pushSnapshotEvent(next, events, command.timestamp)) return eventOverflow();
  return finishApplied(state, next, events);
};

export const transitionArenaRoom = (
  stateInput: unknown | null,
  commandInput: unknown,
  authorityContextInput: unknown,
  trustedTimeInput?: unknown,
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
    const parsedContext = parseArenaRoomAuthorityContext(authorityContextInput);
    if (!parsedContext) return transitionFailure('forbidden', 'invalid-authority-context');
    return createRoom(command, parsedContext);
  }
  if (stateInput === null) return transitionFailure('not-found', 'state-required');
  const state = parseState(stateInput);
  if (!state) return transitionFailure('validation-failed', 'invalid-state');
  if (command.expectedRoomEpoch !== state.snapshot.roomEpoch) {
    return transitionFailure('stale', 'room-epoch-mismatch');
  }
  const context = parseArenaRoomAuthorityContext(authorityContextInput);
  if (!context) return transitionFailure('forbidden', 'invalid-authority-context');

  if (command.type === 'close') {
    const authorization = requireRole(state, context, 'host');
    if (authorization) return authorization;
    return closeRoom(state, command.timestamp, command.reason);
  }
  if (state.lifecycle.status === 'closed') return transitionFailure('room-closed', 'room-closed');

  switch (command.type) {
    case 'join-member':
      return joinMember(state, command, context);
    case 'leave-member': {
      if (context.kind !== 'authenticated-user') {
        return transitionFailure('forbidden', 'invalid-authority-context');
      }
      const record = memberAuthorityRecord(state, context.actorUserId);
      if (!record || record.accountUserId !== context.accountUserId) {
        return transitionFailure('forbidden', 'member-not-active');
      }
      if (record.member.membershipState === 'revoked') return finishIdempotent(state);
      const member = activeMember(state, context.actorUserId);
      if (!member) return transitionFailure('validation-failed', 'invalid-state');
      return member.role === 'host'
        ? closeRoom(state, command.timestamp)
        : revokeMember(state, context.actorUserId, command.timestamp);
    }
    case 'kick-member': {
      const authorization = requireRole(state, context, 'host');
      if (authorization) return authorization;
      const target = memberAuthorityRecord(state, command.targetUserId)?.member;
      if (target?.role === 'host') return transitionFailure('forbidden', 'host-required');
      return revokeMember(state, command.targetUserId, command.timestamp);
    }
    case 'publish-config':
      return publishConfig(state, command, context);
    case 'submit-proposal':
      return submitProposal(state, command, context);
    case 'resolve-proposal':
      return resolveProposal(state, command, context);
    case 'withdraw-proposal':
      return withdrawProposal(state, command, context);
    case 'reserve-generation':
    case 'mirror-generation': {
      const trustedTime = parseArenaRoomTrustedTime(trustedTimeInput);
      if (!trustedTime) return transitionFailure('forbidden', 'invalid-trusted-time');
      return command.type === 'reserve-generation'
        ? reserveGeneration(state, command, context, trustedTime)
        : mirrorGeneration(state, command, context, trustedTime);
    }
  }
};
