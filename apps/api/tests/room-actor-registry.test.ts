import { describe, expect, it, vi } from 'vitest';

import {
  checkpointPredecessorOf,
  consumeArenaRoomCheckpointCommit,
  issueArenaRoomGenerationReservationAuthority,
  issueArenaRoomPresenceAuthority,
  issueArenaRoomTrustedTime,
  ArenaRoomAuthorityStateSchema,
  MAX_ROOM_COLLABORATIVE_CHANGES,
  MAX_ROOM_GENERATION_RECORDS,
  type ArenaRoomAuthorityState,
  type ArenaRoomCheckpointCommitData,
  type ArenaRoomCommand,
} from '@mahoshojo/multiplayer-core';

import {
  createRoomActorRegistry as createRuntimeRoomActorRegistry,
  type RoomActorRegistry,
  type RoomActorCheckpointStore,
  type RoomActorRegistryOptions,
} from '#/arena-room/room-actor-registry';
import {
  ARENA_ROOM_NEXT_TIMESTAMP,
  createArenaRoomState,
} from './arena-room-fixtures';

const THIRD_TIMESTAMP = '2026-08-28T00:02:00.000Z';
const FOURTH_TIMESTAMP = '2026-08-28T00:03:00.000Z';
const hostAuthority = {
  kind: 'authenticated-user' as const,
  actorUserId: 'host-1',
  accountUserId: 101,
};

const createRoomActorRegistry = (options: RoomActorRegistryOptions): RoomActorRegistry => (
  createRuntimeRoomActorRegistry({
    createRoomIdentity: () => ({ roomId: 'room-1', roomEpoch: 'epoch-1' }),
    createTimestamp: () => '2026-08-28T00:00:00.000Z',
    now: () => Date.parse('2026-08-28T00:00:00.000Z'),
    ...options,
  })
);

const createActorRoom = async (
  registry: RoomActorRegistry,
  authority: unknown = hostAuthority,
): Promise<Awaited<ReturnType<RoomActorRegistry['create']>>['result']> => (
  (await registry.create({
    host: { userId: 'host-1', displayName: 'Host' },
    sharedConfig: createArenaRoomState().snapshot.sharedConfig,
    authority,
  })).result
);

const createCommand = (roomEpoch = 'epoch-1', roomId = 'room-1'): ArenaRoomCommand => {
  const state = createArenaRoomState(roomEpoch);
  return {
    type: 'create',
    roomId,
    roomEpoch,
    host: state.snapshot.members[0]!,
    sharedConfig: state.snapshot.sharedConfig,
    deadlines: state.deadlines,
    timestamp: state.lifecycle.createdAt,
  };
};

const publishCommand = (
  state: ArenaRoomAuthorityState,
  expectedRevision: number,
  guidance: string,
  timestamp: string,
): ArenaRoomCommand => ({
  type: 'publish-config',
  expectedRoomEpoch: state.snapshot.roomEpoch,
  expectedRevision,
  sharedConfig: { ...state.snapshot.sharedConfig, userGuidance: guidance },
  timestamp,
});

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
};

const sameState = (
  left: ArenaRoomAuthorityState | null,
  right: ArenaRoomAuthorityState | null,
): boolean => JSON.stringify(left) === JSON.stringify(right);

const generationExhaustedState = (): ArenaRoomAuthorityState => {
  const state = createArenaRoomState('epoch-1');
  state.generationLedger = Array.from({ length: MAX_ROOM_GENERATION_RECORDS }, (_, index) => ({
    mirror: {
      generationRequestId: `used-request-${index}`,
      generationId: `used-generation-${index}`,
      attempt: 1,
      state: 'cancelled' as const,
      configRevision: 0,
      snapshotDigest: `sha256:${'a'.repeat(64)}`,
      collaborativeInfluence: false,
      participantUserIds: [101],
      startedAt: ARENA_ROOM_NEXT_TIMESTAMP,
      finishedAt: ARENA_ROOM_NEXT_TIMESTAMP,
    },
  }));
  return state;
};

class MemoryRoomStore implements RoomActorCheckpointStore {
  state: ArenaRoomAuthorityState | null = null;
  loadCalls = 0;
  saveCalls = 0;
  refreshCalls = 0;
  activeSaves = 0;
  maxActiveSaves = 0;
  beforeSave?: (
    data: ArenaRoomCheckpointCommitData,
    call: number,
  ) => Promise<void>;
  saveFailure?: Error;
  conflictAtCall?: number;
  beforeLoad?: () => Promise<void>;
  refreshResult: 'refreshed' | 'missing' | 'conflict' = 'refreshed';

  async load(roomId: string): Promise<ArenaRoomAuthorityState | null> {
    this.loadCalls += 1;
    await this.beforeLoad?.();
    if (this.state?.snapshot.roomId !== roomId) return null;
    return structuredClone(this.state);
  }

  async save(input: Parameters<RoomActorCheckpointStore['save']>[0]) {
    const data = consumeArenaRoomCheckpointCommit(input.commit);
    const call = ++this.saveCalls;
    this.activeSaves += 1;
    this.maxActiveSaves = Math.max(this.maxActiveSaves, this.activeSaves);
    try {
      await this.beforeSave?.(data, call);
      if (this.saveFailure) throw this.saveFailure;
      if (this.conflictAtCall === call) return { kind: 'conflict' as const };
      const current = this.state;
      if (data.predecessor === null) {
        if (current !== null) return { kind: 'conflict' as const };
      } else if (
        current === null
        || !sameState(current, data.predecessorState)
        || JSON.stringify(checkpointPredecessorOf(current)) !== JSON.stringify(data.predecessor)
      ) {
        return { kind: 'conflict' as const };
      }
      this.state = structuredClone(data.nextState);
      return { kind: 'saved' as const };
    } finally {
      this.activeSaves -= 1;
    }
  }

  async refresh(input: { checkpoint: ArenaRoomAuthorityState }) {
    this.refreshCalls += 1;
    if (!sameState(this.state, input.checkpoint)) return { kind: 'conflict' as const };
    return { kind: this.refreshResult };
  }

}

describe('RoomActorRegistry', () => {
  it('无效 command 在 hydration/epoch rollover 前直接拒绝', async () => {
    const store = new MemoryRoomStore();
    const registry = createRoomActorRegistry({ store });

    await expect(registry.execute({
      roomId: 'room-1',
      command: { type: 'publish-config', clientOnly: 'untrusted' },
      authority: hostAuthority,
    })).resolves.toMatchObject({
      ok: false,
      code: 'validation-failed',
      reason: 'invalid-command',
    });
    expect(store.loadCalls).toBe(0);
    expect(store.saveCalls).toBe(0);
  });

  it('schema-valid 外部 command 不会隐式 hydrate/rollover，Room identity 只能由服务端创建入口签发', async () => {
    const store = new MemoryRoomStore();
    const seed = createRoomActorRegistry({ store });
    await createActorRoom(seed);
    await seed.shutdown();
    const registry = createRoomActorRegistry({
      store,
      maxActors: 1,
      createRoomIdentity: () => ({ roomId: 'room-fresh', roomEpoch: 'epoch-fresh' }),
    });
    const loadCalls = store.loadCalls;

    await expect(registry.execute({
      roomId: 'room-1',
      command: publishCommand(store.state!, 0, 'unauthorized-rollover', THIRD_TIMESTAMP),
      authority: { ...hostAuthority, actorUserId: 'attacker' },
    })).rejects.toThrow('ROOM_ACTOR_NOT_FOUND');
    expect(store.loadCalls).toBe(loadCalls);
    expect(store.state?.snapshot.roomEpoch).toBe('epoch-1');

    store.state = null;
    await expect(registry.execute({
      roomId: 'room-1',
      command: createCommand('epoch-1', 'room-1'),
      authority: { ...hostAuthority, actorUserId: 'attacker' },
    })).rejects.toThrow('ROOM_ACTOR_CREATE_REQUIRES_SERVER_IDENTITY');
    expect(store.saveCalls).toBe(1);
    await expect(createActorRoom(
      registry,
      { ...hostAuthority, actorUserId: 'attacker' },
    )).resolves.toMatchObject({ ok: false, code: 'forbidden' });
    await vi.waitFor(() => expect(registry.size).toBe(0));
    await expect(createActorRoom(registry)).resolves.toMatchObject({
      ok: true,
      kind: 'applied',
      nextState: { snapshot: { roomId: 'room-fresh', roomEpoch: 'epoch-fresh' } },
    });
  });

  it('registry room 容量有界，满额时在 load/transition/checkpoint 前 fail closed', async () => {
    const store = new MemoryRoomStore();
    let identityIndex = 0;
    const identities = [
      { roomId: 'room-1', roomEpoch: 'epoch-1' },
      { roomId: 'room-overload', roomEpoch: 'epoch-overload' },
    ];
    const registry = createRoomActorRegistry({
      store,
      maxActors: 1,
      createRoomIdentity: () => identities[identityIndex++]!,
    });
    await createActorRoom(registry);

    await expect(createActorRoom(registry)).rejects.toThrow('ROOM_ACTOR_REGISTRY_CAPACITY');
    expect(store.saveCalls).toBe(1);
  });

  it('服务端 identity 碰撞的 concurrent create 只建立一个 actor/writer', async () => {
    const store = new MemoryRoomStore();
    const registry = createRoomActorRegistry({ store });

    const results = await Promise.all([
      createActorRoom(registry).then((result) => ({ status: 'fulfilled' as const, result })),
      createActorRoom(registry).then(
        (result) => ({ status: 'fulfilled' as const, result }),
        (error: unknown) => ({ status: 'rejected' as const, error }),
      ),
    ]);

    expect(results).toMatchObject([
      { status: 'fulfilled', result: { ok: true, kind: 'applied' } },
      { status: 'rejected', error: { code: 'ROOM_ACTOR_CREATE_IDENTITY_CONFLICT' } },
    ]);
    expect(store.saveCalls).toBe(1);
    expect(store.maxActiveSaves).toBe(1);
    expect(registry.size).toBe(1);
  });

  it('同 room concurrent command 严格串行，并只在 checkpoint 后安装/fan-out', async () => {
    const store = new MemoryRoomStore();
    const registry = createRoomActorRegistry({ store });
    const created = await createActorRoom(registry);
    if (!created.ok) throw new Error('expected create success');
    const actor = await registry.get('room-1');
    if (!actor) throw new Error('expected actor');
    const fanout: string[] = [];
    actor.subscribe(({ snapshot }) => fanout.push(snapshot.sharedConfig.userGuidance));

    const first = registry.execute({
      roomId: 'room-1',
      command: publishCommand(created.nextState, 0, 'first', ARENA_ROOM_NEXT_TIMESTAMP),
      authority: hostAuthority,
    });
    const secondCommand = publishCommand(created.nextState, 1, 'second', THIRD_TIMESTAMP);
    const second = registry.execute({
      roomId: 'room-1',
      command: secondCommand,
      authority: hostAuthority,
    });
    if (secondCommand.type !== 'publish-config') throw new Error('expected publish command');
    secondCommand.sharedConfig.userGuidance = 'tampered-after-enqueue';

    await expect(Promise.all([first, second])).resolves.toMatchObject([
      { ok: true, kind: 'applied', nextState: { snapshot: { revision: 1 } } },
      { ok: true, kind: 'applied', nextState: { snapshot: { revision: 2 } } },
    ]);
    expect(store.maxActiveSaves).toBe(1);
    expect(actor.getSnapshot()).toMatchObject({
      snapshot: { revision: 2, sharedConfig: { userGuidance: 'second' } },
    });
    expect(fanout).toEqual(['first', 'second']);
  });

  it('服务端 create 在排队前冻结普通 authority 输入，拒绝调用后提权', async () => {
    const store = new MemoryRoomStore();
    const registry = createRoomActorRegistry({ store });
    const mutableAuthority = {
      kind: 'authenticated-user',
      actorUserId: 'attacker',
      accountUserId: 999,
    };
    const result = createActorRoom(registry, mutableAuthority);
    mutableAuthority.actorUserId = 'host-1';
    mutableAuthority.accountUserId = 101;

    await expect(result).resolves.toMatchObject({
      ok: false,
      code: 'forbidden',
      reason: 'host-required',
    });
    expect(store.saveCalls).toBe(0);
  });

  it('bounded queue 满时稳定拒绝，不让过载 command 进入 transition/store', async () => {
    const store = new MemoryRoomStore();
    const registry = createRoomActorRegistry({ store, maxQueuedCommands: 1 });
    const created = await createActorRoom(registry);
    if (!created.ok) throw new Error('expected create success');
    const gate = deferred();
    store.beforeSave = async (_data, call) => {
      if (call === 2) await gate.promise;
    };

    const first = registry.execute({
      roomId: 'room-1',
      command: publishCommand(created.nextState, 0, 'first', ARENA_ROOM_NEXT_TIMESTAMP),
      authority: hostAuthority,
    });
    await vi.waitFor(() => expect(store.activeSaves).toBe(1));
    const queued = registry.execute({
      roomId: 'room-1',
      command: publishCommand(created.nextState, 1, 'queued', THIRD_TIMESTAMP),
      authority: hostAuthority,
    });
    await expect(registry.execute({
      roomId: 'room-1',
      command: publishCommand(created.nextState, 2, 'overload', FOURTH_TIMESTAMP),
      authority: hostAuthority,
    })).rejects.toThrow('ROOM_ACTOR_QUEUE_OVERLOADED');

    gate.resolve();
    await expect(Promise.all([first, queued])).resolves.toMatchObject([
      { ok: true, kind: 'applied' },
      { ok: true, kind: 'applied' },
    ]);
    expect(store.saveCalls).toBe(3);
  });

  it('warm recovery 切新 epoch；旧 actor/callback 的已推导 mutation 被 Redis CAS fence', async () => {
    const store = new MemoryRoomStore();
    const oldRegistry = createRoomActorRegistry({ store });
    const created = await createActorRoom(oldRegistry);
    if (!created.ok) throw new Error('expected create success');

    const recoveredRegistry = createRoomActorRegistry({
      store,
      createRoomEpoch: () => 'epoch-2',
      recoveryTimestamp: () => THIRD_TIMESTAMP,
    });
    const recoveredActor = await recoveredRegistry.recover('room-1');
    expect(recoveredActor?.getSnapshot()).toMatchObject({
      snapshot: { roomEpoch: 'epoch-2', controlSeq: 0 },
    });

    await expect(oldRegistry.execute({
      roomId: 'room-1',
      command: publishCommand(created.nextState, 0, 'late-old-actor', FOURTH_TIMESTAMP),
      authority: hostAuthority,
    })).rejects.toThrow('ROOM_ACTOR_CHECKPOINT_CONFLICT');
    await expect(oldRegistry.execute({
      roomId: 'room-1',
      command: publishCommand(created.nextState, 0, 'second-late', FOURTH_TIMESTAMP),
      authority: hostAuthority,
    })).rejects.toThrow('ROOM_ACTOR_FENCED');
    expect(store.state?.snapshot.roomEpoch).toBe('epoch-2');
  });

  it('warm recovery 后旧 actor 的 idempotent success 也必须校验 Redis 并被 fence', async () => {
    const store = new MemoryRoomStore();
    const oldRegistry = createRoomActorRegistry({ store });
    const created = await createActorRoom(oldRegistry);
    if (!created.ok) throw new Error('expected create success');
    const recoveredRegistry = createRoomActorRegistry({
      store,
      createRoomEpoch: () => 'epoch-2',
      recoveryTimestamp: () => THIRD_TIMESTAMP,
    });
    await recoveredRegistry.recover('room-1');

    await expect(oldRegistry.execute({
      roomId: 'room-1',
      command: publishCommand(
        created.nextState,
        0,
        created.nextState.snapshot.sharedConfig.userGuidance,
        FOURTH_TIMESTAMP,
      ),
      authority: hostAuthority,
    })).rejects.toThrow('ROOM_ACTOR_CHECKPOINT_CONFLICT');
    expect(() => oldRegistry.get('room-1')).toThrow('ROOM_ACTOR_FENCED');
  });

  it('本地 fenced tombstone 有独立上限且不占用 active actor capacity', async () => {
    const store = new MemoryRoomStore();
    let createCount = 0;
    const oldRegistry = createRoomActorRegistry({
      store,
      maxActors: 1,
      maxFencedRooms: 1,
      createRoomIdentity: () => createCount++ === 0
        ? { roomId: 'room-1', roomEpoch: 'epoch-1' }
        : { roomId: 'room-new', roomEpoch: 'epoch-new' },
    });
    const created = await createActorRoom(oldRegistry);
    if (!created.ok) throw new Error('expected create success');
    const recoveredRegistry = createRoomActorRegistry({
      store,
      createRoomEpoch: () => 'epoch-2',
      recoveryTimestamp: () => THIRD_TIMESTAMP,
    });
    await recoveredRegistry.recover('room-1');
    await expect(oldRegistry.execute({
      roomId: 'room-1',
      command: publishCommand(created.nextState, 0, 'late', FOURTH_TIMESTAMP),
      authority: hostAuthority,
    })).rejects.toThrow('ROOM_ACTOR_CHECKPOINT_CONFLICT');
    expect(oldRegistry.size).toBe(0);

    store.state = null;
    await expect(createActorRoom(oldRegistry)).resolves.toMatchObject({ ok: true, kind: 'applied' });
    expect(oldRegistry.size).toBe(1);
  });

  it('并发 hydrate 只有一个 recovery writer，失败 registry 稳定进入本地 fence', async () => {
    const store = new MemoryRoomStore();
    const seed = createRoomActorRegistry({ store });
    await createActorRoom(seed);
    await seed.shutdown();
    const gate = deferred();
    store.beforeSave = async (_data, call) => {
      if (call >= 2) await gate.promise;
    };
    const first = createRoomActorRegistry({
      store,
      createRoomEpoch: () => 'epoch-recovery-a',
      recoveryTimestamp: () => THIRD_TIMESTAMP,
    });
    const second = createRoomActorRegistry({
      store,
      createRoomEpoch: () => 'epoch-recovery-b',
      recoveryTimestamp: () => THIRD_TIMESTAMP,
    });
    const firstHydration = first.recover('room-1');
    const secondHydration = second.recover('room-1');
    await vi.waitFor(() => expect(store.saveCalls).toBe(3));
    gate.resolve();
    const settled = await Promise.allSettled([firstHydration, secondHydration]);
    expect(settled.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
    const failedRegistry = settled[0]!.status === 'rejected' ? first : second;
    const failure = settled.find((item) => item.status === 'rejected');
    expect(failure).toMatchObject({
      status: 'rejected',
      reason: expect.objectContaining({ message: 'ROOM_ACTOR_RECOVERY_CONFLICT' }),
    });
    expect(() => failedRegistry.get('room-1')).toThrow('ROOM_ACTOR_FENCED');
    expect(failedRegistry.size).toBe(0);
  });

  it('closed checkpoint hydrate 保留 terminal actor 与 close idempotency，不切换 epoch', async () => {
    const store = new MemoryRoomStore();
    const first = createRoomActorRegistry({ store });
    const created = await createActorRoom(first);
    if (!created.ok) throw new Error('expected create success');
    const closed = await first.execute({
      roomId: 'room-1',
      command: {
        type: 'close',
        expectedRoomEpoch: 'epoch-1',
        reason: 'terminal-retry',
        timestamp: ARENA_ROOM_NEXT_TIMESTAMP,
      },
      authority: hostAuthority,
    });
    if (!closed.ok) throw new Error('expected close success');
    await first.shutdown();
    const recovered = createRoomActorRegistry({
      store,
      createRoomEpoch: () => 'must-not-be-used',
    });

    const actor = await recovered.recover('room-1');
    expect(actor?.getSnapshot()).toEqual(closed.nextState);
    await expect(recovered.execute({
      roomId: 'room-1',
      command: {
        type: 'close',
        expectedRoomEpoch: 'epoch-1',
        reason: 'terminal-retry',
        timestamp: THIRD_TIMESTAMP,
      },
      authority: hostAuthority,
    })).resolves.toMatchObject({ ok: true, kind: 'idempotent' });
    expect(store.state?.snapshot.roomEpoch).toBe('epoch-1');
  });

  it('exact replay quota 耗尽时以 opaque runtime capability checkpoint close，原请求稳定 fail closed', async () => {
    const store = new MemoryRoomStore();
    store.state = generationExhaustedState();
    const registry = createRoomActorRegistry({
      store,
      createRoomEpoch: () => 'epoch-2',
      recoveryTimestamp: () => THIRD_TIMESTAMP,
      quotaCloseTimestamp: () => FOURTH_TIMESTAMP,
    });
    const actor = await registry.recover('room-1');
    if (!actor) throw new Error('expected actor');
    const fanout = vi.fn();
    actor.subscribe(fanout);
    const authority = issueArenaRoomGenerationReservationAuthority({
      actorUserId: 'host-1',
      accountUserId: 101,
      roomId: 'room-1',
      roomEpoch: 'epoch-2',
      configRevision: 0,
      generationRequestId: 'next-request',
      generationId: 'next-generation',
      attempt: 1,
      snapshotDigest: `sha256:${'b'.repeat(64)}`,
      expiresAt: '2026-08-28T01:00:00.000Z',
    });

    await expect(registry.execute({
      roomId: 'room-1',
      command: {
        type: 'reserve-generation',
        expectedRoomEpoch: 'epoch-2',
        expectedRevision: 0,
        generationRequestId: 'next-request',
        generationId: 'next-generation',
        attempt: 1,
        timestamp: FOURTH_TIMESTAMP,
      },
      authority,
      trustedTime: issueArenaRoomTrustedTime({ now: FOURTH_TIMESTAMP }),
    })).resolves.toMatchObject({
      ok: false,
      code: 'capability-denied',
      reason: 'generation-history-limit-reached',
    });
    expect(store.state).toMatchObject({
      snapshot: { roomEpoch: 'epoch-2' },
      lifecycle: { status: 'closed', closeReason: 'room-incarnation-limit' },
    });
    expect(fanout).toHaveBeenCalledWith(expect.objectContaining({
      events: [expect.objectContaining({ type: 'room.closing' })],
    }));
  });

  it('collaborative provenance quota 也触发同一 runtime checkpoint close', async () => {
    const store = new MemoryRoomStore();
    const exhausted = createArenaRoomState('epoch-1');
    exhausted.snapshot.members.push({
      userId: 'member-1',
      role: 'member',
      displayName: 'Member',
      membershipState: 'active',
      joinedAt: ARENA_ROOM_NEXT_TIMESTAMP,
    });
    exhausted.memberAuthority.push({
      accountUserId: 202,
      member: exhausted.snapshot.members[1]!,
    });
    exhausted.collaborativeChanges = Array.from(
      { length: MAX_ROOM_COLLABORATIVE_CHANGES },
      (_, index) => ({
        changeId: `removed-change-${index}`,
        type: 'removeCombatant' as const,
        combatantKey: `data-card:removed-character-${index}`,
        expectedBase: {
          kind: 'present' as const,
          ref: {
            id: `removed-character-${index}`,
            kind: 'character' as const,
            versionToken: 'v1',
          },
        },
      }),
    );
    exhausted.snapshot.proposals = [{
      proposalVersion: 1,
      proposalId: 'proposal-remove-current',
      roomId: 'room-1',
      authorUserId: 'member-1',
      baseRevision: 0,
      status: 'submitted',
      changes: [{
        changeId: 'add-current-material',
        type: 'addMaterial',
        ref: { id: 'material-current', kind: 'material', versionToken: 'v1' },
        expectedBase: { kind: 'absent' },
      }],
      createdAt: ARENA_ROOM_NEXT_TIMESTAMP,
    }];
    // RedisRoomStore.load() returns the strict schema projection. Keep this
    // in-memory recovery fixture on the same canonical checkpoint boundary.
    store.state = ArenaRoomAuthorityStateSchema.parse(exhausted);
    const registry = createRoomActorRegistry({
      store,
      createRoomEpoch: () => 'epoch-2',
      recoveryTimestamp: () => THIRD_TIMESTAMP,
      quotaCloseTimestamp: () => FOURTH_TIMESTAMP,
    });
    const actor = await registry.recover('room-1');
    if (!actor) throw new Error('expected actor');

    await expect(registry.execute({
      roomId: 'room-1',
      command: {
        type: 'resolve-proposal',
        expectedRoomEpoch: 'epoch-2',
        proposalId: 'proposal-remove-current',
        resolution: 'accept-selected',
        selectedChangeIds: ['add-current-material'],
        timestamp: FOURTH_TIMESTAMP,
      },
      authority: hostAuthority,
    })).resolves.toMatchObject({
      ok: false,
      code: 'capability-denied',
      reason: 'collaborative-history-limit-reached',
    });
    expect(store.state?.lifecycle).toMatchObject({
      status: 'closed',
      closeReason: 'room-incarnation-limit',
    });
  });

  it('quota close checkpoint 暂时失败时保持本地 close-only，并在后续请求重试关闭', async () => {
    const store = new MemoryRoomStore();
    const observed = vi.fn();
    store.state = generationExhaustedState();
    store.beforeSave = async (_data, call) => {
      if (call === 2) throw new Error('redis temporarily unavailable');
    };
    const registry = createRoomActorRegistry({
      store,
      createRoomEpoch: () => 'epoch-2',
      recoveryTimestamp: () => THIRD_TIMESTAMP,
      quotaCloseTimestamp: () => FOURTH_TIMESTAMP,
      onBackgroundError: observed,
    });
    await registry.recover('room-1');
    const authority = issueArenaRoomGenerationReservationAuthority({
      actorUserId: 'host-1',
      accountUserId: 101,
      roomId: 'room-1',
      roomEpoch: 'epoch-2',
      configRevision: 0,
      generationRequestId: 'next-request',
      generationId: 'next-generation',
      attempt: 1,
      snapshotDigest: `sha256:${'b'.repeat(64)}`,
      expiresAt: '2026-08-28T01:00:00.000Z',
    });
    await expect(registry.execute({
      roomId: 'room-1',
      command: {
        type: 'reserve-generation',
        expectedRoomEpoch: 'epoch-2',
        expectedRevision: 0,
        generationRequestId: 'next-request',
        generationId: 'next-generation',
        attempt: 1,
        timestamp: FOURTH_TIMESTAMP,
      },
      authority,
      trustedTime: issueArenaRoomTrustedTime({ now: FOURTH_TIMESTAMP }),
    })).resolves.toMatchObject({
      ok: false,
      code: 'capability-denied',
      reason: 'generation-history-limit-reached',
    });
    expect(store.state?.lifecycle.status).toBe('open');
    expect(observed).toHaveBeenCalledTimes(1);

    await expect(registry.execute({
      roomId: 'room-1',
      command: publishCommand(store.state!, 0, 'must-not-apply', FOURTH_TIMESTAMP),
      authority: hostAuthority,
    })).resolves.toMatchObject({
      ok: false,
      code: 'capability-denied',
      reason: 'generation-history-limit-reached',
    });
    expect(store.state).toMatchObject({
      snapshot: { sharedConfig: { userGuidance: '' } },
      lifecycle: { status: 'closed', closeReason: 'room-incarnation-limit' },
    });
  });

  it('quota close CAS conflict 立即 fence actor，不安装 close state 或 fan-out', async () => {
    const store = new MemoryRoomStore();
    store.state = generationExhaustedState();
    store.conflictAtCall = 2;
    const registry = createRoomActorRegistry({
      store,
      createRoomEpoch: () => 'epoch-2',
      recoveryTimestamp: () => THIRD_TIMESTAMP,
      quotaCloseTimestamp: () => FOURTH_TIMESTAMP,
    });
    const actor = await registry.recover('room-1');
    if (!actor) throw new Error('expected actor');
    const fanout = vi.fn();
    actor.subscribe(fanout);
    const authority = issueArenaRoomGenerationReservationAuthority({
      actorUserId: 'host-1',
      accountUserId: 101,
      roomId: 'room-1',
      roomEpoch: 'epoch-2',
      configRevision: 0,
      generationRequestId: 'next-request',
      generationId: 'next-generation',
      attempt: 1,
      snapshotDigest: `sha256:${'b'.repeat(64)}`,
      expiresAt: '2026-08-28T01:00:00.000Z',
    });

    await expect(registry.execute({
      roomId: 'room-1',
      command: {
        type: 'reserve-generation',
        expectedRoomEpoch: 'epoch-2',
        expectedRevision: 0,
        generationRequestId: 'next-request',
        generationId: 'next-generation',
        attempt: 1,
        timestamp: FOURTH_TIMESTAMP,
      },
      authority,
      trustedTime: issueArenaRoomTrustedTime({ now: FOURTH_TIMESTAMP }),
    })).rejects.toThrow('ROOM_ACTOR_CHECKPOINT_CONFLICT');
    expect(actor.getSnapshot()?.lifecycle.status).toBe('open');
    expect(store.state?.lifecycle.status).toBe('open');
    expect(fanout).toHaveBeenCalledOnce();
    expect(fanout).toHaveBeenCalledWith(expect.objectContaining({
      events: [],
      terminal: 'fenced',
    }));
    expect(() => registry.get('room-1')).toThrow('ROOM_ACTOR_FENCED');
  });

  it('recovery 遇到 Redis incarnation quota 时关闭旧 epoch，而不是留下 active checkpoint', async () => {
    const store = new MemoryRoomStore();
    store.state = createArenaRoomState('epoch-1');
    store.beforeSave = async (_data, call) => {
      if (call === 1) throw new Error('REDIS_ROOM_INCARNATION_LIMIT');
    };
    const registry = createRoomActorRegistry({
      store,
      createRoomEpoch: () => 'epoch-2',
      recoveryTimestamp: () => THIRD_TIMESTAMP,
      quotaCloseTimestamp: () => FOURTH_TIMESTAMP,
    });

    const actor = await registry.recover('room-1');
    expect(actor?.getSnapshot()).toMatchObject({
      snapshot: { roomEpoch: 'epoch-1' },
      lifecycle: { status: 'closed', closeReason: 'room-incarnation-limit' },
    });
    expect(store.state).toEqual(actor?.getSnapshot());
    expect(store.saveCalls).toBe(2);
  });

  it('单一 sweeper 保留带未来 deadline 的 idle actor，并在到期后关闭回收', async () => {
    let now = 0;
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const store = new MemoryRoomStore();
    const registry = createRoomActorRegistry({
      store,
      idleActorTtlMs: 50,
      now: () => now,
    });
    await createActorRoom(registry);
    expect(setIntervalSpy).not.toHaveBeenCalled();
    const stopSweeper = registry.startIdleSweeper(10_000);
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    stopSweeper();
    now = Date.parse('2026-08-28T00:44:59.999Z');

    await expect(registry.evictIdle()).resolves.toBe(0);
    expect(registry.size).toBe(1);
    now = Date.parse('2026-08-28T00:45:00.000Z');
    await registry.sweepRuntime();
    expect(registry.size).toBe(0);
    const recovered = await registry.recover('room-1');
    expect(recovered?.getSnapshot()).toMatchObject({
      snapshot: { roomEpoch: 'epoch-1' },
      lifecycle: { status: 'closed', closeReason: 'host-offline-timeout' },
    });
    setIntervalSpy.mockRestore();
  });

  it('deadline 到期后存在 subscriber 的 actor 仍不 eviction，退订后才可回收', async () => {
    let now = 0;
    const store = new MemoryRoomStore();
    const registry = createRoomActorRegistry({
      store,
      idleActorTtlMs: 50,
      now: () => now,
    });
    await createActorRoom(registry);
    const actor = await registry.get('room-1');
    if (!actor) throw new Error('expected actor');
    const unsubscribe = actor.subscribe(vi.fn());
    now = Date.parse('2026-08-28T00:45:00.000Z');

    await expect(registry.expireDeadlines()).resolves.toBe(1);
    await expect(registry.evictIdle()).resolves.toBe(0);
    unsubscribe();
    await expect(registry.evictIdle()).resolves.toBe(1);
  });

  it('command entry 先执行 lazy deadline close，迟到命令不能复活或越过房间期限', async () => {
    let now = Date.parse('2026-08-28T00:00:00.000Z');
    const store = new MemoryRoomStore();
    const registry = createRoomActorRegistry({ store, now: () => now });
    const created = await createActorRoom(registry);
    if (!created.ok) throw new Error('expected create success');
    now = Date.parse('2026-08-28T00:45:00.000Z');

    await expect(registry.execute({
      roomId: 'room-1',
      command: publishCommand(
        created.nextState,
        0,
        'must-not-publish-after-deadline',
        '2026-08-28T00:45:00.000Z',
      ),
      authority: hostAuthority,
    })).resolves.toMatchObject({ ok: false, code: 'room-closed' });
    expect(store.state?.lifecycle).toMatchObject({
      status: 'closed',
      closeReason: 'host-offline-timeout',
    });
    await expect(registry.expireDeadlines()).resolves.toBe(0);
  });

  it('deadline 在线性化队列边界重检，排队中的 presence 不能清除已到期 deadline', async () => {
    let now = Date.parse('2026-08-28T00:00:00.000Z');
    const store = new MemoryRoomStore();
    const registry = createRoomActorRegistry({ store, now: () => now });
    const created = await createActorRoom(registry);
    if (!created.ok) throw new Error('expected create success');
    const actor = registry.get('room-1');
    if (!actor) throw new Error('actor missing');
    const gate = deferred();
    store.beforeSave = async (_data, call) => {
      if (call === 2) await gate.promise;
    };
    const inFlight = actor.execute({
      command: publishCommand(created.nextState, 0, 'before-deadline', THIRD_TIMESTAMP),
      authority: hostAuthority,
    });
    await vi.waitFor(() => expect(store.activeSaves).toBe(1));
    now = Date.parse('2026-08-28T00:45:00.000Z');
    const timestamp = '2026-08-28T00:45:00.000Z';
    const queuedPresence = actor.execute({
      authority: issueArenaRoomPresenceAuthority({
        roomId: 'room-1',
        roomEpoch: 'epoch-1',
        deadlines: { hostOfflineDeadline: null, roomIdleDeadline: null },
        timestamp,
      }),
      command: {
        type: 'sync-presence',
        expectedRoomEpoch: 'epoch-1',
        deadlines: { hostOfflineDeadline: null, roomIdleDeadline: null },
        timestamp,
      },
    });
    gate.resolve();

    await expect(inFlight).resolves.toMatchObject({ ok: true, kind: 'applied' });
    await expect(queuedPresence).resolves.toMatchObject({ ok: false, code: 'room-closed' });
    expect(store.state?.lifecycle).toMatchObject({
      status: 'closed',
      closeReason: 'host-offline-timeout',
    });
  });

  it('graceful shutdown 先拒绝新 command，再 drain acknowledged checkpoint 并清理 fan-out', async () => {
    const store = new MemoryRoomStore();
    const registry = createRoomActorRegistry({ store });
    const created = await createActorRoom(registry);
    if (!created.ok) throw new Error('expected create success');
    const actor = await registry.get('room-1');
    if (!actor) throw new Error('expected actor');
    const fanout = vi.fn();
    actor.subscribe(fanout);
    const gate = deferred();
    store.beforeSave = async (_data, call) => {
      if (call === 2) await gate.promise;
    };
    const inFlight = registry.execute({
      roomId: 'room-1',
      command: publishCommand(created.nextState, 0, 'drained', ARENA_ROOM_NEXT_TIMESTAMP),
      authority: hostAuthority,
    });
    await vi.waitFor(() => expect(store.activeSaves).toBe(1));
    const queued = registry.execute({
      roomId: 'room-1',
      command: publishCommand(created.nextState, 1, 'queued-drain', THIRD_TIMESTAMP),
      authority: hostAuthority,
    });

    const shutdown = registry.shutdown();
    await expect(registry.execute({
      roomId: 'room-1',
      command: publishCommand(created.nextState, 1, 'rejected', THIRD_TIMESTAMP),
      authority: hostAuthority,
    })).rejects.toThrow('ROOM_ACTOR_REGISTRY_SHUTTING_DOWN');
    let shutdownDone = false;
    void shutdown.then(() => { shutdownDone = true; });
    await Promise.resolve();
    expect(shutdownDone).toBe(false);

    gate.resolve();
    await expect(inFlight).resolves.toMatchObject({ ok: true, kind: 'applied' });
    await expect(queued).resolves.toMatchObject({ ok: true, kind: 'applied' });
    await expect(shutdown).resolves.toBeUndefined();
    expect(fanout).toHaveBeenCalledTimes(2);
    expect(store.state?.snapshot.revision).toBe(2);
    expect(registry.size).toBe(0);
  });

  it('force close 不伪造已提交 checkpoint 的本进程 ack 或 fan-out', async () => {
    const store = new MemoryRoomStore();
    const registry = createRoomActorRegistry({ store });
    const created = await createActorRoom(registry);
    if (!created.ok) throw new Error('expected create success');
    const actor = await registry.get('room-1');
    if (!actor) throw new Error('expected actor');
    const fanout = vi.fn();
    actor.subscribe(fanout);
    const gate = deferred();
    store.beforeSave = async (_data, call) => {
      if (call === 2) await gate.promise;
    };
    const inFlight = registry.execute({
      roomId: 'room-1',
      command: publishCommand(created.nextState, 0, 'committed-during-force-close', ARENA_ROOM_NEXT_TIMESTAMP),
      authority: hostAuthority,
    });
    await vi.waitFor(() => expect(store.activeSaves).toBe(1));
    const queued = registry.execute({
      roomId: 'room-1',
      command: publishCommand(created.nextState, 1, 'must-be-rejected', THIRD_TIMESTAMP),
      authority: hostAuthority,
    });

    registry.forceClose();
    await expect(queued).rejects.toThrow('ROOM_ACTOR_SHUTTING_DOWN');
    gate.resolve();
    await expect(inFlight).rejects.toThrow('ROOM_ACTOR_SHUTTING_DOWN');
    expect(store.state?.snapshot).toMatchObject({
      revision: 1,
      sharedConfig: { userGuidance: 'committed-during-force-close' },
    });
    expect(actor.getSnapshot()?.snapshot.revision).toBe(0);
    expect(fanout).not.toHaveBeenCalled();
  });

  it('shutdown 等待进行中的 hydration 停止，且不得在停止接收后安装 recovery actor', async () => {
    const store = new MemoryRoomStore();
    const seed = createRoomActorRegistry({ store });
    await createActorRoom(seed);
    await seed.shutdown();
    const loadGate = deferred();
    store.beforeLoad = () => loadGate.promise;
    const registry = createRoomActorRegistry({
      store,
      createRoomEpoch: () => 'epoch-2',
      recoveryTimestamp: () => THIRD_TIMESTAMP,
    });
    const hydration = registry.recover('room-1');
    const shutdown = registry.shutdown();
    let shutdownDone = false;
    void shutdown.then(() => { shutdownDone = true; });
    await Promise.resolve();
    expect(shutdownDone).toBe(false);

    loadGate.resolve();
    await expect(hydration).rejects.toThrow('ROOM_ACTOR_REGISTRY_SHUTTING_DOWN');
    await expect(shutdown).resolves.toBeUndefined();
    expect(registry.size).toBe(0);
    expect(store.state?.snapshot.roomEpoch).toBe('epoch-1');
  });

  it('checkpoint failure 不安装 state、不 fan-out；subscriber 容量也保持有界', async () => {
    const store = new MemoryRoomStore();
    const registry = createRoomActorRegistry({ store, maxSubscribersPerRoom: 1 });
    const created = await createActorRoom(registry);
    if (!created.ok) throw new Error('expected create success');
    const actor = await registry.get('room-1');
    if (!actor) throw new Error('expected actor');
    const fanout = vi.fn();
    actor.subscribe(fanout);
    expect(() => actor.subscribe(vi.fn())).toThrow('ROOM_ACTOR_SUBSCRIBER_LIMIT');
    store.saveFailure = new Error('REDIS_ROOM_CHECKPOINT_UNAVAILABLE');

    await expect(registry.execute({
      roomId: 'room-1',
      command: publishCommand(created.nextState, 0, 'must-not-install', ARENA_ROOM_NEXT_TIMESTAMP),
      authority: hostAuthority,
    })).rejects.toThrow('REDIS_ROOM_CHECKPOINT_UNAVAILABLE');
    expect(actor.getSnapshot()?.snapshot.revision).toBe(0);
    expect(fanout).not.toHaveBeenCalled();
  });

  it('同步/异步 subscriber 与诊断 hook 抛错也不反转已提交 command 的成功结果', async () => {
    const store = new MemoryRoomStore();
    const observedErrors: string[] = [];
    const registry = createRoomActorRegistry({
      store,
      onSubscriberError: (error) => {
        observedErrors.push(error instanceof Error ? error.message : 'unknown');
        if (observedErrors.length === 1) throw new Error('observer-hook-failure');
      },
    });
    const created = await createActorRoom(registry);
    if (!created.ok) throw new Error('expected create success');
    const actor = await registry.get('room-1');
    if (!actor) throw new Error('expected actor');
    actor.subscribe(() => { throw new Error('subscriber-failure'); });
    actor.subscribe(async () => { throw new Error('async-subscriber-failure'); });

    await expect(registry.execute({
      roomId: 'room-1',
      command: publishCommand(created.nextState, 0, 'committed', ARENA_ROOM_NEXT_TIMESTAMP),
      authority: hostAuthority,
    })).resolves.toMatchObject({ ok: true, kind: 'applied' });
    expect(store.state?.snapshot.revision).toBe(1);
    await vi.waitFor(() => expect(observedErrors).toEqual([
      'subscriber-failure',
      'async-subscriber-failure',
    ]));
  });

  it('永不完成的 async subscriber 只占一个 in-flight slot，后续 fan-out 不再调用', async () => {
    const store = new MemoryRoomStore();
    const registry = createRoomActorRegistry({ store });
    const created = await createActorRoom(registry);
    if (!created.ok) throw new Error('expected create success');
    const actor = await registry.get('room-1');
    if (!actor) throw new Error('expected actor');
    const slow = vi.fn(() => new Promise<void>(() => undefined));
    actor.subscribe(slow);

    const first = await registry.execute({
      roomId: 'room-1',
      command: publishCommand(created.nextState, 0, 'first', ARENA_ROOM_NEXT_TIMESTAMP),
      authority: hostAuthority,
    });
    if (!first.ok) throw new Error('expected first publish success');
    await expect(registry.execute({
      roomId: 'room-1',
      command: publishCommand(first.nextState, 1, 'second', THIRD_TIMESTAMP),
      authority: hostAuthority,
    })).resolves.toMatchObject({ ok: true, kind: 'applied' });
    expect(slow).toHaveBeenCalledTimes(1);
  });

  it('server-owned create 写入初始 host-offline/room-idle deadline', async () => {
    const store = new MemoryRoomStore();
    const registry = createRoomActorRegistry({
      store,
      hostOfflineGraceMs: 45 * 60_000,
      roomIdleTtlMs: 12 * 60 * 60_000,
    });

    const created = await createActorRoom(registry);
    expect(created).toMatchObject({
      ok: true,
      nextState: {
        authorityStateVersion: 2,
        deadlines: {
          hostOfflineDeadline: '2026-08-28T00:45:00.000Z',
          roomIdleDeadline: '2026-08-28T12:00:00.000Z',
        },
      },
    });
  });

  it('单一 process sweep exact revalidation 后关闭到期 deadline，重复 cleanup 幂等', async () => {
    const store = new MemoryRoomStore();
    let now = Date.parse('2026-08-28T00:00:00.000Z');
    const registry = createRoomActorRegistry({ store, now: () => now });
    await createActorRoom(registry);

    now = Date.parse('2026-08-28T00:45:00.000Z');
    await expect(registry.expireDeadlines()).resolves.toBe(1);
    expect(store.state?.lifecycle).toMatchObject({
      status: 'closed',
      closeReason: 'host-offline-timeout',
    });
    await expect(registry.expireDeadlines()).resolves.toBe(0);
  });

  it('lazy recovery 先关闭已到期 checkpoint，不通过 epoch rollover 延长 deadline', async () => {
    const store = new MemoryRoomStore();
    const seed = createRoomActorRegistry({ store });
    await createActorRoom(seed);
    await seed.shutdown();
    const registry = createRoomActorRegistry({
      store,
      now: () => Date.parse('2026-08-28T00:46:00.000Z'),
      createRoomEpoch: () => 'epoch-2',
      recoveryTimestamp: () => '2026-08-28T00:46:00.000Z',
    });

    const actor = await registry.recover('room-1');
    expect(actor?.getSnapshot()).toMatchObject({
      lifecycle: { status: 'closed', closeReason: 'host-offline-timeout' },
      snapshot: { roomEpoch: 'epoch-1' },
    });
  });

  it('低频 process refresh 仅刷新 exact active checkpoint，missing/conflict 会 fence actor', async () => {
    const store = new MemoryRoomStore();
    let now = 0;
    const registry = createRoomActorRegistry({
      store,
      now: () => now,
      checkpointRefreshIntervalMs: 100,
    });
    await createActorRoom(registry);

    now = 100;
    await expect(registry.refreshActiveCheckpoints()).resolves.toBe(1);
    expect(store.refreshCalls).toBe(1);

    now = 200;
    store.refreshResult = 'missing';
    await expect(registry.refreshActiveCheckpoints()).resolves.toBe(0);
    expect(() => registry.get('room-1')).toThrow('ROOM_ACTOR_FENCED');
  });
});
