import { describe, expect, test, vi } from 'vitest';
import {
  createWithCustomId,
  queryD1BatchPayload,
  queryD1Payload,
  queryD1RawPayload,
  queryFromD1,
  saveToD1,
  updateById,
} from '@/lib/database/core';

type EnvSnapshot = {
  CLOUDFLARE_API_TOKEN?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  D1_DATABASE_ID?: string;
  D1_GATEWAY_URL?: string;
  D1_GATEWAY_HMAC_SECRET?: string;
};

const readEnvSnapshot = (): EnvSnapshot => ({
  CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_API_TOKEN,
  CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID,
  D1_DATABASE_ID: process.env.D1_DATABASE_ID,
  D1_GATEWAY_URL: process.env.D1_GATEWAY_URL,
  D1_GATEWAY_HMAC_SECRET: process.env.D1_GATEWAY_HMAC_SECRET,
});

const restoreEnvSnapshot = (snapshot: EnvSnapshot) => {
  if (snapshot.CLOUDFLARE_API_TOKEN == null) delete process.env.CLOUDFLARE_API_TOKEN;
  else process.env.CLOUDFLARE_API_TOKEN = snapshot.CLOUDFLARE_API_TOKEN;

  if (snapshot.CLOUDFLARE_ACCOUNT_ID == null) delete process.env.CLOUDFLARE_ACCOUNT_ID;
  else process.env.CLOUDFLARE_ACCOUNT_ID = snapshot.CLOUDFLARE_ACCOUNT_ID;

  if (snapshot.D1_DATABASE_ID == null) delete process.env.D1_DATABASE_ID;
  else process.env.D1_DATABASE_ID = snapshot.D1_DATABASE_ID;

  if (snapshot.D1_GATEWAY_URL == null) delete process.env.D1_GATEWAY_URL;
  else process.env.D1_GATEWAY_URL = snapshot.D1_GATEWAY_URL;

  if (snapshot.D1_GATEWAY_HMAC_SECRET == null) delete process.env.D1_GATEWAY_HMAC_SECRET;
  else process.env.D1_GATEWAY_HMAC_SECRET = snapshot.D1_GATEWAY_HMAC_SECRET;
};

const setMinimalEnv = () => {
  delete process.env.D1_GATEWAY_URL;
  delete process.env.D1_GATEWAY_HMAC_SECRET;
  process.env.CLOUDFLARE_API_TOKEN = 'token_x';
  process.env.CLOUDFLARE_ACCOUNT_ID = 'account_x';
  process.env.D1_DATABASE_ID = 'db_x';
};

const setGatewayEnv = () => {
  process.env.D1_GATEWAY_URL = 'https://gateway.example.test';
  process.env.D1_GATEWAY_HMAC_SECRET = 'gateway-secret';
};

const withSilencedConsoleError = async (fn: () => Promise<void>) => {
  const originalError = console.error;
  console.error = () => undefined;
  try {
    await fn();
  } finally {
    console.error = originalError;
  }
};

describe('database/core queryD1Payload', () => {
  test('成功时返回 JSON payload，并携带正确的 SQL/参数', async () => {
    const envSnapshot = readEnvSnapshot();
    const originalFetch = globalThis.fetch;

    try {
      setMinimalEnv();
      let calledUrl = '';
      let calledInit: RequestInit | undefined;

      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        calledUrl = String(input);
        calledInit = init;
        return new Response(JSON.stringify({ success: true, result: [{ ok: true }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }) as typeof globalThis.fetch;

      const result = await queryD1Payload('SELECT * FROM users WHERE id = ?', [123]);
      expect(result).toEqual({ success: true, result: [{ ok: true }] });
      expect(calledUrl).toBe(
        'https://api.cloudflare.com/client/v4/accounts/account_x/d1/database/db_x/query',
      );

      const body = JSON.parse(String(calledInit?.body ?? '{}'));
      expect(body.sql).toBe('SELECT * FROM users WHERE id = ?');
      expect(body.params).toEqual([123]);

      const headers = calledInit?.headers as Record<string, string>;
      expect(headers.Authorization).toBe('Bearer token_x');
      expect(headers['Content-Type']).toBe('application/json');
    } finally {
      globalThis.fetch = originalFetch;
      restoreEnvSnapshot(envSnapshot);
    }
  });

  test('HTTP 非 2xx 时抛出带状态与响应体的错误', async () => {
    const envSnapshot = readEnvSnapshot();
    const originalFetch = globalThis.fetch;

    try {
      setMinimalEnv();
      globalThis.fetch = (async () =>
        new Response(' bad request body ', {
          status: 400,
          statusText: 'Bad Request',
        })) as typeof globalThis.fetch;

      await withSilencedConsoleError(async () => {
        await expect(queryD1Payload('SELECT 1', [])).rejects.toThrow(
          'D1 API 错误: 400 Bad Request - bad request body',
        );
      });
    } finally {
      globalThis.fetch = originalFetch;
      restoreEnvSnapshot(envSnapshot);
    }
  });

  test('缺少 Cloudflare 配置时直接失败', async () => {
    const envSnapshot = readEnvSnapshot();
    const originalFetch = globalThis.fetch;

    try {
      delete process.env.CLOUDFLARE_API_TOKEN;
      delete process.env.CLOUDFLARE_ACCOUNT_ID;
      delete process.env.D1_DATABASE_ID;

      let fetchCalled = false;
      globalThis.fetch = (async () => {
        fetchCalled = true;
        return new Response('{}', { status: 200 });
      }) as typeof globalThis.fetch;

      await withSilencedConsoleError(async () => {
        await expect(queryD1Payload('SELECT 1', [])).rejects.toThrow('缺少 Cloudflare 配置信息');
      });
      expect(fetchCalled).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
      restoreEnvSnapshot(envSnapshot);
    }
  });

  test('queryFromD1 兼容别名行为与 queryD1Payload 一致', async () => {
    const envSnapshot = readEnvSnapshot();
    const originalFetch = globalThis.fetch;

    try {
      setMinimalEnv();
      globalThis.fetch = (async () =>
        new Response(JSON.stringify({ success: true, result: [{ alias: true }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })) as typeof globalThis.fetch;

      const result = await queryFromD1('SELECT 1', []);
      expect(result).toEqual({ success: true, result: [{ alias: true }] });
    } finally {
      globalThis.fetch = originalFetch;
      restoreEnvSnapshot(envSnapshot);
    }
  });

  test('queryD1RawPayload 命中 /raw 端点并返回 JSON payload', async () => {
    const envSnapshot = readEnvSnapshot();
    const originalFetch = globalThis.fetch;

    try {
      setMinimalEnv();
      let calledUrl = '';
      let calledInit: RequestInit | undefined;

      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        calledUrl = String(input);
        calledInit = init;
        return new Response(JSON.stringify({ success: true, result: [{ raw: true }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }) as typeof globalThis.fetch;

      const result = await queryD1RawPayload('SELECT id, name FROM badges', []);
      expect(result).toEqual({ success: true, result: [{ raw: true }] });
      expect(calledUrl).toBe(
        'https://api.cloudflare.com/client/v4/accounts/account_x/d1/database/db_x/raw',
      );

      const body = JSON.parse(String(calledInit?.body ?? '{}'));
      expect(body.sql).toBe('SELECT id, name FROM badges');
      expect(body.params).toEqual([]);
    } finally {
      globalThis.fetch = originalFetch;
      restoreEnvSnapshot(envSnapshot);
    }
  });

  test('mutation 收到可重试状态时不透明重放，并报告未知提交结果', async () => {
    const envSnapshot = readEnvSnapshot();
    const originalFetch = globalThis.fetch;

    try {
      setMinimalEnv();
      let fetchCalls = 0;
      globalThis.fetch = (async () => {
        fetchCalls += 1;
        return new Response('temporarily unavailable', {
          status: 503,
          headers: { 'Retry-After': '0' },
        });
      }) as typeof globalThis.fetch;

      await withSilencedConsoleError(async () => {
        await expect(queryD1Payload('UPDATE shojo SET data = ? WHERE id = ?', ['{}', '1']))
          .rejects.toMatchObject({
            name: 'D1IndeterminateOutcomeError',
            code: 'D1_INDETERMINATE_OUTCOME',
            status: 503,
          });
      });
      expect(fetchCalls).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
      restoreEnvSnapshot(envSnapshot);
    }
  });

  test('mutation 遇到可重试 fetch 错误时不透明重放，并报告未知提交结果', async () => {
    const envSnapshot = readEnvSnapshot();
    const originalFetch = globalThis.fetch;
    vi.useFakeTimers();

    try {
      setMinimalEnv();
      let fetchCalls = 0;
      globalThis.fetch = (async () => {
        fetchCalls += 1;
        throw new TypeError('fetch failed');
      }) as typeof globalThis.fetch;

      await withSilencedConsoleError(async () => {
        const pendingError = queryD1Payload('DELETE FROM shojo WHERE id = ?', ['1'])
          .catch((error: unknown) => error);
        await vi.runAllTimersAsync();
        await expect(pendingError).resolves.toMatchObject({
          name: 'D1IndeterminateOutcomeError',
          code: 'D1_INDETERMINATE_OUTCOME',
        });
      });
      expect(fetchCalls).toBe(1);
    } finally {
      vi.useRealTimers();
      globalThis.fetch = originalFetch;
      restoreEnvSnapshot(envSnapshot);
    }
  });

  test('混合读写 batch 收到可重试状态时不透明重放', async () => {
    const envSnapshot = readEnvSnapshot();
    const originalFetch = globalThis.fetch;

    try {
      setMinimalEnv();
      let fetchCalls = 0;
      globalThis.fetch = (async () => {
        fetchCalls += 1;
        return new Response('temporarily unavailable', {
          status: 503,
          headers: { 'Retry-After': '0' },
        });
      }) as typeof globalThis.fetch;

      await withSilencedConsoleError(async () => {
        await expect(queryD1BatchPayload([
          { sql: 'SELECT 1 AS ok' },
          { sql: 'INSERT INTO shojo (data) VALUES (?)', params: ['{}'] },
        ])).rejects.toMatchObject({
          name: 'D1IndeterminateOutcomeError',
          code: 'D1_INDETERMINATE_OUTCOME',
          status: 503,
        });
      });
      expect(fetchCalls).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
      restoreEnvSnapshot(envSnapshot);
    }
  });

  test('显式 safe-read 可重试查询', async () => {
    const envSnapshot = readEnvSnapshot();
    const originalFetch = globalThis.fetch;

    try {
      setMinimalEnv();
      let fetchCalls = 0;
      globalThis.fetch = (async () => {
        fetchCalls += 1;
        if (fetchCalls === 1) {
          return new Response('temporarily unavailable', {
            status: 503,
            headers: { 'Retry-After': '0' },
          });
        }
        return new Response(JSON.stringify({ success: true, result: [{ ok: 1 }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }) as typeof globalThis.fetch;

      const result = await queryD1Payload('SELECT 1 AS ok', [], { retry: 'safe-read' });
      expect(result).toEqual({ success: true, result: [{ ok: 1 }] });
      expect(fetchCalls).toBe(2);
    } finally {
      globalThis.fetch = originalFetch;
      restoreEnvSnapshot(envSnapshot);
    }
  });

  test.each([
    ['createWithCustomId', () => createWithCustomId('{}', 'shojo')],
    ['updateById', () => updateById('record-1', '{}', 'shojo')],
    ['saveToD1', () => saveToD1({ id: 'record-1' })],
  ])('%s 不吞掉未知提交结果', async (_name, invoke) => {
    const envSnapshot = readEnvSnapshot();
    const originalFetch = globalThis.fetch;

    try {
      setMinimalEnv();
      let fetchCalls = 0;
      globalThis.fetch = (async () => {
        fetchCalls += 1;
        return new Response('temporarily unavailable', {
          status: 503,
          headers: { 'Retry-After': '0' },
        });
      }) as typeof globalThis.fetch;

      await withSilencedConsoleError(async () => {
        await expect(invoke()).rejects.toMatchObject({
          name: 'D1IndeterminateOutcomeError',
          code: 'D1_INDETERMINATE_OUTCOME',
          status: 503,
        });
      });
      expect(fetchCalls).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
      restoreEnvSnapshot(envSnapshot);
    }
  });

  test('Gateway safe-read 的每次 attempt 都重新生成鉴权证据', async () => {
    const envSnapshot = readEnvSnapshot();
    const originalFetch = globalThis.fetch;
    const dateNowSpy = vi.spyOn(Date, 'now')
      .mockReturnValueOnce(1_700_000_000_000)
      .mockReturnValue(1_700_000_000_001);

    try {
      setGatewayEnv();
      const attemptHeaders: Array<Record<string, string>> = [];
      globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
        attemptHeaders.push(init?.headers as Record<string, string>);
        if (attemptHeaders.length === 1) {
          return new Response('temporarily unavailable', {
            status: 503,
            headers: { 'Retry-After': '0' },
          });
        }
        return new Response(JSON.stringify({ success: true, result: [{ ok: 1 }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }) as typeof globalThis.fetch;

      await queryD1Payload('SELECT 1 AS ok', [], { retry: 'safe-read' });

      expect(attemptHeaders).toHaveLength(2);
      for (const headers of attemptHeaders) {
        expect(headers['X-Mahoshojo-Timestamp']).toBeTruthy();
        expect(headers['X-Mahoshojo-Nonce']).toBeTruthy();
        expect(headers['X-Mahoshojo-Signature']).toBeTruthy();
      }
      expect(attemptHeaders[0]['X-Mahoshojo-Timestamp'])
        .not.toBe(attemptHeaders[1]['X-Mahoshojo-Timestamp']);
      expect(attemptHeaders[0]['X-Mahoshojo-Nonce'])
        .not.toBe(attemptHeaders[1]['X-Mahoshojo-Nonce']);
      expect(attemptHeaders[0]['X-Mahoshojo-Signature'])
        .not.toBe(attemptHeaders[1]['X-Mahoshojo-Signature']);
    } finally {
      dateNowSpy.mockRestore();
      globalThis.fetch = originalFetch;
      restoreEnvSnapshot(envSnapshot);
    }
  });
});
