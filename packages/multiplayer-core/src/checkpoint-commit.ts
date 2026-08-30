import { ArenaMultiplayerCoreError } from './errors';
import type {
  ArenaRoomAuthorityState,
  ArenaRoomCheckpointPredecessor,
  ArenaRoomTransitionResult,
  ArenaRoomTransitionSuccess,
} from './state-machine-model';
import { deepClone } from './utils';

declare const ArenaRoomCheckpointCommitBrand: unique symbol;

export type ArenaRoomCheckpointCommit = {
  readonly [ArenaRoomCheckpointCommitBrand]: true;
};

export type ArenaRoomCheckpointCommitData = {
  readonly predecessor: ArenaRoomCheckpointPredecessor | null;
  readonly predecessorState: ArenaRoomAuthorityState | null;
  readonly nextState: ArenaRoomTransitionSuccess['nextState'];
};

type TransitionSnapshot = {
  readonly result: ArenaRoomTransitionSuccess;
  readonly predecessorState: ArenaRoomAuthorityState | null;
};

const transitionSnapshots = new WeakMap<object, TransitionSnapshot>();
const checkpointCommits = new WeakMap<object, ArenaRoomCheckpointCommitData>();

const invalidCommit = (): never => {
  throw new ArenaMultiplayerCoreError('invalid-input', 'ARENA_ROOM_CHECKPOINT_COMMIT_INVALID');
};

export const transitionSuccessInternal = (input: {
  readonly kind: ArenaRoomTransitionSuccess['kind'];
  readonly predecessor: ArenaRoomCheckpointPredecessor | null;
  readonly predecessorState: ArenaRoomAuthorityState | null;
  readonly nextState: ArenaRoomTransitionSuccess['nextState'];
  readonly events?: ArenaRoomTransitionSuccess['events'];
}): ArenaRoomTransitionSuccess => {
  const result: ArenaRoomTransitionSuccess = {
    ok: true,
    kind: input.kind,
    predecessor: input.predecessor,
    nextState: input.nextState,
    events: input.events ?? [],
  };
  transitionSnapshots.set(result, {
    result: deepClone(result),
    predecessorState: deepClone(input.predecessorState),
  });
  return result;
};

export const createArenaRoomCheckpointCommit = (
  transition: ArenaRoomTransitionResult,
): ArenaRoomCheckpointCommit => {
  if (!transition.ok || transition.kind !== 'applied') return invalidCommit();
  const snapshot = transitionSnapshots.get(transition);
  if (!snapshot || snapshot.result.kind !== 'applied') return invalidCommit();
  transitionSnapshots.delete(transition);
  const receipt = Object.freeze(Object.create(null)) as ArenaRoomCheckpointCommit;
  checkpointCommits.set(receipt, {
    predecessor: deepClone(snapshot.result.predecessor),
    predecessorState: deepClone(snapshot.predecessorState),
    nextState: deepClone(snapshot.result.nextState),
  });
  return receipt;
};

export const consumeArenaRoomCheckpointCommit = (
  receipt: ArenaRoomCheckpointCommit,
): ArenaRoomCheckpointCommitData => {
  if (typeof receipt !== 'object' || receipt === null) return invalidCommit();
  const data = checkpointCommits.get(receipt);
  if (!data) return invalidCommit();
  checkpointCommits.delete(receipt);
  return deepClone(data);
};
