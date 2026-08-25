import { describe, expect, it } from 'vitest';

import {
  ARENA_INTERNAL_GUIDANCE_SIGNATURE_HEADER,
  createArenaInternalGuidanceAuthority,
} from '../src/arena-generation/internal-authority';
import { createSignatureService } from '../src/signature';

const createService = async () => {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode('test-only-secret-key'),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
  return createSignatureService({ getSigningKey: async () => key });
};

describe('Arena internal guidance authority', () => {
  it('only accepts a server signature bound to the exact guidance', async () => {
    const authority = createArenaInternalGuidanceAuthority(await createService());
    const signature = await authority.sign('ranked server rule');
    const request = new Request('https://example.test/api/arena/generate-stream', {
      headers: { [ARENA_INTERNAL_GUIDANCE_SIGNATURE_HEADER]: signature! },
    });

    await expect(authority.resolve({
      request,
      payload: { internalGuidance: 'ranked server rule' },
    })).resolves.toBe('ranked server rule');
    await expect(authority.resolve({
      request,
      payload: { internalGuidance: 'tampered rule' },
    })).resolves.toBeNull();
  });
});
