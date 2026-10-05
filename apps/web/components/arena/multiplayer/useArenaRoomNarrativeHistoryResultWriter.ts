'use client';

import { useEffect, useRef } from 'react';

import type { ArenaRoomControllerState } from '@/lib/arena-room/controller';
import {
  appendArenaNarrativeHistoryResult,
  selectArenaRoomNarrativeHistoryResultWrite,
  type ArenaNarrativeHistoryResultWrite,
} from '@/lib/arena-room/narrative-history-runtime';

type NarrativeHistoryWriter = (payload: ArenaNarrativeHistoryResultWrite) => Promise<void>;

export const useArenaRoomNarrativeHistoryResultWriter = (
  state: ArenaRoomControllerState,
  write: NarrativeHistoryWriter = appendArenaNarrativeHistoryResult,
): void => {
  const lastWriteKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const payload = selectArenaRoomNarrativeHistoryResultWrite(state);
    const session = state.session;
    if (!payload || !session) return;
    const writeKey = [
      session.roomId,
      session.roomEpoch,
      payload.generationId ?? state.generation.generationRecordId ?? 'unknown',
    ].join(':');
    if (lastWriteKeyRef.current === writeKey) return;
    lastWriteKeyRef.current = writeKey;
    void write(payload);
  }, [state, write]);
};
