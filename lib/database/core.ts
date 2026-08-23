type D1Config = {
  transport: 'gateway' | 'cloudflare-api';
  queryUrl: string;
  rawUrl: string;
  apiToken?: string;
  hmacSecret?: string;
  accessClientId?: string;
  accessClientSecret?: string;
};

export type D1QueryRetryMode = 'none' | 'safe-read';

export interface D1QueryOptions {
  retry?: D1QueryRetryMode;
}

export const D1_INDETERMINATE_OUTCOME_ERROR_CODE = 'D1_INDETERMINATE_OUTCOME' as const;

export class D1IndeterminateOutcomeError extends Error {
  readonly code = D1_INDETERMINATE_OUTCOME_ERROR_CODE;
  readonly status?: number;

  constructor(status?: number) {
    super(status == null
      ? 'D1 请求已发出，但无法确认是否已提交'
      : `D1 请求已发出，但无法确认是否已提交（HTTP ${status}）`);
    this.name = 'D1IndeterminateOutcomeError';
    this.status = status;
  }
}

const sleep = async (ms: number) => {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
};

const isRetryableFetchError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;
  const anyError = error as { name?: unknown; message?: unknown; cause?: unknown };
  if (anyError.name !== 'TypeError') return false;

  const cause = anyError.cause as { code?: unknown } | undefined;
  const code = typeof cause?.code === 'string' ? cause.code : '';
  if (code === 'UND_ERR_CONNECT_TIMEOUT') return true;

  const message = typeof anyError.message === 'string' ? anyError.message : '';
  return message.toLowerCase().includes('fetch failed');
};

const isRetryableStatus = (status: number): boolean => {
  if (status === 408) return true;
  if (status === 425) return true;
  if (status === 429) return true;
  return status >= 500 && status <= 599;
};

const parseRetryAfterMs = (response: Response): number | null => {
  const value = response.headers.get('retry-after');
  if (!value) return null;

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }

  const dateMs = Date.parse(value);
  if (!Number.isFinite(dateMs)) return null;
  return Math.max(0, dateMs - Date.now());
};

const jitterMs = (ms: number): number => {
  if (ms <= 0) return 0;
  const jitterRatio = 0.2;
  const delta = ms * jitterRatio;
  return Math.max(0, ms - delta + Math.random() * (2 * delta));
};

const fetchWithRetry = async (
  url: string,
  createInit: () => RequestInit | Promise<RequestInit>,
  options?: {
    attempts?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
    indeterminateOnRetryableFetchError?: boolean;
  },
): Promise<Response> => {
  const attempts = Math.max(1, options?.attempts ?? 1);
  const baseDelayMs = Math.max(0, options?.baseDelayMs ?? 300);
  const maxDelayMs = Math.max(0, options?.maxDelayMs ?? 10_000);

  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    const init = await createInit();
    try {
      const response = await fetch(url, init);

      if (response.ok || i === attempts - 1 || !isRetryableStatus(response.status)) {
        return response;
      }

      const retryAfterMs = parseRetryAfterMs(response);
      const backoffMs = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, i));
      const delayMs = retryAfterMs ?? backoffMs;

      try {
        await response.body?.cancel();
      } catch {
        // ignore
      }

      await sleep(jitterMs(delayMs));
    } catch (error) {
      lastError = error;
      if (!isRetryableFetchError(error)) throw error;
      if (i === attempts - 1) {
        if (options?.indeterminateOnRetryableFetchError) {
          throw new D1IndeterminateOutcomeError();
        }
        throw error;
      }
      await sleep(jitterMs(Math.min(maxDelayMs, baseDelayMs * Math.pow(2, i))));
    }
  }

  throw lastError;
};

const getD1Config = (): D1Config | null => {
  const gatewayUrl = process.env.D1_GATEWAY_URL?.trim().replace(/\/+$/, '');
  if (gatewayUrl) {
    return {
      transport: 'gateway',
      queryUrl: `${gatewayUrl}/v1/query`,
      rawUrl: `${gatewayUrl}/v1/raw`,
      hmacSecret: process.env.D1_GATEWAY_HMAC_SECRET?.trim() || undefined,
      apiToken: process.env.D1_GATEWAY_TOKEN?.trim() || undefined,
      accessClientId: process.env.CF_ACCESS_CLIENT_ID?.trim() || undefined,
      accessClientSecret: process.env.CF_ACCESS_CLIENT_SECRET?.trim() || undefined,
    };
  }

  const databaseId = process.env.D1_DATABASE_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;

  if (!databaseId || !apiToken || !accountId) return null;

  return {
    transport: 'cloudflare-api',
    apiToken,
    queryUrl: `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`,
    rawUrl: `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/raw`,
  };
};

const assertD1Config = (): D1Config => {
  const config = getD1Config();
  if (config) return config;

  const missing: string[] = [];
  if (!process.env.D1_GATEWAY_URL) missing.push('D1_GATEWAY_URL');
  if (!process.env.CLOUDFLARE_API_TOKEN) missing.push('CLOUDFLARE_API_TOKEN');
  if (!process.env.CLOUDFLARE_ACCOUNT_ID) missing.push('CLOUDFLARE_ACCOUNT_ID');
  if (!process.env.D1_DATABASE_ID) missing.push('D1_DATABASE_ID');

  throw new Error(`缺少 Cloudflare 配置信息（也未配置 D1 Gateway）：${missing.join(', ') || '未知'}`);
};

const bytesToHex = (bytes: ArrayBuffer): string =>
  Array.from(new Uint8Array(bytes), (value) => value.toString(16).padStart(2, '0')).join('');

const createGatewaySignature = async (
  secret: string,
  timestamp: string,
  nonce: string,
  pathname: string,
  bodyText: string,
): Promise<string> => {
  const encoder = new TextEncoder();
  const key = await globalThis.crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await globalThis.crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(`${timestamp}\n${nonce}\n${pathname}\n${bodyText}`),
  );
  return bytesToHex(signature);
};

const buildD1Headers = async (
  config: D1Config,
  targetUrl: string,
  bodyText: string,
): Promise<Record<string, string>> => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  if (config.apiToken) headers.Authorization = `Bearer ${config.apiToken}`;
  if (config.accessClientId) headers['CF-Access-Client-Id'] = config.accessClientId;
  if (config.accessClientSecret) headers['CF-Access-Client-Secret'] = config.accessClientSecret;

  if (config.transport === 'gateway' && config.hmacSecret) {
    const timestamp = String(Date.now());
    const nonce = generateUUID();
    const pathname = new URL(targetUrl).pathname;
    const signature = await createGatewaySignature(config.hmacSecret, timestamp, nonce, pathname, bodyText);
    headers['X-Mahoshojo-Timestamp'] = timestamp;
    headers['X-Mahoshojo-Nonce'] = nonce;
    headers['X-Mahoshojo-Signature'] = signature;
  }

  return headers;
};

const TABLE_NAME_RE = /^[A-Za-z0-9_]+$/;

const assertSafeTableName = (table: string): string => {
  if (!TABLE_NAME_RE.test(table)) {
    throw new Error(`非法 table 名称: ${table}`);
  }
  return table;
};

const fillRandomBytes = (arr: Uint8Array): Uint8Array => {
  const cryptoObj = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
  if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
    return cryptoObj.getRandomValues(arr);
  }
  for (let i = 0; i < arr.length; i++) {
    arr[i] = Math.floor(Math.random() * 256);
  }
  return arr;
};

// 生成 32 位包含大小写字母和数字的随机字符串
export function generateRandomId(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(32);
  fillRandomBytes(bytes);
  let result = '';
  for (let i = 0; i < bytes.length; i++) {
    result += chars.charAt(bytes[i] % chars.length);
  }
  return result;
}

// 生成 UUID v4 格式的字符串 (xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx)
export function generateUUID(): string {
  const randomBytes = new Uint8Array(16);
  fillRandomBytes(randomBytes);
  
  // Set version (4) and variant bits
  randomBytes[6] = (randomBytes[6] & 0x0f) | 0x40; // Version 4
  randomBytes[8] = (randomBytes[8] & 0x3f) | 0x80; // Variant bits
  
  // Convert to hex string with dashes
  const hex = Array.from(randomBytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
    
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32)
  ].join('-');
}

type D1QueryEndpoint = 'query' | 'raw';

// 核心查询函数
async function query(
  body: Record<string, unknown>,
  endpoint: D1QueryEndpoint = 'query',
  options: D1QueryOptions = {},
): Promise<Response> {
  const config = assertD1Config();
  const targetUrl = endpoint === 'raw' ? config.rawUrl : config.queryUrl;
  const bodyText = JSON.stringify(body);
  const safeRead = options.retry === 'safe-read';

  const response = await fetchWithRetry(
    targetUrl,
    async () => ({
      method: "POST",
      headers: await buildD1Headers(config, targetUrl, bodyText),
      body: bodyText,
    }),
    {
      attempts: safeRead ? 5 : 1,
      baseDelayMs: 500,
      maxDelayMs: 8000,
      indeterminateOnRetryableFetchError: !safeRead,
    },
  );

  if (!safeRead && isRetryableStatus(response.status)) {
    try {
      await response.body?.cancel();
    } catch {
      // ignore
    }
    throw new D1IndeterminateOutcomeError(response.status);
  }

  return response;
}

// 从 D1 数据库直接执行 SQL 语句并返回 Cloudflare D1 HTTP payload
export async function queryD1Payload(
  sql: string,
  params: unknown[] = [],
  options: D1QueryOptions = {},
): Promise<unknown> {
  try {
    const response = await query({ sql, params }, 'query', options);

    if (!response.ok) {
      let extra = '';
      try {
        const text = await response.text();
        const trimmed = typeof text === 'string' ? text.trim() : '';
        if (trimmed) extra = ` - ${trimmed.slice(0, 800)}`;
      } catch {
        // ignore
      }
      throw new Error(`D1 API 错误: ${response.status} ${response.statusText}${extra}`);
    }

    const result = await response.json();
    return result;
  } catch (error) {
    console.error("从 D1 数据库查询失败:", error);
    throw error;
  }
}

// 使用 Cloudflare D1 HTTP batch 载荷执行多条语句并返回 payload
export async function queryD1BatchPayload(
  batch: Array<{ sql: string; params?: unknown[] }>,
  options: D1QueryOptions = {},
): Promise<unknown> {
  try {
    const response = await query({ batch }, 'query', options);

    if (!response.ok) {
      let extra = '';
      try {
        const text = await response.text();
        const trimmed = typeof text === 'string' ? text.trim() : '';
        if (trimmed) extra = ` - ${trimmed.slice(0, 800)}`;
      } catch {
        // ignore
      }
      throw new Error(`D1 API 错误: ${response.status} ${response.statusText}${extra}`);
    }

    const result = await response.json();
    return result;
  } catch (error) {
    console.error("从 D1 数据库 batch 查询失败:", error);
    throw error;
  }
}

// 从 D1 数据库直接执行 SQL 语句并返回 Cloudflare D1 HTTP raw payload
export async function queryD1RawPayload(
  sql: string,
  params: unknown[] = [],
  options: D1QueryOptions = {},
): Promise<unknown> {
  try {
    const response = await query({ sql, params }, 'raw', options);

    if (!response.ok) {
      let extra = '';
      try {
        const text = await response.text();
        const trimmed = typeof text === 'string' ? text.trim() : '';
        if (trimmed) extra = ` - ${trimmed.slice(0, 800)}`;
      } catch {
        // ignore
      }
      throw new Error(`D1 API 错误: ${response.status} ${response.statusText}${extra}`);
    }

    const result = await response.json();
    return result;
  } catch (error) {
    console.error("从 D1 数据库 raw 查询失败:", error);
    throw error;
  }
}

/**
 * @deprecated 请改用 `queryD1Payload`。该函数仅保留为兼容层别名，后续会在完成全仓迁移后移除。
 */
export async function queryFromD1(
  sql: string,
  params: unknown[] = [],
  options: D1QueryOptions = {},
): Promise<unknown> {
  return queryD1Payload(sql, params, options);
}

// 保存数据到 D1 数据库，使用自定义 32 位随机字符串 ID 并返回 ID
export async function createWithCustomId(data: string, table: string): Promise<string | null> {
  try {
    if (!getD1Config()) {
      console.warn("缺少 Cloudflare 配置信息，跳过 D1 保存");
      return null;
    }

    const safeTable = assertSafeTableName(table);
    const customId = generateRandomId();
    const timestamp = new Date().toISOString();
    
    const response = await query({
      sql: `INSERT INTO ${safeTable} (id, data, created_at, updated_at) VALUES (?, ?, ?, ?)`,
      params: [customId, data, timestamp, timestamp],
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`D1 API 错误: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const result = await response.json();
    // 如果插入成功，返回自定义 ID
    if (result.success) {
      return customId;
    }
    
    return null;
  } catch (error) {
    if (error instanceof D1IndeterminateOutcomeError) throw error;
    console.error("保存到 D1 数据库失败:", error);
    return null;
  }
}

// 根据 ID 更新数据库记录的函数
export async function updateById(id: string, data: string, table: string): Promise<boolean> {
  try {
    if (!getD1Config()) {
      console.warn("缺少 Cloudflare 配置信息，跳过 D1 更新");
      return false;
    }

    const safeTable = assertSafeTableName(table);
    const timestamp = new Date().toISOString();
    
    const response = await query({
      sql: `UPDATE ${safeTable} SET data = ?, updated_at = ? WHERE id = ?`,
      params: [data, timestamp, id],
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`D1 API 错误: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const result = await response.json();
    // 检查是否有记录被更新
    if (result.success && result.result && result.result.length > 0) {
      const changes = result.result[0].meta?.changes || 0;
      return changes > 0;
    }
    
    return false;
  } catch (error) {
    if (error instanceof D1IndeterminateOutcomeError) throw error;
    console.error("更新 D1 数据库失败:", error);
    return false;
  }
}

export async function getRecordById(id: string, table: string): Promise<unknown> {
  try {
    const safeTable = assertSafeTableName(table);
    const response = await query({ sql: `SELECT * FROM ${safeTable} WHERE id = ?`, params: [id] });
    if (response.ok) {
      const result = await response.json();
      if (result.result && result.result.length > 0) {
        return result.result[0].results[0];
      }
    }
    return null;
  } catch (error) {
    console.error("从 D1 数据库查询失败:", error);
    throw error;
  }
}

// @deprecated 保存到 D1 数据库的函数
export async function saveToD1(data: unknown): Promise<boolean> {
  try {
    if (!getD1Config()) {
      console.warn("缺少 Cloudflare 配置信息，跳过 D1 保存");
      return false;
    }

    const timestamp = new Date().toISOString();
    const dataString = JSON.stringify(data);
    const response = await query({
      sql: "INSERT INTO shojo (data, created_at) VALUES (?, ?)",
      params: [dataString, timestamp],
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`D1 API 错误: ${response.status} ${response.statusText} - ${errorText}`);
    }
    return true;
  } catch (error) {
    if (error instanceof D1IndeterminateOutcomeError) throw error;
    console.error("保存到 D1 数据库失败:", error);
    // 不抛出错误，避免影响主要生成流程
    return false;
  }
}
