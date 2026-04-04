import type { RewardOptionV1, WorldStateV1 } from '@/lib/challenge/types';
import {
  ARENA_CONSUMABLE_CAPACITY,
  ARENA_NEGATIVE_STATUS_PRIORITY,
  ARENA_PERSISTENT_ITEM_CAPACITY,
} from '@/lib/challenge/worlds/arena/manual-content';

const clampTrackValue = (current: number, amount: number, max: number | null): number => {
  const next = current + amount;
  if (typeof max === 'number' && Number.isFinite(max)) {
    return Math.min(max, Math.max(0, next));
  }
  return Math.max(0, next);
};

export const pickNegativeStatusToClear = (
  temporaryStatuses: string[],
  preferredStatusId?: string | null
): string | null => {
  if (typeof preferredStatusId === 'string' && preferredStatusId.trim()) {
    return temporaryStatuses.includes(preferredStatusId) ? preferredStatusId : null;
  }

  for (const statusId of ARENA_NEGATIVE_STATUS_PRIORITY) {
    if (temporaryStatuses.includes(statusId)) return statusId;
  }
  return null;
};

export const canApplyRewardOption = (worldState: WorldStateV1, rewardOption: RewardOptionV1): boolean => {
  switch (rewardOption.kind) {
    case 'add_consumable':
      return (
        typeof rewardOption.payload.itemId === 'string' &&
        !worldState.consumableIds.includes(rewardOption.payload.itemId) &&
        worldState.consumableIds.length < ARENA_CONSUMABLE_CAPACITY
      );
    case 'add_persistent_item':
      return (
        typeof rewardOption.payload.itemId === 'string' &&
        !worldState.persistentItemIds.includes(rewardOption.payload.itemId) &&
        worldState.persistentItemIds.length < ARENA_PERSISTENT_ITEM_CAPACITY
      );
    case 'clear_negative_status':
      return pickNegativeStatusToClear(worldState.temporaryStatuses, rewardOption.payload.statusId ?? null) !== null;
    default:
      return true;
  }
};

export const applyRewardOptionToWorldState = (worldState: WorldStateV1, rewardOption: RewardOptionV1): WorldStateV1 => {
  const nextWorldState: WorldStateV1 = {
    ...worldState,
    tracks: { ...worldState.tracks },
    temporaryStatuses: [...worldState.temporaryStatuses],
    persistentItemIds: [...worldState.persistentItemIds],
    consumableIds: [...worldState.consumableIds],
  };

  switch (rewardOption.kind) {
    case 'adjust_track': {
      const trackId = rewardOption.payload.trackId;
      const amount = typeof rewardOption.payload.amount === 'number' ? rewardOption.payload.amount : 0;
      if (!trackId || !nextWorldState.tracks[trackId]) return nextWorldState;
      const track = nextWorldState.tracks[trackId];
      nextWorldState.tracks[trackId] = {
        ...track,
        current: clampTrackValue(track.current, amount, track.max),
      };
      return nextWorldState;
    }
    case 'add_consumable': {
      const itemId = rewardOption.payload.itemId;
      if (
        typeof itemId === 'string' &&
        itemId &&
        !nextWorldState.consumableIds.includes(itemId) &&
        nextWorldState.consumableIds.length < ARENA_CONSUMABLE_CAPACITY
      ) {
        nextWorldState.consumableIds.push(itemId);
      }
      return nextWorldState;
    }
    case 'add_persistent_item': {
      const itemId = rewardOption.payload.itemId;
      if (
        typeof itemId === 'string' &&
        itemId &&
        !nextWorldState.persistentItemIds.includes(itemId) &&
        nextWorldState.persistentItemIds.length < ARENA_PERSISTENT_ITEM_CAPACITY
      ) {
        nextWorldState.persistentItemIds.push(itemId);
      }
      return nextWorldState;
    }
    case 'add_status': {
      const statusId = rewardOption.payload.statusId;
      if (typeof statusId === 'string' && statusId && !nextWorldState.temporaryStatuses.includes(statusId)) {
        nextWorldState.temporaryStatuses.push(statusId);
      }
      return nextWorldState;
    }
    case 'clear_negative_status': {
      const statusId = pickNegativeStatusToClear(nextWorldState.temporaryStatuses, rewardOption.payload.statusId ?? null);
      if (!statusId) return nextWorldState;
      nextWorldState.temporaryStatuses = nextWorldState.temporaryStatuses.filter((item) => item !== statusId);
      return nextWorldState;
    }
  }
};
