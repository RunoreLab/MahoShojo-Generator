import { describe, expect, it, vi } from 'vitest';

import { cloudflareArenaGenerationObserver } from '@/app/api/arena/generation-telemetry';

describe('Cloudflare Arena generation telemetry', () => {
  it('emits the same bounded observation vocabulary with an explicit runtime origin', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    cloudflareArenaGenerationObserver.observeArenaGeneration({
      event: 'provider',
      generationId: 'generation-1',
      outcome: 'failure',
      durationMs: 42,
    });

    expect(JSON.parse(String(info.mock.calls[0]?.[0]))).toEqual({
      event: 'arena.generation.telemetry',
      schemaVersion: 1,
      runtime: 'cloudflare-worker',
      observation: {
        event: 'provider',
        generationId: 'generation-1',
        outcome: 'failure',
        durationMs: 42,
      },
    });
    expect(JSON.stringify(info.mock.calls)).not.toMatch(/authorization|cookie|prompt|output|actor/u);
  });
});
