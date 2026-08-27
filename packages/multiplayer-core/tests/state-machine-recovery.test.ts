import { describe, expect, it } from 'vitest';

import {
  createArenaRoomCheckpointCommit,
  issueArenaRoomRecoveryAuthority,
  transitionArenaRoom,
  type ArenaRoomAuthorityContext,
} from '../src/index';
import {
  createRoomCommand,
  hostAuthority,
  NEXT_TIMESTAMP,
  TEST_TIMESTAMP,
} from './state-machine-fixtures';

const recoverCommand = () => ({
  type: 'recover' as const,
  expectedRoomEpoch: 'epoch-1',
  nextRoomEpoch: 'epoch-2',
  timestamp: NEXT_TIMESTAMP,
});

describe('Arena Room recovery transition', () => {
  it('以 opaque server capability 原子切换 epoch，并生成可 checkpoint 的完整 snapshot', () => {
    const created = transitionArenaRoom(null, createRoomCommand(), hostAuthority());
    if (!created.ok) throw new Error('expected create success');
    const authority = issueArenaRoomRecoveryAuthority({
      roomId: 'room-1',
      previousRoomEpoch: 'epoch-1',
      nextRoomEpoch: 'epoch-2',
      timestamp: NEXT_TIMESTAMP,
    });

    const recovered = transitionArenaRoom(created.nextState, recoverCommand(), authority);

    expect(recovered).toMatchObject({
      ok: true,
      kind: 'applied',
      predecessor: {
        roomId: 'room-1',
        roomEpoch: 'epoch-1',
        revision: 0,
        controlSeq: 0,
      },
      nextState: {
        lifecycle: { status: 'open', createdAt: TEST_TIMESTAMP, updatedAt: NEXT_TIMESTAMP },
        snapshot: { roomId: 'room-1', roomEpoch: 'epoch-2', revision: 0, controlSeq: 0 },
      },
      events: [{
        roomId: 'room-1',
        roomEpoch: 'epoch-2',
        controlSeq: 0,
        type: 'room.snapshot',
      }],
    });
    expect(() => createArenaRoomCheckpointCommit(recovered)).not.toThrow();
  });

  it('拒绝伪造/序列化 capability、scope 漂移、epoch 复用与 closed Room recovery', () => {
    const created = transitionArenaRoom(null, createRoomCommand(), hostAuthority());
    if (!created.ok) throw new Error('expected create success');
    const authority = issueArenaRoomRecoveryAuthority({
      roomId: 'room-1',
      previousRoomEpoch: 'epoch-1',
      nextRoomEpoch: 'epoch-2',
      timestamp: NEXT_TIMESTAMP,
    });

    expect(transitionArenaRoom(
      created.nextState,
      recoverCommand(),
      structuredClone(authority) as ArenaRoomAuthorityContext,
    )).toMatchObject({ ok: false, code: 'forbidden', reason: 'invalid-authority-context' });
    expect(transitionArenaRoom(
      created.nextState,
      { ...recoverCommand(), nextRoomEpoch: 'epoch-other' },
      authority,
    )).toMatchObject({ ok: false, code: 'forbidden', reason: 'authority-scope-mismatch' });

    const reuseAuthority = issueArenaRoomRecoveryAuthority({
      roomId: 'room-1',
      previousRoomEpoch: 'epoch-1',
      nextRoomEpoch: 'epoch-1',
      timestamp: NEXT_TIMESTAMP,
    });
    expect(transitionArenaRoom(
      created.nextState,
      { ...recoverCommand(), nextRoomEpoch: 'epoch-1' },
      reuseAuthority,
    )).toMatchObject({ ok: false, code: 'stale', reason: 'room-epoch-reuse' });

    const oldTimestamp = '2026-08-27T15:59:00.000Z';
    const regressedAuthority = issueArenaRoomRecoveryAuthority({
      roomId: 'room-1',
      previousRoomEpoch: 'epoch-1',
      nextRoomEpoch: 'epoch-2',
      timestamp: oldTimestamp,
    });
    expect(transitionArenaRoom(created.nextState, {
      ...recoverCommand(),
      timestamp: oldTimestamp,
    }, regressedAuthority)).toMatchObject({
      ok: false,
      code: 'stale',
      reason: 'command-timestamp-regression',
    });

    const closed = transitionArenaRoom(created.nextState, {
      type: 'close',
      expectedRoomEpoch: 'epoch-1',
      timestamp: NEXT_TIMESTAMP,
    }, hostAuthority());
    if (!closed.ok) throw new Error('expected close success');
    expect(transitionArenaRoom(closed.nextState, recoverCommand(), authority))
      .toMatchObject({ ok: false, code: 'room-closed', reason: 'room-closed' });
  });
});
