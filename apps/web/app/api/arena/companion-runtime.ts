import {
  createArenaCompanionRouteService,
  createNodeArenaRepairMetaService,
  type ArenaCompanionRouteService,
} from '@mahoshojo/hosted-runtime/arena-companion';
import { readOwnedNodeArenaGenerationProvenance } from '@mahoshojo/hosted-runtime/arena-generation';
import { recordUserActivityFromRequest } from '@mahoshojo/hosted-runtime/node-runtime/data-ports';
import { createEnvSignatureService } from '@mahoshojo/hosted-runtime/node-runtime/env-signature';

import {
  getCloudflareDrArenaGenerationService,
  resolveCloudflareDrArenaGenerationActor,
} from './generation-runtime';
import { cloudflareArenaGenerationObserver } from './generation-telemetry';
import { getNextHostedD1Client } from '@/lib/hosted-dr/database-provider';

const globalKey = '__mahoshojoArenaCompanionDrServiceV1';

type GlobalWithArenaCompanion = typeof globalThis & {
  [globalKey]?: ArenaCompanionRouteService;
};

const buildService = (): ArenaCompanionRouteService => {
  const signatures = createEnvSignatureService();
  return createArenaCompanionRouteService({
    generationService: getCloudflareDrArenaGenerationService(),
    signatures,
    placement: 'next-dr',
    observer: cloudflareArenaGenerationObserver,
    recordActivity: recordUserActivityFromRequest,
    repairMetaService: createNodeArenaRepairMetaService({
      resolveActor: resolveCloudflareDrArenaGenerationActor,
      readProvenance: async (input) => {
        const client = getNextHostedD1Client();
        if (!client) throw new Error('ARENA_D1_UNAVAILABLE');
        return readOwnedNodeArenaGenerationProvenance({ client, ...input });
      },
      verifySignature: (value) => signatures.verifySignature(value),
      recordActivity: recordUserActivityFromRequest,
    }),
  });
};

export const getCloudflareDrArenaCompanionService = (): ArenaCompanionRouteService => {
  const scope = globalThis as GlobalWithArenaCompanion;
  scope[globalKey] ??= buildService();
  return scope[globalKey];
};
