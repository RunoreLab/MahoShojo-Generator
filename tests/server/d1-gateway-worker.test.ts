import { describe, expect, it } from 'vitest';
import gateway from '@/server/d1-gateway/index';

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

const createRequest = async (body: string, secret: string): Promise<Request> => {
  const timestamp = String(Date.now());
  const nonce = '00000000-0000-4000-8000-000000000001';
  const pathname = '/v1/query';
  const signature = await sign(secret, `${timestamp}\n${nonce}\n${pathname}\n${body}`);
  return new Request(`https://gateway.example.com${pathname}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Mahoshojo-Timestamp': timestamp,
      'X-Mahoshojo-Nonce': nonce,
      'X-Mahoshojo-Signature': signature,
    },
    body,
  });
};

const createDatabase = () => {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const session = {
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          calls.push({ sql, params });
          return this;
        },
        async all() {
          return { success: true, results: [{ ok: 1 }], meta: { rows_read: 1 } };
        },
        async raw() {
          return [['ok'], [1]];
        },
      };
    },
    async batch(statements: unknown[]) {
      return statements.map(() => ({ success: true, results: [], meta: {} }));
    },
    getBookmark() {
      return 'bookmark-1';
    },
  };
  return {
    calls,
    database: {
      ...session,
      withSession() {
        return session;
      },
    },
  };
};

describe('D1 Gateway Worker', () => {
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
    const request = await createRequest(body, secret);
    const { database, calls } = createDatabase();
    const response = await gateway.fetch(request, { DB: database, D1_GATEWAY_HMAC_SECRET: secret });

    expect(response.status).toBe(200);
    expect(response.headers.get('x-d1-bookmark')).toBe('bookmark-1');
    expect(calls).toEqual([{ sql: 'SELECT ? AS ok', params: [1] }]);
    expect(await response.json()).toMatchObject({
      success: true,
      result: [{ success: true, results: [{ ok: 1 }] }],
    });
  });

  it('阻止 DDL 通过业务 Gateway', async () => {
    const secret = 'test-secret';
    const body = JSON.stringify({ sql: 'DROP TABLE users', params: [] });
    const request = await createRequest(body, secret);
    const { database } = createDatabase();
    const response = await gateway.fetch(request, { DB: database, D1_GATEWAY_HMAC_SECRET: secret });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ success: false });
  });
});
