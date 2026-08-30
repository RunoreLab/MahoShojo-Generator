import { describe, expect, it, vi } from 'vitest';

import { createArenaSeasonContextReader } from '../src/arena-generation/season-context';

describe('Arena season context authority', () => {
  it('normalizes the current season from a trusted configured origin', async () => {
    const fetcher = vi.fn(async () => Response.json({
      schemaVersion: 1,
      seasons: [{
        id: 's9', status: 'current',
        specialRules: {
          mode: 'scenario',
          storyGuidance: '  fixed  ',
          scenarioPresetFilename: 'season.json',
          questionnaireLorePresetIds: ['q1'],
        },
      }],
    }));
    const read = createArenaSeasonContextReader({
      baseUrl: 'https://web.example', fetch: fetcher,
    });
    await expect(read()).resolves.toEqual({
      authorityAvailable: true,
      seasonId: 's9',
      mode: 'scenario',
      storyGuidance: 'fixed',
      scenarioPresetFilename: 'season.json',
      questionnaireLoreAllowed: true,
      questionnaireLorePresetIds: ['q1'],
    });
  });

  it('marks transport failure unavailable instead of inventing classic authority', async () => {
    const read = createArenaSeasonContextReader({
      baseUrl: 'https://web.example',
      fetch: vi.fn(async () => new Response(null, { status: 503 })),
    });
    await expect(read()).resolves.toMatchObject({ authorityAvailable: false });
  });
});
