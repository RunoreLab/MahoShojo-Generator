import { z } from './zod';

export const ONLINE_DATA_CARD_TYPES = [
  'character',
  'scenario',
  'history',
  'questionnaire',
] as const;

export const OnlineDataCardTypeSchema = z.enum(ONLINE_DATA_CARD_TYPES);
export type OnlineDataCardType = z.infer<typeof OnlineDataCardTypeSchema>;

export const RepairQuestionnaireDataCardTypeRequestSchema = z.object({
  id: z.string().trim().min(1).max(200),
}).strict();
export type RepairQuestionnaireDataCardTypeRequest = z.infer<typeof RepairQuestionnaireDataCardTypeRequestSchema>;

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

// 摘要查询为增量模式；未指定 view 的旧调用方仍使用完整列表契约。
export const DataCardSummaryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(24).default(12),
  offset: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER - 24).default(0),
  search: z.string().trim().max(200).optional(),
  sortBy: z.enum(['updated_at', 'created_at', 'likes', 'usage', 'favorites', 'favorited_at']).default('updated_at'),
  types: z.array(OnlineDataCardTypeSchema).max(4).optional(),
  visibility: z.enum(['private', 'public', 'banned']).optional(),
  roleType: z.enum(['magical-girl', 'canshou', 'general']).optional(),
  author: z.string().trim().max(200).optional(),
  minLikes: z.coerce.number().int().min(0).optional(),
  maxLikes: z.coerce.number().int().min(0).optional(),
  minUsage: z.coerce.number().int().min(0).optional(),
  maxUsage: z.coerce.number().int().min(0).optional(),
  minFavorites: z.coerce.number().int().min(0).optional(),
  maxFavorites: z.coerce.number().int().min(0).optional(),
  tagIds: z.array(z.string().min(1).max(100)).max(30).optional(),
  tagMatch: z.enum(['any', 'all']).default('any'),
  nativeOnly: z.boolean().default(false),
  nativeAllowedOnly: z.boolean().default(false),
  recommendedOnly: z.boolean().default(false),
  includeLegacyQuestionnaires: z.boolean().default(false),
});
export type DataCardSummaryQuery = z.infer<typeof DataCardSummaryQuerySchema>;
export type DataCardSummaryQueryInput = z.input<typeof DataCardSummaryQuerySchema>;

export const DataCardSummarySchema = z.object({
  id: z.string(), user_id: z.number().int(), type: OnlineDataCardTypeSchema,
  name: z.string(), description: z.string().nullable(),
  is_public: OnlineDataCardVisibilitySchema, review_status: z.string().nullable(),
  created_at: z.string().nullable(), updated_at: z.string().nullable(),
  usage_count: z.number(), like_count: z.number(), favorite_count: z.number(),
  is_recommended: z.number(), username: z.string(),
  roleType: z.enum(['magical-girl', 'canshou', 'general']).nullable(),
  nativeAllowed: z.boolean(), has_pending_update: z.boolean(),
  tag_ids: z.array(z.string()), favorited_at: z.string().nullable(),
  isLegacyQuestionnaire: z.boolean().optional(),
});
export type DataCardSummary = z.infer<typeof DataCardSummarySchema>;
export const DataCardSummaryPageSchema = z.object({
  success: z.literal(true), cards: z.array(DataCardSummarySchema),
  total: z.number().int().nonnegative(), nextOffset: z.number().int().nonnegative().nullable(),
  stats: z.object({ private: z.number(), public: z.number(), pending: z.number() }).optional(),
});
export type DataCardSummaryPage = z.infer<typeof DataCardSummaryPageSchema>;
