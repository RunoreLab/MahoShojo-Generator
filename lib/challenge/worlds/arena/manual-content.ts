import type { RewardOptionV1, ShopOfferV1 } from '@/lib/challenge/types';

export const ARENA_NEGATIVE_STATUS_PRIORITY = ['fatigued', 'exposed', 'shaken'] as const;

export const ARENA_BOOTSTRAP_STARTING_CURRENCY = 30;
export const ARENA_PERSISTENT_ITEM_CAPACITY = 3;
export const ARENA_CONSUMABLE_CAPACITY = 3;

export const ARENA_UNLOCK_CANDIDATE_IDS = {
  startActionOptions: ['moon-slice', 'guard-weave'],
  startPersistentItems: ['starlit-ribbon'],
} as const;

export const ARENA_STARTING_PERSISTENT_ITEM_OPTIONS = [
  {
    id: 'starlit-ribbon',
    title: '星辉缎带',
    description: '在开局时提供更稳定的节奏与光辉管理。',
  },
] as const;

const createRewardOption = (input: {
  rewardOptionId: string;
  kind: RewardOptionV1['kind'];
  label: string;
  payload: RewardOptionV1['payload'];
}): RewardOptionV1 => ({
  version: 1,
  rewardOptionId: input.rewardOptionId,
  kind: input.kind,
  label: input.label,
  payload: input.payload,
});

export const ARENA_SHOP_OFFER_TEMPLATES: ShopOfferV1[] = [
  {
    version: 1,
    offerId: 'shop-offer-ribbon',
    price: 20,
    reward: {
      ...createRewardOption({
        rewardOptionId: 'reward-ribbon',
        kind: 'add_persistent_item',
        label: '购入星辉缎带',
        payload: { itemId: 'starlit-ribbon' },
      }),
      kind: 'add_persistent_item',
    },
  },
  {
    version: 1,
    offerId: 'shop-offer-moondrop',
    price: 12,
    reward: {
      ...createRewardOption({
        rewardOptionId: 'reward-moondrop',
        kind: 'add_consumable',
        label: '购入月露结晶',
        payload: { itemId: 'moon-drop' },
      }),
      kind: 'add_consumable',
    },
  },
  {
    version: 1,
    offerId: 'shop-offer-clear-status',
    price: 10,
    reward: {
      ...createRewardOption({
        rewardOptionId: 'reward-clear-status',
        kind: 'clear_negative_status',
        label: '稳态调修',
        payload: {},
      }),
      kind: 'clear_negative_status',
    },
  },
];
