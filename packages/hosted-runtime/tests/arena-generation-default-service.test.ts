import { describe, expect, it } from 'vitest';

import {
  canonicalizeArenaGenerationPayload,
  deriveArenaGenerationId,
  hashArenaGenerationPayload,
} from '../src/arena-generation/default-service';

describe('Arena generation default service primitives', () => {
  it('canonicalizes nested object keys without reordering arrays', async () => {
    const left = { z: 1, nested: { b: 2, a: 1 }, list: [{ y: 2, x: 1 }, 3] };
    const right = { list: [{ x: 1, y: 2 }, 3], nested: { a: 1, b: 2 }, z: 1 };

    expect(canonicalizeArenaGenerationPayload(left)).toBe(
      canonicalizeArenaGenerationPayload(right),
    );
    await expect(hashArenaGenerationPayload(left)).resolves.toBe(
      await hashArenaGenerationPayload(right),
    );
  });

  it('derives a stable actor-scoped generation identity', async () => {
    const input = { actorKey: 'user:42', generationRequestId: 'request-1234' };
    const generationId = await deriveArenaGenerationId(input);

    expect(generationId).toMatch(/^arena_[a-f0-9]{64}$/u);
    await expect(deriveArenaGenerationId(input)).resolves.toBe(generationId);
    await expect(deriveArenaGenerationId({ ...input, actorKey: 'user:43' }))
      .resolves.not.toBe(generationId);
  });
});
