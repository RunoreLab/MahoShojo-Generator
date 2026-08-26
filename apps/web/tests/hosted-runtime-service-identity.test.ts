import { describe, expect, test } from 'vitest';

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
} from '@mahoshojo/hosted-runtime/node-runtime/default-services';
import { defaultGenerateCanshouService } from '@/lib/hosted-api/generate-canshou';
import { defaultGenerateCanshouStreamService } from '@/lib/hosted-api/generate-canshou-stream';
import { defaultGenerateCreatorService } from '@/lib/hosted-api/generate-creator';
import { defaultGenerateCreatorStreamService } from '@/lib/hosted-api/generate-creator-stream';
import { defaultGenerateFreeService } from '@/lib/hosted-api/generate-free';
import { defaultGenerateFreeStreamService } from '@/lib/hosted-api/generate-free-stream';
import { defaultGenerateGameCardService } from '@/lib/hosted-api/generate-game-card';
import { defaultGenerateMagicalGirlService } from '@/lib/hosted-api/generate-magical-girl';
import { defaultGenerateMagicalGirlDetailsService } from '@/lib/hosted-api/generate-magical-girl-details';
import { defaultGenerateMagicalGirlDetailsStreamService } from '@/lib/hosted-api/generate-magical-girl-details-stream';
import { defaultGenerateScenarioService } from '@/lib/hosted-api/generate-scenario';
import { defaultGenerateScenarioStreamService } from '@/lib/hosted-api/generate-scenario-stream';

describe('12 retained / staged Hosted services identity', () => {
  test('legacy Next compatibility 与 package Node composition 复用同一实例', () => {
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
      defaultGenerateMagicalGirlDetailsService,
      defaultGenerateMagicalGirlDetailsStreamService,
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
    ]);
  });
});
