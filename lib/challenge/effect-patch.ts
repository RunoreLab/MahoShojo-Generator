import type { EffectPatchV1, RunStateV1 } from '@/lib/challenge/types';

const clampTrackValue = (current: number, amount: number, max: number | null): number => {
  const next = current + amount;
  if (typeof max === 'number' && Number.isFinite(max)) {
    return Math.min(max, Math.max(0, next));
  }
  return Math.max(0, next);
};

const assertRewardSelectionShape = (effectPatch: EffectPatchV1): void => {
  if (effectPatch.rewardSelectionMode === 'none') {
    if (effectPatch.rewardOptionIds.length !== 0) {
      throw new Error('CHALLENGE_REWARD_SELECTION_INVALID:none');
    }
    return;
  }

  if (effectPatch.rewardSelectionMode === 'auto' && effectPatch.rewardOptionIds.length !== 1) {
    throw new Error('CHALLENGE_REWARD_SELECTION_INVALID:auto');
  }
  if (effectPatch.rewardSelectionMode === 'choose-one' && effectPatch.rewardOptionIds.length !== 2) {
    throw new Error('CHALLENGE_REWARD_SELECTION_INVALID:choose-one');
  }
};

export const applyEffectPatchToRunState = (
  runState: RunStateV1,
  effectPatch: EffectPatchV1,
  options?: {
    sourceNodeId?: string;
  }
): RunStateV1 => {
  if (!runState.worldState) return runState;
  assertRewardSelectionShape(effectPatch);

  const worldState = {
    ...runState.worldState,
    tracks: { ...runState.worldState.tracks },
    temporaryStatuses: [...runState.worldState.temporaryStatuses],
    runFlags: [...runState.worldState.runFlags],
    persistentItemIds: [...runState.worldState.persistentItemIds],
    consumableIds: [...runState.worldState.consumableIds],
  };

  Object.entries(effectPatch.trackDeltas).forEach(([trackId, amount]) => {
    if (!worldState.tracks[trackId]) return;
    const track = worldState.tracks[trackId];
    worldState.tracks[trackId] = {
      ...track,
      current: clampTrackValue(track.current, amount, track.max),
    };
  });

  effectPatch.removeStatuses.forEach((statusId) => {
    worldState.temporaryStatuses = worldState.temporaryStatuses.filter((item) => item !== statusId);
  });
  effectPatch.addStatuses.forEach((statusId) => {
    if (!worldState.temporaryStatuses.includes(statusId)) {
      worldState.temporaryStatuses.push(statusId);
    }
  });

  const nextRunState: RunStateV1 = {
    ...runState,
    worldState,
  };

  if (!options?.sourceNodeId || effectPatch.rewardSelectionMode === 'none' || effectPatch.rewardOptionIds.length === 0) {
    return {
      ...nextRunState,
      pendingRewardChoice: null,
    };
  }

  return {
    ...nextRunState,
    pendingRewardChoice: {
      selectionMode: effectPatch.rewardSelectionMode,
      rewardOptionIds: [...effectPatch.rewardOptionIds],
      sourceNodeId: options.sourceNodeId,
    },
  };
};
