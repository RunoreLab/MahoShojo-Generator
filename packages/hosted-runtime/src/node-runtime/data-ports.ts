import type {
  D1LikeStatementResult,
  D1QueryOptions,
} from '../d1-http-client';
import { getUserIdFromActivityHeaders } from './activity-token';
import { getDefaultNodeD1Client } from './d1-client';
import { MAX_CUSTOM_AI_MODEL_ID_LENGTH } from './provider-catalog';

export type NodeDataD1Statement = {
  bind(..._params: unknown[]): NodeDataD1Statement;
  run(_options?: D1QueryOptions): Promise<D1LikeStatementResult>;
  all(_options?: D1QueryOptions): Promise<D1LikeStatementResult>;
};

export type NodeDataD1Client = {
  prepare(_sql: string): NodeDataD1Statement;
};

export type RecordOutcomeInput = {
  providerId: string;
  modelId: string;
  outcome: 'success' | 'failure' | 'excluded';
  errorClass?: string;
};

export type HostedDataCard = Record<string, unknown> & {
  id: string;
  type: string;
  data: string;
  tagIds: string[];
};

export type NodeDataPorts = {
  touchUserLastActivity(_userId: number, _seenAtIso?: string): Promise<boolean>;
  recordUserActivityFromRequest(_request: Request, _seenAtIso?: string): void;
  recordAiChannelOutcome(_input: RecordOutcomeInput): Promise<void>;
  getDataCardById(_cardId: string, _publicOnly?: boolean): Promise<HostedDataCard | null>;
};

export type NodeDataPortDependencies = {
  getD1Client(): NodeDataD1Client | null;
  getUserIdFromActivityHeaders(_headers: Headers): Promise<number | null>;
  now(): Date;
  log?: { debug(_message: string): void };
};

const USER_ACTIVITY_UPSERT_SQL = `
INSERT INTO user_last_activity (user_id, last_seen_at, updated_at)
VALUES (?, ?, ?)
ON CONFLICT(user_id) DO UPDATE SET
  last_seen_at = CASE
    WHEN excluded.last_seen_at > user_last_activity.last_seen_at THEN excluded.last_seen_at
    ELSE user_last_activity.last_seen_at
  END,
  updated_at = excluded.updated_at
`.trim();

const AI_AVAILABILITY_UPSERT_SQL = `
INSERT INTO ai_channel_availability_buckets (
  bucket_start,
  provider_id,
  model_id,
  success_count,
  failure_count,
  excluded_count,
  last_error_class,
  updated_at
)
VALUES (?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(bucket_start, provider_id, model_id) DO UPDATE SET
  success_count = ai_channel_availability_buckets.success_count + excluded.success_count,
  failure_count = ai_channel_availability_buckets.failure_count + excluded.failure_count,
  excluded_count = ai_channel_availability_buckets.excluded_count + excluded.excluded_count,
  last_error_class = CASE
    WHEN excluded.failure_count > 0 THEN excluded.last_error_class
    ELSE ai_channel_availability_buckets.last_error_class
  END,
  updated_at = excluded.updated_at
`.trim();

const DATA_CARD_SELECT_SQL = `
SELECT
  dc.id,
  dc.user_id,
  dc.type,
  dc.name,
  dc.description,
  dc.data,
  CAST(dc.is_public AS INTEGER) AS is_public,
  dc.public_since,
  COALESCE(dc.usage_count, 0) AS usage_count,
  COALESCE(dc.like_count, 0) AS like_count,
  COALESCE(dc.favorite_count, 0) AS favorite_count,
  dc.review_status,
  CAST(COALESCE(dc.is_recommended, 0) AS INTEGER) AS is_recommended,
  dc.created_at,
  dc.updated_at,
  dc.deleted_at,
  u.username,
  (
    SELECT group_concat(DISTINCT dct.tag_id)
    FROM data_card_tags AS dct
    WHERE dct.data_card_id = dc.id
  ) AS tag_ids
FROM data_cards AS dc
INNER JOIN users AS u ON dc.user_id = u.id
WHERE dc.id = ?
  AND dc.deleted_at IS NULL
`.trim();

const asFiniteInt = (value: unknown, fallback = 0): number => {
  const numberValue = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? Number(value)
      : Number.NaN;
  return Number.isFinite(numberValue) ? Math.trunc(numberValue) : fallback;
};

const asNullableString = (value: unknown): string | null => (
  typeof value === 'string' ? value : null
);

const alignBucketStart = (date: Date): string => {
  const aligned = new Date(date.getTime());
  aligned.setUTCMinutes(aligned.getUTCMinutes() - (aligned.getUTCMinutes() % 5), 0, 0);
  return aligned.toISOString();
};

const normalizeSeenAt = (value: string | undefined, fallback: Date): string => {
  if (typeof value !== 'string' || !value.trim()) return fallback.toISOString();
  const parsed = new Date(value.trim());
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : fallback.toISOString();
};

const toDataCard = (row: Record<string, unknown>): HostedDataCard => ({
  id: typeof row.id === 'string' ? row.id : '',
  user_id: asFiniteInt(row['user_id']),
  type: typeof row.type === 'string' ? row.type : 'character',
  name: typeof row.name === 'string' ? row.name : '',
  description: asNullableString(row.description),
  data: typeof row.data === 'string' ? row.data : '',
  is_public: asFiniteInt(row['is_public']),
  public_since: asNullableString(row['public_since']),
  usage_count: asFiniteInt(row['usage_count']),
  like_count: asFiniteInt(row['like_count']),
  favorite_count: asFiniteInt(row['favorite_count']),
  review_status: asNullableString(row['review_status']),
  is_recommended: asFiniteInt(row['is_recommended']),
  created_at: asNullableString(row['created_at']),
  updated_at: asNullableString(row['updated_at']),
  deleted_at: asNullableString(row['deleted_at']),
  username: typeof row.username === 'string' ? row.username : '',
  tag_ids: asNullableString(row['tag_ids']),
  tagIds: (typeof row['tag_ids'] === 'string' ? row['tag_ids'] : '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean),
});

export const createNodeDataPorts = (
  dependencies: NodeDataPortDependencies,
): NodeDataPorts => {
  const touchUserLastActivity = async (
    userId: number,
    seenAtIso?: string,
  ): Promise<boolean> => {
    const safeUserId = Number.isFinite(userId) ? Math.floor(userId) : 0;
    if (safeUserId <= 0) return false;

    const client = dependencies.getD1Client();
    if (!client) return false;
    const now = dependencies.now();
    try {
      await client
        .prepare(USER_ACTIVITY_UPSERT_SQL)
        .bind(safeUserId, normalizeSeenAt(seenAtIso, now), now.toISOString())
        .run({ retry: 'none' });
      return true;
    } catch {
      dependencies.log?.debug('用户活动写入失败');
      return false;
    }
  };

  const recordUserActivityFromRequest = (
    request: Request,
    seenAtIso?: string,
  ): void => {
    const pending = (async () => {
      try {
        const userId = await dependencies.getUserIdFromActivityHeaders(request.headers);
        if (userId) await touchUserLastActivity(userId, seenAtIso);
      } catch {
        dependencies.log?.debug('用户活动身份解析失败');
      }
    })();

    const context = (request as Request & {
      context?: { waitUntil?: (_promise: Promise<unknown>) => void };
    }).context;
    try {
      context?.waitUntil?.(pending);
    } catch {
      // background bookkeeping must never affect the response path
    }
  };

  const recordAiChannelOutcome = async (input: RecordOutcomeInput): Promise<void> => {
    const client = dependencies.getD1Client();
    if (!client) return;
    const now = dependencies.now();
    try {
      await client
        .prepare(AI_AVAILABILITY_UPSERT_SQL)
        .bind(
          alignBucketStart(now),
          input.providerId,
          input.modelId.slice(0, MAX_CUSTOM_AI_MODEL_ID_LENGTH),
          input.outcome === 'success' ? 1 : 0,
          input.outcome === 'failure' ? 1 : 0,
          input.outcome === 'excluded' ? 1 : 0,
          input.outcome === 'failure' ? (input.errorClass ?? null) : null,
          now.toISOString(),
        )
        .run({ retry: 'none' });
    } catch {
      dependencies.log?.debug('AI availability 写入失败');
    }
  };

  const getDataCardById = async (
    cardId: string,
    publicOnly = false,
  ): Promise<HostedDataCard | null> => {
    const normalizedId = cardId.trim();
    if (!normalizedId) return null;
    const client = dependencies.getD1Client();
    if (!client) return null;
    const sql = publicOnly
      ? `${DATA_CARD_SELECT_SQL}\n  AND dc.is_public = 1\n  AND dc.review_status = 'approved'\nLIMIT 1`
      : `${DATA_CARD_SELECT_SQL}\nLIMIT 1`;
    try {
      const queryResult = await client
        .prepare(sql)
        .bind(normalizedId)
        .all({ retry: 'safe-read' });
      const row = queryResult.results[0];
      return row ? toDataCard(row) : null;
    } catch {
      dependencies.log?.debug('DataCard 读取失败');
      return null;
    }
  };

  return Object.freeze({
    touchUserLastActivity,
    recordUserActivityFromRequest,
    recordAiChannelOutcome,
    getDataCardById,
  });
};

const defaultNodeDataPorts = createNodeDataPorts({
  getD1Client: getDefaultNodeD1Client,
  getUserIdFromActivityHeaders,
  now: () => new Date(),
});

export const touchUserLastActivity = defaultNodeDataPorts.touchUserLastActivity;
export const recordUserActivityFromRequest = defaultNodeDataPorts.recordUserActivityFromRequest;
export const recordAiChannelOutcome = defaultNodeDataPorts.recordAiChannelOutcome;
export const getDataCardById = defaultNodeDataPorts.getDataCardById;
