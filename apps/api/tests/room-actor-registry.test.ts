import { describe, expect, it, vi } from 'vitest';

import {
  checkpointPredecessorOf,
  consumeArenaRoomCheckpointCommit,
  type ArenaRoomAuthorityState,
  type ArenaRoomCheckpointCommitData,
  type ArenaRoomCommand,
} from '@mahoshojo/multiplayer-core';

import {
  createRoomActorRegistry,
  type RoomActorCheckpointStore,
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

const createCommand = (roomEpoch = 'epoch-1'): ArenaRoomCommand => {
  const state = createArenaRoomState(roomEpoch);
  return {
    type: 'create',
    roomId: state.snapshot.roomId,
    roomEpoch,
    host: state.snapshot.members[0]!,
    sharedConfig: state.snapshot.sharedConfig,
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

class MemoryRoomStore implements RoomActorCheckpointStore {
  state: ArenaRoomAuthorityState | null = null;
  saveCalls = 0;
  activeSaves = 0;
  maxActiveSaves = 0;
  beforeSave?: (
    data: ArenaRoomCheckpointCommitData,
    call: number,
  ) => Promise<void>;
  saveFailure?: Error;
  beforeLoad?: () => Promise<void>;

  async load(roomId: string): Promise<ArenaRoomAuthorityState | null> {
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

}

describe('RoomActorRegistry', () => {
  it('registry room 容量有界，满额时在 load/transition/checkpoint 前 fail closed', async () => {
    const store = new MemoryRoomStore();
    const registry = createRoomActorRegistry({ store, maxActors: 1 });
    await registry.execute({ roomId: 'room-1', command: createCommand(), authority: hostAuthority });

    await expect(registry.execute({
      roomId: 'room-overload',
      command: createCommand('epoch-overload'),
      authority: hostAuthority,
    })).rejects.toThrow('ROOM_ACTOR_REGISTRY_CAPACITY');
    expect(store.saveCalls).toBe(1);
  });

  it('concurrent create 只建立一个 actor/writer，第二个 create 在同一队列内判定 duplicate', async () => {
    const store = new MemoryRoomStore();
    const registry = createRoomActorRegistry({ store });

    const results = await Promise.all([
      registry.execute({ roomId: 'room-1', command: createCommand(), authority: hostAuthority }),
      registry.execute({ roomId: 'room-1', command: createCommand(), authority: hostAuthority }),
    ]);

    expect(results).toMatchObject([
      { ok: true, kind: 'applied' },
      { ok: false, code: 'duplicate', reason: 'state-already-exists' },
    ]);
    expect(store.saveCalls).toBe(1);
    expect(store.maxActiveSaves).toBe(1);
    expect(registry.size).toBe(1);
  });

  it('同 room concurrent command 严格串行，并只在 checkpoint 后安装/fan-out', async () => {
    const store = new MemoryRoomStore();
    const registry = createRoomActorRegistry({ store });
    const created = await registry.execute({
      roomId: 'room-1',
      command: createCommand(),
      authority: hostAuthority,
    });
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

  it('registry 在异步 hydration 前冻结普通 authority 输入，拒绝排队期间提权', async () => {
    const store = new MemoryRoomStore();
    const loadGate = deferred();
    store.beforeLoad = () => loadGate.promise;
    const registry = createRoomActorRegistry({ store });
    const mutableAuthority = {
      kind: 'authenticated-user',
      actorUserId: 'attacker',
      accountUserId: 999,
    };
    const result = registry.execute({
      roomId: 'room-1',
      command: createCommand(),
      authority: mutableAuthority,
    });
    mutableAuthority.actorUserId = 'host-1';
    mutableAuthority.accountUserId = 101;
    loadGate.resolve();

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
    const created = await registry.execute({
      roomId: 'room-1',
      command: createCommand(),
      authority: hostAuthority,
    });
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
    const created = await oldRegistry.execute({
      roomId: 'room-1',
      command: createCommand(),
      authority: hostAuthority,
    });
    if (!created.ok) throw new Error('expected create success');

    const recoveredRegistry = createRoomActorRegistry({
      store,
      createRoomEpoch: () => 'epoch-2',
      recoveryTimestamp: () => THIRD_TIMESTAMP,
    });
    const recoveredActor = await recoveredRegistry.get('room-1');
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

  it('显式 idle eviction 不创建 per-room interval；再次 hydrate 必须切新 epoch', async () => {
    let now = 0;
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const store = new MemoryRoomStore();
    const epochs = ['epoch-2'];
    const registry = createRoomActorRegistry({
      store,
      idleActorTtlMs: 50,
      now: () => now,
      createRoomEpoch: () => epochs.shift() ?? 'epoch-unexpected',
      recoveryTimestamp: () => THIRD_TIMESTAMP,
    });
    await registry.execute({
      roomId: 'room-1',
      command: createCommand(),
      authority: hostAuthority,
    });
    expect(setIntervalSpy).not.toHaveBeenCalled();
    const stopSweeper = registry.startIdleSweeper(10_000);
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    stopSweeper();
    now = 100;

    await expect(registry.evictIdle()).resolves.toBe(1);
    expect(registry.size).toBe(0);
    const recovered = await registry.get('room-1');
    expect(recovered?.getSnapshot()?.snapshot.roomEpoch).toBe('epoch-2');
    setIntervalSpy.mockRestore();
  });

  it('存在 subscriber 的 actor 不会被 idle eviction，退订后才可回收', async () => {
    let now = 0;
    const store = new MemoryRoomStore();
    const registry = createRoomActorRegistry({
      store,
      idleActorTtlMs: 50,
      now: () => now,
    });
    await registry.execute({ roomId: 'room-1', command: createCommand(), authority: hostAuthority });
    const actor = await registry.get('room-1');
    if (!actor) throw new Error('expected actor');
    const unsubscribe = actor.subscribe(vi.fn());
    now = 100;

    await expect(registry.evictIdle()).resolves.toBe(0);
    unsubscribe();
    await expect(registry.evictIdle()).resolves.toBe(1);
  });

  it('graceful shutdown 先拒绝新 command，再 drain acknowledged checkpoint 并清理 fan-out', async () => {
    const store = new MemoryRoomStore();
    const registry = createRoomActorRegistry({ store });
    const created = await registry.execute({
      roomId: 'room-1',
      command: createCommand(),
      authority: hostAuthority,
    });
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
    await expect(shutdown).resolves.toBeUndefined();
    expect(fanout).toHaveBeenCalledTimes(1);
    expect(registry.size).toBe(0);
  });

  it('force close 不伪造已提交 checkpoint 的本进程 ack 或 fan-out', async () => {
    const store = new MemoryRoomStore();
    const registry = createRoomActorRegistry({ store });
    const created = await registry.execute({
      roomId: 'room-1',
      command: createCommand(),
      authority: hostAuthority,
    });
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

    registry.forceClose();
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
    await seed.execute({ roomId: 'room-1', command: createCommand(), authority: hostAuthority });
    await seed.shutdown();
    const loadGate = deferred();
    store.beforeLoad = () => loadGate.promise;
    const registry = createRoomActorRegistry({
      store,
      createRoomEpoch: () => 'epoch-2',
      recoveryTimestamp: () => THIRD_TIMESTAMP,
    });
    const hydration = registry.get('room-1');
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
    const created = await registry.execute({
      roomId: 'room-1',
      command: createCommand(),
      authority: hostAuthority,
    });
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
    const created = await registry.execute({
      roomId: 'room-1',
      command: createCommand(),
      authority: hostAuthority,
    });
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
});
