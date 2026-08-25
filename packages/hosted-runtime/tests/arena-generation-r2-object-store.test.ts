import { describe, expect, it, vi } from 'vitest';

import { createArenaR2ObjectStoreFromEnvironment } from '../src/arena-generation/r2-object-store';

describe('Arena R2 object store', () => {
  it('is unavailable when credentials are incomplete', () => {
    expect(createArenaR2ObjectStoreFromEnvironment({ env: {} })).toBeNull();
  });

  it('signs deterministic private object requests without exposing credentials in the URL', async () => {
    const sign = vi.fn(async (url: string, init: RequestInit) => ({ ...init, url }));
    const fetcher = vi.fn(async () => new Response('stored', { status: 200 }));
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
    expect(JSON.stringify(sign.mock.calls)).not.toContain('private-secret');
  });
});
