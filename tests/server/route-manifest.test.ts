import { describe, expect, it } from 'vitest';
import { legacyRouteDefinitions } from '@/server/generated/legacy-routes';

describe('Hono legacy route manifest', () => {
  it('挂载全部生成类 API 白名单', () => {
    expect(legacyRouteDefinitions.map((route) => route.id).sort()).toEqual([
      'arena/generate',
      'arena/generate-stream',
      'arena/session/generate-next',
      'creator/generate',
      'creator/generate-stream',
      'generate-battle-story',
      'generate-canshou',
      'generate-canshou-stream',
      'generate-free',
      'generate-free-stream',
      'generate-game-card',
      'generate-magical-girl',
      'generate-magical-girl-details',
      'generate-magical-girl-details-stream',
      'generate-scenario',
      'generate-scenario-stream',
      'generate-sublimation',
      'generate-sublimation-stream',
      'magic-tavern/generate-choices',
      'magic-tavern/generate-stream',
      'magic-tea-party/generate-choices',
      'magic-tea-party/generate-stream',
      'magic-tea-party/generate-updates',
      'me/battle-reports/[generationId]/regenerate',
    ]);
    expect(legacyRouteDefinitions.some((route) => route.pattern === '/api/auth/*')).toBe(false);
    expect(legacyRouteDefinitions.some((route) => route.pattern.startsWith('/api/pvp/'))).toBe(false);
  });
});
