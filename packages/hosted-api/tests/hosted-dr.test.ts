import { describe, expect, it, vi } from 'vitest';
import {
  createHostedDrReadinessService,
  selectHostedDrRuntime,
  type HostedDrReadinessDatabaseProvider,
} from '../src/hosted-dr';

describe('Hosted DR runtime selector', () => {
  it('把尚未 dispatch 的 safe read 在 primary unavailable 时交给 Next DR', () => {
    expect(selectHostedDrRuntime({
      requestClass: 'safe-read',
      dispatchState: 'not-dispatched',
      primaryHealth: 'unavailable',
      hasDurableIdempotencyProof: false,
    })).toBe('next-dr');
  });

  it('只让带 durable proof 的幂等命令在 primary unavailable 时进入 Next DR', () => {
    const input = {
      requestClass: 'durably-idempotent-command' as const,
      dispatchState: 'not-dispatched' as const,
      primaryHealth: 'unavailable' as const,
    };

    expect(selectHostedDrRuntime({
      ...input,
      hasDurableIdempotencyProof: true,
    })).toBe('next-dr');
    expect(selectHostedDrRuntime({
      ...input,
      hasDurableIdempotencyProof: false,
    })).toBe('fail-closed');
  });

  it('允许控制面把尚未 dispatch 的非幂等新 operation 直接选择到 Next DR', () => {
    expect(selectHostedDrRuntime({
      requestClass: 'non-idempotent-operation',
      dispatchState: 'not-dispatched',
      primaryHealth: 'unavailable',
      hasDurableIdempotencyProof: false,
    })).toBe('next-dr');
  });

  it.each(['dispatched', 'unknown'] as const)(
    '对 %s 的非幂等 operation fail closed，禁止透明第二次 POST',
    (dispatchState) => {
      expect(selectHostedDrRuntime({
        requestClass: 'non-idempotent-operation',
        dispatchState,
        primaryHealth: 'unavailable',
        hasDurableIdempotencyProof: false,
      })).toBe('fail-closed');
    },
  );

  it('primary 健康时只把后续未 dispatch 请求交给 Hono，不改变既有请求的决定', () => {
    expect(selectHostedDrRuntime({
      requestClass: 'non-idempotent-operation',
      dispatchState: 'not-dispatched',
      primaryHealth: 'healthy',
      hasDurableIdempotencyProof: false,
    })).toBe('hono-primary');
    expect(selectHostedDrRuntime({
      requestClass: 'non-idempotent-operation',
      dispatchState: 'unknown',
      primaryHealth: 'healthy',
      hasDurableIdempotencyProof: false,
    })).toBe('fail-closed');
  });

  it('primary 健康状态不明确时 fail closed', () => {
    expect(selectHostedDrRuntime({
      requestClass: 'safe-read',
      dispatchState: 'not-dispatched',
      primaryHealth: 'unknown',
      hasDurableIdempotencyProof: false,
    })).toBe('fail-closed');
  });
});

const readinessProvider = (
  result: unknown = { success: true, results: [{ ok: 1 }], meta: {} },
): {
  provider: HostedDrReadinessDatabaseProvider;
  sql: string[];
  options: unknown[];
} => {
  const sql: string[] = [];
  const options: unknown[] = [];
  return {
    provider: {
      id: 'cloudflare-d1-binding',
      openSession: ({ consistency }) => ({
        consistency,
        initialBookmark: 'bookmark-secret-canary',
        getBookmark: () => 'bookmark-secret-canary',
        client: {
          prepare: (statementSql) => {
            sql.push(statementSql);
            return {
              bind: () => {
                throw new Error('readiness SQL 不得 bind 任意输入');
              },
              run: async () => {
                throw new Error('readiness 必须使用 all safe-read');
              },
              all: async (queryOptions) => {
                options.push(queryOptions);
                return result as never;
              },
            };
          },
        },
      }),
    },
    sql,
    options,
  };
};

describe('Hosted DR readiness application contract', () => {
  it('只执行固定 SELECT 1 safe-read 并返回最小公开 contract', async () => {
    const { provider, sql, options } = readinessProvider();
    const service = createHostedDrReadinessService({
      placement: 'next-dr',
      provider,
    });

    const response = await service(new Request('https://example.test/api/hosted/dr-readiness'));

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({
      ok: true,
      contractVersion: 'g25e1-v1',
      placement: 'next-dr',
      databaseProvider: 'cloudflare-d1-binding',
      consistency: 'replica-ok',
    });
    expect(sql).toEqual(['SELECT 1 AS ok']);
    expect(options).toEqual([{ retry: 'safe-read' }]);
  });

  it('HEAD 保持状态与 header parity 且 body 为空', async () => {
    const { provider } = readinessProvider();
    const service = createHostedDrReadinessService({
      placement: 'hono-primary',
      provider,
    });

    const response = await service(new Request(
      'https://example.test/api/hosted/dr-readiness',
      { method: 'HEAD' },
    ));

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).toBe('');
  });

  it.each([
    ['missing provider', null],
    ['query failure', new Error('db-url-secret-canary')],
    ['invalid result', { success: true, results: [{ ok: 0 }], meta: {} }],
  ] as const)('%s 时返回固定 503 且不泄漏内部值', async (_label, outcome) => {
    const provider = outcome === null
      ? { id: 'cloudflare-d1-binding' as const, openSession: () => null }
      : readinessProvider(outcome).provider;
    if (outcome instanceof Error) {
      provider.openSession = () => ({
        consistency: 'replica-ok',
        initialBookmark: 'bookmark-secret-canary',
        getBookmark: () => 'bookmark-secret-canary',
        client: {
          prepare: () => ({
            bind: () => { throw outcome; },
            run: async () => { throw outcome; },
            all: async () => { throw outcome; },
          }),
        },
      });
    }
    const service = createHostedDrReadinessService({
      placement: 'next-dr',
      provider,
    });

    const response = await service(new Request('https://example.test/api/hosted/dr-readiness'));
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(JSON.parse(body)).toEqual({
      ok: false,
      code: 'HOSTED_DR_CAPABILITY_UNAVAILABLE',
      contractVersion: 'g25e1-v1',
    });
    expect(body).not.toMatch(/bookmark-secret-canary|db-url-secret-canary|SELECT 1/u);
  });

  it('拒绝 GET/HEAD 之外的方法且不打开 provider session', async () => {
    const openSession = vi.fn();
    const service = createHostedDrReadinessService({
      placement: 'next-dr',
      provider: { id: 'cloudflare-d1-binding', openSession },
    });

    const response = await service(new Request(
      'https://example.test/api/hosted/dr-readiness',
      { method: 'POST' },
    ));

    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET, HEAD');
    expect(openSession).not.toHaveBeenCalled();
  });
});
