import { gte, sql } from 'drizzle-orm';
import { aiChannelAvailabilityBuckets, aiChannelAvailabilitySnapshot } from '@/lib/db/schema/ai-availability';
import { getDrizzleDbFromRuntime, type AppDrizzleDb } from '@/lib/db/drizzle';
import { AI_PROVIDER_CATALOG } from '@/lib/ai/constants';
import { getLogger } from '@/lib/logger';

const log = getLogger('ai-availability-snapshot');

// --- 常量 ---

const SNAPSHOT_TTL_SECONDS = 120;
const MIN_SAMPLE_COUNT = 3;
const MAX_CUSTOM_ENTRIES = 200;

// Worker isolate 内 single-flight：过期快照并发命中时只允许一次 D1 扫描/写入。
let rebuildInFlight: Promise<ChannelAvailabilityResponse> | null = null;

// --- 类型 ---

export type AvailabilityStatus = 'healthy' | 'degraded' | 'poor' | 'unknown';

type AvailabilityWindowRate = {
  window: '1h' | '24h' | 'none';
  successRate: number | null;
  status: AvailabilityStatus;
};

export type ChannelAvailabilityEntry = {
  providerId: string;
  modelId: string;
  primary: AvailabilityWindowRate;
  reference?: {
    window: '24h';
    successRate: number;
    status: Exclude<AvailabilityStatus, 'unknown'>;
  };
};

export type ChannelAvailabilityResponse = {
  success: true;
  generatedAt: string;
  windows: {
    '1h': { durationSeconds: number };
    '24h': { durationSeconds: number };
  };
  minSampleCount: number;
  entries: ChannelAvailabilityEntry[];
  stale?: boolean;
};

// --- 工具函数 ---

function getStatus(rate: number): AvailabilityStatus {
  if (rate >= 0.90) return 'healthy';
  if (rate >= 0.70) return 'degraded';
  return 'poor';
}

function computeRate(success: number, failure: number): { rate: number | null; sampleCount: number } {
  const sampleCount = success + failure;
  if (sampleCount < MIN_SAMPLE_COUNT) return { rate: null, sampleCount };
  return { rate: success / sampleCount, sampleCount };
}

type BucketAgg = {
  providerId: string;
  modelId: string;
  success1h: number;
  failure1h: number;
  success24h: number;
  failure24h: number;
};

function aggregateBuckets(
  buckets: {
    bucketStart: string;
    providerId: string;
    modelId: string;
    successCount: number;
    failureCount: number;
  }[],
  cutoff1h: string,
): Map<string, BucketAgg> {
  const map = new Map<string, BucketAgg>();

  for (const row of buckets) {
    const key = `${row.providerId}:${row.modelId}`;
    let agg = map.get(key);
    if (!agg) {
      agg = {
        providerId: row.providerId,
        modelId: row.modelId,
        success1h: 0,
        failure1h: 0,
        success24h: 0,
        failure24h: 0,
      };
      map.set(key, agg);
    }
    agg.success24h += row.successCount;
    agg.failure24h += row.failureCount;
    if (row.bucketStart >= cutoff1h) {
      agg.success1h += row.successCount;
      agg.failure1h += row.failureCount;
    }
  }

  return map;
}

function buildEntry(agg: BucketAgg): ChannelAvailabilityEntry {
  const { rate: rate1h, sampleCount: sample1h } = computeRate(agg.success1h, agg.failure1h);
  const { rate: rate24h, sampleCount: sample24h } = computeRate(agg.success24h, agg.failure24h);

  let primary: AvailabilityWindowRate;
  let reference: ChannelAvailabilityEntry['reference'];

  if (rate1h !== null && sample1h >= MIN_SAMPLE_COUNT) {
    primary = { window: '1h', successRate: rate1h, status: getStatus(rate1h) };
    // 1h 有效时，如果 24h 也有效，可以附带参考（但 spec 说仅当 primary 非近 1h 有效时附带）
    // 这里不附带，保持 spec 语义
  } else if (rate24h !== null && sample24h >= MIN_SAMPLE_COUNT) {
    primary = { window: 'none', successRate: null, status: 'unknown' };
    reference = {
      window: '24h',
      successRate: rate24h,
      status: getStatus(rate24h) as Exclude<AvailabilityStatus, 'unknown'>,
    };
  } else {
    primary = { window: 'none', successRate: null, status: 'unknown' };
  }

  return {
    providerId: agg.providerId,
    modelId: agg.modelId,
    primary,
    reference,
  };
}

// --- 重建 ---

async function rebuildFromBuckets(db: AppDrizzleDb): Promise<ChannelAvailabilityResponse> {
  const now = new Date();
  const cutoff24h = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const cutoff1h = new Date(now.getTime() - 60 * 60 * 1000).toISOString();

  // 读取近 24h 的桶
  const rows = await db
    .select({
      bucketStart: aiChannelAvailabilityBuckets.bucketStart,
      providerId: aiChannelAvailabilityBuckets.providerId,
      modelId: aiChannelAvailabilityBuckets.modelId,
      successCount: aiChannelAvailabilityBuckets.successCount,
      failureCount: aiChannelAvailabilityBuckets.failureCount,
    })
    .from(aiChannelAvailabilityBuckets)
    .where(gte(aiChannelAvailabilityBuckets.bucketStart, cutoff24h));

  const aggMap = aggregateBuckets(rows, cutoff1h);

  // 构建 catalog 全量 entries
  const catalogEntries: ChannelAvailabilityEntry[] = [];
  const catalogKeys = new Set<string>();

  for (const provider of AI_PROVIDER_CATALOG) {
    for (const model of provider.models) {
      const key = `${provider.id}:${model.value}`;
      catalogKeys.add(key);
      const agg = aggMap.get(key);
      catalogEntries.push(
        agg
          ? buildEntry(agg)
          : {
              providerId: provider.id,
              modelId: model.value,
              primary: { window: 'none', successRate: null, status: 'unknown' },
            },
      );
    }
  }

  // 收集自定义 model（不在 catalog 中，但 24h 有样本）
  const customEntriesWithSamples: { entry: ChannelAvailabilityEntry; totalSamples: number }[] = [];
  for (const [key, agg] of aggMap) {
    if (catalogKeys.has(key)) continue;
    const totalSamples = agg.success24h + agg.failure24h;
    if (totalSamples < MIN_SAMPLE_COUNT) continue;
    customEntriesWithSamples.push({ entry: buildEntry(agg), totalSamples });
  }

  // 按样本数降序，硬顶 MAX_CUSTOM_ENTRIES
  customEntriesWithSamples.sort((a, b) => b.totalSamples - a.totalSamples);
  const trimmedCustom = customEntriesWithSamples.slice(0, MAX_CUSTOM_ENTRIES).map(item => item.entry);

  const sourceBucketMax = rows.length > 0
    ? rows.reduce((max, r) => (r.bucketStart > max ? r.bucketStart : max), rows[0].bucketStart)
    : null;

  const payload: ChannelAvailabilityResponse = {
    success: true,
    generatedAt: now.toISOString(),
    windows: {
      '1h': { durationSeconds: 3600 },
      '24h': { durationSeconds: 86400 },
    },
    minSampleCount: MIN_SAMPLE_COUNT,
    entries: [...catalogEntries, ...trimmedCustom],
  };

  // 写入 snapshot
  try {
    await db
      .insert(aiChannelAvailabilitySnapshot)
      .values({
        id: 'default',
        payloadJson: JSON.stringify(payload),
        updatedAt: now.toISOString(),
        sourceBucketMax,
      })
      .onConflictDoUpdate({
        target: aiChannelAvailabilitySnapshot.id,
        set: {
          payloadJson: JSON.stringify(payload),
          updatedAt: now.toISOString(),
          sourceBucketMax,
        },
      });
  } catch (error) {
    log.debug('快照写入失败（已忽略）', { error });
  }

  return payload;
}

// --- 公开 API ---

/**
 * 读取或惰性重建可用性快照。
 * 返回快照数据；若无有效快照则返回全 unknown 响应。
 */
export async function rebuildSnapshot(): Promise<ChannelAvailabilityResponse> {
  const db = getDrizzleDbFromRuntime();
  if (!db) {
    return buildEmptyResponse();
  }

  // 尝试读取现有快照
  try {
    const [row] = await db
      .select()
      .from(aiChannelAvailabilitySnapshot)
      .where(sql`${aiChannelAvailabilitySnapshot.id} = 'default'`)
      .limit(1);

    if (row) {
      const age = Date.now() - new Date(row.updatedAt).getTime();
      if (age < SNAPSHOT_TTL_SECONDS * 1000) {
        // 快照有效
        try {
          return JSON.parse(row.payloadJson) as ChannelAvailabilityResponse;
        } catch {
          // 解析失败，重建
        }
      }
      // 快照过期，惰性重建
      return rebuildSnapshotFromBuckets(db);
    }
  } catch (error) {
    log.debug('读取快照失败', { error });
  }

  // 无快照，重建
  return rebuildSnapshotFromBuckets(db);
}

function rebuildSnapshotFromBuckets(db: AppDrizzleDb): Promise<ChannelAvailabilityResponse> {
  if (rebuildInFlight) return rebuildInFlight;
  rebuildInFlight = rebuildFromBuckets(db).finally(() => {
    rebuildInFlight = null;
  });
  return rebuildInFlight;
}

function buildEmptyResponse(): ChannelAvailabilityResponse {
  return {
    success: true,
    generatedAt: new Date().toISOString(),
    windows: {
      '1h': { durationSeconds: 3600 },
      '24h': { durationSeconds: 86400 },
    },
    minSampleCount: MIN_SAMPLE_COUNT,
    entries: [],
  };
}
