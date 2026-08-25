import { createMemoryGenerationReplayStore } from '@mahoshojo/hosted-api/arena-generation/memory-replay-store';
import {
  createArenaGenerationFinalizer,
  createArenaR2ObjectStoreFromEnvironment,
  createNodeArenaGenerationFinalizationPorts,
  createNodeArenaGenerationService,
  createNodeArenaGenerationTerminalStore,
} from '@mahoshojo/hosted-runtime/arena-generation';
import { getDefaultNodeD1Client } from '@mahoshojo/hosted-runtime/node-runtime/d1-client';

import { readGenerationRankingForGeneration } from '@/app/api/arena/generation-ranking/handler';
import { settleArenaRatingsForGeneration } from '@/lib/database/arena-ratings';
import { cloudflareArenaGenerationObserver } from '@/app/api/arena/generation-telemetry';

const globalKey = '__mahoshojoArenaGenerationDrServiceV1';

type GlobalWithArenaGeneration = typeof globalThis & {
  [globalKey]?: ReturnType<typeof createNodeArenaGenerationService>;
};

const buildService = (): ReturnType<typeof createNodeArenaGenerationService> => {
  const getD1Client = () => getDefaultNodeD1Client();
  const objectStore = createArenaR2ObjectStoreFromEnvironment();
  const persistence = createNodeArenaGenerationFinalizationPorts({
    getD1Client,
    ...(objectStore ? { objectStore } : {}),
    settleRatings: settleArenaRatingsForGeneration,
    readRanking: readGenerationRankingForGeneration,
  });
  return createNodeArenaGenerationService({
    store: createMemoryGenerationReplayStore(),
    terminalStore: createNodeArenaGenerationTerminalStore({
      getD1Client,
      ...(objectStore ? { objectStore } : {}),
    }),
    getD1Client,
    observer: cloudflareArenaGenerationObserver,
    executorOptions: {
      finalizer: createArenaGenerationFinalizer(persistence, {
        observer: cloudflareArenaGenerationObserver,
      }),
    },
  });
};

export const getCloudflareDrArenaGenerationService = () => {
  const scope = globalThis as GlobalWithArenaGeneration;
  scope[globalKey] ??= buildService();
  return scope[globalKey];
};
