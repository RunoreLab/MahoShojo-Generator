import type { ArenaGenerationObserver } from '@mahoshojo/hosted-api/arena-generation/service';

/**
 * Cloudflare/OpenNext keeps per-observation logs so platform Analytics can
 * correlate Worker CPU with the same bounded lifecycle vocabulary as Hono.
 */
export const cloudflareArenaGenerationObserver: ArenaGenerationObserver = Object.freeze({
  observeArenaGeneration(observation) {
    try {
      console.info(JSON.stringify({
        event: 'arena.generation.telemetry',
        schemaVersion: 1,
        runtime: 'cloudflare-worker',
        observation,
      }));
    } catch {
      // Telemetry transport must not affect Cloudflare DR execution.
    }
  },
});
