export type ArenaRoomActorOperation = 'command' | 'story';

export type ArenaRoomActorOperationOutcome = 'applied' | 'idempotent' | 'rejected' | 'error';

export type ArenaRoomCheckpointOperation = 'load' | 'save' | 'refresh' | 'expire' | 'delete';

export type ArenaRoomCheckpointOutcome =
  | 'ok'
  | 'missing'
  | 'conflict'
  | 'error'
  | 'unavailable';

export type ArenaRoomSyncMode = 'current' | 'replay' | 'snapshot';

export type ArenaRoomPublisherOutcome = 'published' | 'rejected' | 'dropped' | 'error';

export type ArenaRoomIncidentOutcome =
  | 'created'
  | 'recovered'
  | 'fenced'
  | 'quarantined'
  | 'replacement_required';

export type ArenaRoomRuntimeObservation =
  | {
    event: 'registry';
    activeRooms: number;
    residentActors: number;
  }
  | {
    event: 'actor_queue';
    queuedCurrent: number;
    roomQueuedCurrent: number;
    overloaded: boolean;
  }
  | {
    event: 'actor_operation';
    operation: ArenaRoomActorOperation;
    outcome: ArenaRoomActorOperationOutcome;
    durationMs: number;
  }
  | {
    event: 'checkpoint';
    operation: ArenaRoomCheckpointOperation;
    outcome: ArenaRoomCheckpointOutcome;
    serializedBytes?: number;
    durationMs: number;
  }
  | { event: 'socket'; action: 'opened' | 'closed' }
  | { event: 'socket_backlog'; queuedFrames: number; queuedBytes: number }
  | { event: 'slow_consumer_resync_close' }
  | { event: 'sync'; action: 'reconnect_attempt' }
  | { event: 'sync'; action: 'membership_rejected' | 'authority_fenced' | 'authority_unavailable' }
  | { event: 'sync'; action: 'delivery'; mode: ArenaRoomSyncMode }
  | { event: 'sync'; action: 'resync_requested' | 'resync_required' }
  | { event: 'publisher'; action: 'started' | 'finished' }
  | { event: 'publisher_backlog'; inFlightCurrent: number }
  | { event: 'publisher_outcome'; outcome: ArenaRoomPublisherOutcome }
  | { event: 'incident'; outcome: ArenaRoomIncidentOutcome };

export interface ArenaRoomRuntimeObserver {
  observeArenaRoomRuntime(
    _observation: ArenaRoomRuntimeObservation,
  ): void | PromiseLike<void>;
}

export const noopArenaRoomRuntimeObserver: ArenaRoomRuntimeObserver = Object.freeze({
  observeArenaRoomRuntime: () => undefined,
});

export const observeArenaRoomRuntime = (
  observer: ArenaRoomRuntimeObserver | null | undefined,
  observation: ArenaRoomRuntimeObservation,
): void => {
  try {
    const result = observer?.observeArenaRoomRuntime(observation);
    if (result && typeof result.then === 'function') {
      void result.then(undefined, () => undefined);
    }
  } catch {
    // Telemetry failures must never alter Room authority behavior or resource cleanup.
  }
};
