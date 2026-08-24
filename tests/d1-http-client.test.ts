import { describe, expect, vi, test } from 'vitest';
import {
  registerHostedRuntimeObserver,
  resetHostedRuntimeObserverForTests,
  type D1RoundTripObservation,
} from '@mahoshojo/hosted-runtime/telemetry';

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

describe('db/d1-http-client', () => {
  test('同一环境配置下替换 fetch seam 会重建 client，不复用旧 transport', async () => {
    const envSnapshot = readEnvSnapshot();
    const originalFetch = globalThis.fetch;
    let firstCalls = 0;
    let secondCalls = 0;
    const response = () => new Response(JSON.stringify({
      success: true,
      result: [{ success: true, results: [], meta: {} }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });

    try {
      process.env.CLOUDFLARE_API_TOKEN = 'cache-token';
      process.env.CLOUDFLARE_ACCOUNT_ID = 'cache-account';
      process.env.D1_DATABASE_ID = 'cache-database';
      const { createHttpD1ClientFromEnv } = await import('@/lib/db/d1-http-client');

      globalThis.fetch = (async () => {
        firstCalls += 1;
        return response();
      }) as typeof fetch;
      const first = createHttpD1ClientFromEnv();

      globalThis.fetch = (async () => {
        secondCalls += 1;
        return response();
      }) as typeof fetch;
      const second = createHttpD1ClientFromEnv();

      expect(first).not.toBeNull();
      expect(second).not.toBe(first);
      await second!.prepare('SELECT 1').all();
      expect(firstCalls).toBe(0);
      expect(secondCalls).toBe(1);

      process.env.CLOUDFLARE_API_TOKEN = 'cache-token-rotated';
      const rotated = createHttpD1ClientFromEnv();
      expect(rotated).not.toBe(second);
    } finally {
      restoreEnvSnapshot(envSnapshot);
      globalThis.fetch = originalFetch;
    }
  });

  test('每个真实 D1 HTTP round trip 都写入低基数 observation', async () => {
    const envSnapshot = readEnvSnapshot();
    const originalFetch = globalThis.fetch;
    const observations: D1RoundTripObservation[] = [];

    try {
      process.env.CLOUDFLARE_API_TOKEN = `telemetry_token_${Date.now()}`;
      process.env.CLOUDFLARE_ACCOUNT_ID = 'telemetry_account';
      process.env.D1_DATABASE_ID = 'telemetry_db';
      registerHostedRuntimeObserver({
        beginAiUpstream: () => ({ recordTtfb: () => undefined, finish: () => undefined }),
        observeD1RoundTrip: (observation) => observations.push(observation),
      });
      globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const body = JSON.parse(String(init?.body ?? '{}')) as { sql?: unknown };
        const mutation = typeof body.sql === 'string' && body.sql.startsWith('UPDATE');
        return new Response(
          JSON.stringify({
            success: true,
            result: [{
              success: true,
              results: mutation ? [] : [{ id: 1 }],
              meta: mutation ? { changes: 2 } : {},
            }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }) as typeof globalThis.fetch;

      const { createHttpD1ClientFromEnv } = await import('@/lib/db/d1-http-client');
      const client = createHttpD1ClientFromEnv() as {
        prepare: (sql: string) => {
          all: () => Promise<unknown>;
          run: () => Promise<unknown>;
        };
      } | null;

      expect(client).not.toBeNull();
      if (!client) return;
      await client.prepare('SELECT id FROM users').all();
      await client.prepare('UPDATE users SET active = 1').run();

      expect(observations).toHaveLength(2);
      expect(observations.map(({ outcome, rowsRead, rowsWritten, errorClass }) => ({
        outcome,
        rowsRead,
        rowsWritten,
        errorClass,
      }))).toEqual([
        { outcome: 'ok', rowsRead: 1, rowsWritten: 0, errorClass: 'none' },
        { outcome: 'ok', rowsRead: 0, rowsWritten: 2, errorClass: 'none' },
      ]);
      expect(JSON.stringify(observations)).not.toMatch(/SELECT|UPDATE|telemetry_token|users/);
    } finally {
      resetHostedRuntimeObserverForTests();
      restoreEnvSnapshot(envSnapshot);
      globalThis.fetch = originalFetch;
      vi.restoreAllMocks();
    }
  });

  test('raw() 使用 /raw 通道并保留数组列顺序（含重复列）', async () => {
    const envSnapshot = readEnvSnapshot();
    const originalFetch = globalThis.fetch;
    const calls = {
      query: [] as Array<{ sql: string; params: unknown[] }>,
      raw: [] as Array<{ sql: string; params: unknown[] }>,
    };

    try {
      process.env.CLOUDFLARE_API_TOKEN = `token_${Date.now()}`;
      process.env.CLOUDFLARE_ACCOUNT_ID = 'account_x';
      process.env.D1_DATABASE_ID = 'db_x';
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url = String(input);
        const body = JSON.parse(String(init?.body ?? '{}'));
        const sql = String(body.sql ?? '');
        const params = Array.isArray(body.params) ? body.params : [];

        if (url.endsWith('/raw')) {
          calls.raw.push({ sql, params });
          return new Response(
            JSON.stringify({
              success: true,
              result: [
                {
                  success: true,
                  results: {
                    columns: ['ub_id', 'badge_id', 'badge_name', 'badge_description'],
                    rows: [
                      [11, 'season_s0_hana', 'S0花牌', '在公测赛季（S0）中，任意角色严格排位达到「花牌」及以上段位。'],
                      [12, 'season_s0_veteran', 'S0历战', '在公测赛季（S0）中，任意角色自由排位对局数超过 100 场。'],
                    ],
                  },
                  meta: { duration: 2 },
                },
              ],
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            },
          );
        }

        calls.query.push({ sql, params });
        return new Response(
          JSON.stringify({
            success: true,
            result: [
              {
                success: true,
                results: [{ id: 7, name: '金主大人' }],
                meta: { duration: 1 },
              },
            ],
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }) as typeof globalThis.fetch;

      const { createHttpD1ClientFromEnv } = await import('@/lib/db/d1-http-client');
      const client = createHttpD1ClientFromEnv() as {
        prepare: (sql: string) => {
          bind: (...params: unknown[]) => {
            raw: () => Promise<unknown[][]>;
            all: () => Promise<unknown>;
          };
        };
      } | null;

      expect(client).not.toBeNull();
      if (!client) return;

      const rawRows = await client
        .prepare('SELECT ub.id, b.id, b.name, b.description FROM user_badges ub JOIN badges b ON ub.badge_id = b.id')
        .bind(42)
        .raw();

      const rawRowsWithColumns = await client
        .prepare('SELECT ub.id, b.id, b.name, b.description FROM user_badges ub JOIN badges b ON ub.badge_id = b.id')
        .bind(42)
        .raw({ columnNames: true });

      expect(rawRows).toEqual([
        [11, 'season_s0_hana', 'S0花牌', '在公测赛季（S0）中，任意角色严格排位达到「花牌」及以上段位。'],
        [12, 'season_s0_veteran', 'S0历战', '在公测赛季（S0）中，任意角色自由排位对局数超过 100 场。'],
      ]);
      expect(rawRowsWithColumns).toEqual([
        ['ub_id', 'badge_id', 'badge_name', 'badge_description'],
        [11, 'season_s0_hana', 'S0花牌', '在公测赛季（S0）中，任意角色严格排位达到「花牌」及以上段位。'],
        [12, 'season_s0_veteran', 'S0历战', '在公测赛季（S0）中，任意角色自由排位对局数超过 100 场。'],
      ]);

      const allResult = await client.prepare('SELECT id, name FROM badges').bind().all();
      expect(allResult).toEqual({
        success: true,
        results: [{ id: 7, name: '金主大人' }],
        meta: { duration: 1 },
      });

      expect(calls.raw).toHaveLength(2);
      expect(calls.query).toHaveLength(1);
      expect(calls.raw[0]).toEqual({
        sql: 'SELECT ub.id, b.id, b.name, b.description FROM user_badges ub JOIN badges b ON ub.badge_id = b.id',
        params: [42],
      });
      expect(calls.query[0]).toEqual({
        sql: 'SELECT id, name FROM badges',
        params: [],
      });
    } finally {
      restoreEnvSnapshot(envSnapshot);
      globalThis.fetch = originalFetch;
      vi.restoreAllMocks();
    }
  });

  test('batch() 应合并为单次 query 请求并按语句顺序返回结果', async () => {
    const envSnapshot = readEnvSnapshot();
    const originalFetch = globalThis.fetch;
    const queryCalls: Array<{
      sql: string | null;
      params: unknown[];
      batch: Array<{ sql: string; params: unknown[] }>;
    }> = [];

    try {
      process.env.CLOUDFLARE_API_TOKEN = `token_${Date.now()}`;
      process.env.CLOUDFLARE_ACCOUNT_ID = 'account_x';
      process.env.D1_DATABASE_ID = 'db_x';
      globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const body = JSON.parse(String(init?.body ?? '{}'));
        queryCalls.push({
          sql: typeof body.sql === 'string' ? body.sql : null,
          params: Array.isArray(body.params) ? body.params : [],
          batch: Array.isArray(body.batch)
            ? body.batch.map((item: Record<string, unknown>) => ({
                sql: String(item?.sql ?? ''),
                params: Array.isArray(item?.params) ? item.params : [],
              }))
            : [],
        });

        return new Response(
          JSON.stringify({
            success: true,
            result: [
              {
                success: true,
                results: [{ redeemed_slot_count: 3 }],
                meta: { changes: 1 },
              },
              {
                success: true,
                results: [],
                meta: { changes: 1 },
              },
              {
                success: true,
                results: [{ slot_count: 3 }],
                meta: { changes: 1 },
              },
            ],
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }) as typeof globalThis.fetch;

      const { createHttpD1ClientFromEnv } = await import('@/lib/db/d1-http-client');
      const client = createHttpD1ClientFromEnv() as {
        prepare: (sql: string) => { bind: (...params: unknown[]) => unknown };
        batch: (statements: unknown[]) => Promise<Array<{ results: Array<Record<string, unknown>> }>>;
      } | null;

      expect(client).not.toBeNull();
      if (!client) return;

      const results = await client.batch([
        client
          .prepare('UPDATE users SET slot_count = COALESCE(slot_count, 0) + ? WHERE id = ? RETURNING ? AS redeemed_slot_count')
          .bind(3, 7, 3),
        client
          .prepare('INSERT OR IGNORE INTO user_badges (user_id, badge_id) VALUES (?, ?)')
          .bind(7, 'sponsor'),
        client
          .prepare('DELETE FROM redemption_codes WHERE code = ? RETURNING slot_count AS slot_count')
          .bind('ABC-123'),
      ]);

      expect(queryCalls).toHaveLength(1);
      expect(queryCalls[0]?.sql).toBeNull();
      expect(queryCalls[0]?.params).toEqual([]);
      expect(queryCalls[0]?.batch).toEqual([
        {
          sql: 'UPDATE users SET slot_count = COALESCE(slot_count, 0) + ? WHERE id = ? RETURNING ? AS redeemed_slot_count',
          params: [3, 7, 3],
        },
        {
          sql: 'INSERT OR IGNORE INTO user_badges (user_id, badge_id) VALUES (?, ?)',
          params: [7, 'sponsor'],
        },
        {
          sql: 'DELETE FROM redemption_codes WHERE code = ? RETURNING slot_count AS slot_count',
          params: ['ABC-123'],
        },
      ]);
      expect(results).toEqual([
        { success: true, results: [{ redeemed_slot_count: 3 }], meta: { changes: 1 } },
        { success: true, results: [], meta: { changes: 1 } },
        { success: true, results: [{ slot_count: 3 }], meta: { changes: 1 } },
      ]);
    } finally {
      restoreEnvSnapshot(envSnapshot);
      globalThis.fetch = originalFetch;
      vi.restoreAllMocks();
    }
  });
});
