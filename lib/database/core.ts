type D1Config = {
  databaseId: string;
  apiToken: string;
  accountId: string;
  databaseUrl: string;
};

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

const fetchWithRetry = async (
  url: string,
  init: RequestInit,
  options?: { attempts?: number; baseDelayMs?: number }
): Promise<Response> => {
  const attempts = Math.max(1, options?.attempts ?? 3);
  const baseDelayMs = Math.max(0, options?.baseDelayMs ?? 300);

  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fetch(url, init);
    } catch (error) {
      lastError = error;
      if (!isRetryableFetchError(error) || i === attempts - 1) throw error;
      await sleep(baseDelayMs * Math.pow(2, i));
    }
  }

  throw lastError;
};

const getD1Config = (): D1Config | null => {
  const databaseId = process.env.D1_DATABASE_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;

  if (!databaseId || !apiToken || !accountId) return null;

  return {
    databaseId,
    apiToken,
    accountId,
    databaseUrl: `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`,
  };
};

const assertD1Config = (): D1Config => {
  const config = getD1Config();
  if (config) return config;

  const missing: string[] = [];
  if (!process.env.CLOUDFLARE_API_TOKEN) missing.push('CLOUDFLARE_API_TOKEN');
  if (!process.env.CLOUDFLARE_ACCOUNT_ID) missing.push('CLOUDFLARE_ACCOUNT_ID');
  if (!process.env.D1_DATABASE_ID) missing.push('D1_DATABASE_ID');

  throw new Error(`缺少 Cloudflare 配置信息：${missing.join(', ') || '未知'}`);
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

// 核心查询函数
async function query(sql: string, params: unknown[] = []): Promise<Response> {
  const config = assertD1Config();

  return await fetchWithRetry(
    config.databaseUrl,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${config.apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sql,
        params,
      }),
    },
    { attempts: 3, baseDelayMs: 400 }
  );
}

// 从 D1 数据库直接执行 SQL 语句
export async function queryFromD1(sql: string, params: unknown[] = []): Promise<unknown> {
  try {
    const response = await query(sql, params);

    if (!response.ok) {
      throw new Error(`D1 API 错误: ${response.status} ${response.statusText}`);
    }

    const result = await response.json();
    return result;
  } catch (error) {
    console.error("从 D1 数据库查询失败:", error);
    throw error;
  }
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
    
    const response = await query(
      `INSERT INTO ${safeTable} (id, data, created_at, updated_at) VALUES (?, ?, ?, ?)`,
      [customId, data, timestamp, timestamp]
    );

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
    
    const response = await query(
      `UPDATE ${safeTable} SET data = ?, updated_at = ? WHERE id = ?`,
      [data, timestamp, id]
    );

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
    console.error("更新 D1 数据库失败:", error);
    return false;
  }
}

export async function getRecordById(id: string, table: string): Promise<unknown> {
  try {
    const safeTable = assertSafeTableName(table);
    const response = await query(`SELECT * FROM ${safeTable} WHERE id = ?`, [id]);
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
    const response = await query(
      "INSERT INTO shojo (data, created_at) VALUES (?, ?)",
      [dataString, timestamp]
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`D1 API 错误: ${response.status} ${response.statusText} - ${errorText}`);
    }
    return true;
  } catch (error) {
    console.error("保存到 D1 数据库失败:", error);
    // 不抛出错误，避免影响主要生成流程
    return false;
  }
}
