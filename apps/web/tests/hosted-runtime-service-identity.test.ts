import { describe, expect, test, vi } from 'vitest';

import {
  defaultGenerateCanshouService as packageCanshou,
  defaultGenerateCanshouStreamService as packageCanshouStream,
  defaultGenerateCreatorService as packageCreator,
  defaultGenerateCreatorStreamService as packageCreatorStream,
  defaultGenerateFreeService as packageFree,
  defaultGenerateFreeStreamService as packageFreeStream,
  defaultGenerateGameCardService as packageGameCard,
  defaultGenerateMagicalGirlService as packageMagicalGirl,
  defaultGenerateMagicalGirlDetailsService as packageMagicalGirlDetails,
  defaultGenerateMagicalGirlDetailsStreamService as packageMagicalGirlDetailsStream,
  defaultGenerateScenarioService as packageScenario,
  defaultGenerateScenarioStreamService as packageScenarioStream,
  defaultGenerateSublimationService as packageSublimation,
  defaultGenerateSublimationStreamService as packageSublimationStream,
} from '@mahoshojo/hosted-runtime/node-runtime/default-services';
import { defaultGenerateCanshouService } from '@/lib/hosted-api/generate-canshou';
import { defaultGenerateCanshouStreamService } from '@/lib/hosted-api/generate-canshou-stream';
import { defaultGenerateCreatorService } from '@/lib/hosted-api/generate-creator';
import { defaultGenerateCreatorStreamService } from '@/lib/hosted-api/generate-creator-stream';
import { defaultGenerateFreeService } from '@/lib/hosted-api/generate-free';
import { defaultGenerateFreeStreamService } from '@/lib/hosted-api/generate-free-stream';
import { defaultGenerateGameCardService } from '@/lib/hosted-api/generate-game-card';
import { defaultGenerateMagicalGirlService } from '@/lib/hosted-api/generate-magical-girl';
import {
  defaultGenerateMagicalGirlDetailsService,
  hostedService as magicalGirlDetailsCore,
} from '@/lib/hosted-api/generate-magical-girl-details';
import {
  defaultGenerateMagicalGirlDetailsStreamService,
  hostedService as magicalGirlDetailsStreamCore,
} from '@/lib/hosted-api/generate-magical-girl-details-stream';
import { defaultGenerateScenarioService } from '@/lib/hosted-api/generate-scenario';
import { defaultGenerateScenarioStreamService } from '@/lib/hosted-api/generate-scenario-stream';
import {
  defaultGenerateSublimationService,
  hostedService as sublimationCore,
} from '@/lib/hosted-api/generate-sublimation';
import {
  defaultGenerateSublimationStreamService,
  hostedService as sublimationStreamCore,
} from '@/lib/hosted-api/generate-sublimation-stream';

describe('14 retained / staged Hosted services identity', () => {
  test('Next DR 与 Hono 使用同一 package Node core composition', () => {
    expect([
      defaultGenerateFreeService,
      defaultGenerateFreeStreamService,
      defaultGenerateScenarioService,
      defaultGenerateScenarioStreamService,
      defaultGenerateCanshouService,
      defaultGenerateCanshouStreamService,
      defaultGenerateMagicalGirlService,
      defaultGenerateGameCardService,
      defaultGenerateCreatorService,
      defaultGenerateCreatorStreamService,
      magicalGirlDetailsCore,
      magicalGirlDetailsStreamCore,
      sublimationCore,
      sublimationStreamCore,
    ]).toEqual([
      packageFree,
      packageFreeStream,
      packageScenario,
      packageScenarioStream,
      packageCanshou,
      packageCanshouStream,
      packageMagicalGirl,
      packageGameCard,
      packageCreator,
      packageCreatorStream,
      packageMagicalGirlDetails,
      packageMagicalGirlDetailsStream,
      packageSublimation,
      packageSublimationStream,
    ]);
    expect(defaultGenerateMagicalGirlDetailsService).not.toBe(magicalGirlDetailsCore);
    expect(defaultGenerateMagicalGirlDetailsStreamService).not.toBe(magicalGirlDetailsStreamCore);
    expect(defaultGenerateSublimationService).not.toBe(sublimationCore);
    expect(defaultGenerateSublimationStreamService).not.toBe(sublimationStreamCore);
  });

  test('Next DR lifecycle 输出固定 schema 且不记录请求 URL', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    try {
      const response = await defaultGenerateMagicalGirlDetailsService(new Request(
        'https://next-dr-secret-canary.test/api/generate-magical-girl-details',
        { method: 'GET' },
      ));
      expect(response.status).toBe(405);
      const payload = JSON.parse(String(info.mock.calls[0]?.[0]));
      expect(payload).toEqual(expect.objectContaining({
        event: 'hosted.generation.lifecycle',
        schemaVersion: 1,
        operation: 'generate-magical-girl-details',
        placement: 'next-dr',
        outcome: 'rejected',
      }));
      expect(JSON.stringify(info.mock.calls)).not.toContain('next-dr-secret-canary');
    } finally {
      info.mockRestore();
    }
  });
});
