import { describe, expect, it, vi } from 'vitest';
import type {
  D1LikeStatementResult,
  D1QueryOptions,
} from '../src/d1-http-client';
import {
  createCloudflareD1BindingDatabaseProvider,
  createHonoPrimaryDatabaseProvider,
  type CloudflareD1Binding,
} from '../src/database-provider';
import type {
  NodeDataD1Client,
  NodeDataD1Statement,
} from '../src/node-runtime/data-ports';

const result = (value: string): D1LikeStatementResult => ({
  success: true,
  results: [{ value }],
  meta: {},
});

describe('Hono primary DatabaseProvider', () => {
  it('保留 primary client、输入 bookmark lineage 与显式 transport retry 语义', async () => {
    const allOptions: Array<D1QueryOptions | undefined> = [];
    const runOptions: Array<D1QueryOptions | undefined> = [];
    const statement: NodeDataD1Statement = {
      bind: () => statement,
      all: async (options) => {
        allOptions.push(options);
        return result('all');
      },
      run: async (options) => {
        runOptions.push(options);
        return result('run');
      },
    };
    const client: NodeDataD1Client = { prepare: () => statement };
    const provider = createHonoPrimaryDatabaseProvider(() => client);

    const session = provider.openSession({
      consistency: 'replica-ok',
      bookmark: 'bookmark-before',
    });

    expect(provider.id).toBe('hono-d1-primary');
    expect(session).not.toBeNull();
    expect(session?.client).toBe(client);
    expect(session?.consistency).toBe('replica-ok');
    expect(session?.initialBookmark).toBe('bookmark-before');
    expect(session?.getBookmark()).toBe('bookmark-before');

    await session?.client.prepare('SELECT 1').all({ retry: 'safe-read' });
    await session?.client.prepare('UPDATE example').run({ retry: 'none' });
    expect(allOptions).toEqual([{ retry: 'safe-read' }]);
    expect(runOptions).toEqual([{ retry: 'none' }]);
  });

  it('primary client 缺失或 resolver 抛错时返回 unavailable', () => {
    expect(createHonoPrimaryDatabaseProvider(() => null).openSession({
      consistency: 'primary',
    })).toBeNull();
    expect(createHonoPrimaryDatabaseProvider(() => {
      throw new Error('secret-transport-canary');
    }).openSession({ consistency: 'primary' })).toBeNull();
  });
});

describe('Cloudflare D1 binding DatabaseProvider', () => {
  const createBinding = () => {
    const constraints: string[] = [];
    const queryCalls: Array<{ kind: 'all' | 'run'; args: unknown[] }> = [];
    let bookmark: string | null = null;
    const binding: CloudflareD1Binding = {
      withSession: (constraint) => {
        constraints.push(constraint);
        bookmark = constraint.startsWith('bookmark-') ? constraint : null;
        return {
          getBookmark: () => bookmark,
          prepare: () => {
            const runtimeStatement = {
              bind: (...params: unknown[]) => {
                queryCalls.push({ kind: 'all', args: ['bind', ...params] });
                return runtimeStatement;
              },
              all: async (...args: unknown[]) => {
                queryCalls.push({ kind: 'all', args });
                bookmark = 'bookmark-after-query';
                return { success: true, results: [{ ok: 1 }], meta: { rows_read: 1 } };
              },
              run: async (...args: unknown[]) => {
                queryCalls.push({ kind: 'run', args });
                bookmark = 'bookmark-after-query';
                return { success: true, results: [], meta: { rows_written: 1 } };
              },
            };
            return runtimeStatement;
          },
        };
      },
    };
    return { binding, constraints, queryCalls };
  };

  it('按 consistency 选择 first-unconstrained 或 first-primary', () => {
    const { binding, constraints } = createBinding();
    const provider = createCloudflareD1BindingDatabaseProvider(() => binding);

    expect(provider.openSession({ consistency: 'replica-ok' })).not.toBeNull();
    expect(provider.openSession({ consistency: 'primary' })).not.toBeNull();
    expect(constraints).toEqual(['first-unconstrained', 'first-primary']);
  });

  it('bookmark 优先于初始 consistency，并只返回 session 实际产生的 bookmark', async () => {
    const { binding, constraints } = createBinding();
    const provider = createCloudflareD1BindingDatabaseProvider(() => binding);
    const session = provider.openSession({
      consistency: 'primary',
      bookmark: 'bookmark-before',
    });

    expect(constraints).toEqual(['bookmark-before']);
    expect(session?.initialBookmark).toBe('bookmark-before');
    expect(session?.getBookmark()).toBe('bookmark-before');

    const queryResult = await session?.client.prepare('SELECT 1').all({ retry: 'safe-read' });
    expect(queryResult).toEqual({
      success: true,
      results: [{ ok: 1 }],
      meta: { rows_read: 1 },
    });
    expect(session?.getBookmark()).toBe('bookmark-after-query');
  });

  it('statement adapter 不把 Node retry 参数交给 binding，也不自行重试', async () => {
    const { binding, queryCalls } = createBinding();
    const provider = createCloudflareD1BindingDatabaseProvider(() => binding);
    const session = provider.openSession({ consistency: 'primary' });

    await session?.client.prepare('UPDATE example').bind(1, 'a').run({ retry: 'safe-read' });
    expect(queryCalls).toEqual([
      { kind: 'all', args: ['bind', 1, 'a'] },
      { kind: 'run', args: [] },
    ]);
  });

  it('binding、withSession 或 session shape 缺失时 fail closed', () => {
    expect(createCloudflareD1BindingDatabaseProvider(() => null).openSession({
      consistency: 'primary',
    })).toBeNull();
    expect(createCloudflareD1BindingDatabaseProvider(
      () => ({}) as CloudflareD1Binding,
    ).openSession({ consistency: 'primary' })).toBeNull();
    expect(createCloudflareD1BindingDatabaseProvider(() => ({
      withSession: vi.fn(() => {
        throw new Error('binding-secret-canary');
      }),
    })).openSession({ consistency: 'primary' })).toBeNull();
  });
});
