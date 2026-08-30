import { sql } from 'drizzle-orm';
import { aiChannelAvailabilityBuckets } from '@/lib/db/schema/ai-availability';
import { getDrizzleDbFromRuntime } from '@/lib/db/drizzle';
import { MAX_CUSTOM_AI_MODEL_ID_LENGTH } from '@/lib/ai/constants';
import { getLogger } from '@/lib/logger';

const log = getLogger('ai-availability-record');

/**
 * 将 5 分钟对齐的 bucket_start 从 ISO 时间戳转换。
 * 例: "2026-07-25T12:34:56.789Z" → "2026-07-25T12:30:00.000Z"
 */
function alignBucketStart(isoNow: string): string {
  const d = new Date(isoNow);
  const minutes = d.getUTCMinutes();
  const aligned = minutes - (minutes % 5);
  d.setUTCMinutes(aligned, 0, 0);
  return d.toISOString();
}

function truncateModelId(modelId: string): string {
  if (modelId.length > MAX_CUSTOM_AI_MODEL_ID_LENGTH) {
    return modelId.slice(0, MAX_CUSTOM_AI_MODEL_ID_LENGTH);
  }
  return modelId;
}

export type RecordOutcomeInput = {
  providerId: string;
  modelId: string;
  outcome: 'success' | 'failure' | 'excluded';
  errorClass?: string;
};

/**
 * 记录一次 AI 上游 attempt 的 outcome 到分桶表。
 * 非阻塞、fire-and-forget：失败只打日志。
 */
export async function recordAiChannelOutcome(input: RecordOutcomeInput): Promise<void> {
  try {
    const db = getDrizzleDbFromRuntime();
    if (!db) return;

    const bucketStart = alignBucketStart(new Date().toISOString());
    const modelId = truncateModelId(input.modelId);
    const now = new Date().toISOString();

    const countColumn =
      input.outcome === 'success'
        ? aiChannelAvailabilityBuckets.successCount
        : input.outcome === 'failure'
          ? aiChannelAvailabilityBuckets.failureCount
          : aiChannelAvailabilityBuckets.excludedCount;

    // UPSERT: 存在则增加计数，不存在则插入
    await db
      .insert(aiChannelAvailabilityBuckets)
      .values({
        bucketStart,
        providerId: input.providerId,
        modelId,
        successCount: input.outcome === 'success' ? 1 : 0,
        failureCount: input.outcome === 'failure' ? 1 : 0,
        excludedCount: input.outcome === 'excluded' ? 1 : 0,
        lastErrorClass: input.outcome === 'failure' ? (input.errorClass ?? null) : null,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          aiChannelAvailabilityBuckets.bucketStart,
          aiChannelAvailabilityBuckets.providerId,
          aiChannelAvailabilityBuckets.modelId,
        ],
        set: {
          [countColumn.name]: sql`${countColumn} + 1`,
          ...(input.outcome === 'failure'
            ? { lastErrorClass: input.errorClass ?? null }
            : {}),
          updatedAt: now,
        },
      });
  } catch (error) {
    // 非阻塞：记分失败不得影响生成结果
    log.debug('recordAiChannelOutcome 失败（已忽略）', { error, input });
  }
}
