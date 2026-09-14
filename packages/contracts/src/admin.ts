import { z } from './zod';

export const AdminBatchMutationSchema=z.object({
  reason:z.string().trim().min(1).max(1000),idempotencyKey:z.string().min(1).max(100),
  items:z.array(z.record(z.string(),z.unknown())).min(1).max(100).refine(items=>items.every(item=>!Object.hasOwn(item,'reason')&&!Object.hasOwn(item,'idempotencyKey'))),
}).strict();

/** Version 1 browser-safe read resources. This is not a database table API. */
export const ADMIN_RESOURCES = [
  'dashboard', 'users', 'user-accounts', 'data-cards', 'data-card-updates',
  'tags', 'tag-aliases', 'badges', 'redemption-codes', 'messages', 'user-messages',
  'report-cases', 'report-appeals', 'crowd-review', 'inspectors', 'ratings',
  'rating-events', 'risk-audits', 'generations', 'pvp-rooms', 'large-objects',
  'analytics', 'ai-availability',
] as const;
export const AdminResourceSchema = z.enum(ADMIN_RESOURCES);
export type AdminResource = z.infer<typeof AdminResourceSchema>;

export const AdminQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).max(4096).optional(),
  id: z.string().min(1).max(512).optional(),
  q: z.string().trim().min(1).max(100).optional(),
  status: z.string().min(1).max(40).optional(),
  visibility: z.preprocess((value) => typeof value === 'string' && /^-?[01]$/.test(value) ? Number(value) : value,
    z.union([z.literal(-1), z.literal(0), z.literal(1)])).optional(),
  userId: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
}).strict();
export type AdminQuery = z.infer<typeof AdminQuerySchema>;
export type AdminValue = string | number | boolean | null;
/** Every producer explicitly allowlists fields; arbitrary database rows must never be returned. */
export type AdminRecord = Record<string, AdminValue>;
export type AdminReadResponse = {
  items: AdminRecord[];
  nextCursor: string | null;
};

const adminAiId = z.string().trim().min(1).max(128);
const adminAiVersion = z.string().regex(/^[a-f0-9]{64}$/);
export const AdminAiReviewSelectionSchema = z.object({
  providerId: adminAiId,
  modelId: z.string().trim().min(1).max(200).regex(/^[^\u0000-\u001f\u007f]+$/),
}).strict();
export type AdminAiReviewSelection = z.infer<typeof AdminAiReviewSelectionSchema>;
export const AdminAiReviewTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('card'), id: adminAiId, expectedVersion: adminAiVersion }).strict(),
  z.object({ kind: z.literal('update'), id: adminAiId, expectedVersion: adminAiVersion, cardId: adminAiId, cardVersion: adminAiVersion }).strict(),
]);
export type AdminAiReviewTarget = z.infer<typeof AdminAiReviewTargetSchema>;
export const AdminAiReviewRequestSchema = z.object({
  targets: z.array(AdminAiReviewTargetSchema).min(1).max(10).refine(targets => new Set(targets.map(target => `${target.kind}:${target.id}`)).size === targets.length),
  selection: AdminAiReviewSelectionSchema,
  apiKey: z.string().trim().min(1).max(4096).regex(/^[^\u0000-\u001f\u007f]+$/).optional(),
  reason: z.string().trim().min(1).max(1000),
  idempotencyKey: z.string().trim().min(1).max(128),
}).strict().superRefine((input, context) => {
  if ((input.selection.providerId === 'system') === (input.apiKey !== undefined)) {
    context.addIssue({ code: 'custom', message: '系统渠道不接受密钥；自定义渠道必须提供密钥', path: ['apiKey'] });
  }
});
export const AdminAiReviewContextSchema = z.object({
  id: z.string().min(1).max(140), kind: z.enum(['card', 'update']), targetId: adminAiId,
  name: z.string().max(200), expectedVersion: adminAiVersion,
  cardId: adminAiId.optional(), cardVersion: adminAiVersion.optional(),
  coverage: z.object({ contentTruncated: z.boolean(), contentParseError: z.boolean() }).strict(),
}).strict();
export type AdminAiReviewContext = z.infer<typeof AdminAiReviewContextSchema>;
export const AdminAiReviewResultSchema = z.object({
  reviews: z.array(z.object({ id: z.string().min(1).max(140), suggestion: z.enum(['approved', 'rejected']), reason: z.string().min(1).max(200) }).strict()).min(1).max(10),
  provider: z.string().min(1).max(128).nullable().default(null), model: z.string().max(200),
  usage: z.record(z.string(), z.number().int().nonnegative()).nullable(),
  contexts: z.array(AdminAiReviewContextSchema).max(10).default([]),
}).strict();
export type AdminAiReviewResult = z.infer<typeof AdminAiReviewResultSchema>;
