import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * AI 渠道可用性分桶计数（5 分钟粒度）。
 * 主键 (bucket_start, provider_id, model_id)。
 */
export const aiChannelAvailabilityBuckets = sqliteTable(
  'ai_channel_availability_buckets',
  {
    bucketStart: text('bucket_start').notNull(),
    providerId: text('provider_id').notNull(),
    modelId: text('model_id').notNull(),
    successCount: integer('success_count').notNull().default(0),
    failureCount: integer('failure_count').notNull().default(0),
    excludedCount: integer('excluded_count').notNull().default(0),
    lastErrorClass: text('last_error_class'),
    updatedAt: text('updated_at').notNull().default(''),
  },
  (table) => [
    primaryKey({
      columns: [table.bucketStart, table.providerId, table.modelId],
    }),
    index('idx_availability_buckets_scan').on(table.bucketStart),
  ],
);

/**
 * AI 渠道可用性快照（单行，id 固定 'default'）。
 * 由读 API 惰性重建，避免每次请求扫桶表。
 */
export const aiChannelAvailabilitySnapshot = sqliteTable(
  'ai_channel_availability_snapshot',
  {
    id: text('id').primaryKey().default('default'),
    payloadJson: text('payload_json').notNull(),
    updatedAt: text('updated_at').notNull().default(''),
    sourceBucketMax: text('source_bucket_max'),
  },
);
