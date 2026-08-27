import { describe, expect, it } from 'vitest';

import {
  createArenaRoomCheckpointCommit,
  readArenaRoomCheckpointCommit,
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
    const expected = structuredClone(transition.nextState);
    transition.nextState.snapshot.sharedConfig.userGuidance = 'tampered-after-transition';

    expect(JSON.stringify(receipt)).toBe('{}');
    expect(readArenaRoomCheckpointCommit(receipt)).toEqual({
      predecessor: null,
      nextState: expected,
    });
  });

  it('拒绝伪造 receipt、失败 transition 与 idempotent transition', () => {
    expect(() => readArenaRoomCheckpointCommit({} as ArenaRoomCheckpointCommit))
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
      sharedConfig: created.nextState.snapshot.sharedConfig,
      timestamp: created.nextState.lifecycle.updatedAt,
    }, hostAuthority());
    expect(idempotent).toMatchObject({ ok: true, kind: 'idempotent' });
    expect(() => createArenaRoomCheckpointCommit(idempotent))
      .toThrow('ARENA_ROOM_CHECKPOINT_COMMIT_INVALID');
  });
});
