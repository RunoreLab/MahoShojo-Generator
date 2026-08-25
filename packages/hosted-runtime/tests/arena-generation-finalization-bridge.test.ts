import { describe, expect, it, vi } from 'vitest';

import { verifyArenaInternalRequest } from '../src/arena-generation/internal-http-auth';
import { createArenaFinalizationBridge } from '../src/arena-generation/finalization-bridge';

describe('Arena finalization bridge', () => {
  it('uses an authenticated versioned request and reuses its ranking result', async () => {
    const secret = 'arena-finalization-test-secret-32-bytes';
    const fetcher = vi.fn(async (requestInput: string | URL | Request, init?: RequestInit) => {
      const request = new Request(requestInput, init);
      const body = await request.clone().text();
      expect(await verifyArenaInternalRequest({ secret, request, body })).toBe(true);
      expect(JSON.parse(body)).toEqual({ version: 1, generationId: 'generation-1' });
      return Response.json({ success: true, ranking: { generationId: 'generation-1' } });
    });
    const bridge = createArenaFinalizationBridge({
      baseUrl: 'https://web.example',
      secret,
      fetch: fetcher,
    });

    await bridge.settleRatings('generation-1');
    await expect(bridge.readRanking('generation-1')).resolves.toEqual({ generationId: 'generation-1' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('rejects insecure non-local origins and short secrets', () => {
    expect(() => createArenaFinalizationBridge({
      baseUrl: 'http://web.example', secret: 'x'.repeat(32),
    })).toThrow('ARENA_FINALIZATION_URL_INVALID');
    expect(() => createArenaFinalizationBridge({
      baseUrl: 'https://web.example', secret: 'short',
    })).toThrow('ARENA_FINALIZATION_SECRET_INVALID');
  });
});
