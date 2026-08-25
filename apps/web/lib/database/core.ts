import {
  createD1HttpTransport,
  D1_INDETERMINATE_OUTCOME_ERROR_CODE,
  D1IndeterminateOutcomeError,
  type D1HttpPayload,
  type D1HttpTransport,
  type D1QueryOptions,
  type D1QueryRetryMode,
} from '@mahoshojo/hosted-runtime/d1-http-client';

export { D1_INDETERMINATE_OUTCOME_ERROR_CODE, D1IndeterminateOutcomeError };
export type { D1QueryOptions, D1QueryRetryMode };

type D1Config = {
  kind: 'gateway' | 'cloudflare-api';
  queryUrl?: string;
  rawUrl?: string;
  baseUrl?: string;
  token?: string;
  apiToken?: string;
  hmacSecret?: string;
  accessClientId?: string;
  accessClientSecret?: string;
};

const envValue = (name: string): string | undefined => {
  const value = process.env[name]?.trim();
  return value || undefined;
};

const getD1Config = (): D1Config | null => {
  const gatewayUrl = envValue('D1_GATEWAY_URL')?.replace(/\/+$/, '');
  if (gatewayUrl) {
    return {
      kind: 'gateway',
      baseUrl: gatewayUrl,
      token: envValue('D1_GATEWAY_TOKEN'),
      hmacSecret: envValue('D1_GATEWAY_HMAC_SECRET'),
      accessClientId: envValue('CF_ACCESS_CLIENT_ID'),
      accessClientSecret: envValue('CF_ACCESS_CLIENT_SECRET'),
    };
  }

  const accountId = envValue('CLOUDFLARE_ACCOUNT_ID');
  const databaseId = envValue('D1_DATABASE_ID');
  const apiToken = envValue('CLOUDFLARE_API_TOKEN');
  if (!accountId || !databaseId || !apiToken) return null;

  const baseUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}`;
  return {
    kind: 'cloudflare-api',
    queryUrl: `${baseUrl}/query`,
    rawUrl: `${baseUrl}/raw`,
    apiToken,
  };
};

const missingConfigMessage = (): string => {
  const missing: string[] = [];
  if (!envValue('D1_GATEWAY_URL')) missing.push('D1_GATEWAY_URL');
  if (!envValue('CLOUDFLARE_API_TOKEN')) missing.push('CLOUDFLARE_API_TOKEN');
  if (!envValue('CLOUDFLARE_ACCOUNT_ID')) missing.push('CLOUDFLARE_ACCOUNT_ID');
  if (!envValue('D1_DATABASE_ID')) missing.push('D1_DATABASE_ID');
  return `缺少 Cloudflare 配置信息（也未配置 D1 Gateway）：${missing.join(', ') || '未知'}`;
};

let transportCache: {
  key: string;
  fetcher: typeof globalThis.fetch;
  transport: D1HttpTransport;
} | null = null;

const getTransport = (): D1HttpTransport => {
  const config = getD1Config();
  if (!config) throw new Error(missingConfigMessage());

  // Include fetch identity so test seams and runtime hot replacement do not
  // retain an old fetcher behind an unchanged environment configuration.
  const fetcher = globalThis.fetch;
  const key = JSON.stringify(config);
  if (transportCache?.key === key && transportCache.fetcher === fetcher) {
    return transportCache.transport;
  }

  const transport = createD1HttpTransport({ ...config, fetch: fetcher });
  transportCache = { key, fetcher, transport };
  return transport;
};

export async function queryD1Payload(
  sql: string,
  params: unknown[] = [],
  options: D1QueryOptions = {},
): Promise<D1HttpPayload> {
  try {
    return await getTransport().query(sql, params, options);
  } catch (error) {
    console.error('从 D1 数据库查询失败:', error instanceof Error ? error.message : 'unknown error');
    throw error;
  }
}

export async function queryD1RawPayload(
  sql: string,
  params: unknown[] = [],
  options: D1QueryOptions = {},
): Promise<D1HttpPayload> {
  try {
    return await getTransport().queryRaw(sql, params, options);
  } catch (error) {
    console.error('从 D1 数据库 raw 查询失败:', error instanceof Error ? error.message : 'unknown error');
    throw error;
  }
}

export async function queryD1BatchPayload(
  batch: Array<{ sql: string; params?: unknown[] }>,
  options: D1QueryOptions = {},
): Promise<D1HttpPayload> {
  try {
    return await getTransport().queryBatch(
      batch.map((entry) => ({ sqlText: entry.sql, params: entry.params ?? [] })),
      options,
    );
  } catch (error) {
    console.error('从 D1 数据库 batch 查询失败:', error instanceof Error ? error.message : 'unknown error');
    throw error;
  }
}

/** @deprecated 请改用 `queryD1Payload`。 */
export async function queryFromD1(
  sql: string,
  params: unknown[] = [],
  options: D1QueryOptions = {},
): Promise<D1HttpPayload> {
  return queryD1Payload(sql, params, options);
}

const TABLE_NAME_RE = /^[A-Za-z0-9_]+$/;

const assertSafeTableName = (table: string): string => {
  if (!TABLE_NAME_RE.test(table)) throw new Error('非法 table 名称');
  return table;
};

const fillRandomBytes = (arr: Uint8Array): Uint8Array => {
  const cryptoObj = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
  if (cryptoObj?.getRandomValues) return cryptoObj.getRandomValues(arr);
  for (let i = 0; i < arr.length; i += 1) arr[i] = Math.floor(Math.random() * 256);
  return arr;
};

// 生成 32 位包含大小写字母和数字的随机字符串
export function generateRandomId(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = fillRandomBytes(new Uint8Array(32));
  return Array.from(bytes, (value) => chars.charAt(value % chars.length)).join('');
}

// 生成 UUID v4 格式的字符串 (xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx)
export function generateUUID(): string {
  const bytes = fillRandomBytes(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
}

type D1Envelope = {
  success?: boolean;
  result?: Array<{ results?: Array<Record<string, unknown>>; meta?: Record<string, unknown> }>;
};

const envelope = (payload: D1HttpPayload): D1Envelope => payload as D1Envelope;

// 保存数据到 D1 数据库，使用自定义 32 位随机字符串 ID 并返回 ID
export async function createWithCustomId(data: string, table: string): Promise<string | null> {
  try {
    if (!getD1Config()) {
      console.warn('缺少 Cloudflare 配置信息，跳过 D1 保存');
      return null;
    }

    const safeTable = assertSafeTableName(table);
    const customId = generateRandomId();
    const timestamp = new Date().toISOString();
    const result = envelope(await queryD1Payload(
      `INSERT INTO ${safeTable} (id, data, created_at, updated_at) VALUES (?, ?, ?, ?)`,
      [customId, data, timestamp, timestamp],
    ));
    return result.success ? customId : null;
  } catch (error) {
    if (error instanceof D1IndeterminateOutcomeError) throw error;
    console.error('保存到 D1 数据库失败:', error instanceof Error ? error.message : 'unknown error');
    return null;
  }
}

// 根据 ID 更新数据库记录的函数
export async function updateById(id: string, data: string, table: string): Promise<boolean> {
  try {
    if (!getD1Config()) {
      console.warn('缺少 Cloudflare 配置信息，跳过 D1 更新');
      return false;
    }

    const safeTable = assertSafeTableName(table);
    const result = envelope(await queryD1Payload(
      `UPDATE ${safeTable} SET data = ?, updated_at = ? WHERE id = ?`,
      [data, new Date().toISOString(), id],
    ));
    const meta = result.result?.[0]?.meta ?? {};
    return Number(meta.rows_written ?? meta.changes ?? 0) > 0;
  } catch (error) {
    if (error instanceof D1IndeterminateOutcomeError) throw error;
    console.error('更新 D1 数据库失败:', error instanceof Error ? error.message : 'unknown error');
    return false;
  }
}

export async function getRecordById(id: string, table: string): Promise<unknown> {
  try {
    const safeTable = assertSafeTableName(table);
    const result = envelope(await queryD1Payload(`SELECT * FROM ${safeTable} WHERE id = ?`, [id]));
    return result.result?.[0]?.results?.[0] ?? null;
  } catch (error) {
    console.error('从 D1 数据库查询失败:', error instanceof Error ? error.message : 'unknown error');
    throw error;
  }
}

// @deprecated 保存到 D1 数据库的函数
export async function saveToD1(data: unknown): Promise<boolean> {
  try {
    if (!getD1Config()) {
      console.warn('缺少 Cloudflare 配置信息，跳过 D1 保存');
      return false;
    }

    const result = envelope(await queryD1Payload(
      'INSERT INTO shojo (data, created_at) VALUES (?, ?)',
      [JSON.stringify(data), new Date().toISOString()],
    ));
    return result.success === true;
  } catch (error) {
    if (error instanceof D1IndeterminateOutcomeError) throw error;
    console.error('保存到 D1 数据库失败:', error instanceof Error ? error.message : 'unknown error');
    // 不抛出错误，避免影响主要生成流程
    return false;
  }
}
