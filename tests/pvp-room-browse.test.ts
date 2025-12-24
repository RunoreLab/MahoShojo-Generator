import { describe, expect, it } from 'bun:test';

import { canJoinPvpRoomFromBrowse, canSpectatePvpRoomFromBrowse } from '@/lib/pvp/room-browse';

describe('pvp room browse flags', () => {
  describe('canJoinPvpRoomFromBrowse', () => {
    it('仅允许 open + waiting/submitting 且有空位的房间加入', () => {
      expect(canJoinPvpRoomFromBrowse({ status: 'open', phase: 'waiting', slotsLeft: 1 })).toBe(true);
      expect(canJoinPvpRoomFromBrowse({ status: 'open', phase: 'submitting', slotsLeft: 1 })).toBe(true);
      expect(canJoinPvpRoomFromBrowse({ status: 'open', phase: 'waiting', slotsLeft: 0 })).toBe(false);
      expect(canJoinPvpRoomFromBrowse({ status: 'open', phase: 'choosing', slotsLeft: 1 })).toBe(false);
      expect(canJoinPvpRoomFromBrowse({ status: 'closed', phase: 'waiting', slotsLeft: 1 })).toBe(false);
    });
  });

  describe('canSpectatePvpRoomFromBrowse', () => {
    it('仅允许 open + 非 closed 且开启观战的房间观战', () => {
      expect(canSpectatePvpRoomFromBrowse({ status: 'open', phase: 'choosing', allowSpectators: true })).toBe(true);
      expect(canSpectatePvpRoomFromBrowse({ status: 'open', phase: 'finished', allowSpectators: true })).toBe(true);
      expect(canSpectatePvpRoomFromBrowse({ status: 'open', phase: 'closed', allowSpectators: true })).toBe(false);
      expect(canSpectatePvpRoomFromBrowse({ status: 'open', phase: 'choosing', allowSpectators: false })).toBe(false);
      expect(canSpectatePvpRoomFromBrowse({ status: 'closed', phase: 'choosing', allowSpectators: true })).toBe(false);
    });
  });
});

