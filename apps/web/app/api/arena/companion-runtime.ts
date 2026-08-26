import {
  createArenaCompanionRouteService,
  type ArenaCompanionRouteService,
} from '@mahoshojo/hosted-runtime/arena-companion';
import { recordUserActivityFromRequest } from '@mahoshojo/hosted-runtime/node-runtime/data-ports';
import { createEnvSignatureService } from '@mahoshojo/hosted-runtime/node-runtime/env-signature';

import { getCloudflareDrArenaGenerationService } from './generation-runtime';

const globalKey = '__mahoshojoArenaCompanionDrServiceV1';

type GlobalWithArenaCompanion = typeof globalThis & {
  [globalKey]?: ArenaCompanionRouteService;
};

const buildService = (): ArenaCompanionRouteService => createArenaCompanionRouteService({
  generationService: getCloudflareDrArenaGenerationService(),
  signatures: createEnvSignatureService(),
  recordActivity: recordUserActivityFromRequest,
});

export const getCloudflareDrArenaCompanionService = (): ArenaCompanionRouteService => {
  const scope = globalThis as GlobalWithArenaCompanion;
  scope[globalKey] ??= buildService();
  return scope[globalKey];
};
