import { describe, expect, it } from 'vitest';

import {
  issueArenaRoomQuotaCloseAuthority,
  transitionArenaRoom,
  type ArenaRoomAuthorityContext,
} from '../src/index';
import {
  createRoomCommand,
  hostAuthority,
  NEXT_TIMESTAMP,
  TEST_TIMESTAMP,
} from './state-machine-fixtures';

describe('Arena Room quota close authority', () => {
  it('只允许 opaque、精确 scope 的 runtime capability 关闭配额耗尽 incarnation', () => {
    const created = transitionArenaRoom(null, createRoomCommand(), hostAuthority());
    if (!created.ok) throw new Error('expected create success');
    const command = {
      type: 'close' as const,
      expectedRoomEpoch: 'epoch-1',
      reason: 'room-incarnation-limit' as const,
      timestamp: NEXT_TIMESTAMP,
    };
    const authority = issueArenaRoomQuotaCloseAuthority({
      roomId: 'room-1',
      roomEpoch: 'epoch-1',
      reason: 'room-incarnation-limit',
      timestamp: NEXT_TIMESTAMP,
    });

    expect(transitionArenaRoom(
      created.nextState,
      command,
      structuredClone(authority) as ArenaRoomAuthorityContext,
    )).toMatchObject({ ok: false, code: 'forbidden', reason: 'invalid-authority-context' });
    expect(transitionArenaRoom(created.nextState, {
      ...command,
      timestamp: '2026-08-27T16:02:00.000Z',
    }, authority)).toMatchObject({
      ok: false,
      code: 'forbidden',
      reason: 'authority-scope-mismatch',
    });
    expect(transitionArenaRoom(created.nextState, command, authority)).toMatchObject({
      ok: true,
      kind: 'applied',
      nextState: {
        lifecycle: {
          status: 'closed',
          closeReason: 'room-incarnation-limit',
        },
      },
    });
  });

  it('host 与 runtime quota close 都不能回退 lifecycle 时间', () => {
    const created = transitionArenaRoom(null, createRoomCommand(), hostAuthority());
    if (!created.ok) throw new Error('expected create success');
    const timestamp = '2026-08-27T15:59:00.000Z';
    const command = {
      type: 'close' as const,
      expectedRoomEpoch: 'epoch-1',
      reason: 'room-incarnation-limit' as const,
      timestamp,
    };
    const authority = issueArenaRoomQuotaCloseAuthority({
      roomId: 'room-1',
      roomEpoch: 'epoch-1',
      reason: 'room-incarnation-limit',
      timestamp,
    });

    expect(transitionArenaRoom(created.nextState, command, authority)).toMatchObject({
      ok: false,
      code: 'stale',
      reason: 'command-timestamp-regression',
    });
    expect(transitionArenaRoom(created.nextState, {
      ...command,
      reason: 'host-close',
      timestamp,
    }, hostAuthority())).toMatchObject({
      ok: false,
      code: 'stale',
      reason: 'command-timestamp-regression',
    });
    expect(created.nextState.lifecycle.updatedAt).toBe(TEST_TIMESTAMP);
  });
});
