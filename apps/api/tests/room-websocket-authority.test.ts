import { describe, expect, it } from 'vitest';

import {
  checkpointPredecessorOf,
  consumeArenaRoomCheckpointCommit,
  issueArenaRoomGenerationPublisherAuthority,
  issueArenaRoomGenerationReservationAuthority,
  issueArenaRoomTrustedTime,
  type ArenaRoomAuthorityState,
} from '@mahoshojo/multiplayer-core';
import {
  createRoomActorRegistry,
  type RoomActorCheckpointStore,
} from '#/arena-room/room-actor-registry';
import { createArenaRoomMembershipService } from '#/arena-room/room-membership-service';
import type { ArenaRoomMembershipService } from '#/arena-room/room-membership-service';
import {
  createArenaRoomTicketCodec,
  createArenaRoomTicketSignatureService,
} from '#/arena-room/room-ticket';
import {
  createArenaRoomWebSocketAuthority,
} from '#/arena-room/room-websocket-authority';
import type {
  RoomWebSocketAuthorization,
  RoomWebSocketConnection,
  RoomWebSocketPeer,
} from '#/arena-room/room-websocket-gateway';
import type { RedisRoomTicketReplayStore } from '#/arena-room/redis-room-ticket-replay-store';
import type {
  ArenaRoomRuntimeObservation,
  ArenaRoomRuntimeObserver,
} from '#/arena-room/runtime-observer';
import { createArenaRoomState } from './arena-room-fixtures';

class MemoryRoomStore implements RoomActorCheckpointStore {
  state: ArenaRoomAuthorityState | null = null;
  refreshResult: 'conflict' | 'refreshed' = 'refreshed';
  readonly directoryMutations: Array<'mutate' | 'preserve' | undefined> = [];

  async load(roomId: string) {
    return this.state?.snapshot.roomId === roomId ? structuredClone(this.state) : null;
  }

  async save(input: Parameters<RoomActorCheckpointStore['save']>[0]) {
    this.directoryMutations.push(input.directoryMutation);
    const data = consumeArenaRoomCheckpointCommit(input.commit);
    if (data.predecessor === null) {
      if (this.state !== null) return { kind: 'conflict' as const };
    } else if (
      this.state === null
      || JSON.stringify(this.state) !== JSON.stringify(data.predecessorState)
      || JSON.stringify(checkpointPredecessorOf(this.state)) !== JSON.stringify(data.predecessor)
    ) return { kind: 'conflict' as const };
    this.state = structuredClone(data.nextState);
    return { kind: 'saved' as const };
  }

  async refresh() {
    return { kind: this.refreshResult };
  }
}

class MemoryTicketReplayStore implements RedisRoomTicketReplayStore {
  readonly consumed = new Set<string>();
  calls = 0;

  async consume(input: { jti: string }) {
    this.calls += 1;
    if (this.consumed.has(input.jti)) return { kind: 'replayed' as const };
    this.consumed.add(input.jti);
    return { kind: 'consumed' as const };
  }
}

const createPeer = () => {
  const messages: unknown[] = [];
  const closes: Array<{ code: number; reason: string }> = [];
  const peer: RoomWebSocketPeer = {
    send: (message) => {
      messages.push(structuredClone(message));
      return true;
    },
    close: (code, reason) => closes.push({ code, reason }),
  };
  return { peer, messages, closes };
};

const accepted = (
  authorization: RoomWebSocketAuthorization,
): Extract<RoomWebSocketAuthorization, { accepted: true }> => {
  expect(authorization.accepted).toBe(true);
  if (!authorization.accepted) throw new Error(authorization.code);
  return authorization;
};

const activate = async (
  authorization: RoomWebSocketAuthorization,
  peer: RoomWebSocketPeer,
): Promise<RoomWebSocketConnection> => {
  const grant = accepted(authorization);
  if (!grant.connectionAuthority) throw new Error('missing connection authority');
  return grant.connectionAuthority.activate(peer);
};

const createHarness = async (
  maxSubscribersPerRoom?: number,
  observer?: ArenaRoomRuntimeObserver,
) => {
  const store = new MemoryRoomStore();
  const replay = new MemoryTicketReplayStore();
  let now = Date.parse('2026-08-28T00:00:00.000Z');
  let userIndex = 0;
  let jtiIndex = 0;
  const actors = createRoomActorRegistry({
    store,
    createRoomIdentity: () => ({ roomId: 'room-1', roomEpoch: 'epoch-1' }),
    createTimestamp: () => new Date(now).toISOString(),
    now: () => now,
    ...(maxSubscribersPerRoom === undefined ? {} : { maxSubscribersPerRoom }),
  });
  const memberships = createArenaRoomMembershipService({
    actors,
    createUserId: () => `server-user-${++userIndex}`,
    now: () => new Date(now).toISOString(),
  });
  const codec = createArenaRoomTicketCodec({
    signatures: createArenaRoomTicketSignatureService({
      env: { SIGNATURE_SECRET_KEY: 'authority-test-secret-at-least-32-characters' },
      logger: { warn: () => undefined, error: () => undefined },
    }),
    createJti: () => `jti-${++jtiIndex}`,
    now: () => now,
  });
  const authority = createArenaRoomWebSocketAuthority({
    actors,
    memberships,
    replay,
    tickets: codec,
    now: () => now,
    ...(observer === undefined ? {} : { observer }),
  });
  const host = await memberships.create({
    accountUserId: 101,
    displayName: 'Host',
    sharedConfig: createArenaRoomState().snapshot.sharedConfig,
  });
  const member = await memberships.join({
    roomId: host.roomId,
    accountUserId: 202,
    displayName: 'Member',
  });
  return {
    actors,
    authority,
    codec,
    host,
    member,
    memberships,
    replay,
    setNow: (value: string) => { now = Date.parse(value); },
    store,
  };
};

const requestForTicket = (ticket: string): Request => new Request(
  `https://room.example.test/api/arena/rooms/v1/ws?ticket=${encodeURIComponent(ticket)}`,
);

describe('Arena Room ticket -> membership -> presence WSS authority', () => {
  it('把 transient story.delta 直接安全 fanout 给已连接 peer', async () => {
    const harness = await createHarness();
    const ticket = await harness.authority.issue({ roomId: 'room-1', accountUserId: 101 });
    const connected = createPeer();
    const connection = await activate(
      await harness.authority.authorize(requestForTicket(ticket)),
      connected.peer,
    );
    const actor = harness.actors.get('room-1');
    if (!actor) throw new Error('actor missing');
    const snapshotDigest = `sha256:${'a'.repeat(64)}`;
    const expiresAt = '2026-08-28T01:00:00.000Z';
    harness.setNow('2026-08-28T00:01:00.000Z');
    await actor.execute({
      authority: issueArenaRoomGenerationReservationAuthority({
        actorUserId: harness.host.member.userId,
        accountUserId: 101,
        roomId: 'room-1',
        roomEpoch: 'epoch-1',
        configRevision: 0,
        generationRequestId: 'request-1',
        generationId: 'generation-1',
        attempt: 1,
        snapshotDigest,
        generationPayloadDigest: `sha256:${'d'.repeat(64)}`,
        expiresAt,
      }),
      command: {
        type: 'reserve-generation',
        expectedRoomEpoch: 'epoch-1',
        expectedRevision: 0,
        generationRequestId: 'request-1',
        generationId: 'generation-1',
        attempt: 1,
        generationPayloadDigest: `sha256:${'d'.repeat(64)}`,
        timestamp: '2026-08-28T00:01:00.000Z',
      },
      trustedTime: issueArenaRoomTrustedTime({ now: '2026-08-28T00:01:00.000Z' }),
    });
    harness.setNow('2026-08-28T00:02:00.000Z');
    const publisherAuthority = issueArenaRoomGenerationPublisherAuthority({
      roomId: 'room-1',
      roomEpoch: 'epoch-1',
      generationRequestId: 'request-1',
      generationId: 'generation-1',
      attempt: 1,
      expiresAt,
    });
    await actor.execute({
      authority: publisherAuthority,
      command: {
        type: 'mirror-generation',
        expectedRoomEpoch: 'epoch-1',
        generationRequestId: 'request-1',
        generationId: 'generation-1',
        attempt: 1,
        state: 'running',
        timestamp: '2026-08-28T00:02:00.000Z',
      },
      trustedTime: issueArenaRoomTrustedTime({ now: '2026-08-28T00:02:00.000Z' }),
    });
    harness.setNow('2026-08-28T00:03:00.000Z');
    const story = {
      protocolVersion: 1 as const,
      type: 'story.delta' as const,
      roomId: 'room-1',
      roomEpoch: 'epoch-1',
      generationId: 'generation-1',
      chunkSeq: 0,
      timestamp: '2026-08-28T00:03:00.000Z',
      payload: { delta: '公开正文' },
    };

    await expect(actor.publishStory({
      authority: publisherAuthority,
      event: story,
      trustedTime: issueArenaRoomTrustedTime({ now: story.timestamp }),
    })).resolves.toEqual({ ok: true, kind: 'published' });

    expect(connected.messages.at(-1)).toEqual(story);
    await connection.dispose?.();
  });

  it('ticket roleHint 与 current membership 不一致时 fail closed 且不消费 jti', async () => {
    const harness = await createHarness();
    const forgedHintTicket = await harness.codec.issue({
      roomId: 'room-1',
      roomEpoch: 'epoch-1',
      userId: harness.member.member.userId,
      roleHint: 'host',
    });

    await expect(harness.authority.authorize(requestForTicket(forgedHintTicket)))
      .resolves.toMatchObject({ accepted: false, code: 'ROOM_TICKET_ROLE_STALE', status: 403 });
    await expect(harness.authority.authorize(requestForTicket(forgedHintTicket)))
      .resolves.toMatchObject({ accepted: false, code: 'ROOM_TICKET_ROLE_STALE', status: 403 });
    expect(harness.replay.calls).toBe(0);
  });

  it('kick 后未消费的旧 ticket 被 current membership 拒绝，已有连接收到 close', async () => {
    const harness = await createHarness();
    const ticket = await harness.authority.issue({ roomId: 'room-1', accountUserId: 202 });
    const authorization = await harness.authority.authorize(requestForTicket(ticket));
    const connected = createPeer();
    const connection = await activate(authorization, connected.peer);
    expect(connected.messages[0]).toMatchObject({ type: 'room.snapshot' });

    const unconsumed = await harness.authority.issue({ roomId: 'room-1', accountUserId: 202 });
    await harness.memberships.kick({
      roomId: 'room-1',
      accountUserId: 101,
      targetUserId: harness.member.member.userId,
      expectedRoomEpoch: harness.host.roomEpoch,
    });
    expect(connected.closes.at(-1)).toEqual({ code: 1008, reason: 'membership-revoked' });
    await expect(harness.authority.authorize(requestForTicket(unconsumed)))
      .resolves.toMatchObject({ accepted: false, code: 'ROOM_MEMBERSHIP_REVOKED', status: 403 });
    expect(harness.replay.calls).toBe(1);
    await connection.dispose?.();
  });

  it('activation 最终 membership 复核与 kick 竞态时 fail closed 且不订阅', async () => {
    const harness = await createHarness();
    let userResolutionCalls = 0;
    let releaseFinalResolution!: () => void;
    let markFinalResolutionReached!: () => void;
    const finalResolutionGate = new Promise<void>((resolve) => {
      releaseFinalResolution = resolve;
    });
    const finalResolutionReached = new Promise<void>((resolve) => {
      markFinalResolutionReached = resolve;
    });
    const memberships: ArenaRoomMembershipService = {
      ...harness.memberships,
      async resolveActiveByUser(input) {
        userResolutionCalls += 1;
        if (userResolutionCalls === 3) {
          markFinalResolutionReached();
          await finalResolutionGate;
        }
        return harness.memberships.resolveActiveByUser(input);
      },
    };
    const authority = createArenaRoomWebSocketAuthority({
      actors: harness.actors,
      memberships,
      replay: harness.replay,
      tickets: harness.codec,
      now: () => Date.parse('2026-08-28T00:00:00.000Z'),
    });
    const ticket = await authority.issue({ roomId: 'room-1', accountUserId: 202 });
    const authorization = await authority.authorize(requestForTicket(ticket));
    const connected = createPeer();

    const activation = activate(authorization, connected.peer);
    await finalResolutionReached;
    await harness.memberships.kick({
      roomId: 'room-1',
      accountUserId: 101,
      targetUserId: harness.member.member.userId,
      expectedRoomEpoch: harness.host.roomEpoch,
    });
    releaseFinalResolution();
    await activation;

    expect(connected.messages).toEqual([]);
    expect(connected.closes.at(-1)).toEqual({ code: 1008, reason: 'membership-revoked' });
  });

  it('multi-tab 只增加 connection presence；单 tab close/refresh 不 revoke membership，last close 才设置 deadline', async () => {
    const harness = await createHarness();
    const beforePresence = harness.store.directoryMutations.length;
    const firstTicket = await harness.authority.issue({ roomId: 'room-1', accountUserId: 101 });
    const secondTicket = await harness.authority.issue({ roomId: 'room-1', accountUserId: 101 });
    const firstPeer = createPeer();
    const secondPeer = createPeer();
    const first = await activate(
      await harness.authority.authorize(requestForTicket(firstTicket)),
      firstPeer.peer,
    );
    const second = await activate(
      await harness.authority.authorize(requestForTicket(secondTicket)),
      secondPeer.peer,
    );
    expect(harness.store.state?.deadlines).toEqual({
      hostOfflineDeadline: null,
      roomIdleDeadline: null,
    });
    expect(harness.store.state?.snapshot.members).toHaveLength(2);

    harness.setNow('2026-08-28T00:10:00.000Z');
    await first.dispose?.();
    expect(harness.store.state?.deadlines.hostOfflineDeadline).toBeNull();
    expect(harness.store.state?.memberAuthority.find((entry) => entry.accountUserId === 101)?.member)
      .toMatchObject({ membershipState: 'active' });

    await second.dispose?.();
    expect(harness.store.state?.deadlines).toEqual({
      hostOfflineDeadline: '2026-08-28T00:55:00.000Z',
      roomIdleDeadline: '2026-08-28T12:10:00.000Z',
    });
    expect(harness.store.state?.snapshot.members).toHaveLength(2);
    expect(harness.store.directoryMutations.slice(beforePresence)).toEqual([
      'preserve',
      'preserve',
    ]);
  });

  it('signed reconnect cursor 支持 same-epoch bounded replay；epoch changed 返回 full snapshot 并拒绝旧 ticket', async () => {
    const harness = await createHarness();
    const actor = harness.actors.get('room-1');
    if (!actor) throw new Error('actor missing');
    const state = actor.getSnapshot()!;
    await actor.execute({
      authority: {
        kind: 'authenticated-user',
        actorUserId: harness.host.member.userId,
        accountUserId: 101,
      },
      command: {
        type: 'publish-config',
        expectedRoomEpoch: 'epoch-1',
        expectedRevision: 0,
        sharedConfig: { ...state.snapshot.sharedConfig, userGuidance: 'changed' },
        timestamp: '2026-08-28T00:01:00.000Z',
      },
    });
    const oldEpochTicket = await harness.authority.issue({
      roomId: 'room-1',
      accountUserId: 202,
      reconnect: { control: { roomEpoch: 'epoch-1', controlSeq: 1 } },
    });
    const replayTicket = await harness.authority.issue({
      roomId: 'room-1',
      accountUserId: 101,
      reconnect: { control: { roomEpoch: 'epoch-1', controlSeq: 0 } },
    });
    const replayPeer = createPeer();
    await activate(await harness.authority.authorize(requestForTicket(replayTicket)), replayPeer.peer);
    expect(replayPeer.messages).toEqual([
      expect.objectContaining({ type: 'room.member.joined', controlSeq: 1 }),
      expect.objectContaining({ type: 'room.config.updated', controlSeq: 2 }),
      expect.objectContaining({ type: 'room.host.online', controlSeq: 3 }),
    ]);

    await actor.close();
    const recoveredActors = createRoomActorRegistry({
      store: harness.store,
      createRoomEpoch: () => 'epoch-2',
      recoveryTimestamp: () => '2026-08-28T00:02:00.000Z',
      now: () => Date.parse('2026-08-28T00:02:00.000Z'),
    });
    const recoveredMemberships = createArenaRoomMembershipService({ actors: recoveredActors });
    const recoveredAuthority = createArenaRoomWebSocketAuthority({
      actors: recoveredActors,
      memberships: recoveredMemberships,
      replay: harness.replay,
      tickets: harness.codec,
      now: () => Date.parse('2026-08-28T00:02:00.000Z'),
    });
    await expect(recoveredAuthority.authorize(requestForTicket(oldEpochTicket)))
      .resolves.toMatchObject({ accepted: false, code: 'ROOM_TICKET_EPOCH_STALE', status: 403 });
    const newTicket = await recoveredAuthority.issue({
      roomId: 'room-1',
      accountUserId: 202,
      reconnect: { control: { roomEpoch: 'epoch-1', controlSeq: 99 } },
    });
    const snapshotPeer = createPeer();
    await activate(await recoveredAuthority.authorize(requestForTicket(newTicket)), snapshotPeer.peer);
    expect(snapshotPeer.messages[0]).toMatchObject({
      type: 'room.snapshot',
      roomEpoch: 'epoch-2',
      controlSeq: 1,
    });
  });

  it('只记录无身份的 reconnect/sync/resync 结果，并覆盖 current/replay/snapshot delivery', async () => {
    const observations: ArenaRoomRuntimeObservation[] = [];
    const harness = await createHarness(undefined, {
      observeArenaRoomRuntime: (observation) => {
        observations.push(observation);
      },
    });
    const initialPeer = createPeer();
    const initialTicket = await harness.authority.issue({
      roomId: 'room-1',
      accountUserId: 101,
    });
    const initialConnection = await activate(
      await harness.authority.authorize(requestForTicket(initialTicket)),
      initialPeer.peer,
    );
    expect(initialPeer.messages[0]).toMatchObject({ type: 'room.snapshot' });

    const currentSeq = harness.actors.get('room-1')?.getSnapshot()?.snapshot.controlSeq;
    if (currentSeq === undefined) throw new Error('snapshot missing');
    const reconnectPeer = createPeer();
    const reconnectTicket = await harness.authority.issue({
      roomId: 'room-1',
      accountUserId: 202,
      reconnect: {
        control: { roomEpoch: 'epoch-1', controlSeq: currentSeq },
        story: { generationId: 'generation-1', chunkSeq: 7 },
      },
    });
    const reconnectConnection = await activate(
      await harness.authority.authorize(requestForTicket(reconnectTicket)),
      reconnectPeer.peer,
    );
    expect(reconnectPeer.messages).toEqual([{
      protocolVersion: 1,
      type: 'room.resync.required',
      reason: 'replay-unavailable',
    }]);

    await reconnectConnection.onMessage?.({
      protocolVersion: 1,
      type: 'room.resync.request',
      cursor: { control: { roomEpoch: 'epoch-1', controlSeq: 0 } },
    });
    expect(reconnectPeer.messages).toContainEqual(expect.objectContaining({
      type: 'room.member.joined',
    }));
    expect(observations).toEqual(expect.arrayContaining([
      { event: 'sync', action: 'delivery', mode: 'snapshot' },
      { event: 'sync', action: 'reconnect_attempt' },
      { event: 'sync', action: 'delivery', mode: 'current' },
      { event: 'sync', action: 'resync_required' },
      { event: 'sync', action: 'resync_requested' },
      { event: 'sync', action: 'delivery', mode: 'replay' },
    ]));
    expect(JSON.stringify(observations)).not.toContain('room-1');
    expect(JSON.stringify(observations)).not.toContain('generation-1');
    expect(JSON.stringify(observations)).not.toContain('server-user');

    await reconnectConnection.dispose?.();
    await initialConnection.dispose?.();
  });

  it('peer 拒绝 enqueue 时不把 sync attempt 伪报为 delivery', async () => {
    const observations: ArenaRoomRuntimeObservation[] = [];
    const harness = await createHarness(undefined, {
      observeArenaRoomRuntime: (observation) => { observations.push(observation); },
    });
    const ticket = await harness.authority.issue({ roomId: 'room-1', accountUserId: 101 });
    const connection = await activate(
      await harness.authority.authorize(requestForTicket(ticket)),
      {
        send: () => false,
        close: () => undefined,
      },
    );

    expect(observations).not.toContainEqual({
      event: 'sync', action: 'delivery', mode: 'snapshot',
    });
    await connection.dispose?.();
  });

  it('observer 抛错不改变 sync delivery 或 presence cleanup', async () => {
    const harness = await createHarness(undefined, {
      observeArenaRoomRuntime: () => {
        throw new Error('observer-secret-canary');
      },
    });
    const peer = createPeer();
    const ticket = await harness.authority.issue({ roomId: 'room-1', accountUserId: 101 });
    const connection = await activate(
      await harness.authority.authorize(requestForTicket(ticket)),
      peer.peer,
    );

    expect(peer.messages[0]).toMatchObject({ type: 'room.snapshot' });
    expect(harness.store.state?.deadlines.hostOfflineDeadline).toBeNull();
    harness.setNow('2026-08-28T00:10:00.000Z');
    await connection.dispose?.();
    expect(harness.store.state?.deadlines).toEqual({
      hostOfflineDeadline: '2026-08-28T00:55:00.000Z',
      roomIdleDeadline: '2026-08-28T12:10:00.000Z',
    });
  });

  it('WSS Proposal 事件对 host/author 可见，其他 member 获得同序号过滤 snapshot', async () => {
    const harness = await createHarness();
    const other = await harness.memberships.join({
      roomId: harness.host.roomId,
      accountUserId: 303,
      displayName: 'Other',
    });
    const [hostPeer, authorPeer, otherPeer] = [createPeer(), createPeer(), createPeer()];
    const connections: RoomWebSocketConnection[] = [];
    for (const [accountUserId, connected] of [
      [101, hostPeer],
      [202, authorPeer],
      [303, otherPeer],
    ] as const) {
      const ticket = await harness.authority.issue({ roomId: 'room-1', accountUserId });
      connections.push(await activate(
        await harness.authority.authorize(requestForTicket(ticket)),
        connected.peer,
      ));
    }
    const actor = harness.actors.get('room-1');
    if (!actor) throw new Error('actor missing');
    const submitted = await actor.execute({
      authority: {
        kind: 'authenticated-user',
        actorUserId: harness.member.member.userId,
        accountUserId: 202,
      },
      command: {
        type: 'submit-proposal',
        expectedRoomEpoch: 'epoch-1',
        timestamp: '2026-08-28T00:01:00.000Z',
        proposal: {
          proposalVersion: 1,
          proposalId: 'proposal-private',
          roomId: 'room-1',
          authorUserId: harness.member.member.userId,
          baseRevision: 0,
          status: 'submitted',
          changes: [{
            changeId: 'guidance-1',
            type: 'setUserGuidance',
            value: '成员建议',
            expectedBase: { kind: 'value', value: '' },
          }],
          createdAt: '2026-08-28T00:01:00.000Z',
        },
      },
    });
    if (!submitted.ok) throw new Error(submitted.reason);
    const submitSeq = submitted.nextState.snapshot.controlSeq;
    expect(hostPeer.messages.at(-1)).toMatchObject({
      type: 'proposal.submitted',
      controlSeq: submitSeq,
      payload: { proposal: { proposalId: 'proposal-private' } },
    });
    expect(authorPeer.messages.at(-1)).toMatchObject({
      type: 'proposal.submitted',
      controlSeq: submitSeq,
      payload: { proposal: { proposalId: 'proposal-private' } },
    });
    expect(otherPeer.messages.at(-1)).toMatchObject({
      type: 'room.snapshot',
      controlSeq: submitSeq,
      payload: { proposals: [] },
    });
    const otherReconnectPeer = createPeer();
    const otherReconnectTicket = await harness.authority.issue({
      roomId: 'room-1',
      accountUserId: 303,
      reconnect: {
        control: { roomEpoch: 'epoch-1', controlSeq: submitSeq - 1 },
      },
    });
    connections.push(await activate(
      await harness.authority.authorize(requestForTicket(otherReconnectTicket)),
      otherReconnectPeer.peer,
    ));
    expect(otherReconnectPeer.messages).toEqual([
      expect.objectContaining({
        type: 'room.snapshot',
        controlSeq: submitSeq,
        payload: expect.objectContaining({ proposals: [] }),
      }),
    ]);

    const [hostInitial, authorInitial, otherInitial] = [createPeer(), createPeer(), createPeer()];
    for (const [accountUserId, connected] of [
      [101, hostInitial],
      [202, authorInitial],
      [303, otherInitial],
    ] as const) {
      const ticket = await harness.authority.issue({ roomId: 'room-1', accountUserId });
      connections.push(await activate(
        await harness.authority.authorize(requestForTicket(ticket)),
        connected.peer,
      ));
    }
    expect(hostInitial.messages).toEqual([
      expect.objectContaining({
        type: 'room.snapshot',
        payload: expect.objectContaining({
          proposals: [expect.objectContaining({ proposalId: 'proposal-private' })],
        }),
      }),
    ]);
    expect(authorInitial.messages).toEqual([
      expect.objectContaining({
        type: 'room.snapshot',
        payload: expect.objectContaining({
          proposals: [expect.objectContaining({ proposalId: 'proposal-private' })],
        }),
      }),
    ]);
    expect(otherInitial.messages).toEqual([
      expect.objectContaining({
        type: 'room.snapshot',
        payload: expect.objectContaining({ proposals: [] }),
      }),
    ]);

    const resolved = await actor.execute({
      authority: {
        kind: 'authenticated-user',
        actorUserId: harness.host.member.userId,
        accountUserId: 101,
      },
      command: {
        type: 'resolve-proposal',
        expectedRoomEpoch: 'epoch-1',
        expectedRevision: 0,
        proposalId: 'proposal-private',
        resolution: 'accept-selected',
        selectedChangeIds: ['guidance-1'],
        timestamp: '2026-08-28T00:02:00.000Z',
      },
    });
    if (!resolved.ok) throw new Error(resolved.reason);
    const resolveSeq = resolved.nextState.snapshot.controlSeq;
    expect(hostPeer.messages.at(-1)).toMatchObject({
      type: 'proposal.resolved',
      controlSeq: resolveSeq,
      payload: { proposalId: 'proposal-private', status: 'accepted' },
    });
    expect(hostPeer.messages.at(-2)).toMatchObject({
      type: 'room.config.updated',
      controlSeq: resolveSeq - 1,
      payload: { revision: 1, sharedConfig: { userGuidance: '成员建议' } },
    });
    expect(authorPeer.messages.at(-1)).toMatchObject({
      type: 'proposal.resolved',
      controlSeq: resolveSeq,
      payload: { proposalId: 'proposal-private', status: 'accepted' },
    });
    expect(otherPeer.messages.at(-1)).toMatchObject({
      type: 'room.snapshot',
      controlSeq: resolveSeq,
      payload: { proposals: [] },
    });

    const [hostReplay, authorReplay, otherReplay] = [createPeer(), createPeer(), createPeer()];
    for (const [accountUserId, connected] of [
      [101, hostReplay],
      [202, authorReplay],
      [303, otherReplay],
    ] as const) {
      const ticket = await harness.authority.issue({
        roomId: 'room-1',
        accountUserId,
        reconnect: {
          control: { roomEpoch: 'epoch-1', controlSeq: submitSeq - 1 },
        },
      });
      connections.push(await activate(
        await harness.authority.authorize(requestForTicket(ticket)),
        connected.peer,
      ));
    }
    for (const visibleReplay of [hostReplay.messages, authorReplay.messages]) {
      expect(visibleReplay).toEqual([
        expect.objectContaining({ type: 'proposal.submitted', controlSeq: submitSeq }),
        expect.objectContaining({ type: 'room.config.updated', controlSeq: submitSeq + 1 }),
        expect.objectContaining({
          type: 'proposal.resolved',
          controlSeq: resolveSeq,
          payload: { proposalId: 'proposal-private', status: 'accepted' },
        }),
      ]);
    }
    expect(otherReplay.messages).toEqual([
      expect.objectContaining({
        type: 'room.snapshot',
        controlSeq: submitSeq,
        payload: expect.objectContaining({ proposals: [] }),
      }),
      expect.objectContaining({
        type: 'room.config.updated',
        controlSeq: submitSeq + 1,
        payload: expect.objectContaining({ revision: 1 }),
      }),
      expect.objectContaining({
        type: 'room.snapshot',
        controlSeq: resolveSeq,
        payload: expect.objectContaining({ proposals: [], revision: 1 }),
      }),
    ]);
    expect(JSON.stringify(otherReplay.messages)).not.toContain('proposal-private');
    expect(other.member.userId).not.toBe(harness.member.member.userId);
    await Promise.all(connections.map(async (connection) => connection.dispose?.()));
  });

  it('混合隐藏 Proposal replay 不丢失作者自己的 terminal event', async () => {
    const harness = await createHarness();
    const other = await harness.memberships.join({
      roomId: harness.host.roomId,
      accountUserId: 303,
      displayName: 'Other',
    });
    const actor = harness.actors.get('room-1');
    if (!actor) throw new Error('actor missing');
    const cursorSeq = actor.getSnapshot()?.snapshot.controlSeq;
    if (cursorSeq === undefined) throw new Error('snapshot missing');

    for (const [author, accountUserId, proposalId, value, timestamp] of [
      [other.member.userId, 303, 'proposal-hidden', '其他成员建议', '2026-08-28T00:01:00.000Z'],
      [harness.member.member.userId, 202, 'proposal-author', '作者建议', '2026-08-28T00:02:00.000Z'],
    ] as const) {
      const submitted = await actor.execute({
        authority: { kind: 'authenticated-user', actorUserId: author, accountUserId },
        command: {
          type: 'submit-proposal',
          expectedRoomEpoch: 'epoch-1',
          timestamp,
          proposal: {
            proposalVersion: 1,
            proposalId,
            roomId: 'room-1',
            authorUserId: author,
            baseRevision: 0,
            status: 'submitted',
            changes: [{
              changeId: `${proposalId}-guidance`,
              type: 'setUserGuidance',
              value,
              expectedBase: { kind: 'value', value: '' },
            }],
            createdAt: timestamp,
          },
        },
      });
      if (!submitted.ok) throw new Error(submitted.reason);
    }

    const resolved = await actor.execute({
      authority: {
        kind: 'authenticated-user',
        actorUserId: harness.host.member.userId,
        accountUserId: 101,
      },
      command: {
        type: 'resolve-proposal',
        expectedRoomEpoch: 'epoch-1',
        expectedRevision: 0,
        proposalId: 'proposal-author',
        resolution: 'accept-selected',
        selectedChangeIds: ['proposal-author-guidance'],
        timestamp: '2026-08-28T00:03:00.000Z',
      },
    });
    if (!resolved.ok) throw new Error(resolved.reason);

    const replayPeer = createPeer();
    const ticket = await harness.authority.issue({
      roomId: 'room-1',
      accountUserId: 202,
      reconnect: { control: { roomEpoch: 'epoch-1', controlSeq: cursorSeq } },
    });
    const connection = await activate(
      await harness.authority.authorize(requestForTicket(ticket)),
      replayPeer.peer,
    );

    expect(replayPeer.messages).toContainEqual(expect.objectContaining({
      type: 'proposal.resolved',
      payload: { proposalId: 'proposal-author', status: 'accepted' },
    }));
    expect(JSON.stringify(replayPeer.messages)).not.toContain('proposal-hidden');
    await connection.dispose?.();
  });

  it('缺失/重复 query、无效签名和 replay store unavailable 全部 fail closed 且不反射 ticket', async () => {
    const harness = await createHarness();
    const ticket = await harness.authority.issue({ roomId: 'room-1', accountUserId: 101 });

    await expect(harness.authority.authorize(new Request('https://room.example.test/api/arena/rooms/v1/ws')))
      .resolves.toMatchObject({ accepted: false, code: 'ROOM_TICKET_REQUIRED', status: 401 });
    await expect(harness.authority.authorize(new Request(
      `https://room.example.test/api/arena/rooms/v1/ws?ticket=${ticket}&ticket=${ticket}`,
    ))).resolves.toMatchObject({ accepted: false, code: 'ROOM_TICKET_INVALID', status: 401 });
    await expect(harness.authority.authorize(requestForTicket(`${ticket}tampered`)))
      .resolves.toMatchObject({ accepted: false, code: 'ROOM_TICKET_INVALID', status: 401 });

    const unavailable = createArenaRoomWebSocketAuthority({
      actors: harness.actors,
      memberships: harness.memberships,
      replay: { consume: async () => { throw new Error('redis secret canary'); } },
      tickets: harness.codec,
      now: () => Date.parse('2026-08-28T00:00:00.000Z'),
    });
    await expect(unavailable.authorize(requestForTicket(ticket)))
      .resolves.toEqual({ accepted: false, code: 'ROOM_TICKET_AUTH_UNAVAILABLE', status: 503 });
  });

  it('subscriber capacity 失败时回滚 connection presence，不遗留伪在线用户', async () => {
    const harness = await createHarness(1);
    const hostTicket = await harness.authority.issue({ roomId: 'room-1', accountUserId: 101 });
    const memberTicket = await harness.authority.issue({ roomId: 'room-1', accountUserId: 202 });
    const hostConnection = await activate(
      await harness.authority.authorize(requestForTicket(hostTicket)),
      createPeer().peer,
    );

    await expect(activate(
      await harness.authority.authorize(requestForTicket(memberTicket)),
      createPeer().peer,
    )).rejects.toThrow('ROOM_ACTOR_SUBSCRIBER_LIMIT');

    harness.setNow('2026-08-28T00:10:00.000Z');
    await hostConnection.dispose?.();
    expect(harness.store.state?.deadlines).toEqual({
      hostOfflineDeadline: '2026-08-28T00:55:00.000Z',
      roomIdleDeadline: '2026-08-28T12:10:00.000Z',
    });
  });

  it('actor checkpoint fence 主动关闭已有 peer', async () => {
    const harness = await createHarness();
    const ticket = await harness.authority.issue({ roomId: 'room-1', accountUserId: 101 });
    const connected = createPeer();
    await activate(await harness.authority.authorize(requestForTicket(ticket)), connected.peer);
    harness.store.refreshResult = 'conflict';
    const actor = harness.actors.get('room-1');
    if (!actor) throw new Error('actor missing');

    await actor.refreshCheckpoint(Date.parse('2026-08-28T04:01:00.000Z'));

    expect(connected.closes.at(-1)).toEqual({ code: 1013, reason: 'room-authority-fenced' });
  });
});
