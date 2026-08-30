import { describe, expect, it } from 'vitest';

import {
  createArenaInternalAuthHeaders,
  verifyArenaInternalRequest,
} from '../src/arena-generation/internal-http-auth';

describe('Arena internal HTTP auth', () => {
  it('binds method, path and body and rejects expired signatures', async () => {
    const secret = 'arena-finalization-test-secret-32-bytes';
    const body = JSON.stringify({ version: 1, generationId: 'generation-1' });
    const now = new Date('2026-08-25T00:00:00.000Z');
    const headers = await createArenaInternalAuthHeaders({
      secret,
      method: 'POST',
      pathname: '/api/internal/arena-generation/finalize',
      body,
      now,
      nonce: '123e4567-e89b-42d3-a456-426614174000',
    });
    const request = new Request('https://web.example/api/internal/arena-generation/finalize', {
      method: 'POST', headers, body,
    });

    await expect(verifyArenaInternalRequest({ secret, request, body, now })).resolves.toBe(true);
    await expect(verifyArenaInternalRequest({
      secret,
      request: new Request('https://web.example/api/internal/arena-generation/other', {
        method: 'POST', headers, body,
      }),
      body,
      now,
    })).resolves.toBe(false);
    await expect(verifyArenaInternalRequest({
      secret,
      request,
      body: `${body} `,
      now,
    })).resolves.toBe(false);
    await expect(verifyArenaInternalRequest({
      secret,
      request,
      body,
      now: new Date(now.getTime() + 61_000),
    })).resolves.toBe(false);
  });
});
