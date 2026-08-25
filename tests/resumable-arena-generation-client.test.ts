import { describe, expect, it, vi } from 'vitest';

import {
  ARENA_GENERATION_ACTOR_TOKEN_HEADER,
  ARENA_GENERATION_ACTOR_TOKEN_KEY,
  ARENA_GENERATION_CLIENT_STATE_KEY,
  openArenaGenerationStream,
} from '@/lib/arena/resumable-generation-client';

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

const response = (body: ReadableStream<Uint8Array> | string, generationId = 'generation-1') => new Response(body, {
  status: 200,
  headers: {
    'Content-Type': 'text/event-stream',
    'X-Mahoshojo-Generation-Id': generationId,
  },
});

describe('resumable Arena generation client', () => {
  it('persists a bootstrap actor credential before the first POST', async () => {
    const storage = new MemoryStorage();
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get(ARENA_GENERATION_ACTOR_TOKEN_HEADER)).toMatch(/^bootstrap\.[0-9a-f-]{36}$/u);
      expect(storage.getItem(ARENA_GENERATION_ACTOR_TOKEN_KEY)).toBe(
        headers.get(ARENA_GENERATION_ACTOR_TOKEN_HEADER),
      );
      return response('id: 1-0\nevent: done\ndata: {"status":"completed"}\n\n');
    });

    const opened = await openArenaGenerationStream({
      endpoint: '/api/arena/generate-stream',
      body: {}, headers: {}, fetcher, storage,
      generationRequestId: 'request-1234',
    });
    await opened.text();
  });

  it('reconnects with the last SSE id and never posts a second generation', async () => {
    const encoder = new TextEncoder();
    let reads = 0;
    const interrupted = new ReadableStream<Uint8Array>({
      pull(controller) {
        reads += 1;
        if (reads === 1) {
          controller.enqueue(encoder.encode('id: 1-0\nevent: markdown\ndata: {"chunk":"A"}\n\n'));
        } else {
          controller.error(new Error('network lost'));
        }
      },
    });
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response(interrupted))
      .mockResolvedValueOnce(response(
        'id: 2-0\nevent: markdown\ndata: {"chunk":"B"}\n\nid: 3-0\nevent: done\ndata: {"status":"completed"}\n\n',
      ));
    const storage = new MemoryStorage();

    const opened = await openArenaGenerationStream({
      endpoint: '/api/arena/generate-stream?format=sse',
      body: { combatants: [{}, {}] },
      headers: {},
      fetcher,
      storage,
      generationRequestId: 'request-1234',
      baseReconnectDelayMs: 1,
      random: () => 0,
    });

    await expect(opened.text()).resolves.toContain('data: {"chunk":"A"}');
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0]?.[1]?.method).toBe('POST');
    expect(fetcher.mock.calls[1]?.[0]).toBe('/api/arena/generations/generation-1/stream?after=1-0');
    expect(JSON.parse(storage.getItem(ARENA_GENERATION_CLIENT_STATE_KEY)!)).toMatchObject({
      generationId: 'generation-1',
      lastEventId: '3-0',
      state: 'completed',
    });
  });

  it('retries a lost initial handshake with the identical idempotency identity', async () => {
    const storage = new MemoryStorage();
    const seen: Array<{ body: string; actor: string | null }> = [];
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      seen.push({
        body: String(init?.body ?? ''),
        actor: new Headers(init?.headers).get(ARENA_GENERATION_ACTOR_TOKEN_HEADER),
      });
      if (seen.length === 1) throw new TypeError('response headers lost');
      return response('id: 1-0\nevent: done\ndata: {"status":"completed"}\n\n');
    });
    const opened = await openArenaGenerationStream({
      endpoint: '/api/arena/generate-stream', body: {}, headers: {}, fetcher, storage,
      generationRequestId: 'request-1234', baseReconnectDelayMs: 1, random: () => 0,
    });
    await opened.text();

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(seen[0]).toEqual(seen[1]);
    expect(JSON.parse(seen[0]!.body)).toMatchObject({ generationRequestId: 'request-1234' });
  });

  it('resumes with no cursor when the first response disconnects before any bytes', async () => {
    const disconnected = new ReadableStream<Uint8Array>({
      start(controller) { controller.error(new Error('lost before first byte')); },
    });
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response(disconnected))
      .mockResolvedValueOnce(response(
        'id: 1-0\nevent: done\ndata: {"status":"completed"}\n\n',
      ));

    const opened = await openArenaGenerationStream({
      endpoint: '/api/arena/generate-stream',
      body: {}, headers: {}, fetcher, storage: new MemoryStorage(),
      generationRequestId: 'request-1234', baseReconnectDelayMs: 1, random: () => 0,
    });
    await opened.text();

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0]?.[1]?.method).toBe('POST');
    expect(fetcher.mock.calls[1]?.[0]).toBe('/api/arena/generations/generation-1/stream');
    expect(fetcher.mock.calls[1]?.[1]?.method).toBe('GET');
  });

  it('survives repeated network toggles with monotonic cursors and one POST', async () => {
    const interrupted = (id: string, chunk: string) => {
      let reads = 0;
      return new ReadableStream<Uint8Array>({
        pull(controller) {
          reads += 1;
          if (reads === 1) {
            controller.enqueue(new TextEncoder().encode(
              `id: ${id}\nevent: markdown\ndata: {"chunk":"${chunk}"}\n\n`,
            ));
          } else {
            controller.error(new Error('network toggle'));
          }
        },
      });
    };
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response(interrupted('1-0', 'A')))
      .mockResolvedValueOnce(response(interrupted('2-0', 'B')))
      .mockResolvedValueOnce(response(
        'id: 3-0\nevent: done\ndata: {"status":"completed"}\n\n',
      ));

    const opened = await openArenaGenerationStream({
      endpoint: '/api/arena/generate-stream',
      body: {}, headers: {}, fetcher, storage: new MemoryStorage(),
      generationRequestId: 'request-1234', baseReconnectDelayMs: 1, random: () => 0,
    });
    await expect(opened.text()).resolves.toContain('{"chunk":"B"}');

    expect(fetcher.mock.calls.map(([url, init]) => [url, init?.method])).toEqual([
      ['/api/arena/generate-stream', 'POST'],
      ['/api/arena/generations/generation-1/stream?after=1-0', 'GET'],
      ['/api/arena/generations/generation-1/stream?after=2-0', 'GET'],
    ]);
  });

  it('resumes persisted state after refresh without creating a second generation', async () => {
    const storage = new MemoryStorage();
    storage.setItem(ARENA_GENERATION_CLIENT_STATE_KEY, JSON.stringify({
      version: 1,
      generationRequestId: 'request-1234',
      generationId: 'generation-1',
      lastEventId: '8-0',
      state: 'generating',
      updatedAt: '2026-08-25T00:00:00.000Z',
    }));
    const fetcher = vi.fn(async () => response(
      'id: 9-0\nevent: done\ndata: {"status":"completed"}\n\n',
    ));

    const opened = await openArenaGenerationStream({
      endpoint: '/api/arena/generate-stream?format=sse',
      body: {},
      headers: {},
      fetcher,
      storage,
    });
    await opened.text();

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toBe('/api/arena/generations/generation-1/stream?after=8-0');
    expect(fetcher.mock.calls[0]?.[1]?.method).toBe('GET');
  });

  it('subscriber cancellation does not call explicit cancel, while user stop does', async () => {
    let keepOpen!: ReadableStreamDefaultController<Uint8Array>;
    const fetcher = vi.fn(async (url: string) => {
      if (url.includes('/cancel')) return new Response(null, { status: 202 });
      return response(new ReadableStream<Uint8Array>({
        start(controller) { keepOpen = controller; },
      }));
    });
    const first = await openArenaGenerationStream({
      endpoint: '/api/arena/generate-stream',
      body: {}, headers: {}, fetcher, storage: new MemoryStorage(),
      generationRequestId: 'request-1234',
    });
    await first.body!.cancel('tab closed');
    expect(fetcher).toHaveBeenCalledTimes(1);

    const abort = new AbortController();
    const second = await openArenaGenerationStream({
      endpoint: '/api/arena/generate-stream',
      body: {}, headers: {}, fetcher, storage: new MemoryStorage(),
      generationRequestId: 'request-5678', signal: abort.signal,
    });
    abort.abort('user');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetcher.mock.calls.some(([url]) => String(url).includes('/cancel'))).toBe(true);
    void second;
    void keepOpen;
  });
});
