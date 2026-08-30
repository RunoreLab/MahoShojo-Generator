import { expect, describe, it } from 'vitest';

import {
  projectArenaRoomEventForViewer,
  projectArenaRoomSnapshotForViewer,
  transitionArenaRoom,
  type ArenaRoomAuthorityState,
  type ArenaRoomTransitionResult,
} from '../src/index';
import {
  createRoomCommand,
  hostAuthority,
  joinMemberCommand,
  memberAuthority,
  NEXT_TIMESTAMP,
  proposal,
  guidanceChange,
} from './state-machine-fixtures';

const success = (result: ArenaRoomTransitionResult): Extract<ArenaRoomTransitionResult, { ok: true }> => {
  expect(result.ok, result.ok ? undefined : `${result.code}:${result.reason}`).toBe(true);
  if (!result.ok) throw new Error(`${result.code}:${result.reason}`);
  return result;
};

const secondMemberAuthority = () => ({
  kind: 'authenticated-user' as const,
  actorUserId: 'member-2',
  accountUserId: 303,
});

const createStateWithTwoProposals = (): ArenaRoomAuthorityState => {
  const created = success(transitionArenaRoom(null, createRoomCommand(), hostAuthority()));
  const firstJoined = success(transitionArenaRoom(created.nextState, joinMemberCommand(), memberAuthority()));
  const secondJoined = success(transitionArenaRoom(firstJoined.nextState, {
    ...joinMemberCommand(),
    member: {
      ...joinMemberCommand().member,
      userId: 'member-2',
      displayName: 'Member 2',
    },
  }, secondMemberAuthority()));
  const firstProposal = success(transitionArenaRoom(secondJoined.nextState, {
    type: 'submit-proposal',
    expectedRoomEpoch: 'epoch-1',
    proposal: proposal([guidanceChange('成员一建议')], 'proposal-1'),
    timestamp: NEXT_TIMESTAMP,
  }, memberAuthority()));
  const secondProposal = success(transitionArenaRoom(firstProposal.nextState, {
    type: 'submit-proposal',
    expectedRoomEpoch: 'epoch-1',
    proposal: {
      ...proposal([guidanceChange('成员二建议')], 'proposal-2'),
      authorUserId: 'member-2',
    },
    timestamp: NEXT_TIMESTAMP,
  }, secondMemberAuthority()));
  return secondProposal.nextState;
};

describe('Arena Room viewer Proposal projection', () => {
  it('shows all pending Proposals to host, only own to authors, and no foreign Proposal to another member', () => {
    const state = createStateWithTwoProposals();
    const host = projectArenaRoomSnapshotForViewer(state.snapshot, 'host-1');
    const memberOne = projectArenaRoomSnapshotForViewer(state.snapshot, 'member-1');
    const memberTwo = projectArenaRoomSnapshotForViewer(state.snapshot, 'member-2');

    expect(host.proposals.map((item) => item.proposalId)).toEqual(['proposal-1', 'proposal-2']);
    expect(memberOne.proposals.map((item) => item.proposalId)).toEqual(['proposal-1']);
    expect(memberTwo.proposals.map((item) => item.proposalId)).toEqual(['proposal-2']);
  });

  it('replaces a foreign Proposal event with a sequence-preserving filtered snapshot', () => {
    const created = success(transitionArenaRoom(null, createRoomCommand(), hostAuthority()));
    const joined = success(transitionArenaRoom(created.nextState, joinMemberCommand(), memberAuthority()));
    const submitted = success(transitionArenaRoom(joined.nextState, {
      type: 'submit-proposal',
      expectedRoomEpoch: 'epoch-1',
      proposal: proposal([guidanceChange()], 'proposal-1'),
      timestamp: NEXT_TIMESTAMP,
    }, memberAuthority()));
    const event = submitted.events[0];
    if (!event || event.type !== 'proposal.submitted') throw new Error('expected proposal.submitted event');

    const hostEvent = projectArenaRoomEventForViewer(event, submitted.nextState.snapshot, 'host-1');
    const authorEvent = projectArenaRoomEventForViewer(event, submitted.nextState.snapshot, 'member-1');
    const otherEvent = projectArenaRoomEventForViewer(event, submitted.nextState.snapshot, 'member-2');

    expect(hostEvent).toMatchObject({ type: 'proposal.submitted', controlSeq: event.controlSeq });
    expect(authorEvent).toMatchObject({ type: 'proposal.submitted', controlSeq: event.controlSeq });
    expect(otherEvent).toMatchObject({
      type: 'room.snapshot',
      controlSeq: event.controlSeq,
      payload: { controlSeq: event.controlSeq, proposals: [] },
    });
    expect(JSON.stringify(otherEvent)).not.toContain('proposal-1');
  });

  it('filters ordinary room.snapshot events used by initial sync and replay', () => {
    const state = createStateWithTwoProposals();
    const snapshotEvent = {
      protocolVersion: 1 as const,
      roomId: state.snapshot.roomId,
      roomEpoch: state.snapshot.roomEpoch,
      controlSeq: state.snapshot.controlSeq,
      timestamp: state.lifecycle.updatedAt,
      type: 'room.snapshot' as const,
      payload: state.snapshot,
    };

    const projected = projectArenaRoomEventForViewer(
      snapshotEvent,
      state.snapshot,
      'member-1',
    );

    expect(projected).toMatchObject({
      type: 'room.snapshot',
      payload: { proposals: [{ proposalId: 'proposal-1' }] },
    });
    expect(JSON.stringify(projected)).not.toContain('proposal-2');
  });
});
