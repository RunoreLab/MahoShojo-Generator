import { ArenaMultiplayerCoreError } from './errors';
import type {
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
  readonly nextState: ArenaRoomTransitionSuccess['nextState'];
};

const transitionSnapshots = new WeakMap<object, ArenaRoomTransitionSuccess>();
const checkpointCommits = new WeakMap<object, ArenaRoomCheckpointCommitData>();

const invalidCommit = (): never => {
  throw new ArenaMultiplayerCoreError('invalid-input', 'ARENA_ROOM_CHECKPOINT_COMMIT_INVALID');
};

export const transitionSuccessInternal = (input: {
  readonly kind: ArenaRoomTransitionSuccess['kind'];
  readonly predecessor: ArenaRoomCheckpointPredecessor | null;
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
  transitionSnapshots.set(result, deepClone(result));
  return result;
};

export const createArenaRoomCheckpointCommit = (
  transition: ArenaRoomTransitionResult,
): ArenaRoomCheckpointCommit => {
  if (!transition.ok || transition.kind !== 'applied') return invalidCommit();
  const snapshot = transitionSnapshots.get(transition);
  if (!snapshot || snapshot.kind !== 'applied') return invalidCommit();
  const receipt = Object.freeze(Object.create(null)) as ArenaRoomCheckpointCommit;
  checkpointCommits.set(receipt, {
    predecessor: deepClone(snapshot.predecessor),
    nextState: deepClone(snapshot.nextState),
  });
  return receipt;
};

export const readArenaRoomCheckpointCommit = (
  receipt: ArenaRoomCheckpointCommit,
): ArenaRoomCheckpointCommitData => {
  if (typeof receipt !== 'object' || receipt === null) return invalidCommit();
  const data = checkpointCommits.get(receipt);
  if (!data) return invalidCommit();
  return deepClone(data);
};
