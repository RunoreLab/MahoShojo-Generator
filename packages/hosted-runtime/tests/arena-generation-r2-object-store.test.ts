import { describe, expect, it, vi } from 'vitest';

import { createArenaR2ObjectStoreFromEnvironment } from '../src/arena-generation/r2-object-store';

describe('Arena R2 object store', () => {
  it('is unavailable when credentials are incomplete', () => {
    expect(createArenaR2ObjectStoreFromEnvironment({ env: {} })).toBeNull();
  });

  it('signs deterministic private object requests without exposing credentials in the URL', async () => {
    const sign = vi.fn(async (url: string, init: RequestInit) => new Request(url, {
      ...init,
      headers: new Headers({
        ...Object.fromEntries(new Headers(init.headers)),
        Authorization: 'AWS4-HMAC-SHA256 signed-request',
      }),
    }));
    const fetcher = vi.fn(async (request: string | URL | Request) => {
      expect(request).toBeInstanceOf(Request);
      const signedRequest = request as Request;
      expect(signedRequest.method).toBe('PUT');
      expect(signedRequest.headers.get('authorization')).toBe('AWS4-HMAC-SHA256 signed-request');
      expect((await signedRequest.clone().arrayBuffer()).byteLength).toBeGreaterThan(0);
      return new Response('stored', { status: 200 });
    });
    const store = createArenaR2ObjectStoreFromEnvironment({
      env: {
        R2_ACCESS_KEY_ID: 'access-secret',
        R2_SECRET_ACCESS_KEY: 'private-secret',
        R2_BUCKET_NAME: 'arena-output',
        R2_ENDPOINT: 'https://r2.example.test',
      },
      signer: { sign } as never,
      fetch: fetcher,
    });

    await expect(store!.put({
      key: 'v1/battle/generation-1/output.md',
      body: '完整正文',
      contentType: 'text/markdown; charset=utf-8',
      signal: new AbortController().signal,
    })).resolves.toMatchObject({ bytes: 12 });
    expect(sign).toHaveBeenCalledWith(
      'https://r2.example.test/arena-output/v1/battle/generation-1/output.md',
      expect.objectContaining({ method: 'PUT' }),
    );
    expect(fetcher).toHaveBeenCalledOnce();
    expect(JSON.stringify(sign.mock.calls)).not.toContain('private-secret');
  });

  it('returns a typed found result for an existing object', async () => {
    const sign = vi.fn(async (url: string, init: RequestInit) => new Request(url, init));
    const store = createArenaR2ObjectStoreFromEnvironment({
      env: {
        R2_ACCESS_KEY_ID: 'access-secret',
        R2_SECRET_ACCESS_KEY: 'private-secret',
        R2_BUCKET_NAME: 'arena-output',
        R2_ENDPOINT: 'https://r2.example.test',
      },
      signer: { sign } as never,
      fetch: vi.fn(async () => new Response('full body', { status: 200 })),
    });

    await expect(store!.getText('v1/battle/generation-1/output.md')).resolves.toEqual({
      kind: 'found',
      text: 'full body',
    });
  });

  it('returns a typed not-found result only for R2 404', async () => {
    const sign = vi.fn(async (url: string, init: RequestInit) => new Request(url, init));
    const store = createArenaR2ObjectStoreFromEnvironment({
      env: {
        R2_ACCESS_KEY_ID: 'access-secret',
        R2_SECRET_ACCESS_KEY: 'private-secret',
        R2_BUCKET_NAME: 'arena-output',
        R2_ENDPOINT: 'https://r2.example.test',
      },
      signer: { sign } as never,
      fetch: vi.fn(async () => new Response(null, { status: 404 })),
    });

    await expect(store!.getText('v1/battle/generation-1/output.md')).resolves.toEqual({
      kind: 'not-found',
    });
  });

  it.each([403, 500])('keeps R2 %s as a temporary read failure', async (status) => {
    const sign = vi.fn(async (url: string, init: RequestInit) => new Request(url, init));
    const store = createArenaR2ObjectStoreFromEnvironment({
      env: {
        R2_ACCESS_KEY_ID: 'access-secret',
        R2_SECRET_ACCESS_KEY: 'private-secret',
        R2_BUCKET_NAME: 'arena-output',
        R2_ENDPOINT: 'https://r2.example.test',
      },
      signer: { sign } as never,
      fetch: vi.fn(async () => new Response(null, { status })),
    });

    await expect(store!.getText('v1/battle/generation-1/output.md'))
      .rejects.toThrow(`ARENA_R2_GET_FAILED_${status}`);
  });

  it('propagates R2 network failures instead of treating them as not-found', async () => {
    const sign = vi.fn(async (url: string, init: RequestInit) => new Request(url, init));
    const networkFailure = new TypeError('network timeout');
    const store = createArenaR2ObjectStoreFromEnvironment({
      env: {
        R2_ACCESS_KEY_ID: 'access-secret',
        R2_SECRET_ACCESS_KEY: 'private-secret',
        R2_BUCKET_NAME: 'arena-output',
        R2_ENDPOINT: 'https://r2.example.test',
      },
      signer: { sign } as never,
      fetch: vi.fn(async () => { throw networkFailure; }),
    });

    await expect(store!.getText('v1/battle/generation-1/output.md')).rejects.toBe(networkFailure);
  });
});
