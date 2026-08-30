import { describe, expect, test, vi } from 'vitest';

import type {
  D1LikeStatementResult,
  D1QueryOptions,
} from '../src/d1-http-client';
import {
  createNodeDataPorts,
  type NodeDataD1Client,
  type NodeDataD1Statement,
} from '../src/node-runtime/data-ports';

type D1Call = {
  sql: string;
  params: unknown[];
  options: D1QueryOptions | undefined;
};

const result = (rows: Array<Record<string, unknown>> = []): D1LikeStatementResult => ({
  success: true,
  results: rows,
  meta: {},
});

const createD1Harness = (
  results: D1LikeStatementResult[] = [],
): { client: NodeDataD1Client; calls: D1Call[] } => {
  const calls: D1Call[] = [];
  let resultIndex = 0;
  const client: NodeDataD1Client = {
    prepare(sql: string): NodeDataD1Statement {
      let params: unknown[] = [];
      const statement: NodeDataD1Statement = {
        bind(...values) {
          params = values;
          return statement;
        },
        async run(options) {
          calls.push({ sql, params, options });
          return results[resultIndex++] ?? result();
        },
        async all(options) {
          return statement.run(options);
        },
      };
      return statement;
    },
  };
  return { client, calls };
};

describe('package-owned Node data ports', () => {
  test('活动身份仅来自已验证 token，mutation 明确禁用 safe-read 重放', async () => {
    const { client, calls } = createD1Harness();
    const waitUntil = vi.fn<(_promise: Promise<unknown>) => void>();
    const request = new Request('https://api.example.test/generate');
    Object.assign(request, { context: { waitUntil } });
    const getUserIdFromActivityHeaders = vi.fn(async () => 7);
    const ports = createNodeDataPorts({
      getD1Client: () => client,
      getUserIdFromActivityHeaders,
      now: () => new Date('2026-08-24T12:34:56.000Z'),
    });

    ports.recordUserActivityFromRequest(request, 'invalid-date');
    expect(waitUntil).toHaveBeenCalledOnce();
    await waitUntil.mock.calls[0]![0];

    expect(getUserIdFromActivityHeaders).toHaveBeenCalledWith(request.headers);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.sql).toMatch(/INSERT INTO user_last_activity[\s\S]+ON CONFLICT/);
    expect(calls[0]?.params).toEqual([
      7,
      '2026-08-24T12:34:56.000Z',
      '2026-08-24T12:34:56.000Z',
    ]);
    expect(calls[0]?.options).toEqual({ retry: 'none' });

    const untrusted = createNodeDataPorts({
      getD1Client: () => client,
      getUserIdFromActivityHeaders: async () => null,
      now: () => new Date('2026-08-24T12:34:56.000Z'),
    });
    untrusted.recordUserActivityFromRequest(new Request('https://api.example.test/generate'));
    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toHaveLength(1);
  });

  test('AI availability 使用原子 UPSERT，失败 fail-soft 且不记录 channel 内容', async () => {
    const debug = vi.fn();
    const failingClient: NodeDataD1Client = {
      prepare(sql: string) {
        let params: unknown[] = [];
        const statement: NodeDataD1Statement = {
          bind(...values) {
            params = values;
            return statement;
          },
          async run(options) {
            expect(sql).toMatch(/INSERT INTO ai_channel_availability_buckets[\s\S]+ON CONFLICT/);
            expect(params).toEqual([
              '2026-08-24T12:30:00.000Z',
              'provider-secret-canary',
              'm'.repeat(200),
              0,
              1,
              0,
              'upstream-secret-canary',
              '2026-08-24T12:34:56.000Z',
            ]);
            expect(options).toEqual({ retry: 'none' });
            throw new Error('credential=secret-canary');
          },
          async all(options) {
            return statement.run(options);
          },
        };
        return statement;
      },
    };
    const ports = createNodeDataPorts({
      getD1Client: () => failingClient,
      getUserIdFromActivityHeaders: async () => null,
      now: () => new Date('2026-08-24T12:34:56.000Z'),
      log: { debug },
    });

    await expect(ports.recordAiChannelOutcome({
      providerId: 'provider-secret-canary',
      modelId: 'm'.repeat(230),
      outcome: 'failure',
      errorClass: 'upstream-secret-canary',
    })).resolves.toBeUndefined();
    expect(JSON.stringify(debug.mock.calls)).not.toMatch(/secret-canary|provider|model|credential/);
  });

  test('DataCard 只读查询启用 safe-read，并保持 questionnaire 所需 wire', async () => {
    const { client, calls } = createD1Harness([result([{
      id: 'card-1',
      user_id: 9,
      type: 'questionnaire',
      name: '问卷',
      description: null,
      data: '{"id":"q-1"}',
      is_public: 1,
      public_since: null,
      usage_count: 2,
      like_count: 3,
      favorite_count: 4,
      review_status: 'approved',
      is_recommended: 0,
      created_at: '2026-08-20T00:00:00.000Z',
      updated_at: '2026-08-21T00:00:00.000Z',
      deleted_at: null,
      username: 'owner',
      tag_ids: 'tag-a,tag-b',
    }])]);
    const ports = createNodeDataPorts({
      getD1Client: () => client,
      getUserIdFromActivityHeaders: async () => null,
      now: () => new Date('2026-08-24T12:34:56.000Z'),
    });

    const card = await ports.getDataCardById(' card-1 ', false);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.sql).toMatch(/FROM data_cards AS dc[\s\S]+INNER JOIN users AS u/);
    expect(calls[0]?.params).toEqual(['card-1']);
    expect(calls[0]?.options).toEqual({ retry: 'safe-read' });
    expect(card).toMatchObject({
      id: 'card-1',
      type: 'questionnaire',
      data: '{"id":"q-1"}',
      username: 'owner',
      tagIds: ['tag-a', 'tag-b'],
    });
  });

  test('Hosted questionnaire DataCard 匿名只读公开 approved，且忽略自报 user id', async () => {
    const { client, calls } = createD1Harness([result()]);
    const getAuthenticatedUserId = vi.fn(async () => null);
    const ports = createNodeDataPorts({
      getD1Client: () => client,
      getUserIdFromActivityHeaders: async () => null,
      getAuthenticatedUserId,
      now: () => new Date('2026-08-24T12:34:56.000Z'),
    });
    const request = new Request('https://api.example.test/generate', {
      headers: { 'X-Mahoshojo-User-Id': '9' },
    });

    await ports.getAuthorizedDataCardById(request, ' private-card ');

    expect(getAuthenticatedUserId).toHaveBeenCalledWith(request);
    expect(calls[0]?.sql).toMatch(/dc\.is_public = 1[\s\S]+dc\.review_status = 'approved'/u);
    expect(calls[0]?.sql).not.toMatch(/dc\.user_id = \?/u);
    expect(calls[0]?.params).toEqual(['private-card']);
    expect(calls[0]?.options).toEqual({ retry: 'safe-read' });
  });

  test('Hosted questionnaire DataCard 只允许可信 actor 自有卡或公开 approved 卡', async () => {
    const { client, calls } = createD1Harness([result()]);
    const request = new Request('https://api.example.test/generate', {
      headers: { Authorization: 'Bearer verified-legacy-token' },
    });
    const ports = createNodeDataPorts({
      getD1Client: () => client,
      getUserIdFromActivityHeaders: async () => null,
      getAuthenticatedUserId: async (incoming) => {
        expect(incoming).toBe(request);
        return 9;
      },
      now: () => new Date('2026-08-24T12:34:56.000Z'),
    });

    await ports.getAuthorizedDataCardById(request, 'owned-card');

    expect(calls[0]?.sql).toMatch(/dc\.user_id = \?[\s\S]+dc\.is_public = 1/u);
    expect(calls[0]?.sql).toMatch(/dc\.review_status = 'approved'/u);
    expect(calls[0]?.params).toEqual(['owned-card', 9]);
    expect(calls[0]?.options).toEqual({ retry: 'safe-read' });
  });

  test('Hosted questionnaire DataCard 遇到明确认证拒绝时不降级为匿名查询', async () => {
    const { client, calls } = createD1Harness();
    const ports = createNodeDataPorts({
      getD1Client: () => client,
      getUserIdFromActivityHeaders: async () => null,
      resolveAuthentication: async () => ({ status: 'denied' }),
      now: () => new Date('2026-08-24T12:34:56.000Z'),
    });

    await expect(ports.getAuthorizedDataCardById(
      new Request('https://api.example.test/generate', {
        headers: { Authorization: 'Bearer banned-user' },
      }),
      'public-card',
    )).resolves.toBeNull();
    expect(calls).toEqual([]);
  });
});
