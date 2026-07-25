import { queryFromD1 } from '@/lib/database/core';
import { rebuildSnapshot } from '@/lib/ai/availability';

export const runtime = 'edge';

// --- Helpers ---

const readRows = <T>(result: unknown): T[] => {
  const rows = (result as { result?: Array<{ results?: T[] }> })?.result?.[0]?.results;
  return Array.isArray(rows) ? rows : [];
};

const readFirstRow = <T>(result: unknown): T | null => {
  const rows = readRows<T>(result);
  return rows.length > 0 ? rows[0] : null;
};

const readInt = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.floor(value);
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.floor(parsed);
  }
  return 0;
};

const json = (payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

// --- Types ---

type SummaryRow = {
  total_providers: number;
  total_models: number;
  total_buckets: number;
  total_success: number;
  total_failure: number;
  total_excluded: number;
  earliest_bucket: string | null;
  latest_bucket: string | null;
};

type BucketRow = {
  bucket_start: string;
  provider_id: string;
  model_id: string;
  success_count: number;
  failure_count: number;
  excluded_count: number;
  last_error_class: string | null;
  updated_at: string;
};

type ErrorDistRow = {
  last_error_class: string;
  count: number;
};

type SnapshotInfoRow = {
  updated_at: string;
  source_bucket_max: string | null;
};

// --- Availability logic (inline, admin-specific — exposes more detail than public API) ---

const MIN_SAMPLE_COUNT = 3;

function getStatus(rate: number): 'healthy' | 'degraded' | 'poor' {
  if (rate >= 0.90) return 'healthy';
  if (rate >= 0.70) return 'degraded';
  return 'poor';
}

type ChannelAgg = {
  providerId: string;
  modelId: string;
  success1h: number;
  failure1h: number;
  excluded1h: number;
  success24h: number;
  failure24h: number;
  excluded24h: number;
  lastErrorClass: string | null;
};

function aggregateChannels(buckets: BucketRow[], cutoff1h: string): ChannelAgg[] {
  const map = new Map<string, ChannelAgg>();

  for (const row of buckets) {
    const key = `${row.provider_id}:${row.model_id}`;
    let agg = map.get(key);
    if (!agg) {
      agg = {
        providerId: row.provider_id,
        modelId: row.model_id,
        success1h: 0,
        failure1h: 0,
        excluded1h: 0,
        success24h: 0,
        failure24h: 0,
        excluded24h: 0,
        lastErrorClass: null,
      };
      map.set(key, agg);
    }
    agg.success24h += row.success_count;
    agg.failure24h += row.failure_count;
    agg.excluded24h += row.excluded_count;
    if (row.bucket_start >= cutoff1h) {
      agg.success1h += row.success_count;
      agg.failure1h += row.failure_count;
      agg.excluded1h += row.excluded_count;
    }
    if (row.failure_count > 0 && row.last_error_class) {
      agg.lastErrorClass = row.last_error_class;
    }
  }

  return Array.from(map.values());
}

function computeRateAndStatus(success: number, failure: number): { rate: number | null; status: string; sampleCount: number } {
  const sampleCount = success + failure;
  if (sampleCount < MIN_SAMPLE_COUNT) return { rate: null, status: 'unknown', sampleCount };
  const rate = success / sampleCount;
  return { rate, status: getStatus(rate), sampleCount };
}

// --- Handlers ---

async function handleGet(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const view = url.searchParams.get('view');

  if (view === 'buckets') {
    return handleGetBuckets(url);
  }
  return handleGetSummary();
}

async function handleGetSummary(): Promise<Response> {
  const now = new Date();
  const cutoff24h = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const cutoff1h = new Date(now.getTime() - 60 * 60 * 1000).toISOString();

  const [summaryResult, bucketsResult, errorDistResult, snapshotResult] = await Promise.all([
    queryFromD1(`
      SELECT
        COUNT(DISTINCT provider_id) AS total_providers,
        COUNT(DISTINCT model_id) AS total_models,
        COUNT(*) AS total_buckets,
        COALESCE(SUM(success_count), 0) AS total_success,
        COALESCE(SUM(failure_count), 0) AS total_failure,
        COALESCE(SUM(excluded_count), 0) AS total_excluded,
        MIN(bucket_start) AS earliest_bucket,
        MAX(bucket_start) AS latest_bucket
      FROM ai_channel_availability_buckets
    `),
    queryFromD1(`
      SELECT provider_id, model_id, bucket_start, success_count, failure_count, excluded_count, last_error_class
      FROM ai_channel_availability_buckets
      WHERE bucket_start >= ?
    `, [cutoff24h]),
    queryFromD1(`
      SELECT last_error_class, SUM(failure_count) AS count
      FROM ai_channel_availability_buckets
      WHERE failure_count > 0 AND last_error_class IS NOT NULL AND bucket_start >= ?
      GROUP BY last_error_class
      ORDER BY count DESC
    `, [cutoff24h]),
    queryFromD1(`
      SELECT updated_at, source_bucket_max FROM ai_channel_availability_snapshot WHERE id = 'default'
    `),
  ]);

  const summary = readFirstRow<SummaryRow>(summaryResult);
  const buckets = readRows<BucketRow>(bucketsResult);
  const errorDist = readRows<ErrorDistRow>(errorDistResult);
  const snapshotInfo = readFirstRow<SnapshotInfoRow>(snapshotResult);

  const totalSuccess = summary?.total_success ?? 0;
  const totalFailure = summary?.total_failure ?? 0;
  const overallSampleCount = totalSuccess + totalFailure;

  const channelAggs = aggregateChannels(buckets, cutoff1h);
  const channels = channelAggs.map((agg) => {
    const h1 = computeRateAndStatus(agg.success1h, agg.failure1h);
    const h24 = computeRateAndStatus(agg.success24h, agg.failure24h);
    return {
      providerId: agg.providerId,
      modelId: agg.modelId,
      success1h: agg.success1h,
      failure1h: agg.failure1h,
      excluded1h: agg.excluded1h,
      successRate1h: h1.rate,
      status1h: h1.status,
      sampleCount1h: h1.sampleCount,
      success24h: agg.success24h,
      failure24h: agg.failure24h,
      excluded24h: agg.excluded24h,
      successRate24h: h24.rate,
      status24h: h24.status,
      sampleCount24h: h24.sampleCount,
      lastErrorClass: agg.lastErrorClass,
    };
  });

  // Sort: healthy > degraded > poor > unknown; within same status sort by 24h rate desc
  const statusOrder: Record<string, number> = { healthy: 0, degraded: 1, poor: 2, unknown: 3 };
  channels.sort((a, b) => {
    const sa = statusOrder[a.status1h] ?? 3;
    const sb = statusOrder[b.status1h] ?? 3;
    if (sa !== sb) return sa - sb;
    const ra = a.successRate24h ?? -1;
    const rb = b.successRate24h ?? -1;
    return rb - ra;
  });

  return json({
    success: true,
    view: 'summary',
    summary: {
      totalProviders: summary?.total_providers ?? 0,
      totalModels: summary?.total_models ?? 0,
      totalBuckets: summary?.total_buckets ?? 0,
      totalSuccess,
      totalFailure,
      totalExcluded: summary?.total_excluded ?? 0,
      overallSuccessRate: overallSampleCount >= MIN_SAMPLE_COUNT ? totalSuccess / overallSampleCount : null,
      earliestBucket: summary?.earliest_bucket ?? null,
      latestBucket: summary?.latest_bucket ?? null,
      snapshotUpdatedAt: snapshotInfo?.updated_at ?? null,
      snapshotSourceBucketMax: snapshotInfo?.source_bucket_max ?? null,
    },
    channels,
    errorDistribution: errorDist.map((r) => ({ errorClass: r.last_error_class, count: r.count })),
  });
}

async function handleGetBuckets(url: URL): Promise<Response> {
  const provider = url.searchParams.get('provider');
  const model = url.searchParams.get('model');
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const page = Math.max(1, readInt(url.searchParams.get('page')) || 1);
  const limit = Math.min(200, Math.max(1, readInt(url.searchParams.get('limit')) || 50));
  const offset = (page - 1) * limit;

  const whereParts: string[] = [];
  const params: unknown[] = [];

  if (provider) {
    whereParts.push('provider_id = ?');
    params.push(provider);
  }
  if (model) {
    whereParts.push('model_id LIKE ?');
    params.push(`%${model}%`);
  }
  if (from) {
    whereParts.push('bucket_start >= ?');
    params.push(from);
  }
  if (to) {
    whereParts.push('bucket_start < ?');
    params.push(to);
  }

  const whereSql = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : '';

  const [countResult, dataResult] = await Promise.all([
    queryFromD1(
      `SELECT COUNT(*) AS total FROM ai_channel_availability_buckets ${whereSql}`,
      params,
    ),
    queryFromD1(
      `SELECT bucket_start, provider_id, model_id, success_count, failure_count, excluded_count, last_error_class, updated_at
       FROM ai_channel_availability_buckets ${whereSql}
       ORDER BY bucket_start DESC, provider_id, model_id
       LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    ),
  ]);

  const total = readFirstRow<{ total: number }>(countResult)?.total ?? 0;
  const rows = readRows<BucketRow>(dataResult);
  const totalPages = Math.ceil(total / limit);

  return json({
    success: true,
    view: 'buckets',
    rows: rows.map((r) => ({
      bucketStart: r.bucket_start,
      providerId: r.provider_id,
      modelId: r.model_id,
      successCount: r.success_count,
      failureCount: r.failure_count,
      excludedCount: r.excluded_count,
      lastErrorClass: r.last_error_class,
      updatedAt: r.updated_at,
    })),
    total,
    page,
    limit,
    totalPages,
  });
}

async function handlePost(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ success: false, error: '无效的 JSON 请求体' }, 400);
  }

  const { action } = (body ?? {}) as { action?: string };

  if (action === 'cleanup') {
    return handleCleanup(body as { olderThanDays?: number });
  }
  if (action === 'refresh-snapshot') {
    return handleRefreshSnapshot();
  }

  return json({ success: false, error: `未知 action: ${action}` }, 400);
}

async function handleCleanup(body: { olderThanDays?: number }): Promise<Response> {
  const days = body.olderThanDays;
  if (typeof days !== 'number' || !Number.isFinite(days) || days <= 0) {
    return json({ success: false, error: 'olderThanDays 必须为正整数' }, 400);
  }

  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const BATCH_SIZE = 1000;
  let totalDeleted = 0;

  while (true) {
    const result = await queryFromD1(
      `DELETE FROM ai_channel_availability_buckets WHERE bucket_start < ? LIMIT ${BATCH_SIZE}`,
      [cutoff],
    );
    const deleted = (result as { result?: Array<{ meta?: { changes?: number } }> })?.result?.[0]?.meta?.changes ?? 0;
    totalDeleted += deleted;
    if (deleted < BATCH_SIZE) break;
  }

  return json({
    success: true,
    deletedRows: totalDeleted,
    cutoffTime: cutoff,
  });
}

async function handleRefreshSnapshot(): Promise<Response> {
  const snapshot = await rebuildSnapshot();
  return json({
    success: true,
    generatedAt: snapshot.generatedAt,
    entryCount: snapshot.entries.length,
  });
}

// --- Exported handler ---

export async function GET(req: Request): Promise<Response> {
  try {
    return await handleGet(req);
  } catch (error) {
    console.error('Admin AI channel availability GET 失败:', error);
    return json({ success: false, error: '获取 AI 渠道可用性数据失败' }, 500);
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    return await handlePost(req);
  } catch (error) {
    console.error('Admin AI channel availability POST 失败:', error);
    return json({ success: false, error: '执行操作失败' }, 500);
  }
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'GET' || req.method === 'HEAD') return GET(req);
  if (req.method === 'POST') return POST(req);
  return json({ success: false, error: 'Method Not Allowed' }, 405);
}
