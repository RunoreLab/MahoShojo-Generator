import { describe, expect, test } from 'bun:test';
import { queryD1Payload, queryFromD1 } from '@/lib/database/core';

type EnvSnapshot = {
  CLOUDFLARE_API_TOKEN?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  D1_DATABASE_ID?: string;
};

const readEnvSnapshot = (): EnvSnapshot => ({
  CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_API_TOKEN,
  CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID,
  D1_DATABASE_ID: process.env.D1_DATABASE_ID,
});

const restoreEnvSnapshot = (snapshot: EnvSnapshot) => {
  if (snapshot.CLOUDFLARE_API_TOKEN == null) delete process.env.CLOUDFLARE_API_TOKEN;
  else process.env.CLOUDFLARE_API_TOKEN = snapshot.CLOUDFLARE_API_TOKEN;

  if (snapshot.CLOUDFLARE_ACCOUNT_ID == null) delete process.env.CLOUDFLARE_ACCOUNT_ID;
  else process.env.CLOUDFLARE_ACCOUNT_ID = snapshot.CLOUDFLARE_ACCOUNT_ID;

  if (snapshot.D1_DATABASE_ID == null) delete process.env.D1_DATABASE_ID;
  else process.env.D1_DATABASE_ID = snapshot.D1_DATABASE_ID;
};

const setMinimalEnv = () => {
  process.env.CLOUDFLARE_API_TOKEN = 'token_x';
  process.env.CLOUDFLARE_ACCOUNT_ID = 'account_x';
  process.env.D1_DATABASE_ID = 'db_x';
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
      expect(fetchCalled).toBeFalse();
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
});
