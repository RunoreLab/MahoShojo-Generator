import { describe, expect, it, vi } from 'vitest';
import {
  createD1HttpTransport,
  createHttpD1Client,
  type D1HttpTransport,
} from '@mahoshojo/hosted-runtime/d1-http-client';
import {
  registerHostedRuntimeObserver,
  resetHostedRuntimeObserverForTests,
} from '@mahoshojo/hosted-runtime/telemetry';

const observer = (events: unknown[]) => registerHostedRuntimeObserver({
  beginAiUpstream: () => ({ recordTtfb: () => undefined, finish: () => undefined }),
  observeD1RoundTrip: (event) => events.push(event),
});

describe('D1 HTTP hardening', () => {
  it('does not observe injected transports that perform zero fetches', async () => {
    const events: unknown[] = [];
    const unregister = observer(events);
    const transport: D1HttpTransport = {
      query: async () => ({ success: true, result: [{ success: true, results: [{ id: 1 }], meta: {} }] }),
      queryRaw: async () => ({ success: true, result: [{ success: true, results: [], meta: {} }] }),
      queryBatch: async () => ({ success: true, result: [] }),
    };
    try {
      const client = createHttpD1Client(transport);
      await client.prepare('SELECT secret FROM users').all();
      expect(events).toEqual([]);
    } finally {
      unregister();
      resetHostedRuntimeObserverForTests();
    }
  });

  it('fails invalid transport configuration before starting observation or fetch', () => {
    expect(() => createD1HttpTransport({ kind: 'gateway' })).toThrow('配置无效');
  });

  it('does not observe or classify a signing failure as dispatched', async () => {
    const events: unknown[] = [];
    const unregister = observer(events);
    const fetcher = vi.fn<typeof fetch>();
    const signSpy = vi.spyOn(globalThis.crypto.subtle, 'sign').mockRejectedValue(new Error('sign failed'));
    try {
      const transport = createD1HttpTransport({
        kind: 'gateway',
        baseUrl: 'https://gateway.example.test',
        hmacSecret: 'secret',
        fetch: fetcher,
      });
      const error = await transport.query('UPDATE users SET active = 1', []).catch((value: unknown) => value as Error);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error & { code?: string }).code).not.toBe('D1_INDETERMINATE_OUTCOME');
      expect(error).toMatchObject({ message: 'D1 HTTP 传输失败' });
      expect(fetcher).not.toHaveBeenCalled();
      expect(events).toEqual([]);
    } finally {
      signSpy.mockRestore();
      unregister();
      resetHostedRuntimeObserverForTests();
    }
  });

  it('sanitizes pre-dispatch body serialization failures', async () => {
    const events: unknown[] = [];
    const unregister = observer(events);
    const fetcher = vi.fn<typeof fetch>();
    const parameter = { toJSON: () => { throw new Error('sql-param-body-url-token-canary'); } };
    try {
      const error = await createD1HttpTransport({
        kind: 'cloudflare-api',
        queryUrl: 'https://d1.example.test/query',
        rawUrl: 'https://d1.example.test/raw',
        fetch: fetcher,
      }).query('UPDATE users SET secret = ?', [parameter]).catch((value: unknown) => value as Error);
      expect(error).toMatchObject({ message: 'D1 HTTP 请求参数无效' });
      expect(error.message).not.toMatch(/sql-param-body-url-token-canary/);
      expect(fetcher).not.toHaveBeenCalled();
      expect(events).toEqual([]);
    } finally {
      unregister();
      resetHostedRuntimeObserverForTests();
    }
  });

  it('uses D1 meta row counters before result-array compatibility fallback', async () => {
    const events: any[] = [];
    const unregister = observer(events);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => Response.json({ success: true, result: [{ success: true, results: [{ id: 1 }], meta: { rows_read: 7, rows_written: 4 } }] })) as typeof fetch;
    try {
      await createD1HttpTransport({ kind: 'cloudflare-api', queryUrl: 'https://d1.example.test/query', rawUrl: 'https://d1.example.test/raw' }).query('SELECT 1', []);
      expect(events[0]).toMatchObject({ rowsRead: 7, rowsWritten: 4 });
    } finally {
      globalThis.fetch = originalFetch;
      unregister();
      resetHostedRuntimeObserverForTests();
    }
  });

  it('does not emit an observation for an empty batch', async () => {
    const events: unknown[] = [];
    const unregister = observer(events);
    try {
      await expect(createHttpD1Client({
        query: vi.fn(), queryRaw: vi.fn(), queryBatch: vi.fn(),
      }).batch([])).rejects.toThrow('至少需要一条');
      const fetcher = vi.fn();
      await expect(createD1HttpTransport({
        kind: 'cloudflare-api',
        queryUrl: 'https://d1.example.test/query',
        rawUrl: 'https://d1.example.test/raw',
        fetch: fetcher,
      }).queryBatch([])).rejects.toThrow('至少需要一条');
      expect(fetcher).not.toHaveBeenCalled();
      expect(events).toEqual([]);
    } finally {
      unregister();
      resetHostedRuntimeObserverForTests();
    }
  });

  it('keeps a foreign prepared statement batch fallback without an HTTP round trip', async () => {
    const run = vi.fn(async () => ({ success: true, results: [{ id: 9 }], meta: {} }));
    const client = createHttpD1Client({
      query: vi.fn(),
      queryRaw: vi.fn(),
      queryBatch: vi.fn(),
    });
    await expect(client.batch([{ run }])).resolves.toEqual([{ success: true, results: [{ id: 9 }], meta: {} }]);
    expect(run).toHaveBeenCalledOnce();
  });

  it('aggregates batch rows_read/rows_written once per HTTP fetch', async () => {
    const events: any[] = [];
    const unregister = observer(events);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => Response.json({ success: true, result: [
      { success: true, results: [{ id: 1 }], meta: { rows_read: 5, rows_written: 2 } },
      { success: true, results: [{ id: 2 }], meta: { rows_read: 3, rows_written: 4 } },
    ] })) as typeof fetch;
    try {
      const transport = createD1HttpTransport({ kind: 'cloudflare-api', queryUrl: 'https://d1.example.test/query', rawUrl: 'https://d1.example.test/raw' });
      await transport.queryBatch([{ sqlText: 'UPDATE t SET x = 1', params: [] }, { sqlText: 'SELECT 1', params: [] }]);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ rowsRead: 8, rowsWritten: 6 });
    } finally {
      globalThis.fetch = originalFetch;
      unregister();
      resetHostedRuntimeObserverForTests();
    }
  });

  it('does not put SQL, params, response body, URL, or token in parse errors', async () => {
    const transport: D1HttpTransport = {
      query: async () => ({ success: false, errors: [{ message: 'body-canary' }] }),
      queryRaw: async () => ({}), queryBatch: async () => ({}),
    };
    const error = await createHttpD1Client(transport).prepare('SELECT sql-canary WHERE token = ?').bind('param-canary').all().catch((value: unknown) => value as Error);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toMatch(/sql-canary|param-canary|body-canary|https?:\/\/|token-canary/);
  });

  it('classifies invalid JSON as a single unknown error observation without body leakage', async () => {
    const events: any[] = [];
    const unregister = observer(events);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response('json-body-canary', { status: 200 })) as typeof fetch;
    try {
      const transport = createD1HttpTransport({ kind: 'cloudflare-api', queryUrl: 'https://d1.example.test/query', rawUrl: 'https://d1.example.test/raw' });
      await expect(transport.query('SELECT invalid-json', ['param-canary'])).rejects.toThrow('D1 HTTP 返回格式异常');
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ outcome: 'error', errorClass: 'unknown', rowsRead: 0, rowsWritten: 0 });
      expect(JSON.stringify(events)).not.toMatch(/invalid-json|param-canary|json-body-canary/);
    } finally {
      globalThis.fetch = originalFetch;
      unregister();
      resetHostedRuntimeObserverForTests();
    }
  });

  it('marks an already-dispatched mutation with an unreadable response as indeterminate', async () => {
    const events: any[] = [];
    const unregister = observer(events);
    const fetcher = vi.fn(async () => new Response('not-json', { status: 200 }));
    try {
      const error = await createD1HttpTransport({
        kind: 'cloudflare-api',
        queryUrl: 'https://d1.example.test/query',
        rawUrl: 'https://d1.example.test/raw',
        fetch: fetcher,
      }).query('UPDATE users SET active = 1', []).catch((value: unknown) => value as Error);

      expect(error).toMatchObject({ code: 'D1_INDETERMINATE_OUTCOME' });
      expect(fetcher).toHaveBeenCalledOnce();
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ outcome: 'error', errorClass: 'unknown' });
    } finally {
      unregister();
      resetHostedRuntimeObserverForTests();
    }
  });

  it.each([301, 302, 303, 307, 308])(
    'never follows HTTP %i for a mutation or replays its signed body',
    async (status) => {
      const fetcher = vi.fn(async (_input: unknown, init?: RequestInit) => {
        expect(init?.redirect).toBe('manual');
        return new Response(null, {
          status,
          headers: { location: 'https://redirect-secret-canary.invalid/v1/query' },
        });
      });
      const error = await createD1HttpTransport({
        kind: 'gateway',
        baseUrl: 'https://gateway.example.test',
        hmacSecret: 'hmac-secret-canary',
        accessClientId: 'access-id-canary',
        accessClientSecret: 'access-secret-canary',
        fetch: fetcher,
      }).query('UPDATE users SET secret = ?', ['sql-param-secret-canary'], { retry: 'safe-read' })
        .catch((value: unknown) => value as Error);

      expect(error).toMatchObject({ code: 'D1_INDETERMINATE_OUTCOME', status });
      expect(fetcher).toHaveBeenCalledOnce();
      expect(String(error)).not.toMatch(
        /redirect-secret-canary|hmac-secret-canary|access-secret-canary|sql-param-secret-canary/u,
      );
    },
  );

  it('does not double-observe hostile response header/body access', async () => {
    const events: any[] = [];
    const unregister = observer(events);
    const response = {
      status: 503,
      ok: false,
      get headers() { throw new Error('headers getter canary'); },
      get body() { throw new Error('body getter canary'); },
    } as unknown as Response;
    try {
      const error = await createD1HttpTransport({
        kind: 'cloudflare-api',
        queryUrl: 'https://d1.example.test/query',
        rawUrl: 'https://d1.example.test/raw',
        fetch: async () => response,
      }).query('UPDATE users SET active = 1', []).catch((value: unknown) => value as Error);
      expect(error).toMatchObject({ code: 'D1_INDETERMINATE_OUTCOME' });
      expect(events).toHaveLength(1);
    } finally {
      unregister();
      resetHostedRuntimeObserverForTests();
    }
  });

  it('retries safe reads but never retries mutations and signs each actual attempt', async () => {
    const originalFetch = globalThis.fetch;
    const calls: RequestInit[] = [];
    let count = 0;
    globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
      count += 1; calls.push(init ?? {});
      if (count === 1 || count === 3) return new Response('temporary-body', { status: 503, headers: { 'retry-after': '0' } });
      return Response.json({ success: true, result: [{ success: true, results: [], meta: { rows_read: 0 } }] });
    }) as typeof fetch;
    try {
      const transport = createD1HttpTransport({ kind: 'gateway', baseUrl: 'https://gateway.example.test/', hmacSecret: 'secret-canary', token: 'token-canary' });
      await transport.query('SELECT 1', [], { retry: 'safe-read' });
      expect(calls).toHaveLength(2);
      const mutationError = await transport.query('-- comment\n/* another */ UPDATE t SET x = ?', ['param-canary'], { retry: 'safe-read' }).catch((error: unknown) => error as Error);
      expect((mutationError as Error).message).toMatch(/D1 请求已发出/);
      expect(calls).toHaveLength(3);
      expect((calls[0].headers as Record<string, string>).Authorization).toBe('Bearer token-canary');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('uses exponential backoff when Retry-After is absent', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const fetcher = vi.fn(async () => {
      calls += 1;
      return calls === 1
        ? new Response('temporary', { status: 503 })
        : Response.json({ success: true, result: [{ success: true, results: [], meta: {} }] });
    });
    const promise = createD1HttpTransport({
      kind: 'cloudflare-api',
      queryUrl: 'https://d1.example.test/query',
      rawUrl: 'https://d1.example.test/raw',
      fetch: fetcher,
    }).query('SELECT 1', [], { retry: 'safe-read' });
    try {
      await Promise.resolve();
      expect(calls).toBe(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(calls).toBe(1);
      await vi.advanceTimersByTimeAsync(1_000);
      await expect(promise).resolves.toBeDefined();
      expect(calls).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses exponential backoff after a retryable fetch rejection', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const fetcher = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw new TypeError('fetch failed');
      return Response.json({ success: true, result: [{ success: true, results: [], meta: {} }] });
    });
    const promise = createD1HttpTransport({
      kind: 'cloudflare-api',
      queryUrl: 'https://d1.example.test/query',
      rawUrl: 'https://d1.example.test/raw',
      fetch: fetcher,
    }).query('SELECT 1', [], { retry: 'safe-read' });
    try {
      await Promise.resolve();
      await Promise.resolve();
      expect(calls).toBe(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(calls).toBe(1);
      await vi.advanceTimersByTimeAsync(1_000);
      await expect(promise).resolves.toBeDefined();
      expect(calls).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('never retries a semicolon-separated statement containing a mutation', async () => {
    const fetcher = vi.fn(async () => new Response('temporary', {
      status: 503,
      headers: { 'retry-after': '0' },
    }));
    const error = await createD1HttpTransport({
      kind: 'cloudflare-api',
      queryUrl: 'https://d1.example.test/query',
      rawUrl: 'https://d1.example.test/raw',
      fetch: fetcher,
    }).query('SELECT 1; UPDATE users SET active = 1', [], { retry: 'safe-read' })
      .catch((value: unknown) => value as Error);

    expect(error).toMatchObject({ code: 'D1_INDETERMINATE_OUTCOME' });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('ignores semicolons inside literals and comments when proving a read', async () => {
    let calls = 0;
    const fetcher = vi.fn(async () => {
      calls += 1;
      return calls === 1
        ? new Response('temporary', { status: 503, headers: { 'retry-after': '0' } })
        : Response.json({ success: true, result: [{ success: true, results: [], meta: {} }] });
    });
    await createD1HttpTransport({
      kind: 'cloudflare-api',
      queryUrl: 'https://d1.example.test/query',
      rawUrl: 'https://d1.example.test/raw',
      fetch: fetcher,
    }).query("-- ; comment\nSELECT 'semi;colon' /* ; block */", [], { retry: 'safe-read' });
    expect(calls).toBe(2);
  });

  it.each([
    { success: true, result: [] },
    { success: true },
    { success: true, result: [{}] },
    { success: true, result: [{ success: true }] },
    { success: true, result: [{ success: true, results: null }] },
  ])('treats malformed mutation success evidence as indeterminate: $result', async (payload) => {
    const events: any[] = [];
    const unregister = observer(events);
    try {
      const error = await createD1HttpTransport({
        kind: 'cloudflare-api',
        queryUrl: 'https://d1.example.test/query',
        rawUrl: 'https://d1.example.test/raw',
        fetch: async () => Response.json(payload),
      }).query('UPDATE users SET active = 1', []).catch((value: unknown) => value as Error);
      expect(error).toMatchObject({ code: 'D1_INDETERMINATE_OUTCOME' });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ outcome: 'error', rowsRead: 0, rowsWritten: 0 });
    } finally {
      unregister();
      resetHostedRuntimeObserverForTests();
    }
  });

  it('rejects a legacy-shaped item in a dispatched mutation batch as indeterminate', async () => {
    const events: any[] = [];
    const unregister = observer(events);
    try {
      const error = await createD1HttpTransport({
        kind: 'cloudflare-api',
        queryUrl: 'https://d1.example.test/query',
        rawUrl: 'https://d1.example.test/raw',
        fetch: async () => Response.json({
          success: true,
          result: [
            { success: true, results: [], meta: { rows_written: 1 } },
            { ok: true },
          ],
        }),
      }).queryBatch([
        { sqlText: 'UPDATE users SET active = 1', params: [] },
        { sqlText: 'SELECT 1', params: [] },
      ]).catch((value: unknown) => value as Error);

      expect(error).toMatchObject({ code: 'D1_INDETERMINATE_OUTCOME' });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ outcome: 'error', rowsRead: 0, rowsWritten: 0 });
    } finally {
      unregister();
      resetHostedRuntimeObserverForTests();
    }
  });

  it('validates and aggregates every result of a semicolon-separated HTTP query', async () => {
    const events: any[] = [];
    const unregister = observer(events);
    try {
      const transport = createD1HttpTransport({
        kind: 'cloudflare-api',
        queryUrl: 'https://d1.example.test/query',
        rawUrl: 'https://d1.example.test/raw',
        fetch: async () => Response.json({
          success: true,
          result: [
            { success: true, results: [{ id: 1 }], meta: { rows_read: 2 } },
            { success: true, results: [], meta: { rows_written: 7 } },
          ],
        }),
      });

      await expect(transport.query('SELECT 1; UPDATE users SET active = 1', []))
        .resolves.toBeDefined();
      expect(events).toEqual([expect.objectContaining({
        outcome: 'ok',
        rowsRead: 2,
        rowsWritten: 7,
      })]);
    } finally {
      unregister();
      resetHostedRuntimeObserverForTests();
    }
  });

  it('rejects a malformed later result of a dispatched multi-statement mutation', async () => {
    const events: any[] = [];
    const unregister = observer(events);
    try {
      const error = await createD1HttpTransport({
        kind: 'cloudflare-api',
        queryUrl: 'https://d1.example.test/query',
        rawUrl: 'https://d1.example.test/raw',
        fetch: async () => Response.json({
          success: true,
          result: [
            { success: true, results: [], meta: {} },
            { success: true },
          ],
        }),
      }).query('SELECT 1; UPDATE users SET active = 1', [])
        .catch((value: unknown) => value as Error);

      expect(error).toMatchObject({ code: 'D1_INDETERMINATE_OUTCOME' });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ outcome: 'error', rowsRead: 0, rowsWritten: 0 });
    } finally {
      unregister();
      resetHostedRuntimeObserverForTests();
    }
  });

  it('keeps a later explicit statement failure known instead of indeterminate', async () => {
    const events: any[] = [];
    const unregister = observer(events);
    try {
      const error = await createD1HttpTransport({
        kind: 'cloudflare-api',
        queryUrl: 'https://d1.example.test/query',
        rawUrl: 'https://d1.example.test/raw',
        fetch: async () => Response.json({
          success: true,
          result: [
            { success: true, results: [], meta: {} },
            { success: false, error: 'statement-failure-canary' },
          ],
        }),
      }).query('SELECT 1; UPDATE users SET active = 1', [])
        .catch((value: unknown) => value as Error);

      expect(error).toMatchObject({ name: 'D1HttpError', stage: 'envelope' });
      expect((error as Error & { code?: string }).code).toBeUndefined();
      expect(error.message).not.toContain('statement-failure-canary');
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ outcome: 'error', rowsRead: 0, rowsWritten: 0 });
    } finally {
      unregister();
      resetHostedRuntimeObserverForTests();
    }
  });

  it('does not observe or mark a synchronously rejected fetch seam as dispatched', async () => {
    const events: any[] = [];
    const unregister = observer(events);
    const fetcher = vi.fn(() => {
      throw new TypeError('synchronous input rejection');
    });
    try {
      const error = await createD1HttpTransport({
        kind: 'cloudflare-api',
        queryUrl: 'https://d1.example.test/query',
        rawUrl: 'https://d1.example.test/raw',
        fetch: fetcher as typeof fetch,
      }).query('UPDATE users SET active = 1', []).catch((value: unknown) => value as Error);

      expect(error).toMatchObject({ message: 'D1 HTTP 传输失败' });
      expect((error as Error & { code?: string }).code).toBeUndefined();
      expect(fetcher).toHaveBeenCalledOnce();
      expect(events).toEqual([]);
    } finally {
      unregister();
      resetHostedRuntimeObserverForTests();
    }
  });

  it('counts raw rows without meta and preserves fractional exec duration', async () => {
    const events: any[] = [];
    const unregister = observer(events);
    const fetcher = vi.fn(async () => Response.json({
      success: true,
      result: [{
        success: true,
        results: { columns: ['id'], rows: [[1], [2]] },
        meta: {},
      }],
    }));
    try {
      const transport = createD1HttpTransport({
        kind: 'cloudflare-api',
        queryUrl: 'https://d1.example.test/query',
        rawUrl: 'https://d1.example.test/raw',
        fetch: fetcher,
      });
      await transport.queryRaw('SELECT id FROM users', []);
      expect(events[0]).toMatchObject({ rowsRead: 2 });

      const client = createHttpD1Client({
        query: async () => ({
          success: true,
          result: [{ success: true, results: [], meta: { changes: 1, duration: 0.75 } }],
        }),
        queryRaw: vi.fn(),
        queryBatch: vi.fn(),
      });
      await expect(client.exec('UPDATE users SET active = 1')).resolves.toEqual({
        count: 1,
        duration: 0.75,
      });
    } finally {
      unregister();
      resetHostedRuntimeObserverForTests();
    }
  });

  it('runs foreign batch statements sequentially', async () => {
    let releaseFirst!: (_result: { success: true; results: []; meta: {} }) => void;
    const first = vi.fn(() => new Promise<{ success: true; results: []; meta: {} }>((resolve) => {
      releaseFirst = resolve;
    }));
    const second = vi.fn(async () => ({ success: true as const, results: [], meta: {} }));
    const client = createHttpD1Client({ query: vi.fn(), queryRaw: vi.fn(), queryBatch: vi.fn() });
    const pending = client.batch([{ run: first }, { run: second }]);
    await Promise.resolve();
    expect(first).toHaveBeenCalledOnce();
    expect(second).not.toHaveBeenCalled();
    releaseFirst({ success: true, results: [], meta: {} });
    await expect(pending).resolves.toHaveLength(2);
    expect(second).toHaveBeenCalledOnce();
  });

  it('preserves order for foreign-local-foreign batches', async () => {
    const order: string[] = [];
    const transport: D1HttpTransport = {
      query: async () => {
        order.push('local');
        return { success: true, result: [{ success: true, results: [], meta: {} }] };
      },
      queryRaw: async () => ({ success: true, result: [] }),
      queryBatch: async () => ({ success: true, result: [] }),
    };
    const client = createHttpD1Client(transport);
    await client.batch([
      { run: async () => { order.push('foreign-1'); return { success: true, results: [], meta: {} }; } },
      client.prepare('SELECT 1'),
      { run: async () => { order.push('foreign-2'); return { success: true, results: [], meta: {} }; } },
    ]);
    expect(order).toEqual(['foreign-1', 'local', 'foreign-2']);
  });

  it('supports first and exec while using mutation meta counters', async () => {
    const transport: D1HttpTransport = {
      query: async () => ({
        success: true,
        result: [{ success: true, results: [{ id: 3 }], meta: { rows_written: 2, duration: 4 } }],
      }),
      queryRaw: async () => ({ success: true, result: [] }),
      queryBatch: async () => ({ success: true, result: [] }),
    };
    const client = createHttpD1Client(transport);
    await expect(client.prepare('SELECT id').first<number>('id')).resolves.toBe(3);
    await expect(client.exec('UPDATE users SET active = 1')).resolves.toEqual({ count: 2, duration: 4 });
  });

  it.each([
    ['AbortError', 'aborted'],
    ['TimeoutError', 'timeout'],
  ] as const)('classifies %s without retrying', async (name, expectedClass) => {
    const events: any[] = [];
    const unregister = observer(events);
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      const error = new Error(name);
      error.name = name;
      throw error;
    }) as typeof fetch;
    try {
      const transport = createD1HttpTransport({ kind: 'cloudflare-api', queryUrl: 'https://d1.example.test/query', rawUrl: 'https://d1.example.test/raw' });
      await expect(transport.query('SELECT 1', [], { retry: 'safe-read' })).rejects.toThrow('D1 HTTP 传输失败');
      expect(calls).toBe(1);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ errorClass: expectedClass, rowsRead: 0, rowsWritten: 0 });
    } finally {
      globalThis.fetch = originalFetch;
      unregister();
      resetHostedRuntimeObserverForTests();
    }
  });

  it('classifies connect timeout as timeout and retries safe reads', async () => {
    const events: any[] = [];
    const unregister = observer(events);
    const first = Object.assign(new TypeError('connect failed'), {
      cause: { code: 'UND_ERR_CONNECT_TIMEOUT' },
    });
    let calls = 0;
    const fetcher = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw first;
      return Response.json({ success: true, result: [{ success: true, results: [], meta: {} }] });
    });
    try {
      await createD1HttpTransport({
        kind: 'cloudflare-api',
        queryUrl: 'https://d1.example.test/query',
        rawUrl: 'https://d1.example.test/raw',
        fetch: fetcher,
      }).query('SELECT 1', [], { retry: 'safe-read' });
      expect(calls).toBe(2);
      expect(events[0]).toMatchObject({ errorClass: 'timeout', outcome: 'error' });
    } finally {
      unregister();
      resetHostedRuntimeObserverForTests();
    }
  });

  it('treats hostile error getters as non-retryable without throwing from classification', async () => {
    const events: any[] = [];
    const unregister = observer(events);
    const hostile = new Proxy({}, {
      get() {
        throw new Error('getter trap');
      },
    });
    const fetcher = vi.fn(async () => { throw hostile; });
    try {
      await expect(createD1HttpTransport({
        kind: 'cloudflare-api',
        queryUrl: 'https://d1.example.test/query',
        rawUrl: 'https://d1.example.test/raw',
        fetch: fetcher,
      }).query('SELECT 1', [], { retry: 'safe-read' })).rejects.toThrow('D1 HTTP 传输失败');
      expect(fetcher).toHaveBeenCalledOnce();
      expect(events).toHaveLength(1);
    } finally {
      unregister();
      resetHostedRuntimeObserverForTests();
    }
  });
});
