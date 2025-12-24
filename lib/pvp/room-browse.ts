import type { PvpRoomPhase, PvpRoomStatus } from '@/lib/d1';

export function canJoinPvpRoomFromBrowse(input: { status: PvpRoomStatus; phase: PvpRoomPhase; slotsLeft: number }): boolean {
  if (input.status !== 'open') return false;
  if (input.phase !== 'waiting' && input.phase !== 'submitting') return false;
  return Number.isFinite(input.slotsLeft) && input.slotsLeft > 0;
}

export function canSpectatePvpRoomFromBrowse(input: {
  status: PvpRoomStatus;
  phase: PvpRoomPhase;
  allowSpectators: boolean;
}): boolean {
  if (input.status !== 'open') return false;
  if (input.phase === 'closed') return false;
  return input.allowSpectators === true;
}

