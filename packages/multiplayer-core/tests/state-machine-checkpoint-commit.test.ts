import { describe, expect, it } from 'vitest';

import {
  createArenaRoomCheckpointCommit,
  consumeArenaRoomCheckpointCommit,
  transitionArenaRoom,
  type ArenaRoomCheckpointCommit,
} from '../src/index';
import {
  baseConfig,
  createRoomCommand,
  hostAuthority,
} from './state-machine-fixtures';

describe('Arena Room checkpoint commit receipt', () => {
  it('只为真实 applied transition 签发不可序列化、不可篡改的 commit receipt', () => {
    const transition = transitionArenaRoom(null, createRoomCommand(), hostAuthority());
    expect(transition.ok).toBe(true);
    if (!transition.ok) throw new Error('expected transition success');

    const receipt = createArenaRoomCheckpointCommit(transition);
    expect(() => createArenaRoomCheckpointCommit(transition))
      .toThrow('ARENA_ROOM_CHECKPOINT_COMMIT_INVALID');
    const expected = structuredClone(transition.nextState);
    transition.nextState.snapshot.sharedConfig.userGuidance = 'tampered-after-transition';

    expect(JSON.stringify(receipt)).toBe('{}');
    expect(consumeArenaRoomCheckpointCommit(receipt)).toEqual({
      predecessor: null,
      predecessorState: null,
      nextState: expected,
    });
    expect(() => consumeArenaRoomCheckpointCommit(receipt))
      .toThrow('ARENA_ROOM_CHECKPOINT_COMMIT_INVALID');
  });

  it('拒绝伪造 receipt、失败 transition 与 idempotent transition', () => {
    expect(() => consumeArenaRoomCheckpointCommit({} as ArenaRoomCheckpointCommit))
      .toThrow('ARENA_ROOM_CHECKPOINT_COMMIT_INVALID');

    const failed = transitionArenaRoom(null, {
      ...createRoomCommand(),
      sharedConfig: { ...baseConfig(), userGuidance: 'x'.repeat(20_000) },
    }, hostAuthority());
    expect(failed.ok).toBe(false);
    expect(() => createArenaRoomCheckpointCommit(failed))
      .toThrow('ARENA_ROOM_CHECKPOINT_COMMIT_INVALID');

    const created = transitionArenaRoom(null, createRoomCommand(), hostAuthority());
    if (!created.ok) throw new Error('expected create success');
    const idempotent = transitionArenaRoom(created.nextState, {
      type: 'publish-config',
      expectedRoomEpoch: created.nextState.snapshot.roomEpoch,
      expectedRevision: created.nextState.snapshot.revision,
      expectedControlSeq: created.nextState.snapshot.controlSeq,
      sharedConfig: created.nextState.snapshot.sharedConfig,
      timestamp: created.nextState.lifecycle.updatedAt,
    }, hostAuthority());
    expect(idempotent).toMatchObject({ ok: true, kind: 'idempotent' });
    expect(() => createArenaRoomCheckpointCommit(idempotent))
      .toThrow('ARENA_ROOM_CHECKPOINT_COMMIT_INVALID');
  });

  it('把 transition 实际读取的完整 predecessor state 固化进 receipt', () => {
    const created = transitionArenaRoom(null, createRoomCommand(), hostAuthority());
    if (!created.ok) throw new Error('expected create success');
    const previous = structuredClone(created.nextState);
    const published = transitionArenaRoom(created.nextState, {
      type: 'publish-config',
      expectedRoomEpoch: created.nextState.snapshot.roomEpoch,
      expectedRevision: created.nextState.snapshot.revision,
      expectedControlSeq: created.nextState.snapshot.controlSeq,
      sharedConfig: { ...created.nextState.snapshot.sharedConfig, userGuidance: 'next' },
      timestamp: '2026-08-28T00:01:00.000Z',
    }, hostAuthority());
    if (!published.ok) throw new Error('expected publish success');

    created.nextState.snapshot.sharedConfig.userGuidance = 'tampered-previous';
    const data = consumeArenaRoomCheckpointCommit(createArenaRoomCheckpointCommit(published));
    expect(data.predecessorState).toEqual(previous);
  });
});
