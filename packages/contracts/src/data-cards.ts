import { z } from 'zod';

export const ONLINE_DATA_CARD_TYPES = [
  'character',
  'scenario',
  'history',
  'questionnaire',
] as const;

export const OnlineDataCardTypeSchema = z.enum(ONLINE_DATA_CARD_TYPES);
export type OnlineDataCardType = z.infer<typeof OnlineDataCardTypeSchema>;

export const DATA_CARD_REVIEW_STATUSES = ['pending', 'approved', 'rejected'] as const;

export const DataCardReviewStatusSchema = z.enum(DATA_CARD_REVIEW_STATUSES);
export type DataCardReviewStatus = z.infer<typeof DataCardReviewStatusSchema>;

export const ONLINE_DATA_CARD_VISIBILITIES = [-1, 0, 1] as const;

export const OnlineDataCardVisibilitySchema = z.union([
  z.literal(-1),
  z.literal(0),
  z.literal(1),
]);
export type OnlineDataCardVisibility = z.infer<typeof OnlineDataCardVisibilitySchema>;
