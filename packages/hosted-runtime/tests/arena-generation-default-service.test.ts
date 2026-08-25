import { describe, expect, it } from 'vitest';

import {
  canonicalizeArenaGenerationPayload,
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
});
