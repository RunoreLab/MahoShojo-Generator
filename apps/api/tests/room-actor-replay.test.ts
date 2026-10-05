import { describe, expect, it, vi } from 'vitest';

import {
  checkpointPredecessorOf,
  consumeArenaRoomCheckpointCommit,
  type ArenaRoomAuthorityState,
  type ArenaRoomCheckpointCommitData,
} from '@mahoshojo/multiplayer-core';
import {
  createRoomActorRegistry,
  type RoomActorCheckpointStore,
} from '#/arena-room/room-actor-registry';
import { createArenaRoomState } from './arena-room-fixtures';

class MemoryRoomStore implements RoomActorCheckpointStore {
  state: ArenaRoomAuthorityState | null = null;

  async load(roomId: string) {
    return this.state?.snapshot.roomId === roomId ? structuredClone(this.state) : null;
  }

  async save(input: Parameters<RoomActorCheckpointStore['save']>[0]) {
    const commit: ArenaRoomCheckpointCommitData = consumeArenaRoomCheckpointCommit(input.commit);
    if (commit.predecessor === null) {
      if (this.state !== null) return { kind: 'conflict' as const };
    } else if (
      this.state === null
      || JSON.stringify(this.state) !== JSON.stringify(commit.predecessorState)
      || JSON.stringify(checkpointPredecessorOf(this.state)) !== JSON.stringify(commit.predecessor)
    ) {
      return { kind: 'conflict' as const };
    }
    this.state = structuredClone(commit.nextState);
    return { kind: 'saved' as const };
  }

  async refresh(input: { checkpoint: ArenaRoomAuthorityState }) {
    return JSON.stringify(this.state) === JSON.stringify(input.checkpoint)
      ? { kind: 'refreshed' as const }
      : { kind: 'conflict' as const };
  }
}

const hostAuthority = {
  kind: 'authenticated-user' as const,
  actorUserId: 'host-1',
  accountUserId: 101,
};

const createRegistry = (store: MemoryRoomStore, maxReplayEvents = 2) => createRoomActorRegistry({
  store,
  createRoomIdentity: () => ({ roomId: 'room-1', roomEpoch: 'epoch-1' }),
  createTimestamp: () => '2026-08-28T00:00:00.000Z',
  now: () => Date.parse('2026-08-28T00:00:00.000Z'),
  hostOfflineGraceMs: 45 * 60_000,
  maxReplayEvents,
  roomIdleTtlMs: 12 * 60 * 60_000,
});

describe('RoomActor bounded reconnect replay', () => {
  it('同 epoch cursor 获得连续 bounded replay，窗口缺失或新 epoch 获得当前 snapshot', async () => {
    const store = new MemoryRoomStore();
    const registry = createRegistry(store, 2);
    const created = await registry.create({
      authority: hostAuthority,
      host: { displayName: 'Host', userId: 'host-1' },
      sharedConfig: createArenaRoomState().snapshot.sharedConfig,
    });
    expect(created.result).toMatchObject({ ok: true });
    const actor = registry.get('room-1');
    if (!actor) throw new Error('actor not found');

    for (const [index, guidance] of ['one', 'two', 'three'].entries()) {
      const state = actor.getSnapshot();
      if (!state) throw new Error('state not found');
      await actor.execute({
        authority: hostAuthority,
        command: {
          type: 'publish-config',
          expectedRoomEpoch: 'epoch-1',
          expectedRevision: index,
          expectedControlSeq: state.snapshot.controlSeq,
          sharedConfig: { ...state.snapshot.sharedConfig, userGuidance: guidance },
          timestamp: `2026-08-28T00:0${index + 1}:00.000Z`,
        },
      });
    }

    expect(actor.resolveControlSync({ roomEpoch: 'epoch-1', controlSeq: 1 })).toMatchObject({
      kind: 'replay',
      events: [
        { type: 'room.config.updated', controlSeq: 2 },
        { type: 'room.config.updated', controlSeq: 3 },
      ],
    });
    expect(actor.resolveControlSync({ roomEpoch: 'epoch-1', controlSeq: 0 })).toMatchObject({
      kind: 'snapshot',
      events: [{ type: 'room.snapshot', controlSeq: 3 }],
    });
    expect(actor.resolveControlSync({ roomEpoch: 'epoch-old', controlSeq: 99 })).toMatchObject({
      kind: 'snapshot',
      events: [{ type: 'room.snapshot', roomEpoch: 'epoch-1', controlSeq: 3 }],
    });
    expect(actor.resolveControlSync({ roomEpoch: 'epoch-1', controlSeq: 3 })).toEqual({
      kind: 'current',
      events: [],
    });
  });

  it('subscribeWithControlSync 在 snapshot/replay 与后续 fan-out 之间不留 gap', async () => {
    const store = new MemoryRoomStore();
    const registry = createRegistry(store);
    await registry.create({
      authority: hostAuthority,
      host: { displayName: 'Host', userId: 'host-1' },
      sharedConfig: createArenaRoomState().snapshot.sharedConfig,
    });
    const actor = registry.get('room-1');
    if (!actor) throw new Error('actor not found');
    const subscriber = vi.fn();

    const attached = actor.subscribeWithControlSync(undefined, subscriber);
    expect(attached.sync).toMatchObject({
      kind: 'snapshot',
      events: [{ type: 'room.snapshot', controlSeq: 0 }],
    });
    const state = actor.getSnapshot()!;
    await actor.execute({
      authority: hostAuthority,
      command: {
        type: 'publish-config',
        expectedRoomEpoch: 'epoch-1',
        expectedRevision: 0,
        expectedControlSeq: state.snapshot.controlSeq,
        sharedConfig: { ...state.snapshot.sharedConfig, userGuidance: 'after-attach' },
        timestamp: '2026-08-28T00:01:00.000Z',
      },
    });

    expect(subscriber).toHaveBeenCalledWith(expect.objectContaining({
      events: [expect.objectContaining({ type: 'room.config.updated', controlSeq: 1 })],
    }));
    attached.unsubscribe();
  });
});
