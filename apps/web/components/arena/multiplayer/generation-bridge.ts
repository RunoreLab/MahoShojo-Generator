import type { ArenaRoomSharedConfig } from '@mahoshojo/contracts/arena-room';

import type {
  ArenaRoomController,
  ArenaRoomControllerState,
} from '@/lib/arena-room/controller';

export type ArenaRoomGenerationAction = {
  readonly inRoom: boolean;
  readonly canStart: boolean;
  readonly canRetry: boolean;
  readonly reason: 'active' | 'connection' | 'member' | 'recovery' | 'unknown' | null;
};

export const resolveArenaRoomGenerationAction = (
  state: ArenaRoomControllerState,
): ArenaRoomGenerationAction => {
  const session = state.session;
  if (!session) return { inRoom: false, canStart: true, canRetry: false, reason: null };
  if (session.self.role !== 'host') {
    return { inRoom: true, canStart: false, canRetry: false, reason: 'member' };
  }
  if (state.phase !== 'connected') {
    return { inRoom: true, canStart: false, canRetry: false, reason: 'connection' };
  }
  const retryableUnknown = state.generation.startResultUnknown
    && state.generation.phase === 'unknown'
    && state.generation.pendingRequestId !== null;
  const retryableNotFound = state.generation.phase === 'unavailable'
    && state.generation.mirror?.state === 'starting'
    && state.generation.pendingRequestId === state.generation.mirror.generationRequestId;
  if (retryableUnknown || retryableNotFound) {
    return { inRoom: true, canStart: false, canRetry: true, reason: 'recovery' };
  }
  if (
    state.generation.mirror?.state === 'starting'
    || state.generation.mirror?.state === 'running'
  ) {
    return { inRoom: true, canStart: false, canRetry: false, reason: 'unknown' };
  }
  if (state.generation.startResultUnknown || state.generation.phase === 'unknown') {
    return { inRoom: true, canStart: false, canRetry: false, reason: 'unknown' };
  }
  if (['starting', 'running', 'resyncing'].includes(state.generation.phase)) {
    return { inRoom: true, canStart: false, canRetry: false, reason: 'active' };
  }
  return { inRoom: true, canStart: true, canRetry: false, reason: null };
};

export const dispatchArenaRoomGenerationRetry = async (options: {
  readonly controller: ArenaRoomController;
  readonly state: ArenaRoomControllerState;
}): Promise<'blocked' | 'stale' | 'submitted'> => {
  const captured = options.state.session;
  if (!captured || !resolveArenaRoomGenerationAction(options.state).canRetry) return 'blocked';
  const current = options.controller.getSnapshot();
  if (
    !current.session
    || current.session.roomId !== captured.roomId
    || current.session.roomEpoch !== captured.roomEpoch
    || current.session.self.userId !== captured.self.userId
    || !resolveArenaRoomGenerationAction(current).canRetry
  ) return 'stale';
  await options.controller.retryGenerationStart();
  return 'submitted';
};

type DispatchArenaRoomGenerationStartOptions = {
  readonly controller: ArenaRoomController;
  readonly state: ArenaRoomControllerState;
  readonly sharedConfig: ArenaRoomSharedConfig;
  readonly generationRequestId: string;
  /** Request-scoped full payload; this function never stores it in Room state. */
  readonly generation: Record<string, unknown>;
};

export const dispatchArenaRoomGenerationStart = async (
  options: DispatchArenaRoomGenerationStartOptions,
): Promise<'blocked' | 'stale' | 'submitted'> => {
  const captured = options.state.session;
  if (!captured || !resolveArenaRoomGenerationAction(options.state).canStart) {
    return 'blocked';
  }

  // Shared-config construction can hash local data asynchronously. Re-fence the
  // authority tuple before allowing the request-scoped full payload to leave.
  const currentState = options.controller.getSnapshot();
  const current = currentState.session;
  if (
    !current
    || !resolveArenaRoomGenerationAction(currentState).canStart
    || current.roomId !== captured.roomId
    || current.roomEpoch !== captured.roomEpoch
    || current.snapshot.revision !== captured.snapshot.revision
    || current.self.userId !== captured.self.userId
  ) {
    return 'stale';
  }

  await options.controller.startGeneration({
    expectedRoomEpoch: captured.roomEpoch,
    expectedRevision: captured.snapshot.revision,
    generationRequestId: options.generationRequestId,
    sharedConfig: options.sharedConfig,
    generation: options.generation,
  });
  return 'submitted';
};
