import { describe, expect, it } from 'vitest';
import gateway from '../index';

const sign = async (secret: string, value: string): Promise<string> => {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(value));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, '0')).join('');
};

const createSignedRequest = async (
  body: string,
  secret: string,
  pathname = '/v1/query',
  additionalHeaders: Record<string, string> = {},
): Promise<Request> => {
  const timestamp = String(Date.now());
  const nonce = '00000000-0000-4000-8000-000000000001';
  const signature = await sign(secret, `${timestamp}\n${nonce}\n${pathname}\n${body}`);
  return new Request(`https://gateway.example.com${pathname}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Mahoshojo-Timestamp': timestamp,
      'X-Mahoshojo-Nonce': nonce,
      'X-Mahoshojo-Signature': signature,
      ...additionalHeaders,
    },
    body,
  });
};

const createDatabase = () => {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const rawOptions: Array<{ columnNames?: boolean } | undefined> = [];
  const sessionConstraints: Array<string | undefined> = [];
  const batchSizes: number[] = [];
  const session = {
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          calls.push({ sql, params });
          return this;
        },
        async all() {
          return { success: true, results: [{ ok: 1 }], meta: {} };
        },
        async raw(options?: { columnNames?: boolean }) {
          rawOptions.push(options);
          return [['ok'], [1]];
        },
      };
    },
    async batch(statements: unknown[]) {
      batchSizes.push(statements.length);
      return statements.map(() => ({ success: true, results: [], meta: {} }));
    },
    getBookmark() {
      return 'bookmark-1';
    },
  };
  return {
    batchSizes,
    calls,
    rawOptions,
    sessionConstraints,
    database: {
      ...session,
      withSession(constraint?: string) {
        sessionConstraints.push(constraint);
        return session;
      },
    },
  };
};

describe('D1 Gateway Worker', () => {
  it('公开 health liveness，禁用缓存且不读取 D1 binding', async () => {
    let databaseReads = 0;
    const environment = Object.defineProperty({}, 'DB', {
      get() {
        databaseReads += 1;
        throw new Error('health 不应读取 DB');
      },
    }) as Parameters<typeof gateway.fetch>[1];

    const response = await gateway.fetch(
      new Request('https://gateway.example.com/health'),
      environment,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ ok: true, service: 'mahoshojo-d1-gateway' });
    expect(databaseReads).toBe(0);
  });

  it('拒绝未认证请求', async () => {
    const { database } = createDatabase();
    const response = await gateway.fetch(
      new Request('https://gateway.example.com/v1/query', { method: 'POST', body: '{}' }),
      { DB: database, D1_GATEWAY_HMAC_SECRET: 'secret' },
    );
    expect(response.status).toBe(401);
  });

  it('执行带参数查询并返回 bookmark', async () => {
    const secret = 'test-secret';
    const body = JSON.stringify({ sql: 'SELECT ? AS ok', params: [1] });
    const request = await createSignedRequest(body, secret);
    const { database, calls, sessionConstraints } = createDatabase();
    const response = await gateway.fetch(request, { DB: database, D1_GATEWAY_HMAC_SECRET: secret });

    expect(response.status).toBe(200);
    expect(response.headers.get('x-d1-bookmark')).toBe('bookmark-1');
    expect(calls).toEqual([{ sql: 'SELECT ? AS ok', params: [1] }]);
    expect(sessionConstraints).toEqual(['first-primary']);
    expect(await response.json()).toMatchObject({
      success: true,
      result: [{ success: true, results: [{ ok: 1 }] }],
    });
  });

  it('接受固定 Bearer token', async () => {
    const token = 'test-gateway-token';
    const body = JSON.stringify({ sql: 'SELECT 1 AS ok', params: [] });
    const request = new Request('https://gateway.example.com/v1/query', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body,
    });
    const { database, calls } = createDatabase();

    const response = await gateway.fetch(request, { DB: database, D1_GATEWAY_TOKEN: token });

    expect(response.status).toBe(200);
    expect(calls).toEqual([{ sql: 'SELECT 1 AS ok', params: [] }]);
  });

  it('将 raw 矩阵转换为 columns 和 rows envelope', async () => {
    const secret = 'test-secret';
    const body = JSON.stringify({ sql: 'SELECT ? AS ok', params: [1] });
    const request = await createSignedRequest(body, secret, '/v1/raw');
    const { database, rawOptions } = createDatabase();

    const response = await gateway.fetch(request, { DB: database, D1_GATEWAY_HMAC_SECRET: secret });

    expect(response.status).toBe(200);
    expect(rawOptions).toEqual([{ columnNames: true }]);
    expect(await response.json()).toEqual({
      success: true,
      result: [{
        success: true,
        results: { columns: ['ok'], rows: [[1]] },
        meta: {},
      }],
    });
  });

  it('以 bookmark 优先级执行 batch session', async () => {
    const secret = 'test-secret';
    const body = JSON.stringify({
      batch: [
        { sql: 'SELECT ? AS first', params: [1] },
        { sql: 'SELECT ? AS second', params: [2] },
      ],
    });
    const request = await createSignedRequest(body, secret, '/v1/query', {
      'X-D1-Bookmark': 'bookmark-input',
      'X-D1-Session-Constraint': 'first-unconstrained',
    });
    const { batchSizes, calls, database, sessionConstraints } = createDatabase();

    const response = await gateway.fetch(request, { DB: database, D1_GATEWAY_HMAC_SECRET: secret });

    expect(response.status).toBe(200);
    expect(sessionConstraints).toEqual(['bookmark-input']);
    expect(batchSizes).toEqual([2]);
    expect(calls).toEqual([
      { sql: 'SELECT ? AS first', params: [1] },
      { sql: 'SELECT ? AS second', params: [2] },
    ]);
    expect(await response.json()).toMatchObject({
      success: true,
      result: [{ success: true }, { success: true }],
    });
  });

  it.each([
    'DROP TABLE users',
    '-- audit\nDROP TABLE users',
    '/* audit */ DROP TABLE users',
    '/* first */ -- second\n ALTER TABLE users ADD COLUMN leaked TEXT',
    'PRAGMA optimize',
    'REINDEX users',
    'ANALYZE users',
    'VACUUM',
  ])('阻止 DDL 或维护语句通过业务 Gateway：%s', async (sql) => {
    const secret = 'test-secret';
    const body = JSON.stringify({ sql, params: [] });
    const request = await createSignedRequest(body, secret);
    const { calls, database } = createDatabase();
    const response = await gateway.fetch(request, { DB: database, D1_GATEWAY_HMAC_SECRET: secret });

    expect(response.status).toBe(400);
    expect(calls).toEqual([]);
    expect(await response.json()).toEqual({
      success: false,
      errors: [{ message: 'Gateway 禁止执行 DDL 或维护语句' }],
    });
  });

  it('在 raw 和 batch 入口同样阻止维护语句', async () => {
    const secret = 'test-secret';
    const rawBody = JSON.stringify({ sql: '/* raw */ PRAGMA optimize', params: [] });
    const rawRequest = await createSignedRequest(rawBody, secret, '/v1/raw');
    const rawDatabase = createDatabase();
    const rawResponse = await gateway.fetch(rawRequest, {
      DB: rawDatabase.database,
      D1_GATEWAY_HMAC_SECRET: secret,
    });

    const batchBody = JSON.stringify({
      batch: [
        { sql: 'SELECT 1', params: [] },
        { sql: '/* batch */ REINDEX users', params: [] },
      ],
    });
    const batchRequest = await createSignedRequest(batchBody, secret);
    const batchDatabase = createDatabase();
    const batchResponse = await gateway.fetch(batchRequest, {
      DB: batchDatabase.database,
      D1_GATEWAY_HMAC_SECRET: secret,
    });

    expect(rawResponse.status).toBe(400);
    expect(batchResponse.status).toBe(400);
    expect(rawDatabase.calls).toEqual([]);
    expect(batchDatabase.calls).toEqual([]);
  });

  it('拒绝超过 50 条语句的 batch', async () => {
    const token = 'test-gateway-token';
    const body = JSON.stringify({
      batch: Array.from({ length: 51 }, (_, index) => ({ sql: 'SELECT ?', params: [index] })),
    });
    const request = new Request('https://gateway.example.com/v1/query', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body,
    });
    const { batchSizes, database } = createDatabase();

    const response = await gateway.fetch(request, { DB: database, D1_GATEWAY_TOKEN: token });

    expect(response.status).toBe(400);
    expect(batchSizes).toEqual([]);
    expect(await response.json()).toEqual({
      success: false,
      errors: [{ message: 'batch 语句数量必须在 1 到 50 之间' }],
    });
  });

  it('在读取请求体前拒绝声明超过 512 KiB 的载荷', async () => {
    const { database } = createDatabase();
    const response = await gateway.fetch(
      new Request('https://gateway.example.com/v1/query', {
        method: 'POST',
        headers: { 'Content-Length': String((512 * 1024) + 1) },
        body: '{}',
      }),
      { DB: database },
    );

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({
      success: false,
      errors: [{ message: '请求体过大' }],
    });
  });

  it('保持方法与未知 POST 路由的状态码', async () => {
    const { database } = createDatabase();
    const methodResponse = await gateway.fetch(
      new Request('https://gateway.example.com/v1/query'),
      { DB: database },
    );
    const routeResponse = await gateway.fetch(
      new Request('https://gateway.example.com/v1/missing', { method: 'POST' }),
      { DB: database },
    );

    expect(methodResponse.status).toBe(405);
    expect(await methodResponse.json()).toEqual({
      success: false,
      errors: [{ message: 'Method not allowed' }],
    });
    expect(routeResponse.status).toBe(404);
    expect(await routeResponse.json()).toEqual({
      success: false,
      errors: [{ message: 'Not found' }],
    });
  });
});
